import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';
import { getTransactionStatus } from '../services/algorand.js';

const router = Router();

/**
 * GET /api/transactions/:txHash
 * Transaction details by hash with blockchain confirmation status
 */
router.get('/transactions/:txHash', async (req: Request, res: Response) => {
  try {
    const { txHash } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get transaction from database
    const transaction = await prisma.blockchainTransaction.findUnique({
      where: { txHash },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            ownerId: true,
          },
        },
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
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Verify user has access to this transaction
    const hasAccess =
      transaction.project.ownerId === userId ||
      transaction.task?.assignedTo?.id === userId ||
      (await prisma.userRole.count({
        where: {
          userId,
          projectId: transaction.projectId,
          status: 'ACTIVE',
        },
      })) > 0;

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to this transaction' });
    }

    // Get real-time status from blockchain if pending
    let blockchainStatus = null;
    if (transaction.status === 'PENDING') {
      try {
        blockchainStatus = await getTransactionStatus(txHash);
        
        // Update database if status changed
        if (blockchainStatus.confirmed) {
          await prisma.blockchainTransaction.update({
            where: { id: transaction.id },
            data: {
              status: 'CONFIRMED',
              blockNumber: blockchainStatus.blockNumber,
              confirmations: blockchainStatus.confirmations,
              confirmedAt: new Date(),
            },
          });
        }
      } catch (error) {
        console.error('Error fetching blockchain status:', error);
      }
    }

    res.json({
      id: transaction.id,
      txHash: transaction.txHash,
      type: transaction.type,
      amount: transaction.amount,
      fee: transaction.fee,
      fromAddress: transaction.fromAddress,
      toAddress: transaction.toAddress,
      status: blockchainStatus?.status || transaction.status,
      blockNumber: blockchainStatus?.blockNumber?.toString() || transaction.blockNumber?.toString(),
      confirmations: blockchainStatus?.confirmations || transaction.confirmations,
      note: transaction.note,
      errorMessage: transaction.errorMessage,
      submittedAt: transaction.submittedAt,
      confirmedAt: transaction.confirmedAt,
      project: {
        id: transaction.project.id,
        name: transaction.project.name,
      },
      task: transaction.task
        ? {
            id: transaction.task.id,
            title: transaction.task.title,
            employee: transaction.task.assignedTo,
          }
        : null,
    });
  } catch (error: any) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch transaction' });
  }
});

/**
 * GET /api/users/:userId/earnings
 * Total earnings for an employee across all projects
 */
router.get('/users/:userId/earnings', async (req: Request, res: Response) => {
  try {
    const { userId: targetUserId } = req.params;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Users can only view their own earnings unless they're a project owner/manager
    if (currentUserId !== targetUserId) {
      // Check if current user is owner/manager of any project with this user
      const hasAccess = await prisma.project.count({
        where: {
          OR: [
            { ownerId: currentUserId },
            {
              userRoles: {
                some: {
                  userId: currentUserId,
                  role: 'PROJECT_MANAGER',
                  status: 'ACTIVE',
                },
              },
            },
          ],
          userRoles: {
            some: {
              userId: targetUserId,
              role: 'EMPLOYEE',
            },
          },
        },
      });

      if (hasAccess === 0) {
        return res.status(403).json({ error: 'Access denied to this user\'s earnings' });
      }
    }

    // Get all tasks for the user with payment information
    const tasks = await prisma.task.findMany({
      where: {
        employeeId: targetUserId,
        paymentAmount: { not: null },
      },
      include: {
        department: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        blockchainPayment: {
          select: {
            txHash: true,
            status: true,
            confirmedAt: true,
          },
        },
      },
    });

    // Calculate totals
    const totalPending = tasks
      .filter((t) => ['PENDING', 'ALLOCATED'].includes(t.paymentStatus))
      .reduce((sum, t) => sum + (t.paymentAmount || 0), 0);

    const totalPaid = tasks
      .filter((t) => t.paymentStatus === 'PAID')
      .reduce((sum, t) => sum + (t.paymentAmount || 0), 0);

    const totalProcessing = tasks
      .filter((t) => t.paymentStatus === 'PROCESSING')
      .reduce((sum, t) => sum + (t.paymentAmount || 0), 0);

    const totalEarnings = tasks.reduce((sum, t) => sum + (t.paymentAmount || 0), 0);

    // Group by project
    const byProject = tasks.reduce((acc: any[], task) => {
      const projectId = task.department.project.id;
      const existing = acc.find((p) => p.projectId === projectId);

      if (existing) {
        existing.total += task.paymentAmount || 0;
        existing.paid += task.paymentStatus === 'PAID' ? task.paymentAmount || 0 : 0;
        existing.pending += ['PENDING', 'ALLOCATED'].includes(task.paymentStatus)
          ? task.paymentAmount || 0
          : 0;
        existing.tasks.push({
          id: task.id,
          title: task.title,
          amount: task.paymentAmount,
          status: task.paymentStatus,
          paidAt: task.paidAt,
          txHash: task.blockchainPayment?.txHash,
        });
      } else {
        acc.push({
          projectId,
          projectName: task.department.project.name,
          total: task.paymentAmount || 0,
          paid: task.paymentStatus === 'PAID' ? task.paymentAmount || 0 : 0,
          pending: ['PENDING', 'ALLOCATED'].includes(task.paymentStatus)
            ? task.paymentAmount || 0
            : 0,
          tasks: [
            {
              id: task.id,
              title: task.title,
              amount: task.paymentAmount,
              status: task.paymentStatus,
              paidAt: task.paidAt,
              txHash: task.blockchainPayment?.txHash,
            },
          ],
        });
      }

      return acc;
    }, []);

    res.json({
      userId: targetUserId,
      total: totalEarnings,
      paid: totalPaid,
      pending: totalPending,
      processing: totalProcessing,
      taskCount: tasks.length,
      byProject,
      recentTransactions: tasks
        .filter((t) => t.blockchainPayment && t.paymentStatus === 'PAID')
        .sort((a, b) => (b.paidAt?.getTime() || 0) - (a.paidAt?.getTime() || 0))
        .slice(0, 10)
        .map((t) => ({
          taskId: t.id,
          taskTitle: t.title,
          amount: t.paymentAmount,
          txHash: t.blockchainPayment?.txHash,
          paidAt: t.paidAt,
          projectName: t.department.project.name,
        })),
    });
  } catch (error: any) {
    console.error('Error fetching earnings:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch earnings' });
  }
});

/**
 * GET /api/projects/:projectId/payment-summary
 * Budget overview and payment breakdown for a project
 */
router.get('/projects/:projectId/payment-summary', async (req: Request, res: Response) => {
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

    const isOwner = project.ownerId === userId;
    const isManager = project.userRoles.some((role) => role.role === 'PROJECT_MANAGER');

    if (!isOwner && !isManager) {
      return res.status(403).json({ error: 'Only owners and managers can view payment summary' });
    }

    // Get all tasks with payment information
    const tasks = await prisma.task.findMany({
      where: {
        department: {
          projectId,
        },
        paymentAmount: { not: null },
      },
      include: {
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        blockchainPayment: {
          select: {
            txHash: true,
            status: true,
            confirmedAt: true,
          },
        },
      },
    });

    // Calculate budget metrics
    const budgetAmount = project.budgetAmount || 0;
    const allocatedFunds = project.allocatedFunds || 0;
    const releasedFunds = project.releasedFunds || 0;
    const availableFunds = budgetAmount - allocatedFunds;
    const escrowBalance = project.escrow?.currentBalance || 0;

    // Payment breakdown by employee
    const byEmployee = tasks.reduce((acc: any[], task) => {
      if (!task.assignedTo) return acc;

      const employeeId = task.assignedTo.id;
      const existing = acc.find((e) => e.employeeId === employeeId);

      if (existing) {
        existing.totalAllocated += task.paymentAmount || 0;
        existing.totalPaid += task.paymentStatus === 'PAID' ? task.paymentAmount || 0 : 0;
        existing.totalPending += ['PENDING', 'ALLOCATED'].includes(task.paymentStatus)
          ? task.paymentAmount || 0
          : 0;
        existing.taskCount += 1;
        existing.completedTasks += task.status === 'COMPLETED' || task.status === 'APPROVED' ? 1 : 0;
      } else {
        acc.push({
          employeeId,
          employeeName: `${task.assignedTo.firstName || ''} ${task.assignedTo.lastName || ''}`.trim() || task.assignedTo.email,
          totalAllocated: task.paymentAmount || 0,
          totalPaid: task.paymentStatus === 'PAID' ? task.paymentAmount || 0 : 0,
          totalPending: ['PENDING', 'ALLOCATED'].includes(task.paymentStatus)
            ? task.paymentAmount || 0
            : 0,
          taskCount: 1,
          completedTasks: task.status === 'COMPLETED' || task.status === 'APPROVED' ? 1 : 0,
        });
      }

      return acc;
    }, []);

    // Payment status breakdown
    const statusBreakdown = {
      pending: tasks.filter((t) => t.paymentStatus === 'PENDING').length,
      allocated: tasks.filter((t) => t.paymentStatus === 'ALLOCATED').length,
      processing: tasks.filter((t) => t.paymentStatus === 'PROCESSING').length,
      paid: tasks.filter((t) => t.paymentStatus === 'PAID').length,
      failed: tasks.filter((t) => t.paymentStatus === 'FAILED').length,
    };

    // Recent payments
    const recentPayments = tasks
      .filter((t) => t.paymentStatus === 'PAID' && t.paidAt)
      .sort((a, b) => (b.paidAt?.getTime() || 0) - (a.paidAt?.getTime() || 0))
      .slice(0, 10)
      .map((t) => ({
        taskId: t.id,
        taskTitle: t.title,
        amount: t.paymentAmount,
        employee: t.assignedTo,
        txHash: t.blockchainPayment?.txHash,
        paidAt: t.paidAt,
      }));

    res.json({
      projectId,
      projectName: project.name,
      budget: {
        total: budgetAmount,
        allocated: allocatedFunds,
        released: releasedFunds,
        available: availableFunds,
        escrowBalance,
        utilizationPercent: budgetAmount > 0 ? (allocatedFunds / budgetAmount) * 100 : 0,
      },
      payments: {
        totalTasks: tasks.length,
        statusBreakdown,
        byEmployee: byEmployee.sort((a, b) => b.totalAllocated - a.totalAllocated),
        recentPayments,
      },
      escrow: {
        address: project.escrow?.escrowAddress,
        funded: project.escrowFunded,
        status: project.escrow?.status,
      },
    });
  } catch (error: any) {
    console.error('Error fetching payment summary:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch payment summary' });
  }
});

/**
 * GET /api/projects/:projectId/transactions
 * All blockchain transactions for a project (with pagination)
 */
router.get('/projects/:projectId/transactions', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const {
      type,
      status,
      page = '1',
      limit = '20',
      startDate,
      endDate,
    } = req.query;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verify user has access to project
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        userRoles: {
          where: { userId, status: 'ACTIVE' },
        },
      },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const hasAccess = project.ownerId === userId || project.userRoles.length > 0;

    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Build query filters
    const where: any = { projectId };
    if (type) where.type = type as string;
    if (status) where.status = status as string;
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    // Calculate pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Get total count
    const total = await prisma.blockchainTransaction.count({ where });

    // Get transactions
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
      skip,
      take: limitNum,
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
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error: any) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch transactions' });
  }
});

export default router;

