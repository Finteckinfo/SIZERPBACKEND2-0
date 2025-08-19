// src/routes/departments.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/departments
 * Get all departments across all projects
 */
router.get('/', async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 50,
    search,
    type,
    projectId,
    sortBy = 'name',
    sortOrder = 'asc'
  } = req.query;

  try {
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 50, 200);
    const offset = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    if (search) {
      where.name = { contains: search as string, mode: 'insensitive' };
    }

    if (type) {
      where.type = type;
    }

    if (projectId) {
      where.projectId = projectId;
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get departments with usage statistics
    const [departments, totalCount] = await Promise.all([
      prisma.department.findMany({
        where,
        select: {
          id: true,
          name: true,
          type: true,
          description: true,
          order: true,
          isVisible: true,
          createdAt: true,
          updatedAt: true,
          project: {
            select: {
              id: true,
              name: true
            }
          },
          managers: {
            select: {
              id: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  avatarUrl: true
                }
              }
            }
          },
          _count: {
            select: {
              tasks: true
            }
          }
        },
        skip: offset,
        take: limitNum,
        orderBy
      }),
      prisma.department.count({ where })
    ]);

    // Add computed fields
    const departmentsWithStats = departments.map(dept => ({
      ...dept,
      taskCount: dept._count.tasks,
      managerNames: dept.managers.map(mgr => 
        mgr.user.firstName && mgr.user.lastName 
          ? `${mgr.user.firstName} ${mgr.user.lastName}`.trim()
          : mgr.user.email
      )
    }));

    res.json({
      departments: departmentsWithStats,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitNum),
        hasNext: pageNum * limitNum < totalCount,
        hasPrev: pageNum > 1
      }
    });
  } catch (error) {
    console.error('[Departments API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

/**
 * GET /api/departments/:departmentId
 * Get department details
 */
router.get('/:departmentId', async (req: Request, res: Response) => {
  const { departmentId } = req.params;

  try {
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: {
        id: true,
        name: true,
        type: true,
        description: true,
        order: true,
        isVisible: true,
        createdAt: true,
        updatedAt: true,
        project: {
          select: {
            id: true,
            name: true,
            type: true,
            priority: true
          }
        },
        managers: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                avatarUrl: true
              }
            }
          }
        },
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            assignedRole: {
              select: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true
                  }
                }
              }
            },
            createdAt: true,
            updatedAt: true
          }
        },
        _count: {
          select: {
            tasks: true
          }
        }
      }
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Add computed fields
    const departmentWithStats = {
      ...department,
      managerNames: department.managers.map(mgr => 
        mgr.user.firstName && mgr.user.lastName 
          ? `${mgr.user.firstName} ${mgr.user.lastName}`.trim()
          : mgr.user.email
      ),
      stats: {
        totalTasks: department._count.tasks,
        completedTasks: department.tasks.filter(task => task.status === 'COMPLETED').length,
        inProgressTasks: department.tasks.filter(task => task.status === 'IN_PROGRESS').length,
        pendingTasks: department.tasks.filter(task => task.status === 'PENDING').length
      }
    };

    res.json(departmentWithStats);
  } catch (error) {
    console.error('[Departments API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch department details' });
  }
});

export default router;
