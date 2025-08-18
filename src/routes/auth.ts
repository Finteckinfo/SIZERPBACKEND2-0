// src/routes/auth.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/me
 * Get current backend user (id, email, walletAddress, permissions)
 */
router.get('/me', async (req: Request, res: Response) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId as string },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        walletAddress: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    console.error('[Auth API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

/**
 * GET /api/permissions?resource=project&action=create
 * Check if current user can perform specific actions
 */
router.get('/permissions', async (req: Request, res: Response) => {
  const { userId, resource, action } = req.query;

  if (!userId || !resource || !action) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  try {
    let hasPermission = false;

    switch (resource) {
      case 'project':
        switch (action) {
          case 'create':
            // Any authenticated user can create projects
            hasPermission = true;
            break;
          case 'edit':
            // Check if user owns the project or is a manager
            const userRoles = await prisma.userRole.findMany({
              where: {
                userId: userId as string,
                role: { in: ['PROJECT_OWNER', 'PROJECT_MANAGER'] },
              },
            });
            hasPermission = userRoles.length > 0;
            break;
          case 'delete':
            // Only project owners can delete
            const ownedProjects = await prisma.userRole.findMany({
              where: {
                userId: userId as string,
                role: 'PROJECT_OWNER',
              },
            });
            hasPermission = ownedProjects.length > 0;
            break;
          default:
            hasPermission = false;
        }
        break;
      
      case 'department':
        // Project owners and managers can manage departments
        const deptRoles = await prisma.userRole.findMany({
          where: {
            userId: userId as string,
            role: { in: ['PROJECT_OWNER', 'PROJECT_MANAGER'] },
          },
        });
        hasPermission = deptRoles.length > 0;
        break;
      
      case 'user':
        // Project owners can manage team members
        const userManageRoles = await prisma.userRole.findMany({
          where: {
            userId: userId as string,
            role: 'PROJECT_OWNER',
          },
        });
        hasPermission = userManageRoles.length > 0;
        break;
      
      default:
        hasPermission = false;
    }

    res.json({ 
      hasPermission,
      resource: resource as string,
      action: action as string,
      userId: userId as string,
    });
  } catch (error) {
    console.error('[Permissions API] Error:', error);
    res.status(500).json({ error: 'Failed to check permissions' });
  }
});

export default router;
