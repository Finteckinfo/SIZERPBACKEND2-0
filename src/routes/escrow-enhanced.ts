import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';
import { getEscrowBalance, verifyDepositTransaction } from '../services/algorand.js';

const router = Router();

/**
 * POST /api/projects/:projectId/escrow/fund
 * Integrated wallet funding or manual deposit recording
 */
router.post('/projects/:projectId/escrow/fund', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { amount, txHash } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!amount || !txHash) {
      return res.status(400).json({ error: 'amount and txHash are required' });
    }

    // Verify user is project owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: { escrow: true },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId !== userId) {
      return res.status(403).json({ error: 'Only project owner can fund escrow' });
    }

    if (!project.escrow) {
      return res.status(400).json({ error: 'Escrow account not created for this project' });
    }

    // Verify transaction on blockchain
    const verification = await verifyDepositTransaction(
      txHash,
      parseFloat(amount),
      project.escrow.escrowAddress
    );

    // Record transaction
    await prisma.blockchainTransaction.create({
      data: {
        txHash,
        type: 'DEPOSIT',
        amount: verification.amount,
        fee: verification.fee,
        fromAddress: 'EXTERNAL',
        toAddress: project.escrow.escrowAddress,
        projectId,
        status: verification.confirmed ? 'CONFIRMED' : 'PENDING',
        blockNumber: verification.blockNumber ? BigInt(verification.blockNumber) : null,
        confirmations: verification.confirmed ? 1 : 0,
        submittedAt: new Date(),
        confirmedAt: verification.confirmed ? new Date() : null,
        note: 'Escrow funding',
      },
    });

    // Update escrow balance
    const newBalance = project.escrow.currentBalance + verification.amount;
    await prisma.projectEscrow.update({
      where: { id: project.escrow.id },
      data: {
        currentBalance: newBalance,
        initialDeposit: project.escrow.initialDeposit === 0 ? verification.amount : project.escrow.initialDeposit,
      },
    });

    // Mark project as funded
    await prisma.project.update({
      where: { id: projectId },
      data: { escrowFunded: true },
    });

    res.json({
      success: true,
      verified: verification.confirmed,
      currentBalance: newBalance,
      txHash,
    });
  } catch (error: any) {
    console.error('Error funding escrow:', error);
    res.status(500).json({ error: error.message || 'Failed to fund escrow' });
  }
});

/**
 * GET /api/projects/:projectId/escrow/funding-needed
 * Calculate how much funding is needed
 */
router.get('/projects/:projectId/escrow/funding-needed', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        escrow: true,
        recurringPayments: {
          where: { status: 'ACTIVE' },
        },
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Verify access
    const hasAccess = project.ownerId === userId || await prisma.userRole.count({
      where: {
        userId,
        projectId,
        status: 'ACTIVE',
      },
    }) > 0;

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const currentBalance = project.escrow ? await getEscrowBalance(project.escrow.escrowAddress) : 0;

    const [pendingTaskSum, processingTransfers] = await Promise.all([
      prisma.task.aggregate({
        where: {
          department: { projectId },
          paymentAmount: { not: null },
          paymentStatus: { in: ['PENDING', 'ALLOCATED'] },
        },
        _sum: { paymentAmount: true },
      }),
      prisma.blockchainTransaction.aggregate({
        where: {
          projectId,
          status: 'PENDING',
          type: { in: ['TASK_PAYMENT', 'SALARY_PAYMENT'] },
        },
        _sum: { amount: true },
      }),
    ]);

    const pendingTasksTotal = pendingTaskSum._sum.paymentAmount || 0;
    const processingTotal = processingTransfers._sum.amount || 0;
    const obligations = pendingTasksTotal + processingTotal;
    const available = currentBalance - obligations;

    // Calculate upcoming recurring payments
    const now = new Date();
    const next7Days = new Date(now);
    next7Days.setDate(next7Days.getDate() + 7);
    const next30Days = new Date(now);
    next30Days.setDate(next30Days.getDate() + 30);
    const next90Days = new Date(now);
    next90Days.setDate(next90Days.getDate() + 90);

    let upcoming7 = 0;
    let upcoming30 = 0;
    let upcoming90 = 0;

    project.recurringPayments.forEach((payment) => {
      if (payment.nextPaymentDate <= next7Days) {
        upcoming7 += payment.amount;
      }
      if (payment.nextPaymentDate <= next30Days) {
        upcoming30 += payment.amount;
      }
      if (payment.nextPaymentDate <= next90Days) {
        upcoming90 += payment.amount;
      }
    });

    // Get pending task payments
    const pendingTasks = await prisma.task.count({
      where: {
        department: { projectId },
        paymentStatus: { in: ['PENDING', 'ALLOCATED'] },
        paymentAmount: { not: null },
      },
    });

    const tasksTotal = await prisma.task.aggregate({
      where: {
        department: { projectId },
        paymentStatus: { in: ['PENDING', 'ALLOCATED'] },
        paymentAmount: { not: null },
      },
      _sum: { paymentAmount: true },
    });

    const taskPayments = tasksTotal._sum.paymentAmount || 0;

    // Calculate recommended funding
    const minimumBalance = project.minimumBalance || 0;
    const totalNeeded = upcoming30 + taskPayments;
    const recommended = Math.max(totalNeeded - available, minimumBalance - currentBalance, 0);

    // Check if critical
    const critical = currentBalance < minimumBalance || available < upcoming7;

    res.json({
      currentBalance,
      obligations: {
        pendingTasks: pendingTasksTotal,
        processingTransfers: processingTotal,
        total: obligations,
      },
      available: available < 0 ? 0 : available,
      upcoming: {
        next7Days: upcoming7,
        next30Days: upcoming30,
        next90Days: upcoming90,
      },
      breakdown: {
        tasks: taskPayments,
        salaries: upcoming30,
      },
      recommended,
      critical,
    });
  } catch (error: any) {
    console.error('Error calculating funding needed:', error);
    res.status(500).json({ error: error.message || 'Failed to calculate funding needed' });
  }
});

export default router;

