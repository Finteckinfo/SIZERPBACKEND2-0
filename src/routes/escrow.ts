import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';
import {
  createEscrowAccount,
  getEscrowBalance,
  verifyDepositTransaction,
  getAddressTransactions,
  optInToSIZCOIN,
  isOptedInToSIZCOIN,
} from '../services/algorand.js';

const SIZCOIN_ASSET_ID = 2905622564;

const router = Router();

/**
 * POST /api/projects/:projectId/escrow/create
 * Creates Algorand escrow account for project
 */
router.post('/projects/:projectId/escrow/create', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify user is project owner or manager
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        userRoles: {
          where: { userId },
        },
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const isOwner = project.ownerId === userId;
    const isManager = project.userRoles.some(
      (role) => role.role === 'PROJECT_MANAGER' && role.status === 'ACTIVE'
    );

    if (!isOwner && !isManager) {
      return res.status(403).json({ error: 'Only project owners and managers can create escrow accounts' });
    }

    // Check if escrow already exists
    const existingEscrow = await prisma.projectEscrow.findUnique({
      where: { projectId },
    });

    if (existingEscrow) {
      return res.status(400).json({ error: 'Escrow account already exists for this project' });
    }

    // Create escrow account
    const result = await createEscrowAccount(projectId);

    res.json({
      success: true,
      escrowAddress: result.escrowAddress,
      assetId: result.assetId,
      message: 'Escrow account created successfully.',
      instructions: {
        step1: 'Fund this escrow address with ALGO (minimum 0.1 ALGO for transaction fees)',
        step2: `Call POST /api/projects/${projectId}/escrow/opt-in to opt-in to SIZCOIN`,
        step3: 'Fund the escrow with SIZCOIN tokens',
        step4: 'Record the deposit using POST /api/projects/:projectId/escrow/deposit',
      },
      note: result.note,
    });
  } catch (error: any) {
    console.error('Error creating escrow:', error);
    res.status(500).json({ error: error.message || 'Failed to create escrow account' });
  }
});

/**
 * POST /api/projects/:projectId/escrow/opt-in
 * Opts the escrow account into SIZCOIN asset
 */
router.post('/projects/:projectId/escrow/opt-in', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify user is project owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        escrow: true,
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId !== userId) {
      return res.status(403).json({ error: 'Only project owner can opt-in escrow to SIZCOIN' });
    }

    if (!project.escrow) {
      return res.status(400).json({ error: 'Escrow account not created for this project' });
    }

    // Check if already opted-in
    const alreadyOptedIn = await isOptedInToSIZCOIN(project.escrow.escrowAddress);
    if (alreadyOptedIn) {
      return res.status(400).json({ 
        error: 'Escrow is already opted-in to SIZCOIN',
        assetId: SIZCOIN_ASSET_ID,
      });
    }

    // Perform opt-in
    const result = await optInToSIZCOIN(
      project.escrow.escrowAddress,
      project.escrow.encryptedPrivateKey
    );

    res.json({
      success: true,
      ...result,
      message: 'Escrow successfully opted-in to SIZCOIN. You can now fund it with SIZCOIN tokens.',
    });
  } catch (error: any) {
    console.error('Error opting in to SIZCOIN:', error);
    res.status(500).json({ error: error.message || 'Failed to opt-in to SIZCOIN' });
  }
});

/**
 * POST /api/projects/:projectId/escrow/deposit
 * Records owner's SIZCOIN deposit transaction
 */
router.post('/projects/:projectId/escrow/deposit', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { txHash, amount } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!txHash || !amount) {
      return res.status(400).json({ error: 'txHash and amount are required' });
    }

    // Verify user is project owner
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        escrow: true,
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.ownerId !== userId) {
      return res.status(403).json({ error: 'Only project owner can record deposits' });
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
        fromAddress: 'EXTERNAL', // Will be updated with actual sender
        toAddress: project.escrow.escrowAddress,
        projectId,
        status: verification.confirmed ? 'CONFIRMED' : 'PENDING',
        blockNumber: verification.blockNumber ? BigInt(verification.blockNumber) : null,
        confirmations: verification.confirmed ? 1 : 0,
        submittedAt: new Date(),
        confirmedAt: verification.confirmed ? new Date() : null,
        note: 'Project escrow deposit',
      },
    });

    // Update escrow balance
    const newBalance = project.escrow.currentBalance + verification.amount;
    const isFirstDeposit = project.escrow.initialDeposit === 0;

    await prisma.projectEscrow.update({
      where: { id: project.escrow.id },
      data: {
        currentBalance: newBalance,
        initialDeposit: isFirstDeposit ? verification.amount : project.escrow.initialDeposit,
      },
    });

    // Mark project as funded
    await prisma.project.update({
      where: { id: projectId },
      data: {
        escrowFunded: true,
      },
    });

    res.json({
      success: true,
      txHash,
      amount: verification.amount,
      balance: newBalance,
      confirmed: verification.confirmed,
      message: 'Deposit recorded successfully',
    });
  } catch (error: any) {
    console.error('Error recording deposit:', error);
    res.status(500).json({ error: error.message || 'Failed to record deposit' });
  }
});

/**
 * GET /api/projects/:projectId/escrow/balance
 * Queries Algorand blockchain for current balance
 */
router.get('/projects/:projectId/escrow/balance', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify user has access to project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        escrow: true,
        userRoles: {
          where: { userId, status: 'ACTIVE' },
        },
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const hasAccess =
      project.ownerId === userId ||
      project.userRoles.length > 0;

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    if (!project.escrow) {
      return res.status(400).json({ error: 'Escrow account not created for this project' });
    }

    // Get real-time balance from blockchain
    const blockchainBalance = await getEscrowBalance(project.escrow.escrowAddress);

    // Update database balance
    await prisma.projectEscrow.update({
      where: { id: project.escrow.id },
      data: {
        currentBalance: blockchainBalance,
      },
    });

    // Calculate obligations based on pending tasks and in-flight transactions
    const [pendingTaskSum, processingTransactions] = await Promise.all([
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

    const taskHold = pendingTaskSum._sum.paymentAmount || 0;
    const processingHold = processingTransactions._sum.amount || 0;
    const totalObligations = taskHold + processingHold;
    const netAvailable = blockchainBalance - totalObligations;

    res.json({
      escrowAddress: project.escrow.escrowAddress,
      balance: blockchainBalance,
      obligations: {
        pendingTasks: taskHold,
        processingTransfers: processingHold,
        total: totalObligations,
      },
      released: project.releasedFunds || 0,
      netAvailable: netAvailable < 0 ? 0 : netAvailable,
      funded: project.escrowFunded,
    });
  } catch (error: any) {
    console.error('Error fetching balance:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch balance' });
  }
});

/**
 * GET /api/projects/:projectId/escrow/transactions
 * Lists all blockchain transactions for project
 */
router.get('/projects/:projectId/escrow/transactions', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { type, status, limit = '50' } = req.query;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify user has access to project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        escrow: true,
        userRoles: {
          where: { userId, status: 'ACTIVE' },
        },
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const hasAccess =
      project.ownerId === userId ||
      project.userRoles.length > 0;

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Build query filters
    const where: any = { projectId };
    if (type) where.type = type as string;
    if (status) where.status = status as string;

    // Get transactions from database
    const transactions = await prisma.blockchainTransaction.findMany({
      where,
      include: {
        task: {
          select: {
            id: true,
            title: true,
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit as string),
    });

    res.json({
      transactions: transactions.map((tx) => ({
        id: tx.id,
        txHash: tx.txHash,
        type: tx.type,
        amount: tx.amount,
        fee: tx.fee,
        fromAddress: tx.fromAddress,
        toAddress: tx.toAddress,
        status: tx.status,
        blockNumber: tx.blockNumber?.toString(),
        confirmations: tx.confirmations,
        note: tx.note,
        errorMessage: tx.errorMessage,
        submittedAt: tx.submittedAt,
        confirmedAt: tx.confirmedAt,
        task: tx.task
          ? {
              id: tx.task.id,
              title: tx.task.title,
              employee: tx.task.assignedTo,
            }
          : null,
      })),
      count: transactions.length,
    });
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch transactions' });
  }
});

export default router;

