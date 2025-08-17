// src/routes/user.ts
import { Router, Request, Response } from 'express';
import { prisma, dbUtils } from '../utils/database.js';

const router = Router();

// Use centralized cache from dbUtils
const PROJECTS_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

/**
 * GET /api/user/projects
 * Get all projects the current user is involved in
 */
router.get('/projects', async (req: Request, res: Response) => {
  const { userId, page = 1, limit = 20 } = req.query;
  const pageNum = parseInt(page as string) || 1;
  const limitNum = Math.min(parseInt(limit as string) || 20, 50); // Max 50 projects per page
  const offset = (pageNum - 1) * limitNum;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  try {
    // Check cache for first page
    const cacheKey = `projects_${userId}_${pageNum}_${limitNum}`;
    if (pageNum === 1) {
      const cached = dbUtils.getCached(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    }

    // Optimized query with pagination
    const [userProjects, totalCount] = await Promise.all([
      prisma.userRole.findMany({
        where: { userId: userId as string },
        select: {
          role: true,
          project: {
            select: {
              id: true,
              name: true,
              description: true,
              type: true,
              createdAt: true,
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
        skip: offset,
        take: limitNum,
        orderBy: {
          project: {
            createdAt: 'desc',
          },
        },
      }),
      prisma.userRole.count({
        where: { userId: userId as string },
      }),
    ]);

    const projects = userProjects.map(ur => {
      const project = ur.project;
      const projectTasks = project.departments.flatMap(dept => dept.tasks);
      const completedTasks = projectTasks.filter(task => task.status === 'COMPLETED').length;
      const totalTasks = projectTasks.length;
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

    const result = {
      projects,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
        hasNext: pageNum * limitNum < totalCount,
        hasPrev: pageNum > 1,
      },
    };

    // Cache first page results
    if (pageNum === 1) {
      dbUtils.setCached(cacheKey, result, PROJECTS_CACHE_TTL);
    }

    return res.json(result);
  } catch (err) {
    console.error('[User Projects API] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch user projects' });
  }
});

/**
 * GET /api/user/activities
 * Get recent activities with optimized queries
 */
router.get('/activities', async (req: Request, res: Response) => {
  const { userId, limit = 10, page = 1 } = req.query;
  const limitNum = Math.min(parseInt(limit as string) || 10, 50);
  const pageNum = parseInt(page as string) || 1;
  const offset = (pageNum - 1) * limitNum;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  try {
    // Get user's project IDs first
    const userProjectIds = await prisma.userRole.findMany({
      where: { userId: userId as string },
      select: { projectId: true },
    });

    const projectIds = userProjectIds.map(ur => ur.projectId);

    if (projectIds.length === 0) {
      return res.json({
        activities: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      });
    }

    // Parallel queries for better performance
    const [recentTasks, recentPayments, totalActivities] = await Promise.all([
      // Get recent tasks
      prisma.task.findMany({
        where: {
          department: {
            projectId: { in: projectIds },
          },
        },
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
          department: {
            select: {
              project: {
                select: {
                  name: true,
                },
              },
            },
          },
          assignedTo: {
            select: {
              email: true,
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: Math.floor(limitNum / 2),
        skip: Math.floor(offset / 2),
      }),
      // Get recent payments
      prisma.payment.findMany({
        where: {
          task: {
            department: {
              projectId: { in: projectIds },
            },
          },
        },
        select: {
          id: true,
          amount: true,
          status: true,
          createdAt: true,
          releasedAt: true,
          task: {
            select: {
              department: {
                select: {
                  project: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
          payee: {
            select: {
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.floor(limitNum / 2),
        skip: Math.floor(offset / 2),
      }),
      // Get total count for pagination
      prisma.$transaction([
        prisma.task.count({
          where: {
            department: {
              projectId: { in: projectIds },
            },
          },
        }),
        prisma.payment.count({
          where: {
            task: {
              department: {
                projectId: { in: projectIds },
              },
            },
          },
        }),
      ]),
    ]);

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
     .slice(0, limitNum);

    const totalCount = totalActivities[0] + totalActivities[1];

    return res.json({
      activities,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
        hasNext: pageNum * limitNum < totalCount,
        hasPrev: pageNum > 1,
      },
    });
  } catch (err) {
    console.error('[User Activities API] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch user activities' });
  }
});

/**
 * GET /api/user/deadlines
 * Get urgent tasks with optimized queries
 */
router.get('/deadlines', async (req: Request, res: Response) => {
  const { userId, limit = 10, priority } = req.query;
  const limitNum = Math.min(parseInt(limit as string) || 10, 50);

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  try {
    // Get user's project IDs first
    const userProjectIds = await prisma.userRole.findMany({
      where: { userId: userId as string },
      select: { projectId: true },
    });

    const projectIds = userProjectIds.map(ur => ur.projectId);

    if (projectIds.length === 0) {
      return res.json([]);
    }

    // Build status filter based on priority
    let statusFilter: any = { in: ['PENDING', 'IN_PROGRESS'] };
    if (priority === 'urgent') {
      statusFilter = { equals: 'PENDING' };
    } else if (priority === 'due_soon') {
      statusFilter = { equals: 'IN_PROGRESS' };
    }

    // Optimized query with proper indexing
    const urgentTasks = await prisma.task.findMany({
      where: {
        department: {
          projectId: { in: projectIds },
        },
        status: statusFilter,
      },
      include: {
        department: {
          include: {
            project: {
              select: {
                name: true,
              },
            },
          },
        },
        assignedTo: {
          select: {
            email: true,
          },
        },
      },
      orderBy: [
        { status: 'asc' }, // PENDING first
        { createdAt: 'asc' }, // Oldest first
      ],
      take: limitNum,
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
