// src/routes/projects.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/projects
 * List all projects with filtering, pagination, and search
 */
router.get('/', async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 20,
    search,
    type,
    priority,
    status,
    ownerId,
    startDate,
    endDate,
    tags,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  try {
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    // Build where clause
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    if (type) where.type = type;
    if (priority) where.priority = priority;
    if (ownerId) where.ownerId = ownerId;
    if (startDate) where.startDate = { gte: new Date(startDate as string) };
    if (endDate) where.endDate = { lte: new Date(endDate as string) };

    if (tags && Array.isArray(tags)) {
      where.tags = {
        some: {
          name: { in: tags as string[] }
        }
      };
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get projects with related data
    const [projects, totalCount] = await Promise.all([
      prisma.project.findMany({
        where,
        select: {
          id: true,
          name: true,
          description: true,
          type: true,
          priority: true,
          budgetRange: true,
          startDate: true,
          endDate: true,
          createdAt: true,
          updatedAt: true,
          owner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatarUrl: true
            }
          },
          tags: {
            select: {
              id: true,
              name: true
            }
          },
          departments: {
            select: {
              id: true,
              name: true,
              type: true,
              order: true
            },
            orderBy: { order: 'asc' }
          },
          userRoles: {
            select: {
              id: true,
              role: true,
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
              departments: true,
              userRoles: true
            }
          }
        },
        skip: offset,
        take: limitNum,
        orderBy
      }),
      prisma.project.count({ where })
    ]);

    // Calculate project statistics
    const projectsWithStats = projects.map(project => {
      const totalTasks = project.departments.reduce((sum, dept) => sum + (dept as any)._count?.tasks || 0, 0);
      const completedTasks = project.departments.reduce((sum, dept) => sum + (dept as any)._count?.completedTasks || 0, 0);
      
      return {
        ...project,
        stats: {
          totalDepartments: project._count.departments,
          totalTeamMembers: project._count.userRoles,
          totalTasks,
          completedTasks,
          completionPercentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
        }
      };
    });

    res.json({
      projects: projectsWithStats,
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
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

/**
 * GET /api/projects/:projectId
 * Get single project details
 */
router.get('/:projectId', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        priority: true,
        budgetRange: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        updatedAt: true,
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true
          }
        },
        tags: {
          select: {
            id: true,
            name: true,
            createdAt: true
          }
        },
        departments: {
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
            },
            tasks: {
              select: {
                id: true,
                title: true,
                description: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                assignedTo: {
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
          orderBy: { order: 'asc' }
        },
        userRoles: {
          select: {
            id: true,
            role: true,
            departmentOrder: true,
            departmentScope: true,
            createdAt: true,
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
        invites: {
          select: {
            id: true,
            email: true,
            role: true,
            status: true,
            expiresAt: true,
            createdAt: true
          },
          where: {
            status: 'PENDING'
          }
        }
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Calculate comprehensive project statistics
    const totalTasks = project.departments.reduce((sum, dept) => sum + dept._count.tasks, 0);
    const completedTasks = project.departments.reduce((sum, dept) => 
      sum + dept.tasks.filter(task => task.status === 'COMPLETED').length, 0
    );
    const inProgressTasks = project.departments.reduce((sum, dept) => 
      sum + dept.tasks.filter(task => task.status === 'IN_PROGRESS').length, 0
    );
    const pendingTasks = project.departments.reduce((sum, dept) => 
      sum + dept.tasks.filter(task => task.status === 'PENDING').length, 0
    );

    const projectWithStats = {
      ...project,
      stats: {
        totalDepartments: project.departments.length,
        totalTeamMembers: project.userRoles.length,
        totalTasks,
        completedTasks,
        inProgressTasks,
        pendingTasks,
        completionPercentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
        daysRemaining: Math.ceil((new Date(project.endDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
      }
    };

    res.json(projectWithStats);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch project details' });
  }
});

/**
 * POST /api/projects
 * Create a new project with all related data
 */
router.post('/', async (req: Request, res: Response) => {
  const {
    name,
    description,
    type,
    startDate,
    endDate,
    priority,
    budgetRange,
    tags,
    departments,
    roles,
    walletAddress,
    userId,
    idempotencyKey,
    roleDepartmentOrder,
    roleDepartmentScope,
    departmentVisibility
  } = req.body;

  try {
    // Verify wallet ownership
    if (walletAddress && userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { walletAddress: true }
      });
      if (!user?.walletAddress || user.walletAddress !== walletAddress) {
        return res.status(400).json({ error: 'Wallet address does not match requester' });
      }
    }

    // Check idempotency
    if (idempotencyKey) {
      const existingProject = await prisma.project.findFirst({
        where: { name },
        select: { id: true }
      });
      
      if (existingProject) {
        return res.json({
          project: existingProject,
          message: 'Project already exists (idempotency)'
        });
      }
    }

    // Create project with all related data in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the project
      const project = await tx.project.create({
        data: {
          name,
          description,
          type,
          priority: priority || 'MEDIUM',
          budgetRange,
          startDate: new Date(startDate),
          endDate: new Date(endDate),
          ownerId: userId
        }
      });

      // Create tags
      if (tags && Array.isArray(tags)) {
        await Promise.all(
          tags.map((tagName: string) =>
            tx.projectTag.create({
              data: {
                name: tagName,
                projectId: project.id
              }
            })
          )
        );
      }

      // Create departments
      const createdDepartments = [];
      const departmentsInput = Array.isArray(departmentVisibility) && departmentVisibility.length > 0
        ? departmentVisibility
        : departments;
      
      if (departmentsInput && Array.isArray(departmentsInput)) {
        for (const dept of departmentsInput) {
          const department = await tx.department.create({
            data: {
              name: dept.name,
              type: dept.type,
              description: dept.description,
              order: dept.order || 0,
              isVisible: typeof dept.isVisible === 'boolean' ? dept.isVisible : true,
              projectId: project.id,
              managerId: dept.managerId
            }
          });
          createdDepartments.push(department);
        }
      }

      // Ensure at least one PROJECT_OWNER (fallback to creator)
      const hasOwner = Array.isArray(roles) && roles.some((r: any) => r.role === 'PROJECT_OWNER');
      const rolesWithFallback = [...(roles || [])];
      if (!hasOwner && userId) {
        rolesWithFallback.push({ userId, role: 'PROJECT_OWNER' });
      }

      // Create user roles
      const createdRoles = [];
      if (rolesWithFallback && Array.isArray(rolesWithFallback)) {
        const deptIdSet = new Set(createdDepartments.map(d => d.id));
        
        for (const roleData of rolesWithFallback) {
          if (roleData.userId) {
            const key = roleData.userId || roleData.userEmail;
            const orderFromBody: string[] | undefined = roleDepartmentOrder?.[key];
            const scopeFromBody: string[] | undefined = roleDepartmentScope?.[key];

            const validOrder = Array.isArray(orderFromBody)
              ? orderFromBody.filter((id: string) => deptIdSet.has(id))
              : [];
            const validScope = Array.isArray(scopeFromBody)
              ? scopeFromBody.filter((id: string) => deptIdSet.has(id))
              : [];

            const userRole = await tx.userRole.create({
              data: {
                userId: roleData.userId,
                projectId: project.id,
                role: roleData.role,
                departmentOrder: validOrder,
                departmentScope: validScope
              }
            });
            createdRoles.push(userRole);
          }
        }
      }

      // Create invites for users without IDs
      const createdInvites = [];
      if (roles && Array.isArray(roles)) {
        for (const roleData of roles) {
          if (roleData.userEmail && !roleData.userId) {
            const invite = await tx.projectInvite.create({
              data: {
                email: roleData.userEmail,
                role: roleData.role,
                projectId: project.id,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
              }
            });
            createdInvites.push(invite);
          }
        }
      }

      return {
        project,
        departments: createdDepartments,
        roles: createdRoles,
        invites: createdInvites
      };
    });

    res.status(201).json(result);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

/**
 * PATCH /api/projects/:projectId
 * Update project details
 */
router.patch('/:projectId', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const {
    name,
    description,
    type,
    startDate,
    endDate,
    priority,
    budgetRange,
    tags
  } = req.body;

  try {
    // Check if project exists
    const existingProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });

    if (!existingProject) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check name uniqueness if name is being updated
    if (name) {
      const nameConflict = await prisma.project.findFirst({
        where: {
          name,
          id: { not: projectId }
        },
        select: { id: true }
      });

      if (nameConflict) {
        return res.status(400).json({ error: 'Project name already exists' });
      }
    }

    // Update project
    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(type && { type }),
        ...(startDate && { startDate: new Date(startDate) }),
        ...(endDate && { endDate: new Date(endDate) }),
        ...(priority && { priority }),
        ...(budgetRange !== undefined && { budgetRange })
      }
    });

    // Update tags if provided
    if (tags !== undefined) {
      // Remove existing tags
      await prisma.projectTag.deleteMany({
        where: { projectId }
      });

      // Add new tags
      if (Array.isArray(tags) && tags.length > 0) {
        await Promise.all(
          tags.map((tagName: string) =>
            prisma.projectTag.create({
              data: {
                name: tagName,
                projectId
              }
            })
          )
        );
      }
    }

    res.json({ 
      message: 'Project updated successfully',
      project: updatedProject
    });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

/**
 * DELETE /api/projects/:projectId
 * Delete project and all related data
 */
router.delete('/:projectId', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    // Check if project exists
    const existingProject = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });

    if (!existingProject) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Delete project and all related data in a transaction
    await prisma.$transaction(async (tx) => {
      // Delete in order to respect foreign key constraints
      await tx.payment.deleteMany({
        where: {
          task: {
            department: {
              projectId
            }
          }
        }
      });

      await tx.task.deleteMany({
        where: {
          department: {
            projectId
          }
        }
      });

      await tx.department.deleteMany({
        where: { projectId }
      });

      await tx.userRole.deleteMany({
        where: { projectId }
      });

      await tx.projectInvite.deleteMany({
        where: { projectId }
      });

      await tx.projectTag.deleteMany({
        where: { projectId }
      });

      await tx.projectDraft.deleteMany({
        where: { projectId }
      });

      await tx.project.delete({
        where: { id: projectId }
      });
    });

    res.json({ message: 'Project deleted successfully' });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

/**
 * GET /api/projects/:projectId/departments
 * Get project departments
 */
router.get('/:projectId/departments', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    const departments = await prisma.department.findMany({
      where: { projectId },
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
            }
          }
        },
        _count: {
          select: {
            tasks: true
          }
        }
      },
      orderBy: { order: 'asc' }
    });

    res.json(departments);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

/**
 * POST /api/projects/:projectId/departments
 * Create new department
 */
router.post('/:projectId/departments', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { name, type, description, order, isVisible, managerId } = req.body;

  try {
    // Check if project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get the next order if not provided
    let departmentOrder = order;
    if (departmentOrder === undefined) {
      const maxOrder = await prisma.department.aggregate({
        where: { projectId },
        _max: { order: true }
      });
      departmentOrder = (maxOrder._max.order || 0) + 1;
    }

    const department = await prisma.department.create({
      data: {
        name,
        type,
        description,
        order: departmentOrder,
        isVisible: isVisible !== undefined ? isVisible : true,
        projectId,
        managerId
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

    res.status(201).json(department);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to create department' });
  }
});

/**
 * PATCH /api/projects/:projectId/departments/:departmentId
 * Update department
 */
router.patch('/:projectId/departments/:departmentId', async (req: Request, res: Response) => {
  const { projectId, departmentId } = req.params;
  const { name, type, description, order, isVisible, managerId } = req.body;

  try {
    const department = await prisma.department.update({
      where: {
        id: departmentId,
        projectId // Ensure department belongs to the project
      },
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

    res.json(department);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to update department' });
  }
});

/**
 * DELETE /api/projects/:projectId/departments/:departmentId
 * Delete department
 */
router.delete('/:projectId/departments/:departmentId', async (req: Request, res: Response) => {
  const { projectId, departmentId } = req.params;

  try {
    // Check if department has tasks
    const departmentWithTasks = await prisma.department.findUnique({
      where: { id: departmentId },
      select: {
        id: true,
        _count: {
          select: { tasks: true }
        }
      }
    });

    if (!departmentWithTasks) {
      return res.status(404).json({ error: 'Department not found' });
    }

    if (departmentWithTasks._count.tasks > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete department with existing tasks. Please reassign or delete tasks first.' 
      });
    }

    await prisma.department.delete({
      where: {
        id: departmentId,
        projectId
      }
    });

    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

/**
 * PATCH /api/projects/:projectId/departments/reorder
 * Reorder departments
 */
router.patch('/:projectId/departments/reorder', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { departmentOrders } = req.body; // Array of { id, order }

  try {
    if (!Array.isArray(departmentOrders)) {
      return res.status(400).json({ error: 'departmentOrders must be an array' });
    }

    // Update all departments in a transaction
    await prisma.$transaction(
      departmentOrders.map(({ id, order }) =>
        prisma.department.update({
          where: { id, projectId },
          data: { order }
        })
      )
    );

    res.json({ message: 'Departments reordered successfully' });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to reorder departments' });
  }
});

/**
 * GET /api/projects/:projectId/users
 * Get project team members
 */
router.get('/:projectId/users', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    const userRoles = await prisma.userRole.findMany({
      where: { projectId },
      select: {
        id: true,
        role: true,
        departmentOrder: true,
        departmentScope: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true,
            walletAddress: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    res.json(userRoles);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch project users' });
  }
});

/**
 * POST /api/projects/:projectId/users
 * Add user to project
 */
router.post('/:projectId/users', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { userId, role, departmentOrder, departmentScope } = req.body;

  try {
    // Check if project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if user already has a role in this project
    const existingRole = await prisma.userRole.findFirst({
      where: {
        userId,
        projectId
      }
    });

    if (existingRole) {
      return res.status(400).json({ error: 'User already has a role in this project' });
    }

    const userRole = await prisma.userRole.create({
      data: {
        userId,
        projectId,
        role,
        departmentOrder: departmentOrder || [],
        departmentScope: departmentScope || []
      },
      include: {
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
    });

    res.status(201).json(userRole);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to add user to project' });
  }
});

/**
 * PATCH /api/projects/:projectId/users/:userId
 * Update user role
 */
router.patch('/:projectId/users/:userId', async (req: Request, res: Response) => {
  const { projectId, userId } = req.params;
  const { role, departmentOrder, departmentScope } = req.body;

  try {
    const userRole = await prisma.userRole.update({
      where: {
        id: (await prisma.userRole.findFirst({
          where: { userId, projectId }
        }))?.id
      },
      data: {
        ...(role && { role }),
        ...(departmentOrder !== undefined && { departmentOrder }),
        ...(departmentScope !== undefined && { departmentScope })
      },
      include: {
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
    });

    res.json(userRole);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

/**
 * DELETE /api/projects/:projectId/users/:userId
 * Remove user from project
 */
router.delete('/:projectId/users/:userId', async (req: Request, res: Response) => {
  const { projectId, userId } = req.params;

  try {
    // Check if user is the project owner
    const userRole = await prisma.userRole.findFirst({
      where: {
        userId,
        projectId,
        role: 'PROJECT_OWNER'
      }
    });

    if (userRole) {
      return res.status(400).json({ 
        error: 'Cannot remove project owner. Please transfer ownership first.' 
      });
    }

    const userRoleToDelete = await prisma.userRole.findFirst({
      where: { userId, projectId }
    });
    
    if (userRoleToDelete) {
      await prisma.userRole.delete({
        where: { id: userRoleToDelete.id }
      });
    }

    res.json({ message: 'User removed from project successfully' });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to remove user from project' });
  }
});

/**
 * GET /api/projects/:projectId/tasks
 * Get project tasks
 */
router.get('/:projectId/tasks', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { status, departmentId, assignedTo, page = 1, limit = 50 } = req.query;

  try {
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    const where: any = {
      department: { projectId }
    };

    if (status) where.status = status;
    if (departmentId) where.departmentId = departmentId;
    if (assignedTo) where.employeeId = assignedTo;

    const [tasks, totalCount] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          department: {
            select: {
              id: true,
              name: true,
              type: true
            }
          },
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatarUrl: true
            }
          },
          payments: {
            select: {
              id: true,
              amount: true,
              status: true
            }
          }
        },
        skip: offset,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.task.count({ where })
    ]);

    res.json({
      tasks,
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
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

/**
 * POST /api/projects/:projectId/tasks
 * Create new task
 */
router.post('/:projectId/tasks', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { title, description, departmentId, assignedTo } = req.body;

  try {
    // Verify department belongs to project
    const department = await prisma.department.findFirst({
      where: {
        id: departmentId,
        projectId
      }
    });

    if (!department) {
      return res.status(400).json({ error: 'Invalid department for this project' });
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        departmentId,
        employeeId: assignedTo
      },
      include: {
        department: {
          select: {
            id: true,
            name: true,
            type: true
          }
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    res.status(201).json(task);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

/**
 * PATCH /api/projects/:projectId/tasks/:taskId
 * Update task
 */
router.patch('/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const { title, description, departmentId, assignedTo } = req.body;

  try {
    const task = await prisma.task.update({
      where: {
        id: taskId,
        department: { projectId }
      },
      data: {
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(departmentId && { departmentId }),
        ...(assignedTo !== undefined && { employeeId: assignedTo })
      },
      include: {
        department: {
          select: {
            id: true,
            name: true,
            type: true
          }
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    res.json(task);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

/**
 * DELETE /api/projects/:projectId/tasks/:taskId
 * Delete task
 */
router.delete('/:projectId/tasks/:taskId', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;

  try {
    // Check if task has payments
    const taskWithPayments = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        _count: {
          select: { payments: true }
        }
      }
    });

    if (!taskWithPayments) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (taskWithPayments._count.payments > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete task with existing payments. Please handle payments first.' 
      });
    }

    await prisma.task.delete({
      where: {
        id: taskId,
        department: { projectId }
      }
    });

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

/**
 * PATCH /api/projects/:projectId/tasks/:taskId/status
 * Change task status
 */
router.patch('/:projectId/tasks/:taskId/status', async (req: Request, res: Response) => {
  const { projectId, taskId } = req.params;
  const { status } = req.body;

  try {
    const task = await prisma.task.update({
      where: {
        id: taskId,
        department: { projectId }
      },
      data: { status },
      include: {
        department: {
          select: {
            id: true,
            name: true
          }
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    res.json(task);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to update task status' });
  }
});

/**
 * GET /api/projects/:projectId/tags
 * Get project tags
 */
router.get('/:projectId/tags', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    const tags = await prisma.projectTag.findMany({
      where: { projectId },
      select: {
        id: true,
        name: true,
        createdAt: true
      },
      orderBy: { name: 'asc' }
    });

    res.json(tags);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch project tags' });
  }
});

/**
 * POST /api/projects/:projectId/tags
 * Add tag to project
 */
router.post('/:projectId/tags', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { name } = req.body;

  try {
    const tag = await prisma.projectTag.create({
      data: {
        name,
        projectId
      }
    });

    res.status(201).json(tag);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to add tag' });
  }
});

/**
 * DELETE /api/projects/:projectId/tags/:tagId
 * Remove tag from project
 */
router.delete('/:projectId/tags/:tagId', async (req: Request, res: Response) => {
  const { projectId, tagId } = req.params;

  try {
    await prisma.projectTag.delete({
      where: {
        id: tagId,
        projectId
      }
    });

    res.json({ message: 'Tag removed successfully' });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to remove tag' });
  }
});

/**
 * GET /api/projects/:projectId/drafts
 * Get project drafts
 */
router.get('/:projectId/drafts', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    const drafts = await prisma.projectDraft.findMany({
      where: { projectId },
      select: {
        id: true,
        data: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.json(drafts);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch project drafts' });
  }
});

/**
 * POST /api/projects/:projectId/drafts
 * Save project draft
 */
router.post('/:projectId/drafts', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { data } = req.body;

  try {
    const draft = await prisma.projectDraft.create({
      data: {
        projectId,
        data
      }
    });

    res.status(201).json(draft);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

/**
 * PATCH /api/projects/:projectId/drafts/:draftId
 * Update project draft
 */
router.patch('/:projectId/drafts/:draftId', async (req: Request, res: Response) => {
  const { projectId, draftId } = req.params;
  const { data } = req.body;

  try {
    const draft = await prisma.projectDraft.update({
      where: {
        id: draftId,
        projectId
      },
      data: { data }
    });

    res.json(draft);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to update draft' });
  }
});

/**
 * DELETE /api/projects/:projectId/drafts/:draftId
 * Delete project draft
 */
router.delete('/:projectId/drafts/:draftId', async (req: Request, res: Response) => {
  const { projectId, draftId } = req.params;

  try {
    await prisma.projectDraft.delete({
      where: {
        id: draftId,
        projectId
      }
    });

    res.json({ message: 'Draft deleted successfully' });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
});

/**
 * GET /api/projects/:projectId/invites
 * Get project invites
 */
router.get('/:projectId/invites', async (req: Request, res: Response) => {
  const { projectId } = req.params;

  try {
    const invites = await prisma.projectInvite.findMany({
      where: { projectId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatarUrl: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(invites);
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch project invites' });
  }
});

/**
 * POST /api/projects/:projectId/invites
 * Send project invite
 */
router.post('/:projectId/invites', async (req: Request, res: Response) => {
  const { projectId } = req.params;
  const { email, role, expiresInDays = 7 } = req.body;

  try {
    // Check if project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if user already has a role or invite
    const existingInvite = await prisma.projectInvite.findFirst({
      where: {
        email,
        projectId,
        status: { in: ['PENDING', 'ACCEPTED'] }
      }
    });

    if (existingInvite) {
      return res.status(400).json({ error: 'User already has an active invite or role in this project' });
    }

    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

    const invite = await prisma.projectInvite.create({
      data: {
        email,
        role,
        projectId,
        expiresAt
      }
    });

    res.status(201).json({
      message: 'Invite sent successfully',
      invite: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt
      }
    });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

/**
 * PATCH /api/projects/:projectId/invites/:inviteId
 * Update invite status
 */
router.patch('/:projectId/invites/:inviteId', async (req: Request, res: Response) => {
  const { projectId, inviteId } = req.params;
  const { status, userId } = req.body;

  try {
    const invite = await prisma.projectInvite.findFirst({
      where: {
        id: inviteId,
        projectId
      }
    });

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }

    if (status === 'ACCEPTED' && userId) {
      // Accept the invite in a transaction
      await prisma.$transaction(async (tx) => {
        // Create user role
        await tx.userRole.create({
          data: {
            userId,
            projectId,
            role: invite.role
          }
        });

        // Update invite status
        await tx.projectInvite.update({
          where: { id: inviteId },
          data: {
            status: 'ACCEPTED',
            userId
          }
        });
      });

      res.json({
        message: 'Invite accepted successfully',
        inviteId
      });
    } else {
      // Update invite status only
      const updatedInvite = await prisma.projectInvite.update({
        where: { id: inviteId },
        data: { status }
      });

      res.json(updatedInvite);
    }
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to update invite' });
  }
});

// Keep existing endpoints for backward compatibility
/**
 * GET /api/projects/validate-name?name=...
 * Check if project name is available
 */
router.get('/validate-name', async (req: Request, res: Response) => {
  const { name } = req.query;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid name parameter' });
  }

  try {
    const existingProject = await prisma.project.findUnique({
      where: { name },
      select: { id: true }
    });

    res.json({ 
      available: !existingProject,
      name: name as string
    });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to validate project name' });
  }
});

/**
 * POST /api/projects/precheck
 * Preflight check for project creation
 */
router.post('/precheck', async (req: Request, res: Response) => {
  const { 
    name, 
    startDate, 
    endDate, 
    walletAddress, 
    userId,
    departments,
    roles 
  } = req.body;

  try {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    if (!name) errors.push('Project name is required');
    if (!startDate) errors.push('Start date is required');
    if (!endDate) errors.push('End date is required');
    if (!walletAddress) errors.push('Wallet address is required');
    if (!userId) errors.push('User ID is required');

    // Check date validity
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      if (isNaN(start.getTime())) errors.push('Invalid start date');
      if (isNaN(end.getTime())) errors.push('Invalid end date');
      if (start >= end) errors.push('End date must be after start date');
      
      // Check if dates are in the future
      const now = new Date();
      if (start < now) warnings.push('Start date is in the past');
    }

    // Check wallet ownership
    if (walletAddress && userId) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { walletAddress: true }
      });
      
      if (!user?.walletAddress) {
        errors.push('User wallet not connected');
      } else if (user.walletAddress !== walletAddress) {
        errors.push('Wallet address does not match user wallet');
      }
    }

    // Check name availability
    if (name) {
      const existingProject = await prisma.project.findUnique({
        where: { name },
        select: { id: true }
      });
      
      if (existingProject) {
        errors.push('Project name already exists');
      }
    }

    // Check department constraints
    if (departments && Array.isArray(departments)) {
      if (departments.length === 0) {
        warnings.push('No departments specified');
      }
      
      const majorDepts = departments.filter((dept: any) => dept.type === 'MAJOR');
      if (majorDepts.length === 0) {
        warnings.push('No major departments specified');
      }
    }

    // Check role constraints
    if (roles && Array.isArray(roles)) {
      const owners = roles.filter((role: any) => role.role === 'PROJECT_OWNER');
      if (owners.length === 0) {
        errors.push('At least one PROJECT_OWNER role is required');
      }
    }

    const isValid = errors.length === 0;
    
    res.json({
      isValid,
      errors,
      warnings,
      summary: {
        hasErrors: errors.length > 0,
        hasWarnings: warnings.length > 0,
        errorCount: errors.length,
        warningCount: warnings.length
      }
    });
  } catch (error) {
    console.error('[Projects API] Error:', error);
    res.status(500).json({ error: 'Failed to perform precheck' });
  }
});

export default router;
