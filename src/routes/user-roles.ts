import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';
import { checkProjectAccess, checkProjectRole } from '../utils/accessControl.js';

const router = Router();
const prisma = new PrismaClient();

// Helper function to check authentication
const requireAuth = (req: Request, res: Response): boolean => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  return true;
};

// GET /api/user-roles/project/:projectId/user/:userId - Get user's role in project
router.get('/project/:projectId/user/:userId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId, userId } = req.params;

    // Check if requesting user has access to this project (including ownership)
    if (!requireAuth(req, res)) return;

    const access = await checkProjectAccess(req.user!.id, projectId);
    if (!access.hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: userId,
        projectId: projectId
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        },
        accessibleDepartments: {
          select: {
            id: true,
            name: true,
            type: true,
            order: true
          }
        }
      }
    });

    if (!userRole) {
      return res.status(404).json({ error: 'User role not found' });
    }

    res.json(userRole);
  } catch (error) {
    console.error('Error fetching user role:', error);
    res.status(500).json({ error: 'Failed to fetch user role' });
  }
});

// PUT /api/user-roles/:id - Update user role
router.put('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role, status, departmentScope, departmentOrder } = req.body;

    const userRole = await prisma.userRole.findUnique({
      where: { id },
      include: { project: true }
    });

    if (!userRole) {
      return res.status(404).json({ error: 'User role not found' });
    }

    // Check if user has permission to update this role (including ownership)
    if (!requireAuth(req, res)) return;

    const access = await checkProjectRole(req.user!.id, userRole.projectId, ['PROJECT_OWNER', 'PROJECT_MANAGER']);
    if (!access.hasRole) {
      return res.status(403).json({ error: 'Insufficient permissions to update user role' });
    }

    // Project owners can update any role, managers can only update employee roles
    if (access.role === 'PROJECT_MANAGER' && userRole.role === 'PROJECT_OWNER') {
      return res.status(403).json({ error: 'Managers cannot modify project owner roles' });
    }

    const updatedUserRole = await prisma.userRole.update({
      where: { id },
      data: {
        role,
        departmentScope,
        departmentOrder
      }
    });

    res.json(updatedUserRole);
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// DELETE /api/user-roles/:id - Remove user from project
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const userRole = await prisma.userRole.findUnique({
      where: { id },
      include: { project: true }
    });

    if (!userRole) {
      return res.status(404).json({ error: 'User role not found' });
    }

    // Check if user has permission to remove this role
    if (!requireAuth(req, res)) return;

    const requestingUserRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: userRole.projectId,
        role: {
          in: ['PROJECT_OWNER', 'PROJECT_MANAGER']
        }
      }
    });

    if (!requestingUserRole) {
      return res.status(403).json({ error: 'Insufficient permissions to remove user' });
    }

    // Project owners can remove anyone, managers can only remove employees
    if (requestingUserRole.role === 'PROJECT_MANAGER' && userRole.role === 'PROJECT_OWNER') {
      return res.status(403).json({ error: 'Managers cannot remove project owners' });
    }

    // Cannot remove the last project owner
    if (userRole.role === 'PROJECT_OWNER') {
      const ownerCount = await prisma.userRole.count({
        where: {
          projectId: userRole.projectId,
          role: 'PROJECT_OWNER'
        }
      });

      if (ownerCount <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last project owner' });
      }
    }

    await prisma.userRole.delete({
      where: { id }
    });

    res.json({ message: 'User removed from project successfully' });
  } catch (error) {
    console.error('Error removing user from project:', error);
    res.status(500).json({ error: 'Failed to remove user from project' });
  }
});

// GET /api/user-roles/project/:projectId - Get project team
router.get('/project/:projectId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    // Check if user has access to this project (including ownership)
    if (!requireAuth(req, res)) return;

    const access = await checkProjectAccess(req.user!.id, projectId);
    if (!access.hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const team = await prisma.userRole.findMany({
      where: {
        projectId: projectId
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        },
        accessibleDepartments: {
          select: {
            id: true,
            name: true,
            type: true,
            order: true
          }
        }
      },
      orderBy: [
        { role: 'asc' },
        { user: { firstName: 'asc' } }
      ]
    });

    res.json(team);
  } catch (error) {
    console.error('Error fetching project team:', error);
    res.status(500).json({ error: 'Failed to fetch project team' });
  }
});

// POST /api/user-roles/:id/departments/:departmentId - Assign to department
router.post('/:id/departments/:departmentId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id, departmentId } = req.params;

    const userRole = await prisma.userRole.findUnique({
      where: { id },
      include: { project: true }
    });

    if (!userRole) {
      return res.status(404).json({ error: 'User role not found' });
    }

    const department = await prisma.department.findUnique({
      where: { id: departmentId }
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    if (department.projectId !== userRole.projectId) {
      return res.status(400).json({ error: 'Department does not belong to the same project' });
    }

    // Check if user has permission to assign departments
    if (!requireAuth(req, res)) return;

    const requestingUserRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: userRole.projectId,
        role: {
          in: ['PROJECT_MANAGER']
        }
      }
    });

    if (!requestingUserRole) {
      return res.status(403).json({ error: 'Insufficient permissions to assign departments' });
    }

    // Update the user role's department access
    const updatedUserRole = await prisma.userRole.update({
      where: { id },
      data: {
        accessibleDepartments: {
          connect: { id: departmentId }
        }
      },
      include: {
        accessibleDepartments: true
      }
    });

    res.json(updatedUserRole);
  } catch (error) {
    console.error('Error assigning department to user role:', error);
    res.status(500).json({ error: 'Failed to assign department' });
  }
});

export default router;
