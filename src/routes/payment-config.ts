import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * POST /api/user-roles/:userRoleId/payment-config
 * Create or update payment configuration for a team member
 */
router.post('/user-roles/:userRoleId/payment-config', async (req: Request, res: Response) => {
  try {
    const { userRoleId } = req.params;
    const { paymentType, salaryAmount, salaryFrequency, oversightRate, milestoneAmount, startDate, endDate } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get user role and verify access
    const userRole = await prisma.userRole.findUnique({
      where: { id: userRoleId },
      include: {
        project: {
          include: {
            escrow: true,
          },
        },
      },
    });

    if (!userRole) {
      return res.status(404).json({ error: 'User role not found' });
    }

    // Verify user is project owner or manager
    if (userRole.project.ownerId !== userId) {
      const isManager = await prisma.userRole.count({
        where: {
          userId,
          projectId: userRole.projectId,
          role: 'PROJECT_MANAGER',
          status: 'ACTIVE',
        },
      });

      if (!isManager) {
        return res.status(403).json({ error: 'Only project owners and managers can configure payments' });
      }
    }

    // Create or update payment config
    const paymentConfig = await prisma.userRolePayment.upsert({
      where: { userRoleId },
      create: {
        userRoleId,
        paymentType,
        salaryAmount,
        salaryFrequency,
        oversightRate,
        milestoneAmount,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
      },
      update: {
        paymentType,
        salaryAmount,
        salaryFrequency,
        oversightRate,
        milestoneAmount,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : null,
      },
    });

    // If SALARY type, create recurring payment
    if (paymentType === 'SALARY' && salaryAmount && salaryFrequency) {
      const start = startDate ? new Date(startDate) : new Date();
      const nextDate = calculateNextPaymentDate(start, salaryFrequency);

      await prisma.recurringPayment.create({
        data: {
          userRoleId,
          projectId: userRole.projectId,
          amount: salaryAmount,
          frequency: salaryFrequency,
          startDate: start,
          endDate: endDate ? new Date(endDate) : null,
          nextPaymentDate: nextDate,
          status: 'ACTIVE',
        },
      });

      // No project-level budget allocation – escrow balances are assessed per payment
    }

    // Calculate estimated monthly
    const estimatedMonthly = calculateEstimatedMonthly(paymentType, salaryAmount, salaryFrequency);

    res.json({
      id: paymentConfig.id,
      paymentType: paymentConfig.paymentType,
      salaryAmount: paymentConfig.salaryAmount,
      oversightRate: paymentConfig.oversightRate,
      nextPaymentDate: paymentType === 'SALARY' ? calculateNextPaymentDate(new Date(), salaryFrequency!) : undefined,
      estimatedMonthly,
    });
  } catch (error: any) {
    console.error('Error creating payment config:', error);
    res.status(500).json({ error: error.message || 'Failed to create payment configuration' });
  }
});

/**
 * GET /api/user-roles/:userRoleId/payment-config
 * Get payment configuration for a role
 */
router.get('/user-roles/:userRoleId/payment-config', async (req: Request, res: Response) => {
  try {
    const { userRoleId } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const paymentConfig = await prisma.userRolePayment.findUnique({
      where: { userRoleId },
      include: {
        userRole: {
          include: {
            project: true,
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

    if (!paymentConfig) {
      return res.status(404).json({ error: 'Payment configuration not found' });
    }

    // Get recurring payment if exists
    const recurringPayment = await prisma.recurringPayment.findFirst({
      where: {
        userRoleId,
        status: 'ACTIVE',
      },
    });

    // Calculate total earned
    const totalEarned = recurringPayment?.totalPaid || 0;

    res.json({
      id: paymentConfig.id,
      paymentType: paymentConfig.paymentType,
      salaryAmount: paymentConfig.salaryAmount,
      salaryFrequency: paymentConfig.salaryFrequency,
      oversightRate: paymentConfig.oversightRate,
      nextPayment: recurringPayment ? {
        date: recurringPayment.nextPaymentDate,
        amount: recurringPayment.amount,
      } : null,
      totalEarned,
    });
  } catch (error: any) {
    console.error('Error fetching payment config:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch payment configuration' });
  }
});

// Helper functions
function calculateNextPaymentDate(startDate: Date, frequency: string): Date {
  const next = new Date(startDate);
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

function calculateEstimatedMonthly(paymentType: string, amount: number | null | undefined, frequency?: string | null): number {
  if (!amount) return 0;
  
  if (paymentType === 'SALARY' && frequency) {
    switch (frequency) {
      case 'WEEKLY':
        return amount * 4;
      case 'BIWEEKLY':
        return amount * 2;
      case 'MONTHLY':
        return amount;
    }
  }
  
  return 0;
}

export default router;

