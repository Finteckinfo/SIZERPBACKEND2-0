// src/routes/departments.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

// Helper function to check authentication
const requireAuth = (req: Request, res: Response): boolean => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  return true;
};

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

/**
 * POST /api/departments - Create department
 */
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { name, type, description, projectId, order } = req.body;

    // Check if user has permission to create departments
    if (!requireAuth(req, res)) return;

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: projectId,
        role: {
          in: ['PROJECT_OWNER', 'PROJECT_MANAGER']
        }
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Insufficient permissions to create departments' });
    }

    const department = await prisma.department.create({
      data: {
        name,
        type,
        description,
        projectId,
        order: order || 0
      },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    res.status(201).json(department);
  } catch (error) {
    console.error('[Departments API] Error creating department:', error);
    res.status(500).json({ error: 'Failed to create department' });
  }
});

/**
 * PUT /api/departments/:id - Update department
 */
router.put('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, description, order, isVisible } = req.body;

    const department = await prisma.department.findUnique({
      where: { id },
      include: { project: true }
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Check if user has permission to update this department
    if (!requireAuth(req, res)) return;

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: department.projectId,
        role: {
          in: ['PROJECT_OWNER', 'PROJECT_MANAGER']
        }
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Insufficient permissions to update department' });
    }

    const updatedDepartment = await prisma.department.update({
      where: { id },
      data: {
        name,
        type,
        description,
        order,
        isVisible
      },
      include: {
        project: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    res.json(updatedDepartment);
  } catch (error) {
    console.error('[Departments API] Error updating department:', error);
    res.status(500).json({ error: 'Failed to update department' });
  }
});

/**
 * DELETE /api/departments/:id - Delete department
 */
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const department = await prisma.department.findUnique({
      where: { id },
      include: { project: true }
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Check if user has permission to delete this department
    if (!requireAuth(req, res)) return;

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: department.projectId,
        role: {
          in: ['PROJECT_OWNER', 'PROJECT_MANAGER']
        }
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Insufficient permissions to delete department' });
    }

    // Check if department has tasks
    const taskCount = await prisma.task.count({
      where: { departmentId: id }
    });

    if (taskCount > 0) {
      return res.status(400).json({ error: 'Cannot delete department with existing tasks' });
    }

    await prisma.department.delete({
      where: { id }
    });

    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('[Departments API] Error deleting department:', error);
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

/**
 * GET /api/departments/project/:projectId - Get project departments
 */
router.get('/project/:projectId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;

    // Check if user has access to this project
    if (!requireAuth(req, res)) return;

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: projectId
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Access denied to this project' });
    }

    const departments = await prisma.department.findMany({
      where: {
        projectId: projectId,
        isVisible: true
      },
      include: {
        _count: {
          select: {
            tasks: true
          }
        }
      },
      orderBy: {
        order: 'asc'
      }
    });

    res.json(departments);
  } catch (error) {
    console.error('[Departments API] Error fetching project departments:', error);
    res.status(500).json({ error: 'Failed to fetch project departments' });
  }
});

/**
 * PUT /api/departments/project/:projectId/reorder - Reorder departments
 */
router.put('/project/:projectId/reorder', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { departmentOrders } = req.body; // Array of { id, order }

    // Check if user has permission to reorder departments
    if (!requireAuth(req, res)) return;

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: projectId,
        role: {
          in: ['PROJECT_OWNER', 'PROJECT_MANAGER']
        }
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Insufficient permissions to reorder departments' });
    }

    // Update department orders
    const updatePromises = departmentOrders.map(({ id, order }: { id: string, order: number }) =>
      prisma.department.update({
        where: { id },
        data: { order }
      })
    );

    await Promise.all(updatePromises);

    res.json({ message: 'Departments reordered successfully' });
  } catch (error) {
    console.error('[Departments API] Error reordering departments:', error);
    res.status(500).json({ error: 'Failed to reorder departments' });
  }
});

export default router;
