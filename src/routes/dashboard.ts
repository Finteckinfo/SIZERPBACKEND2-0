// src/routes/dashboard.ts
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

/**
 * GET /api/dashboard/stats
 * Get all dashboard statistics for the current user
 */
router.get('/stats', async (req: Request, res: Response) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  try {
    // Get user's projects
    const userProjects = await prisma.userRole.findMany({
      where: { userId: userId as string },
      include: {
        project: {
          include: {
            departments: {
              include: {
                tasks: true,
              },
            },
            userRoles: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    const projectIds = userProjects.map(ur => ur.project.id);

    // Calculate statistics
    const totalProjects = userProjects.length;
    const activeProjects = userProjects.filter(ur => 
      ur.project.departments.some(dept => 
        dept.tasks.some(task => task.status !== 'COMPLETED')
      )
    ).length;

    const totalTasks = userProjects.reduce((sum, ur) => 
      sum + ur.project.departments.reduce((deptSum, dept) => 
        deptSum + dept.tasks.length, 0
      ), 0
    );

    const completedTasks = userProjects.reduce((sum, ur) => 
      sum + ur.project.departments.reduce((deptSum, dept) => 
        deptSum + dept.tasks.filter(task => task.status === 'COMPLETED').length, 0
      ), 0
    );

    const totalTeamMembers = new Set(
      userProjects.flatMap(ur => ur.project.userRoles.map(ur2 => ur2.user.id))
    ).size;

    const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return res.json({
      totalProjects,
      activeProjects,
      totalTasks,
      completedTasks,
      totalTeamMembers,
      completionPercentage,
    });
  } catch (err) {
    console.error('[Dashboard Stats API] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

/**
 * GET /api/user/projects
 * Get all projects the current user is involved in
 */
router.get('/user/projects', async (req: Request, res: Response) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  try {
    const userProjects = await prisma.userRole.findMany({
      where: { userId: userId as string },
      include: {
        project: {
          include: {
            departments: {
              include: {
                tasks: true,
              },
            },
            userRoles: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    const projects = userProjects.map(ur => {
      const project = ur.project;
      const totalTasks = project.departments.reduce((sum, dept) => 
        sum + dept.tasks.length, 0
      );
      const completedTasks = project.departments.reduce((sum, dept) => 
        sum + dept.tasks.filter(task => task.status === 'COMPLETED').length, 0
      );
      const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        type: project.type,
        userRole: ur.role,
        createdAt: project.createdAt,
        departmentCount: project.departments.length,
        totalTasks,
        completedTasks,
        completionPercentage,
        teamMembers: project.userRoles.length,
      };
    });

    return res.json(projects);
  } catch (err) {
    console.error('[User Projects API] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch user projects' });
  }
});

/**
 * GET /api/user/activities
 * Get recent activities (limited implementation due to no activity log table)
 * Note: This is a simplified version since there's no dedicated activity tracking
 */
router.get('/user/activities', async (req: Request, res: Response) => {
  const { userId, limit = 10 } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  try {
    // Get user's projects
    const userProjects = await prisma.userRole.findMany({
      where: { userId: userId as string },
      include: {
        project: true,
      },
    });

    const projectIds = userProjects.map(ur => ur.project.id);

    // Get recent tasks, payments, and project updates
    const recentTasks = await prisma.task.findMany({
      where: {
        department: {
          projectId: { in: projectIds },
        },
      },
      include: {
        department: {
          include: {
            project: true,
          },
        },
        assignedTo: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.floor(Number(limit) / 2),
    });

    const recentPayments = await prisma.payment.findMany({
      where: {
        task: {
          department: {
            projectId: { in: projectIds },
          },
        },
      },
      include: {
        task: {
          include: {
            department: {
              include: {
                project: true,
              },
            },
          },
        },
        payer: true,
        payee: true,
      },
      orderBy: { createdAt: 'desc' },
      take: Math.floor(Number(limit) / 2),
    });

    // Combine and format activities
    const activities = [
      ...recentTasks.map(task => ({
        id: task.id,
        type: 'task_updated',
        description: `Task "${task.title}" status changed to ${task.status}`,
        projectName: task.department.project.name,
        userName: task.assignedTo?.email || 'Unassigned',
        timestamp: task.updatedAt,
      })),
      ...recentPayments.map(payment => ({
        id: payment.id,
        type: 'payment_released',
        description: `Payment of $${payment.amount} released for task`,
        projectName: payment.task.department.project.name,
        userName: payment.payee.email,
        timestamp: payment.releasedAt || payment.createdAt,
      })),
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
     .slice(0, Number(limit));

    return res.json(activities);
  } catch (err) {
    console.error('[User Activities API] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch user activities' });
  }
});

/**
 * GET /api/dashboard/weekly-progress
 * Get weekly progress statistics
 */
router.get('/weekly-progress', async (req: Request, res: Response) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  try {
    // Calculate date range for this week (Monday to Sunday)
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
    startOfWeek.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6); // Sunday
    endOfWeek.setHours(23, 59, 59, 999);

    // Get user's projects
    const userProjects = await prisma.userRole.findMany({
      where: { userId: userId as string },
      include: {
        project: {
          include: {
            departments: {
              include: {
                tasks: true,
              },
            },
          },
        },
      },
    });

    const projectIds = userProjects.map(ur => ur.project.id);

    // Get tasks completed this week
    const tasksCompletedThisWeek = await prisma.task.count({
      where: {
        department: {
          projectId: { in: projectIds },
        },
        status: 'COMPLETED',
        updatedAt: {
          gte: startOfWeek,
          lte: endOfWeek,
        },
      },
    });

    // Get active projects (projects with incomplete tasks)
    const activeProjects = userProjects.filter(ur => 
      ur.project.departments.some(dept => 
        dept.tasks.some(task => task.status !== 'COMPLETED')
      )
    ).length;

    return res.json({
      tasksCompletedThisWeek,
      activeProjects,
      weekStart: startOfWeek,
      weekEnd: endOfWeek,
    });
  } catch (err) {
    console.error('[Weekly Progress API] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch weekly progress' });
  }
});

/**
 * GET /api/user/deadlines
 * Note: This API cannot be fully implemented as tasks don't have due dates in the current schema
 * This is a placeholder that returns tasks that might need attention
 */
router.get('/user/deadlines', async (req: Request, res: Response) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  try {
    // Get user's projects
    const userProjects = await prisma.userRole.findMany({
      where: { userId: userId as string },
      include: {
        project: true,
      },
    });

    const projectIds = userProjects.map(ur => ur.project.id);

    // Get tasks that are pending or in progress (as a proxy for "deadlines")
    const urgentTasks = await prisma.task.findMany({
      where: {
        department: {
          projectId: { in: projectIds },
        },
        status: { in: ['PENDING', 'IN_PROGRESS'] },
      },
      include: {
        department: {
          include: {
            project: true,
          },
        },
        assignedTo: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });

    const deadlines = urgentTasks.map(task => ({
      id: task.id,
      title: task.title,
      projectName: task.department.project.name,
      status: task.status,
      priority: task.status === 'PENDING' ? 'urgent' : 'due_soon',
      assignedTo: task.assignedTo?.email || 'Unassigned',
      createdAt: task.createdAt,
    }));

    return res.json(deadlines);
  } catch (err) {
    console.error('[User Deadlines API] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch user deadlines' });
  }
});

export default router;
