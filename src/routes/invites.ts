import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();
const prisma = new PrismaClient();

// GET /api/invites - Get all invites for authenticated user
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    // req.user is guaranteed to exist after authenticateToken middleware
    
    const invites = await prisma.projectInvite.findMany({
      where: {
        OR: [
          { userId: req.user!.id },           // Invites sent to this user
          { email: req.user!.email }          // Invites sent to this email (even if user didn't exist yet)
        ]
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            description: true,
            type: true,
            priority: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json(invites);
  } catch (error) {
    console.error('Error fetching user invites:', error);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// GET /api/invites/user/:userId - Get user's pending invites
router.get('/user/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    // req.user is guaranteed to exist after authenticateToken middleware

    const invites = await prisma.projectInvite.findMany({
      where: {
        userId: userId,
        status: 'PENDING'
      },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            description: true,
            type: true,
            priority: true
          }
        }
      }
    });

    res.json(invites);
  } catch (error) {
    console.error('Error fetching user invites:', error);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// GET /api/invites/project/:projectId - Get project's invites
router.get('/project/:projectId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    
    // req.user is guaranteed to exist after authenticateToken middleware

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: projectId
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const invites = await prisma.projectInvite.findMany({
      where: {
        projectId: projectId
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    res.json(invites);
  } catch (error) {
    console.error('Error fetching project invites:', error);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// POST /api/invites - Create new invite
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { email, role, projectId, expiresAt, paymentType, salaryAmount, salaryFrequency, oversightRate } = req.body;

    // req.user is guaranteed to exist after authenticateToken middleware

    // Fetch all roles the inviter holds in this project (support multi-role)
    const inviterRoles = await prisma.userRole.findMany({
      where: {
        userId: req.user!.id,
        projectId: projectId
      },
      select: { role: true }
    });

    const isOwner = inviterRoles.some(r => r.role === 'PROJECT_OWNER');
    const isManager = inviterRoles.some(r => r.role === 'PROJECT_MANAGER');

    if (!isOwner && !isManager) {
      return res.status(403).json({ error: 'Insufficient permissions to invite users' });
    }

    // Enforce invite target role policy:
    // - PROJECT_OWNER can invite PROJECT_MANAGER and EMPLOYEE
    // - PROJECT_MANAGER can invite only EMPLOYEE (cannot invite OWNER or MANAGER)
    if (isOwner) {
      if (!(role === 'PROJECT_MANAGER' || role === 'EMPLOYEE')) {
        return res.status(403).json({ error: 'Project owners may invite only PROJECT_MANAGER or EMPLOYEE roles' });
      }
    } else if (isManager) {
      if (role !== 'EMPLOYEE') {
        return res.status(403).json({ error: 'Project managers may invite only EMPLOYEE roles' });
      }
    }

    // Check if user already exists (optional - invites can be sent to non-existent users)
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    // Check if invite already exists
    const existingInvite = await prisma.projectInvite.findFirst({
      where: {
        email,
        projectId,
        status: 'PENDING'
      }
    });

    if (existingInvite) {
      return res.status(400).json({ error: 'User already has a pending invite for this project' });
    }

    const invite = await prisma.projectInvite.create({
      data: {
        email,
        role,
        projectId,
        userId: existingUser?.id, // Will be null if user doesn't exist yet
        expiresAt: new Date(expiresAt),
        paymentType,
        salaryAmount,
        salaryFrequency,
        oversightRate,
      }
    });

    res.status(201).json(invite);
  } catch (error) {
    console.error('Error creating invite:', error);
    res.status(500).json({ error: 'Failed to create invite' });
  }
});

// PUT /api/invites/:id/respond - Accept/decline invite
router.put('/:id/respond', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { response } = req.body; // 'ACCEPT' or 'DECLINE'

    const invite = await prisma.projectInvite.findUnique({
      where: { id },
      include: { project: true }
    });

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    // req.user is guaranteed to exist after authenticateToken middleware

    // Check if this invite is for the current user (by email) or if they're already linked
    // This allows users to accept invites even if they didn't exist when the invite was sent
    if (invite.email !== req.user!.email && invite.userId && invite.userId !== req.user!.id) {
      return res.status(403).json({ error: 'You can only respond to invites sent to your email address' });
    }

    if (invite.status !== 'PENDING') {
      return res.status(400).json({ error: 'Invite has already been responded to' });
    }

    if (new Date() > invite.expiresAt) {
      return res.status(400).json({ error: 'Invite has expired' });
    }

    if (response === 'ACCEPT') {
      // Create user role
      const userRole = await prisma.userRole.create({
        data: {
          userId: req.user!.id,
          projectId: invite.projectId,
          role: invite.role,
          acceptedAt: new Date(),
          inviteId: invite.id,
          status: 'ACTIVE',
        }
      });

      // Update invite status
      await prisma.projectInvite.update({
        where: { id },
        data: { 
          status: 'ACCEPTED',
          userId: req.user!.id
        }
      });

      // If invite has payment terms, create payment configuration
      let paymentConfig = null;
      if (invite.paymentType) {
        paymentConfig = await prisma.userRolePayment.create({
          data: {
            userRoleId: userRole.id,
            paymentType: invite.paymentType,
            salaryAmount: invite.salaryAmount,
            salaryFrequency: invite.salaryFrequency,
            oversightRate: invite.oversightRate,
          },
        });

        // If SALARY type, create recurring payment
        if (invite.paymentType === 'SALARY' && invite.salaryAmount && invite.salaryFrequency) {
          const nextDate = calculateNextPaymentDate(new Date(), invite.salaryFrequency);
          
          await prisma.recurringPayment.create({
            data: {
              userRoleId: userRole.id,
              projectId: invite.projectId,
              amount: invite.salaryAmount,
              frequency: invite.salaryFrequency,
              startDate: new Date(),
              nextPaymentDate: nextDate,
              status: 'ACTIVE',
            },
          });

          // Allocate funds for first month
          const periodsInMonth = invite.salaryFrequency === 'WEEKLY' ? 4 : invite.salaryFrequency === 'BIWEEKLY' ? 2 : 1;
          const monthlyAllocation = invite.salaryAmount * periodsInMonth;

          await prisma.project.update({
            where: { id: invite.projectId },
            data: {
              allocatedFunds: {
                increment: monthlyAllocation,
              },
            },
          });
        }
      }

      res.json({ 
        message: 'Invite accepted', 
        userRole,
        paymentConfig: paymentConfig ? {
          type: paymentConfig.paymentType,
          nextPayment: paymentConfig.paymentType === 'SALARY' && invite.salaryFrequency ? {
            date: calculateNextPaymentDate(new Date(), invite.salaryFrequency),
            amount: invite.salaryAmount,
          } : undefined,
        } : undefined,
      });
    } else if (response === 'DECLINE') {
      await prisma.projectInvite.update({
        where: { id },
        data: { status: 'DECLINED' }
      });

      res.json({ message: 'Invite declined' });
    } else {
      res.status(400).json({ error: 'Invalid response. Use "ACCEPT" or "DECLINE"' });
    }
  } catch (error) {
    console.error('Error responding to invite:', error);
    res.status(500).json({ error: 'Failed to respond to invite' });
  }
});

// PUT /api/invites/:id - Update invite
router.put('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role, expiresAt } = req.body;

    const invite = await prisma.projectInvite.findUnique({
      where: { id },
      include: { project: true }
    });

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    // req.user is guaranteed to exist after authenticateToken middleware

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: invite.projectId,
        role: {
          in: ['PROJECT_OWNER', 'PROJECT_MANAGER']
        }
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Insufficient permissions to update invite' });
    }

    const updatedInvite = await prisma.projectInvite.update({
      where: { id },
      data: {
        role,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined
      }
    });

    res.json(updatedInvite);
  } catch (error) {
    console.error('Error updating invite:', error);
    res.status(500).json({ error: 'Failed to update invite' });
  }
});

// DELETE /api/invites/:id - Delete invite
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const invite = await prisma.projectInvite.findUnique({
      where: { id },
      include: { project: true }
    });

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    // req.user is guaranteed to exist after authenticateToken middleware

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: invite.projectId,
        role: {
          in: ['PROJECT_OWNER', 'PROJECT_MANAGER']
        }
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Insufficient permissions to delete invite' });
    }

    await prisma.projectInvite.delete({
      where: { id }
    });

    res.json({ message: 'Invite deleted successfully' });
  } catch (error) {
    console.error('Error deleting invite:', error);
    res.status(500).json({ error: 'Failed to delete invite' });
  }
});

// Helper function
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

export default router;
