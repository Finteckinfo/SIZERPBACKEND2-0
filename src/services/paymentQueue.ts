import { Queue, Worker, Job } from 'bullmq';
import { createClient } from 'redis';
import { prisma } from '../utils/database.js';
import { createPaymentTransaction, waitForConfirmation, getTransactionStatus } from './algorand.js';
import winston from 'winston';

// Setup logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'payment-errors.log', level: 'error' }),
    new winston.transports.File({ filename: 'payments.log' }),
  ],
});

// Redis connection for BullMQ
const redisUrl = process.env.REDIS_URL || process.env.RAILWAY_REDIS_URL || 'redis://localhost:6379';
const connection = createClient({ url: redisUrl });

// Create payment processing queue
export const paymentQueue = new Queue('task-payments', { connection: connection as any });

// Job data interface
interface PaymentJobData {
  taskId: string;
  projectId: string;
  employeeWalletAddress: string;
  amount: number;
  escrowAddress: string;
  encryptedPrivateKey: string;
}

/**
 * Adds a payment job to the queue
 */
export async function queuePayment(data: PaymentJobData) {
  try {
    const job = await paymentQueue.add('process-payment', data, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: false,
      removeOnFail: false,
    });
    
    logger.info('Payment job queued', { jobId: job.id, taskId: data.taskId });
    return job.id;
  } catch (error) {
    logger.error('Error queueing payment', { error, data });
    throw error;
  }
}

/**
 * Process payment jobs
 */
const paymentWorker = new Worker<PaymentJobData>(
  'task-payments',
  async (job: Job<PaymentJobData>) => {
    const { taskId, projectId, employeeWalletAddress, amount, escrowAddress, encryptedPrivateKey } = job.data;
    
    logger.info('Processing payment', { taskId, amount, to: employeeWalletAddress });
    
    try {
      // Update task status to PROCESSING
      await prisma.task.update({
        where: { id: taskId },
        data: { paymentStatus: 'PROCESSING' },
      });
      
      // Create and send blockchain transaction
      const note = `Task payment: ${taskId}`;
      const txResult = await createPaymentTransaction(
        escrowAddress,
        encryptedPrivateKey,
        employeeWalletAddress,
        amount,
        note
      );
      
      logger.info('Transaction submitted', { 
        taskId, 
        txHash: txResult.txHash,
        amount: txResult.amount,
        fee: txResult.fee 
      });
      
      // Record transaction in database
      const blockchainTx = await prisma.blockchainTransaction.create({
        data: {
          txHash: txResult.txHash,
          type: 'TASK_PAYMENT',
          amount: txResult.amount,
          fee: txResult.fee,
          fromAddress: escrowAddress,
          toAddress: employeeWalletAddress,
          projectId,
          taskId,
          status: 'PENDING',
          note,
          submittedAt: new Date(),
        },
      });
      
      // Wait for confirmation
      const confirmation = await waitForConfirmation(txResult.txHash);
      
      logger.info('Transaction confirmed', {
        taskId,
        txHash: txResult.txHash,
        blockNumber: confirmation.blockNumber,
      });
      
      // Update transaction status
      await prisma.blockchainTransaction.update({
        where: { id: blockchainTx.id },
        data: {
          status: 'CONFIRMED',
          blockNumber: BigInt(confirmation.blockNumber),
          confirmations: 1,
          confirmedAt: new Date(),
        },
      });
      
      // Update task payment status
      await prisma.task.update({
        where: { id: taskId },
        data: {
          paymentStatus: 'PAID',
          paymentTxHash: txResult.txHash,
          paidAt: new Date(),
        },
      });
      
      // Update project released funds
      await prisma.project.update({
        where: { id: projectId },
        data: {
          releasedFunds: {
            increment: amount,
          },
        },
      });
      
      logger.info('Payment completed successfully', { taskId, txHash: txResult.txHash });
      
      return {
        success: true,
        txHash: txResult.txHash,
        blockNumber: confirmation.blockNumber,
      };
    } catch (error: any) {
      logger.error('Payment processing failed', { taskId, error: error.message });
      
      // Update task status to FAILED
      await prisma.task.update({
        where: { id: taskId },
        data: { paymentStatus: 'FAILED' },
      });
      
      // If transaction was created, update its status
      const existingTx = await prisma.blockchainTransaction.findFirst({
        where: { taskId },
      });
      
      if (existingTx) {
        await prisma.blockchainTransaction.update({
          where: { id: existingTx.id },
          data: {
            status: 'FAILED',
            errorMessage: error.message,
          },
        });
      }
      
      throw error;
    }
  },
  { connection: connection as any }
);

paymentWorker.on('completed', (job) => {
  logger.info('Payment job completed', { jobId: job.id });
});

paymentWorker.on('failed', (job, err) => {
  logger.error('Payment job failed', { jobId: job?.id, error: err.message });
});

/**
 * Monitor transaction confirmations in the background
 */
export async function monitorPendingTransactions() {
  try {
    const pendingTxs = await prisma.blockchainTransaction.findMany({
      where: {
        status: 'PENDING',
        submittedAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
    });
    
    logger.info(`Monitoring ${pendingTxs.length} pending transactions`);
    
    for (const tx of pendingTxs) {
      try {
        const status = await getTransactionStatus(tx.txHash);
        
        if (status.confirmed && status.blockNumber) {
          await prisma.blockchainTransaction.update({
            where: { id: tx.id },
            data: {
              status: 'CONFIRMED',
              blockNumber: status.blockNumber,
              confirmations: status.confirmations,
              confirmedAt: new Date(),
            },
          });
          
          // If it's a task payment, update task status
          if (tx.taskId) {
            await prisma.task.update({
              where: { id: tx.taskId },
              data: {
                paymentStatus: 'PAID',
                paidAt: new Date(),
              },
            });
          }
          
          logger.info('Transaction confirmed during monitoring', {
            txHash: tx.txHash,
            confirmations: status.confirmations,
          });
        } else if (status.status === 'FAILED') {
          await prisma.blockchainTransaction.update({
            where: { id: tx.id },
            data: {
              status: 'FAILED',
              errorMessage: 'Transaction failed on blockchain',
            },
          });
          
          if (tx.taskId) {
            await prisma.task.update({
              where: { id: tx.taskId },
              data: { paymentStatus: 'FAILED' },
            });
          }
          
          logger.error('Transaction failed during monitoring', { txHash: tx.txHash });
        }
      } catch (error: any) {
        logger.error('Error monitoring transaction', {
          txHash: tx.txHash,
          error: error.message,
        });
      }
    }
  } catch (error: any) {
    logger.error('Error in transaction monitoring', { error: error.message });
  }
}

// Run monitoring every 5 minutes
setInterval(monitorPendingTransactions, 5 * 60 * 1000);

logger.info('Payment queue and worker initialized');

