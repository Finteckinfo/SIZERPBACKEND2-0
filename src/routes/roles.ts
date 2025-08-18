// src/routes/roles.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * POST /api/projects/:projectId/roles/bulk
 * Create multiple roles for a project
 */
router.post('/:projectId/bulk', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { roles } = req.body;

  if (!roles || !Array.isArray(roles)) {
    return res.status(400).json({ error: 'Missing or invalid roles array' });
  }

  try {
    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const createdRoles = [];
    const createdInvites = [];

    // Process each role
    for (const roleData of roles) {
      if (roleData.userId) {
        // User exists - create role
        const userRole = await prisma.userRole.create({
          data: {
            userId: roleData.userId,
            projectId,
            role: roleData.role,
          },
        });
        createdRoles.push(userRole);
      } else if (roleData.userEmail) {
        // User doesn't exist - create invite
        const invite = await prisma.projectInvite.create({
          data: {
            email: roleData.userEmail,
            role: roleData.role,
            projectId,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          },
        });
        createdInvites.push(invite);
      }
    }

    res.status(201).json({
      message: 'Roles and invites created successfully',
      roles: createdRoles,
      invites: createdInvites,
    });
  } catch (error) {
    console.error('[Roles API] Error:', error);
    res.status(500).json({ error: 'Failed to create roles' });
  }
});

/**
 * DELETE /api/projects/:projectId/roles/:userRoleId
 * Remove a user role from a project
 */
router.delete('/:projectId/:userRoleId', async (req: Request, res: Response) => {
  const { projectId, userRoleId } = req.params;

  try {
    // Verify role exists and belongs to project
    const userRole = await prisma.userRole.findFirst({
      where: {
        id: userRoleId,
        projectId,
      },
    });

    if (!userRole) {
      return res.status(404).json({ error: 'User role not found' });
    }

    // Don't allow removing the last project owner
    if (userRole.role === 'PROJECT_OWNER') {
      const ownerCount = await prisma.userRole.count({
        where: {
          projectId,
          role: 'PROJECT_OWNER',
        },
      });

      if (ownerCount <= 1) {
        return res.status(400).json({ 
          error: 'Cannot remove the last project owner',
        });
      }
    }

    // Delete the role
    await prisma.userRole.delete({
      where: { id: userRoleId },
    });

    res.json({
      message: 'User role removed successfully',
      userRoleId,
    });
  } catch (error) {
    console.error('[Roles API] Error:', error);
    res.status(500).json({ error: 'Failed to remove user role' });
  }
});

/**
 * POST /api/projects/:projectId/invites
 * Send an invite to a user
 */
router.post('/:projectId/invites', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { email, role } = req.body;

  if (!email || !role) {
    return res.status(400).json({ error: 'Missing email or role' });
  }

  try {
    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if user already has a role or invite
    const existingRole = await prisma.userRole.findFirst({
      where: {
        projectId,
        user: { email },
      },
    });

    if (existingRole) {
      return res.status(409).json({ 
        error: 'User already has a role in this project',
      });
    }

    const existingInvite = await prisma.projectInvite.findFirst({
      where: {
        projectId,
        email,
        status: 'PENDING',
      },
    });

    if (existingInvite) {
      return res.status(409).json({ 
        error: 'User already has a pending invite',
      });
    }

    // Create the invite
    const invite = await prisma.projectInvite.create({
      data: {
        email,
        role,
        projectId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    // TODO: Send email notification here
    // For now, just log it
    console.log(`[INVITE] Created invite for ${email} to join project ${projectId} as ${role}`);

    res.status(201).json({
      message: 'Invite sent successfully',
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
    });
  } catch (error) {
    console.error('[Roles API] Error:', error);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

/**
 * GET /api/projects/:projectId/invites
 * Get all invites for a project
 */
router.get('/:projectId/invites', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    const invites = await prisma.projectInvite.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(invites);
  } catch (error) {
    console.error('[Roles API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

/**
 * PUT /api/projects/:projectId/invites/:inviteId/accept
 * Accept an invite
 */
router.put('/:projectId/invites/:inviteId/accept', async (req: Request, res: Response) => {
  const { projectId, inviteId } = req.params;
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId' });
  }

  try {
    const invite = await prisma.projectInvite.findFirst({
      where: {
        id: inviteId,
        projectId,
        status: 'PENDING',
      },
    });

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found or already processed' });
    }

    if (invite.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invite has expired' });
    }

    // Accept the invite in a transaction
    await prisma.$transaction(async (tx) => {
      // Create user role
      await tx.userRole.create({
        data: {
          userId,
          projectId,
          role: invite.role,
        },
      });

      // Update invite status
      await tx.projectInvite.update({
        where: { id: inviteId },
        data: {
          status: 'ACCEPTED',
          userId,
        },
      });
    });

    res.json({
      message: 'Invite accepted successfully',
      inviteId,
    });
  } catch (error) {
    console.error('[Roles API] Error:', error);
    res.status(500).json({ error: 'Failed to accept invite' });
  }
});

export default router;
