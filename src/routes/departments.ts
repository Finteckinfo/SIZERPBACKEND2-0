// src/routes/departments.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/departments
 * Get all departments for project creation (global department templates)
 */
router.get('/', async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 50,
    search,
    type,
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
          manager: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatarUrl: true
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
      isTemplate: !dept.project, // Departments without projects are templates
      managerName: dept.manager 
        ? `${dept.manager.firstName || ''} ${dept.manager.lastName || ''}`.trim() || dept.manager.email
        : null
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
 * POST /api/departments
 * Create department template
 */
router.post('/', async (req: Request, res: Response) => {
  const { name, type, description, order, isVisible, managerId } = req.body;

  try {
    // Validate required fields
    if (!name || !type) {
      return res.status(400).json({ error: 'Name and type are required' });
    }

    // Check if department name already exists as a template
    const existingTemplate = await prisma.department.findFirst({
      where: {
        name,
        projectId: { equals: null } // Only check templates
      }
    });

    if (existingTemplate) {
      return res.status(400).json({ error: 'Department template with this name already exists' });
    }

    const department = await prisma.department.create({
      data: {
        name,
        type,
        description,
        order: order || 0,
        isVisible: isVisible !== undefined ? isVisible : true,
        managerId,
        projectId: null // Explicitly set as template
      },
      include: {
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true
          }
        }
      }
    });

    res.status(201).json({
      message: 'Department template created successfully',
      department
    });
  } catch (error) {
    console.error('[Departments API] Error:', error);
    res.status(500).json({ error: 'Failed to create department template' });
  }
});

/**
 * GET /api/departments/templates
 * Get only department templates (without projects)
 */
router.get('/templates', async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 50,
    search,
    type,
    sortBy = 'name',
    sortOrder = 'asc'
  } = req.query;

  try {
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 50, 200);
    const offset = (pageNum - 1) * limitNum;

    // Build where clause - only templates
    const where: any = {
      projectId: { equals: null } // Only templates
    };

    if (search) {
      where.name = { contains: search as string, mode: 'insensitive' };
    }

    if (type) {
      where.type = type;
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get department templates
    const [templates, totalCount] = await Promise.all([
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
          manager: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatarUrl: true
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
    const templatesWithStats = templates.map(template => ({
      ...template,
      isTemplate: true,
      managerName: template.manager 
        ? `${template.manager.firstName || ''} ${template.manager.lastName || ''}`.trim() || template.manager.email
        : null
    }));

    res.json({
      templates: templatesWithStats,
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
    res.status(500).json({ error: 'Failed to fetch department templates' });
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
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true
          }
        },
        tasks: {
          select: {
            id: true,
            title: true,
            status: true,
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true
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
      isTemplate: !department.project,
      managerName: department.manager 
        ? `${department.manager.firstName || ''} ${department.manager.lastName || ''}`.trim() || department.manager.email
        : null,
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
 * PATCH /api/departments/:departmentId
 * Update department template
 */
router.patch('/:departmentId', async (req: Request, res: Response) => {
  const { departmentId } = req.params;
  const { name, type, description, order, isVisible, managerId } = req.body;

  try {
    // Check if department exists and is a template
    const existingDepartment = await prisma.department.findFirst({
      where: {
        id: departmentId,
        projectId: { equals: null } // Only templates can be updated globally
      }
    });

    if (!existingDepartment) {
      return res.status(404).json({ error: 'Department template not found' });
    }

    // Check name uniqueness if name is being updated
    if (name && name !== existingDepartment.name) {
      const nameConflict = await prisma.department.findFirst({
        where: {
          name,
          projectId: { equals: null },
          id: { not: departmentId }
        }
      });

      if (nameConflict) {
        return res.status(400).json({ error: 'Department template with this name already exists' });
      }
    }

    const updatedDepartment = await prisma.department.update({
      where: { id: departmentId },
      data: {
        ...(name && { name }),
        ...(type && { type }),
        ...(description !== undefined && { description }),
        ...(order !== undefined && { order }),
        ...(isVisible !== undefined && { isVisible }),
        ...(managerId !== undefined && { managerId })
      },
      include: {
        manager: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true
          }
        }
      }
    });

    res.json({
      message: 'Department template updated successfully',
      department: updatedDepartment
    });
  } catch (error) {
    console.error('[Departments API] Error:', error);
    res.status(500).json({ error: 'Failed to update department template' });
  }
});

/**
 * DELETE /api/departments/:departmentId
 * Delete department template
 */
router.delete('/:departmentId', async (req: Request, res: Response) => {
  const { departmentId } = req.params;

  try {
    // Check if department exists and is a template
    const existingDepartment = await prisma.department.findFirst({
      where: {
        id: departmentId,
        projectId: { equals: null } // Only templates can be deleted globally
      }
    });

    if (!existingDepartment) {
      return res.status(404).json({ error: 'Department template not found' });
    }

    await prisma.department.delete({
      where: { id: departmentId }
    });

    res.json({ message: 'Department template deleted successfully' });
  } catch (error) {
    console.error('[Departments API] Error:', error);
    res.status(500).json({ error: 'Failed to delete department template' });
  }
});

export default router;
