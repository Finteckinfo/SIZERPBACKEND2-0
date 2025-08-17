// src/routes/dashboard.ts
import { Router, Request, Response } from 'express';
import { prisma, dbUtils } from '../utils/database.js';

const router = Router();

// Use centralized cache from dbUtils
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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
    // Check cache first
    const cacheKey = `stats_${userId}`;
    const cached = dbUtils.getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Single optimized query to get all required data
    const userProjects = await prisma.userRole.findMany({
      where: { userId: userId as string },
      select: {
        role: true,
        project: {
          select: {
            id: true,
            name: true,
            departments: {
              select: {
                id: true,
                tasks: {
                  select: {
                    id: true,
                    status: true,
                  },
                },
              },
            },
            userRoles: {
              select: {
                userId: true,
              },
            },
          },
        },
      },
    });

    // Calculate statistics efficiently
    let totalProjects = userProjects.length;
    let activeProjects = 0;
    let totalTasks = 0;
    let completedTasks = 0;
    const uniqueTeamMembers = new Set();

    userProjects.forEach(ur => {
      const project = ur.project;
      const projectTasks = project.departments.flatMap(dept => dept.tasks);
      const projectCompletedTasks = projectTasks.filter(task => task.status === 'COMPLETED').length;
      
      totalTasks += projectTasks.length;
      completedTasks += projectCompletedTasks;
      
      // Project is active if it has incomplete tasks
      if (projectTasks.length > projectCompletedTasks) {
        activeProjects++;
      }

      // Collect unique team members
      project.userRoles.forEach(ur2 => uniqueTeamMembers.add(ur2.userId));
    });

    const totalTeamMembers = uniqueTeamMembers.size;
    const completionPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const stats = {
      totalProjects,
      activeProjects,
      totalTasks,
      completedTasks,
      totalTeamMembers,
      completionPercentage,
    };

    // Cache the result
    dbUtils.setCached(cacheKey, stats, CACHE_TTL);

    return res.json(stats);
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

    // Get user's project IDs first
    const userProjectIds = await prisma.userRole.findMany({
      where: { userId: userId as string },
      select: { projectId: true },
    });

    const projectIds = userProjectIds.map(ur => ur.projectId);

    if (projectIds.length === 0) {
      return res.json({
        tasksCompletedThisWeek: 0,
        activeProjects: 0,
        weekStart: startOfWeek,
        weekEnd: endOfWeek,
      });
    }

    // Parallel queries for better performance
    const [tasksCompletedThisWeek, activeProjectsCount] = await Promise.all([
      // Get tasks completed this week
      prisma.task.count({
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
      }),
      // Get active projects count
      prisma.project.count({
        where: {
          id: { in: projectIds },
          departments: {
            some: {
              tasks: {
                some: {
                  status: { not: 'COMPLETED' },
                },
              },
            },
          },
        },
      }),
    ]);

    return res.json({
      tasksCompletedThisWeek,
      activeProjects: activeProjectsCount,
      weekStart: startOfWeek,
      weekEnd: endOfWeek,
    });
  } catch (err) {
    console.error('[Weekly Progress API] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch weekly progress' });
  }
});

export default router;
