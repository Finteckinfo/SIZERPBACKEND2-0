import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth.js';
import { checkProjectAccess } from '../utils/accessControl.js';

const router = Router();
const prisma = new PrismaClient();

// Helper function to check authentication
const requireAuth = (req: Request, res: Response): boolean => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  return true;
};

// POST /api/tasks - Create task
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { title, description, departmentId, assignedRoleId, priority, startDate, dueDate, endDate, isAllDay, timeZone, progress, checklistCount, checklistCompleted } = req.body;

    // Check if user has access to this department
    if (!requireAuth(req, res)) return;

    // First, get the department to find its project
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      include: { project: true }
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    // Check if user has access to this project and department
    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: department.projectId,
        OR: [
          // Project owners can create tasks in any department
          { role: 'PROJECT_OWNER' },
          // Project managers can create tasks in any department
          { role: 'PROJECT_MANAGER' },
          // Employees can only create tasks in departments they have access to
          {
            role: 'EMPLOYEE',
            accessibleDepartments: {
              some: { id: departmentId }
            }
          }
        ]
      },
      include: { project: true }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Access denied to this department' });
    }

    // Check if user has permission to create tasks
    if (userRole.role === 'EMPLOYEE') {
      // Employees might have limited task creation rights - you can customize this logic
      return res.status(403).json({ error: 'Employees cannot create tasks' });
    }

    const task = await prisma.task.create({
      data: {
        title,
        description,
        departmentId,
        assignedRoleId,
        priority: priority || 'MEDIUM',
        startDate: startDate ? new Date(startDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        isAllDay: typeof isAllDay === 'boolean' ? isAllDay : undefined,
        timeZone: timeZone || undefined,
        progress: typeof progress === 'number' ? progress : undefined,
        checklistCount: typeof checklistCount === 'number' ? checklistCount : undefined,
        checklistCompleted: typeof checklistCompleted === 'number' ? checklistCompleted : undefined,
        createdByRoleId: userRole.id
      },
      include: {
        department: true,
        assignedRole: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    res.status(201).json(task);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// PUT /api/tasks/:id - Update task
router.put('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { title, description, status, priority, startDate, dueDate, endDate, isAllDay, timeZone, progress, checklistCount, checklistCompleted } = req.body;

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        department: true,
        assignedRole: true
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if user has access to this task's department
    if (!requireAuth(req, res)) return;

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: task.department.projectId,
        OR: [
          // Project owners can update tasks in any department
          { role: 'PROJECT_OWNER' },
          // Project managers can update tasks in any department
          { role: 'PROJECT_MANAGER' },
          // Employees can only update tasks in departments they have access to
          {
            role: 'EMPLOYEE',
            accessibleDepartments: {
              some: { id: task.departmentId }
            }
          }
        ]
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Access denied to this task' });
    }

    // Check permissions based on role
    let canUpdate = false;
    
    if (userRole.role === 'PROJECT_OWNER') {
      canUpdate = true;
    } else if (userRole.role === 'PROJECT_MANAGER') {
      // Managers can update tasks in departments they manage
      canUpdate = true;
    } else if (userRole.role === 'EMPLOYEE') {
      // Employees can only update tasks assigned to them
      canUpdate = task.assignedRoleId === userRole.id;
    }

    if (!canUpdate) {
      return res.status(403).json({ error: 'Insufficient permissions to update this task' });
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        title,
        description,
        status,
        priority,
        startDate: startDate !== undefined ? (startDate ? new Date(startDate) : null) : undefined,
        dueDate: dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : undefined,
        endDate: endDate !== undefined ? (endDate ? new Date(endDate) : null) : undefined,
        isAllDay: typeof isAllDay === 'boolean' ? isAllDay : undefined,
        timeZone: timeZone !== undefined ? (timeZone || null) : undefined,
        progress: typeof progress === 'number' ? progress : undefined,
        checklistCount: typeof checklistCount === 'number' ? checklistCount : undefined,
        checklistCompleted: typeof checklistCompleted === 'number' ? checklistCompleted : undefined
      },
      include: {
        department: true,
        assignedRole: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    res.json(updatedTask);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id - Delete task
router.delete('/:id', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        department: true
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check if user has permission to delete this task
    if (!requireAuth(req, res)) return;

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: task.department.projectId,
        OR: [
          // Project owners can delete tasks in any department
          { role: 'PROJECT_OWNER' },
          // Project managers can delete tasks in any department
          { role: 'PROJECT_MANAGER' },
          // Employees can only delete tasks in departments they have access to
          {
            role: 'EMPLOYEE',
            accessibleDepartments: {
              some: { id: task.departmentId }
            }
          }
        ]
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Access denied to this task' });
    }

    // Only project owners and managers can delete tasks
    if (userRole.role === 'EMPLOYEE') {
      return res.status(403).json({ error: 'Employees cannot delete tasks' });
    }

    await prisma.task.delete({
      where: { id }
    });

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// POST /api/tasks/:id/assign/:roleId - Assign task to role
router.post('/:id/assign/:roleId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id, roleId } = req.params;

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        department: true
      }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const assignedRole = await prisma.userRole.findUnique({
      where: { id: roleId }
    });

    if (!assignedRole) {
      return res.status(404).json({ error: 'User role not found' });
    }

    if (assignedRole.projectId !== task.department.projectId) {
      return res.status(400).json({ error: 'User role does not belong to the same project' });
    }

    // Check if user has permission to assign tasks
    if (!requireAuth(req, res)) return;

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: task.department.projectId,
        OR: [
          // Project owners can assign tasks in any department
          { role: 'PROJECT_OWNER' },
          // Project managers can assign tasks in any department
          { role: 'PROJECT_MANAGER' },
          // Employees can only assign tasks in departments they have access to
          {
            role: 'EMPLOYEE',
            accessibleDepartments: {
              some: { id: task.departmentId }
            }
          }
        ]
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Access denied to this task' });
    }

    // Only project owners and managers can assign tasks
    if (userRole.role === 'EMPLOYEE') {
      return res.status(403).json({ error: 'Employees cannot assign tasks' });
    }

    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        assignedRoleId: roleId
      },
      include: {
        department: true,
        assignedRole: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      }
    });

    res.json(updatedTask);
  } catch (error) {
    console.error('Error assigning task:', error);
    res.status(500).json({ error: 'Failed to assign task' });
  }
});

// GET /api/tasks/project/:projectId - Get project tasks
router.get('/project/:projectId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { status, departmentId, assignedTo, page = 1, limit = 50, dateFrom, dateTo, search, fields, sortBy = 'dueDate', sortOrder = 'desc' } = req.query as any;

    // Check if user has access to this project (including ownership)
    if (!requireAuth(req, res)) return;

    const access = await checkProjectAccess(req.user!.id, projectId);
    if (!access.hasAccess) {
      return res.status(403).json({ error: 'Access denied to this project' });
    }

    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    const where: any = { department: { projectId } };

    if (status) where.status = status;
    if (departmentId) where.departmentId = departmentId;
    if (assignedTo) where.assignedRoleId = assignedTo;
    if (dateFrom || dateTo) {
      const gte = dateFrom ? new Date(String(dateFrom)) : undefined;
      const lte = dateTo ? new Date(String(dateTo)) : undefined;
      if ((gte && isNaN(gte.getTime())) || (lte && isNaN(lte.getTime()))) {
        return res.status(400).json({ error: 'Invalid date range' });
      }
      where.AND = [{ OR: [ { dueDate: { gte, lte } }, { startDate: { gte, lte } } ] }];
    }
    if (search) {
      where.OR = [
        { title: { contains: String(search), mode: 'insensitive' } },
        { description: { contains: String(search), mode: 'insensitive' } }
      ];
    }

    const orderBy: any = {};
    const normalizedSortOrder = String(sortOrder) === 'asc' ? 'asc' : 'desc';
    if (sortBy === 'priority') orderBy.priority = normalizedSortOrder;
    else if (sortBy === 'title') orderBy.title = normalizedSortOrder;
    else if (sortBy === 'startDate') orderBy.startDate = normalizedSortOrder;
    else if (sortBy === 'createdAt') orderBy.createdAt = normalizedSortOrder;
    else orderBy.dueDate = normalizedSortOrder; // default

    const minimal = String(fields || '') === 'minimal';
    const [tasks, totalCount] = await Promise.all([
      prisma.task.findMany({
        where,
        select: minimal ? {
          id: true,
          title: true,
          status: true,
          priority: true,
          departmentId: true,
          startDate: true,
          dueDate: true,
          createdAt: true,
          department: { select: { id: true, name: true, type: true, color: true, projectId: true } },
          assignedRoleId: true
        } : {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          startDate: true,
          dueDate: true,
          createdAt: true,
          updatedAt: true,
          department: {
            select: { id: true, name: true, type: true, color: true, projectId: true }
          },
          assignedRole: {
            select: {
              id: true,
              user: {
                select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true }
              }
            }
          }
        },
        skip: offset,
        take: limitNum,
        orderBy
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
    console.error('Error fetching project tasks:', error);
    res.status(500).json({ error: 'Failed to fetch project tasks' });
  }
});

// GET /api/tasks/department/:departmentId - Get department tasks
router.get('/department/:departmentId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { departmentId } = req.params;

    // Check if user has access to this department
    if (!requireAuth(req, res)) return;

    // First, get the department to find its project
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      include: { project: true }
    });

    if (!department) {
      return res.status(404).json({ error: 'Department not found' });
    }

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: department.projectId,
        OR: [
          // Project owners can view tasks in any department
          { role: 'PROJECT_OWNER' },
          // Project managers can view tasks in any department
          { role: 'PROJECT_MANAGER' },
          // Employees can only view tasks in departments they have access to
          {
            role: 'EMPLOYEE',
            accessibleDepartments: {
              some: { id: departmentId }
            }
          }
        ]
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Access denied to this department' });
    }

    const tasks = await prisma.task.findMany({
      where: {
        departmentId: departmentId
      },
      include: {
        department: true,
        assignedRole: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true
              }
            }
          }
        }
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' }
      ]
    });

    res.json(tasks);
  } catch (error) {
    console.error('Error fetching department tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

export default router;
