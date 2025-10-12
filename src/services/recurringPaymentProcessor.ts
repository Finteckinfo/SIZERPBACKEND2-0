import { prisma } from '../utils/database.js';
import { createPaymentTransaction, getEscrowBalance } from './algorand.js';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'recurring-payments.log' }),
  ],
});

const SIZCOIN_ASSET_ID = 2905622564;

/**
 * Process all due recurring payments
 * This should be run daily via cron job
 */
export async function processRecurringPayments() {
  logger.info('Starting recurring payment processing...');
  
  try {
    // Find all active recurring payments that are due
    const now = new Date();
    const duePayments = await prisma.recurringPayment.findMany({
      where: {
        status: 'ACTIVE',
        nextPaymentDate: {
          lte: now,
        },
      },
      include: {
        project: {
          include: {
            escrow: true,
          },
        },
        userRole: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                walletAddress: true,
              },
            },
          },
        },
      },
    });

    logger.info(`Found ${duePayments.length} due payments`);

    let processed = 0;
    let failed = 0;
    let paused = 0;

    for (const payment of duePayments) {
      try {
        // Check if escrow exists and has sufficient balance
        if (!payment.project.escrow) {
          logger.error(`Project ${payment.projectId} has no escrow account`);
          await pausePayment(payment.id, 'No escrow account');
          paused++;
          continue;
        }

        // Get current blockchain balance
        const currentBalance = await getEscrowBalance(payment.project.escrow.escrowAddress);
        
        if (currentBalance < payment.amount) {
          logger.warn(`Insufficient balance for payment ${payment.id}. Need ${payment.amount}, have ${currentBalance}`);
          await pausePayment(payment.id, 'Insufficient balance');
          await sendLowBalanceAlert(payment.projectId);
          paused++;
          continue;
        }

        // Check if employee has wallet
        if (!payment.userRole.user.walletAddress) {
          logger.error(`User ${payment.userRole.userId} has no wallet address`);
          await pausePayment(payment.id, 'No wallet address');
          paused++;
          continue;
        }

        // Create SIZCOIN payment
        const txResult = await createPaymentTransaction(
          payment.project.escrow.escrowAddress,
          payment.project.escrow.encryptedPrivateKey,
          payment.userRole.user.walletAddress,
          payment.amount,
          `Salary payment - ${payment.frequency}`
        );

        // Record transaction
        await prisma.blockchainTransaction.create({
          data: {
            txHash: txResult.txHash,
            type: 'SALARY_PAYMENT',
            amount: payment.amount,
            fee: txResult.fee,
            fromAddress: payment.project.escrow.escrowAddress,
            toAddress: payment.userRole.user.walletAddress,
            projectId: payment.projectId,
            status: 'CONFIRMED',
            note: `Recurring ${payment.frequency} salary payment`,
            submittedAt: new Date(),
          },
        });

        // Calculate next payment date
        const nextDate = calculateNextPaymentDate(payment.nextPaymentDate, payment.frequency);

        // Update recurring payment
        await prisma.recurringPayment.update({
          where: { id: payment.id },
          data: {
            lastPaidDate: now,
            nextPaymentDate: nextDate,
            totalPaid: {
              increment: payment.amount,
            },
            paymentCount: {
              increment: 1,
            },
          },
        });

        // Update project released funds
        await prisma.project.update({
          where: { id: payment.projectId },
          data: {
            releasedFunds: {
              increment: payment.amount,
            },
          },
        });

        // Update escrow balance
        await prisma.projectEscrow.update({
          where: { id: payment.project.escrow.id },
          data: {
            currentBalance: {
              decrement: payment.amount,
            },
          },
        });

        logger.info(`Successfully processed payment ${payment.id} - ${payment.amount} SIZ to ${payment.userRole.user.email}`);
        processed++;

      } catch (error: any) {
        logger.error(`Failed to process payment ${payment.id}:`, error);
        await pausePayment(payment.id, error.message);
        failed++;
      }
    }

    logger.info(`Payment processing complete: ${processed} processed, ${paused} paused, ${failed} failed`);

    return {
      processed,
      paused,
      failed,
      total: duePayments.length,
    };

  } catch (error) {
    logger.error('Error in recurring payment processor:', error);
    throw error;
  }
}

/**
 * Check for low balances and send alerts
 */
export async function checkLowBalanceAlerts() {
  logger.info('Checking for low balance alerts...');

  try {
    const projects = await prisma.project.findMany({
      where: {
        minimumBalance: {
          not: null,
        },
        escrowFunded: true,
      },
      include: {
        escrow: true,
        owner: {
          select: {
            email: true,
            firstName: true,
          },
        },
      },
    });

    for (const project of projects) {
      if (!project.escrow || !project.minimumBalance) continue;

      const currentBalance = await getEscrowBalance(project.escrow.escrowAddress);

      if (currentBalance < project.minimumBalance) {
        logger.warn(`Project ${project.id} balance (${currentBalance}) below minimum (${project.minimumBalance})`);
        await sendLowBalanceAlert(project.id);
      }
    }

  } catch (error) {
    logger.error('Error checking low balance alerts:', error);
  }
}

// Helper functions

async function pausePayment(paymentId: string, reason: string) {
  await prisma.recurringPayment.update({
    where: { id: paymentId },
    data: {
      status: 'PAUSED',
    },
  });
  logger.warn(`Paused payment ${paymentId}: ${reason}`);
}

async function sendLowBalanceAlert(projectId: string) {
  // In production, send email/notification to project owner
  logger.info(`LOW BALANCE ALERT for project ${projectId}`);
  // TODO: Integrate with notification system
}

function calculateNextPaymentDate(currentDate: Date, frequency: string): Date {
  const next = new Date(currentDate);
  switch (frequency) {
    case 'WEEKLY':
      next.setDate(next.getDate() + 7);
      break;
    case 'BIWEEKLY':
      next.setDate(next.getDate() + 14);
      break;
    case 'MONTHLY':
      next.setMonth(next.getMonth() + 1);
      break;
  }
  return next;
}

// Export for cron job
export default processRecurringPayments;

