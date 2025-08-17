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

export default router;
