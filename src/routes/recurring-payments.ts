import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';
import { createPaymentTransaction } from '../services/algorand.js';

const router = Router();

/**
 * POST /api/projects/:projectId/recurring-payments
 * Create recurring salary payment
 */
router.post('/projects/:projectId/recurring-payments', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { userRoleId, amount, frequency, startDate, endDate } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
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
      return res.status(403).json({ error: 'Only project owner can create recurring payments' });
    }

    // Calculate total allocation and validate budget
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;
    const periodsInMonth = frequency === 'WEEKLY' ? 4 : frequency === 'BIWEEKLY' ? 2 : 1;
    const monthlyAllocation = amount * periodsInMonth;

    // Create recurring payment
    const nextDate = calculateNextPaymentDate(start, frequency);
    const recurring = await prisma.recurringPayment.create({
      data: {
        userRoleId,
        projectId,
        amount,
        frequency,
        startDate: start,
        endDate: end,
        nextPaymentDate: nextDate,
        status: 'ACTIVE',
      },
      include: {
        userRole: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    // Allocate funds
    await prisma.project.update({
      where: { id: projectId },
      data: {
        allocatedFunds: {
          increment: monthlyAllocation,
        },
      },
    });

    res.json({
      id: recurring.id,
      amount: recurring.amount,
      frequency: recurring.frequency,
      nextPaymentDate: recurring.nextPaymentDate,
      estimatedTotal: calculateEstimatedTotal(amount, frequency, start, end),
      fundsAllocated: monthlyAllocation,
    });
  } catch (error: any) {
    console.error('Error creating recurring payment:', error);
    res.status(500).json({ error: error.message || 'Failed to create recurring payment' });
  }
});

/**
 * GET /api/projects/:projectId/recurring-payments
 * List all recurring payments for project
 */
router.get('/projects/:projectId/recurring-payments', async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { status, userId: filterUserId } = req.query;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const where: any = { projectId };
    if (status) where.status = status;
    if (filterUserId) {
      where.userRole = { userId: filterUserId };
    }

    const payments = await prisma.recurringPayment.findMany({
      where,
      include: {
        userRole: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { nextPaymentDate: 'asc' },
    });

    // Calculate total monthly
    const totalMonthly = payments
      .filter((p) => p.status === 'ACTIVE')
      .reduce((sum, p) => {
        const multiplier = p.frequency === 'WEEKLY' ? 4 : p.frequency === 'BIWEEKLY' ? 2 : 1;
        return sum + p.amount * multiplier;
      }, 0);

    // Get upcoming payments (next 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const upcomingPayments = payments
      .filter((p) => p.status === 'ACTIVE' && p.nextPaymentDate <= thirtyDaysFromNow)
      .map((p) => ({
        date: p.nextPaymentDate,
        amount: p.amount,
        recipient: `${p.userRole.user.firstName || ''} ${p.userRole.user.lastName || ''}`.trim() || p.userRole.user.email,
      }));

    res.json({
      payments: payments.map((p) => ({
        id: p.id,
        userRole: {
          user: p.userRole.user,
          role: p.userRole.role,
        },
        amount: p.amount,
        frequency: p.frequency,
        nextPaymentDate: p.nextPaymentDate,
        status: p.status,
        totalPaid: p.totalPaid,
        paymentCount: p.paymentCount,
      })),
      totalMonthly,
      upcomingPayments,
    });
  } catch (error: any) {
    console.error('Error fetching recurring payments:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch recurring payments' });
  }
});

/**
 * PATCH /api/recurring-payments/:id/pause
 * Pause recurring payment
 */
router.patch('/recurring-payments/:id/pause', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payment = await prisma.recurringPayment.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!payment) {
      return res.status(404).json({ error: 'Recurring payment not found' });
    }

    if (payment.project.ownerId !== userId) {
      return res.status(403).json({ error: 'Only project owner can pause payments' });
    }

    const updated = await prisma.recurringPayment.update({
      where: { id },
      data: { status: 'PAUSED' },
    });

    res.json({ success: true, status: updated.status });
  } catch (error: any) {
    console.error('Error pausing payment:', error);
    res.status(500).json({ error: error.message || 'Failed to pause payment' });
  }
});

/**
 * PATCH /api/recurring-payments/:id/resume
 * Resume recurring payment
 */
router.patch('/recurring-payments/:id/resume', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payment = await prisma.recurringPayment.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!payment) {
      return res.status(404).json({ error: 'Recurring payment not found' });
    }

    if (payment.project.ownerId !== userId) {
      return res.status(403).json({ error: 'Only project owner can resume payments' });
    }

    const updated = await prisma.recurringPayment.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    res.json({ success: true, status: updated.status });
  } catch (error: any) {
    console.error('Error resuming payment:', error);
    res.status(500).json({ error: error.message || 'Failed to resume payment' });
  }
});

/**
 * DELETE /api/recurring-payments/:id/cancel
 * Cancel recurring payment (refund allocated funds)
 */
router.delete('/recurring-payments/:id/cancel', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const payment = await prisma.recurringPayment.findUnique({
      where: { id },
      include: { project: true },
    });

    if (!payment) {
      return res.status(404).json({ error: 'Recurring payment not found' });
    }

    if (payment.project.ownerId !== userId) {
      return res.status(403).json({ error: 'Only project owner can cancel payments' });
    }

    // Calculate refund amount (allocated but not paid)
    const periodsInMonth = payment.frequency === 'WEEKLY' ? 4 : payment.frequency === 'BIWEEKLY' ? 2 : 1;
    const monthlyAllocation = payment.amount * periodsInMonth;
    const refundAmount = monthlyAllocation; // Refund one month's allocation

    // Update status and refund allocated funds
    await prisma.$transaction([
      prisma.recurringPayment.update({
        where: { id },
        data: { status: 'CANCELLED' },
      }),
      prisma.project.update({
        where: { id: payment.projectId },
        data: {
          allocatedFunds: {
            decrement: refundAmount,
          },
        },
      }),
    ]);

    res.json({ success: true, refundedAmount: refundAmount });
  } catch (error: any) {
    console.error('Error cancelling payment:', error);
    res.status(500).json({ error: error.message || 'Failed to cancel payment' });
  }
});

// Helper functions
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

function calculateEstimatedTotal(amount: number, frequency: string, startDate: Date, endDate: Date | null): number {
  if (!endDate) return 0;
  
  const days = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  const periods = frequency === 'WEEKLY' ? Math.floor(days / 7) : frequency === 'BIWEEKLY' ? Math.floor(days / 14) : Math.floor(days / 30);
  
  return amount * periods;
}

export default router;

