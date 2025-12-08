import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { checkProjectAccess } from '../utils/accessControl.js';
import { broadcastTaskMoved, broadcastTaskAssigned, broadcastTaskCreated, broadcastTaskUpdated } from '../services/websocket.js';
import { queuePayment } from '../services/paymentQueue.js';
import prisma from '../utils/database.js';

const router = Router();

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
    const { title, description, departmentId, assignedRoleId, priority, startDate, dueDate, endDate, isAllDay, timeZone, progress, checklistCount, checklistCompleted, paymentAmount } = req.body;

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

    // Validate payment amount if provided
    if (paymentAmount !== undefined && paymentAmount !== null) {
      const parsedAmount = parseFloat(paymentAmount);
      
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        return res.status(400).json({ error: 'Invalid payment amount' });
      }
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
        paymentAmount: paymentAmount ? parseFloat(paymentAmount) : undefined,
        paymentStatus: paymentAmount ? 'ALLOCATED' : 'PENDING',
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

    // Broadcast task creation
    broadcastTaskCreated(task.department.projectId, task, req.user!.id);

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
    const { title, description, status, priority, startDate, dueDate, endDate, isAllDay, timeZone, progress, checklistCount, checklistCompleted, paymentAmount } = req.body;

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

    // Validate payment amount update
    if (paymentAmount !== undefined && paymentAmount !== null) {
      const newAmount = parseFloat(paymentAmount);
      
      if (isNaN(newAmount) || newAmount < 0) {
        return res.status(400).json({ error: 'Invalid payment amount' });
      }

      // Can't update payment if already paid
      if (task.paymentStatus === 'PAID') {
        return res.status(400).json({ error: 'Cannot update payment amount after payment has been released' });
      }
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
        checklistCompleted: typeof checklistCompleted === 'number' ? checklistCompleted : undefined,
        paymentAmount: paymentAmount !== undefined ? parseFloat(paymentAmount) : undefined,
        paymentStatus: paymentAmount !== undefined ? (parseFloat(paymentAmount) > 0 ? 'ALLOCATED' : 'PENDING') : undefined
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

    // Broadcast task update
    broadcastTaskUpdated(task.department.projectId, id, req.body, req.user!.id);

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

    // Broadcast task assignment
    broadcastTaskAssigned(task.department.projectId, id, roleId, req.user!.id);

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

// GET /api/tasks/kanban/all-projects - Cross-project kanban data
router.get('/kanban/all-projects', authenticateToken, async (req: Request, res: Response) => {
  try {
    const {
      projectIds,
      departmentIds,
      assignedRoleIds,
      priorities,
      statuses,
      includeCompleted = 'false',
      search,
      dueDate
    } = req.query;

    if (!requireAuth(req, res)) return;

    // Get all projects user has access to
    const userProjects = await prisma.userRole.findMany({
      where: { userId: req.user!.id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            type: true,
            priority: true
          }
        }
      }
    });

    if (userProjects.length === 0) {
      return res.json({
        columns: { PENDING: [], IN_PROGRESS: [], COMPLETED: [], APPROVED: [] },
        totalTasks: 0,
        projectSummary: [],
        userPermissions: {
          canCreateTasks: false,
          canEditAllTasks: false,
          canDeleteTasks: false,
          canAssignTasks: false
        }
      });
    }

    const accessibleProjectIds = userProjects.map(up => up.projectId);

    // Build where clause
    const where: any = {
      department: { 
        projectId: { in: accessibleProjectIds }
      },
      deletedAt: null
    };

    // Apply filters
    if (projectIds && Array.isArray(projectIds)) {
      where.department.projectId = { in: (projectIds as string[]).filter(id => accessibleProjectIds.includes(id)) };
    }

    if (departmentIds && Array.isArray(departmentIds)) {
      where.departmentId = { in: departmentIds };
    }

    if (assignedRoleIds && Array.isArray(assignedRoleIds)) {
      where.assignedRoleId = { in: assignedRoleIds };
    }

    if (priorities && Array.isArray(priorities)) {
      where.priority = { in: priorities };
    }

    if (statuses && Array.isArray(statuses)) {
      where.status = { in: statuses };
    } else if (includeCompleted === 'false') {
      where.status = { in: ['PENDING', 'IN_PROGRESS'] };
    }

    if (search) {
      where.OR = [
        { title: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    if (dueDate && typeof dueDate === 'object') {
      const dueDateFilter: any = {};
      if ((dueDate as any).start) dueDateFilter.gte = new Date((dueDate as any).start);
      if ((dueDate as any).end) dueDateFilter.lte = new Date((dueDate as any).end);
      if (Object.keys(dueDateFilter).length > 0) {
        where.dueDate = dueDateFilter;
      }
    }

    // Get all tasks with comprehensive data
    const tasks = await prisma.task.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        estimatedHours: true,
        dueDate: true,
        progress: true,
        order: true,
        assignedRoleId: true,
        departmentId: true,
        createdByRoleId: true,
        checklistCount: true,
        checklistCompleted: true,
        createdAt: true,
        updatedAt: true,
        assignedRole: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                avatarUrl: true
              }
            }
          }
        },
        department: {
          select: {
            id: true,
            name: true,
            color: true,
            type: true,
            project: {
              select: {
                id: true,
                name: true,
                type: true,
                priority: true
              }
            }
          }
        }
      },
      orderBy: [
        { status: 'asc' },
        { order: 'asc' },
        { createdAt: 'asc' }
      ]
    });

    // Get user permissions (use highest permission level across all projects)
    const hasOwnerRole = userProjects.some(up => up.role === 'PROJECT_OWNER');
    const hasManagerRole = userProjects.some(up => up.role === 'PROJECT_MANAGER');

    const userPermissions = {
      canCreateTasks: hasOwnerRole || hasManagerRole,
      canEditAllTasks: hasOwnerRole || hasManagerRole,
      canDeleteTasks: hasOwnerRole || hasManagerRole,
      canAssignTasks: hasOwnerRole || hasManagerRole
    };

    // Build helper maps for permission checks
    const userRoleIds = new Set(userProjects.map(up => up.id));
    const ownerProjectIds = new Set(userProjects.filter(up => up.role === 'PROJECT_OWNER').map(up => up.projectId));
    const managerProjectIds = new Set(userProjects.filter(up => up.role === 'PROJECT_MANAGER').map(up => up.projectId));
    const projectRolesMap = new Map<string, typeof userProjects>();
    userProjects.forEach(up => {
      const roles = projectRolesMap.get(up.projectId) || [];
      roles.push(up);
      projectRolesMap.set(up.projectId, roles);
    });

    const filteredTasks = tasks.filter(task => {
      const projectId = task.department.project.id;
      if (ownerProjectIds.has(projectId) || managerProjectIds.has(projectId)) {
        return true;
      }
      if (task.assignedRoleId && userRoleIds.has(task.assignedRoleId)) {
        return true;
      }
      if (task.createdByRoleId && userRoleIds.has(task.createdByRoleId)) {
        return true;
      }
      return false;
    });

    // Transform tasks with permission checks and user-friendly format
    const transformedTasks = filteredTasks.map(task => {
      const projectId = task.department.project.id;
      const projectRoles = projectRolesMap.get(projectId) || [];
      const isOwner = ownerProjectIds.has(projectId);
      const isManager = managerProjectIds.has(projectId);
      const isAssigned = task.assignedRoleId ? userRoleIds.has(task.assignedRoleId) : false;
      const isCreator = task.createdByRoleId ? userRoleIds.has(task.createdByRoleId) : false;

      const canEdit = isOwner || isManager || isAssigned || isCreator;
      const canAssign = isOwner || isManager;
      const canDelete = isOwner || (isManager && isCreator);

      return {
        ...task,
        projectId,
        departmentId: task.department.id,
        assignedUser: task.assignedRole?.user ? {
          id: task.assignedRole.user.id,
          email: task.assignedRole.user.email,
          name: `${task.assignedRole.user.firstName || ''} ${task.assignedRole.user.lastName || ''}`.trim() || task.assignedRole.user.email,
          avatar: task.assignedRole.user.avatarUrl
        } : null,
        project: task.department.project,
        department: {
          id: task.department.id,
          name: task.department.name,
          color: task.department.color,
          type: task.department.type
        },
        canView: true,
        canEdit,
        canAssign,
        canDelete
      };
    });

    // Group tasks by status
    const columns = {
      PENDING: transformedTasks.filter(task => task.status === 'PENDING'),
      IN_PROGRESS: transformedTasks.filter(task => task.status === 'IN_PROGRESS'),
      COMPLETED: transformedTasks.filter(task => task.status === 'COMPLETED'),
      APPROVED: transformedTasks.filter(task => task.status === 'APPROVED')
    };

    // Generate project summary
    const projectSummary = userProjects.map(up => {
      const projectTasks = transformedTasks.filter(task => task.project.id === up.projectId);
      const departments = [...new Set(projectTasks.map(task => task.department))];
      
      return {
        projectId: up.project.id,
        projectName: up.project.name,
        taskCount: projectTasks.length,
        departments: departments.map(dept => ({
          id: dept.id,
          name: dept.name,
          taskCount: projectTasks.filter(task => task.department.id === dept.id).length
        }))
      };
    }).filter(summary => summary.taskCount > 0);

    res.json({
      columns,
      totalTasks: transformedTasks.length,
      projectSummary,
      userPermissions
    });

  } catch (error) {
    console.error('Error fetching cross-project kanban tasks:', error);
    res.status(500).json({ error: 'Failed to fetch kanban tasks' });
  }
});

// GET /api/tasks/kanban/:projectId - Kanban-optimized task retrieval
router.get('/kanban/:projectId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { 
      departmentId, 
      assignedRoleIds, 
      priorities, 
      includeCompleted = 'false' 
    } = req.query;

    // Check if user has access to this project
    if (!requireAuth(req, res)) return;

    const access = await checkProjectAccess(req.user!.id, projectId);
    if (!access.hasAccess) {
      return res.status(403).json({ error: 'Access denied to this project' });
    }

    // Build where clause
    const where: any = { 
      department: { projectId },
      deletedAt: null
    };

    // Apply filters
    if (departmentId) {
      where.departmentId = departmentId;
    }

    if (assignedRoleIds && Array.isArray(assignedRoleIds)) {
      where.assignedRoleId = { in: assignedRoleIds };
    }

    if (priorities && Array.isArray(priorities)) {
      where.priority = { in: priorities };
    }

    // Status filter - exclude completed unless specifically requested
    if (includeCompleted === 'false') {
      where.status = { in: ['PENDING', 'IN_PROGRESS'] };
    }

    // Get all tasks for the project
    const tasks = await prisma.task.findMany({
      where,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        estimatedHours: true,
        dueDate: true,
        assignedRoleId: true,
        order: true,
        progress: true,
        departmentId: true,
        createdByRoleId: true,
        createdAt: true,
        updatedAt: true,
        assignedRole: {
          select: {
            id: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                avatarUrl: true
              }
            }
          }
        },
        department: {
          select: {
            id: true,
            name: true,
            color: true,
            type: true,
            project: {
              select: {
                id: true,
                name: true,
                type: true,
                priority: true
              }
            }
          }
        }
      },
      orderBy: [
        { status: 'asc' },
        { order: 'asc' },
        { createdAt: 'asc' }
      ]
    });

    // Get user roles for this project
    const userRoles = await prisma.userRole.findMany({
      where: {
        userId: req.user!.id,
        projectId: projectId
      }
    });

    if (userRoles.length === 0) {
      return res.status(403).json({ error: 'Access denied to this project' });
    }

    const userRoleIds = new Set(userRoles.map(role => role.id));
    const isOwner = userRoles.some(role => role.role === 'PROJECT_OWNER');
    const isManager = userRoles.some(role => role.role === 'PROJECT_MANAGER');

    const filteredTasks = tasks.filter(task => {
      if (isOwner || isManager) {
        return true;
      }
      if (task.assignedRoleId && userRoleIds.has(task.assignedRoleId)) {
        return true;
      }
      if (task.createdByRoleId && userRoleIds.has(task.createdByRoleId)) {
        return true;
      }
      return false;
    });

    const transformedTasks = filteredTasks.map(task => {
      const canEdit = isOwner || isManager || (task.assignedRoleId ? userRoleIds.has(task.assignedRoleId) : false) || (task.createdByRoleId ? userRoleIds.has(task.createdByRoleId) : false);
      const canAssign = isOwner || isManager;
      const canDelete = isOwner || (isManager && (task.createdByRoleId ? userRoleIds.has(task.createdByRoleId) : false));

      return {
        ...task,
        projectId,
        departmentId: task.department.id,
        assignedUser: task.assignedRole?.user || null,
        canView: true,
        canEdit,
        canAssign,
        canDelete
      };
    });

    // Group tasks by status for kanban columns
    const columns = {
      PENDING: transformedTasks.filter(task => task.status === 'PENDING'),
      IN_PROGRESS: transformedTasks.filter(task => task.status === 'IN_PROGRESS'),
      COMPLETED: transformedTasks.filter(task => task.status === 'COMPLETED'),
      APPROVED: transformedTasks.filter(task => task.status === 'APPROVED')
    };

    const userPermissions = {
      canCreateTasks: isOwner || isManager,
      canEditAllTasks: isOwner || isManager,
      canDeleteTasks: isOwner || isManager,
      canAssignTasks: isOwner || isManager
    };

    res.json({
      projectId,
      columns,
      totalTasks: transformedTasks.length,
      userPermissions
    });

  } catch (error) {
    console.error('Error fetching kanban tasks:', error);
    res.status(500).json({ error: 'Failed to fetch kanban tasks' });
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

// PATCH /api/tasks/:id/position - Task position/order management for drag and drop
router.patch('/:id/position', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, order, departmentId, projectId } = req.body;

    if (!status || typeof order !== 'number') {
      return res.status(400).json({ error: 'Status and order are required' });
    }

    const task = await prisma.task.findUnique({
      where: { id },
      include: { department: true }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check permissions
    if (!requireAuth(req, res)) return;

    const access = await checkProjectAccess(req.user!.id, task.department.projectId);
    if (!access.hasAccess) {
      return res.status(403).json({ error: 'Access denied to this project' });
    }

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user!.id,
        projectId: task.department.projectId
      }
    });

    if (!userRole || (userRole.role === 'EMPLOYEE' && task.assignedRoleId !== userRole.id)) {
      return res.status(403).json({ error: 'Insufficient permissions to move this task' });
    }

    // Start transaction to handle order updates
    const result = await prisma.$transaction(async (tx) => {
      // If moving to a different department, update departmentId
      const updateData: any = { status, order };
      if (departmentId && departmentId !== task.departmentId) {
        updateData.departmentId = departmentId;
      }

      // Update the task
      const updatedTask = await tx.task.update({
        where: { id },
        data: updateData,
        include: {
          department: {
            select: {
              id: true,
              name: true,
              color: true,
              type: true
            }
          },
          assignedRole: {
            select: {
              id: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                  avatarUrl: true
                }
              }
            }
          }
        }
      });

      // Get other tasks in the same column that need order adjustment
      const sameDepartmentId = departmentId || task.departmentId;
      const affectedTasks = await tx.task.findMany({
        where: {
          departmentId: sameDepartmentId,
          status: status,
          id: { not: id },
          order: { gte: order }
        },
        select: { id: true, order: true }
      });

      // Increment order for affected tasks
      const updatePromises = affectedTasks.map(affectedTask =>
        tx.task.update({
          where: { id: affectedTask.id },
          data: { order: affectedTask.order + 1 },
          select: { id: true, order: true }
        })
      );

      const updatedAffectedTasks = await Promise.all(updatePromises);

      // Add project ID to affected tasks for cross-project response
      const affectedTasksWithProject = await Promise.all(
        updatedAffectedTasks.map(async (affectedTask) => {
          const taskWithProject = await tx.task.findUnique({
            where: { id: affectedTask.id },
            include: { department: { select: { projectId: true } } }
          });
          return {
            ...affectedTask,
            projectId: taskWithProject?.department.projectId
          };
        })
      );

      // Log activity
      await tx.taskActivity.create({
        data: {
          type: status !== task.status ? 'STATUS_CHANGED' : 'POSITION_CHANGED',
          description: status !== task.status 
            ? `Status changed from ${task.status} to ${status}`
            : `Task position updated to ${order}`,
          previousValue: status !== task.status ? task.status : task.order.toString(),
          newValue: status !== task.status ? status : order.toString(),
          taskId: id,
          userId: req.user!.id
        }
      });

      return {
        task: updatedTask,
        affectedTasks: affectedTasksWithProject
      };
    });

    // Broadcast task movement
    if (status !== task.status) {
      broadcastTaskMoved(task.department.projectId, id, task.status, status, req.user!.id);
    }

    res.json({
      taskId: id,
      status: result.task.status,
      order: result.task.order,
      updatedAt: result.task.updatedAt,
      affectedTasks: result.affectedTasks
    });

  } catch (error) {
    console.error('Error updating task position:', error);
    res.status(500).json({ error: 'Failed to update task position' });
  }
});

// PATCH /api/tasks/bulk-update - Bulk task operations
router.patch('/bulk-update', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { taskIds, updates } = req.body;

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'taskIds array is required' });
    }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'updates object is required' });
    }

    if (!requireAuth(req, res)) return;

    // Get all tasks to check permissions
    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      include: { 
        department: { 
          select: { projectId: true } 
        } 
      }
    });

    if (tasks.length === 0) {
      return res.status(404).json({ error: 'No tasks found' });
    }

    // Check if user has access to all projects involved
    const projectIds = [...new Set(tasks.map(task => task.department.projectId))];
    const accessChecks = await Promise.all(
      projectIds.map(projectId => checkProjectAccess(req.user!.id, projectId))
    );

    const hasAccessToAll = accessChecks.every(access => access.hasAccess);
    if (!hasAccessToAll) {
      return res.status(403).json({ error: 'Access denied to one or more tasks' });
    }

    // Get user roles for permission checking
    const userRoles = await prisma.userRole.findMany({
      where: {
        userId: req.user!.id,
        projectId: { in: projectIds }
      }
    });

    const updatedTasks: any[] = [];
    const failedTasks: any[] = [];

    // Process each task
    for (const task of tasks) {
      try {
        const userRole = userRoles.find(role => role.projectId === task.department.projectId);
        
        // Check permissions
        if (!userRole) {
          failedTasks.push({
            id: task.id,
            error: 'No role found for this project'
          });
          continue;
        }

        // Employees can only update their own tasks
        if (userRole.role === 'EMPLOYEE' && task.assignedRoleId !== userRole.id) {
          failedTasks.push({
            id: task.id,
            error: 'Insufficient permissions'
          });
          continue;
        }

        // Prepare update data
        const updateData: any = {};
        if (updates.status) updateData.status = updates.status;
        if (updates.assignedRoleId !== undefined) updateData.assignedRoleId = updates.assignedRoleId;
        if (updates.priority) updateData.priority = updates.priority;
        if (updates.dueDate !== undefined) updateData.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
        if (updates.estimatedHours !== undefined) updateData.estimatedHours = updates.estimatedHours;
        if (updates.departmentId) updateData.departmentId = updates.departmentId;

        const updatedTask = await prisma.task.update({
          where: { id: task.id },
          data: updateData,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            assignedRoleId: true,
            dueDate: true,
            estimatedHours: true,
            updatedAt: true,
            assignedRole: {
              select: {
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

        // Log activity for bulk update
        await prisma.taskActivity.create({
          data: {
            type: 'BULK_UPDATED',
            description: `Task bulk updated: ${Object.keys(updateData).join(', ')}`,
            previousValue: JSON.stringify({
              status: task.status,
              priority: task.priority,
              assignedRoleId: task.assignedRoleId
            }),
            newValue: JSON.stringify(updateData),
            taskId: task.id,
            userId: req.user!.id
          }
        });

        updatedTasks.push(updatedTask);

      } catch (error) {
        console.error(`Error updating task ${task.id}:`, error);
        failedTasks.push({
          id: task.id,
          error: 'Failed to update task'
        });
      }
    }

    res.json({
      updatedTasks,
      failedTasks,
      summary: {
        total: taskIds.length,
        successful: updatedTasks.length,
        failed: failedTasks.length
      }
    });

  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({ error: 'Failed to perform bulk update' });
  }
});

// GET /api/tasks/:id/activity - Task activity/audit trail
router.get('/:id/activity', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const task = await prisma.task.findUnique({
      where: { id },
      include: { department: true }
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Check permissions
    if (!requireAuth(req, res)) return;

    const access = await checkProjectAccess(req.user!.id, task.department.projectId);
    if (!access.hasAccess) {
      return res.status(403).json({ error: 'Access denied to this task' });
    }

    const activities = await prisma.taskActivity.findMany({
      where: { taskId: id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatarUrl: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedActivities = activities.map(activity => ({
      id: activity.id,
      type: activity.type,
      description: activity.description,
      userId: activity.userId,
      userEmail: activity.user.email,
      userName: `${activity.user.firstName || ''} ${activity.user.lastName || ''}`.trim() || activity.user.email,
      previousValue: activity.previousValue,
      newValue: activity.newValue,
      timestamp: activity.createdAt
    }));

    res.json({
      taskId: id,
      activities: formattedActivities
    });

  } catch (error) {
    console.error('Error fetching task activity:', error);
    res.status(500).json({ error: 'Failed to fetch task activity' });
  }
});

// PATCH /api/tasks/bulk-update-cross-project - Cross-project bulk operations
router.patch('/bulk-update-cross-project', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { taskIds, updates } = req.body;

    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'taskIds array is required' });
    }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'updates object is required' });
    }

    if (!requireAuth(req, res)) return;

    // Get all tasks with project information
    const tasks = await prisma.task.findMany({
      where: { id: { in: taskIds } },
      include: { 
        department: { 
          select: { projectId: true } 
        } 
      }
    });

    if (tasks.length === 0) {
      return res.status(404).json({ error: 'No tasks found' });
    }

    // Check user access to all involved projects
    const projectIds = [...new Set(tasks.map(task => task.department.projectId))];
    const userRoles = await prisma.userRole.findMany({
      where: {
        userId: req.user!.id,
        projectId: { in: projectIds }
      }
    });

    const updatedTasks: any[] = [];
    const failedTasks: any[] = [];

    // Process each task with project-specific permissions
    for (const task of tasks) {
      try {
        const userRole = userRoles.find(role => role.projectId === task.department.projectId);
        
        // Check permissions per project
        if (!userRole) {
          failedTasks.push({
            id: task.id,
            projectId: task.department.projectId,
            error: 'No access to this project'
          });
          continue;
        }

        // Employees can only update their own tasks
        if (userRole.role === 'EMPLOYEE' && task.assignedRoleId !== userRole.id) {
          failedTasks.push({
            id: task.id,
            projectId: task.department.projectId,
            error: 'Permission denied for this project'
          });
          continue;
        }

        // Prepare update data
        const updateData: any = {};
        if (updates.status) updateData.status = updates.status;
        if (updates.assignedRoleId !== undefined) updateData.assignedRoleId = updates.assignedRoleId;
        if (updates.priority) updateData.priority = updates.priority;
        if (updates.dueDate !== undefined) updateData.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
        if (updates.estimatedHours !== undefined) updateData.estimatedHours = updates.estimatedHours;
        if (updates.departmentId) updateData.departmentId = updates.departmentId;

        const updatedTask = await prisma.task.update({
          where: { id: task.id },
          data: updateData,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            assignedRoleId: true,
            dueDate: true,
            estimatedHours: true,
            updatedAt: true,
            department: {
              select: { projectId: true }
            }
          }
        });

        // Log activity for bulk update
        await prisma.taskActivity.create({
          data: {
            type: 'BULK_UPDATED',
            description: `Cross-project bulk update: ${Object.keys(updateData).join(', ')}`,
            previousValue: JSON.stringify({
              status: task.status,
              priority: task.priority,
              assignedRoleId: task.assignedRoleId
            }),
            newValue: JSON.stringify(updateData),
            taskId: task.id,
            userId: req.user!.id
          }
        });

        updatedTasks.push({
          ...updatedTask,
          projectId: updatedTask.department.projectId
        });

      } catch (error) {
        console.error(`Error updating task ${task.id}:`, error);
        failedTasks.push({
          id: task.id,
          projectId: task.department.projectId,
          error: 'Failed to update task'
        });
      }
    }

    res.json({
      updatedTasks,
      failedTasks,
      summary: {
        total: taskIds.length,
        successful: updatedTasks.length,
        failed: failedTasks.length
      }
    });

  } catch (error) {
    console.error('Error in cross-project bulk update:', error);
    res.status(500).json({ error: 'Failed to perform bulk update' });
  }
});

// POST /api/tasks/:id/approve - Approve task and trigger payment
router.post('/:id/approve', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get task with all related data
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        department: {
          include: {
            project: {
              include: {
                escrow: true,
              },
            },
          },
        },
        assignedTo: {
          select: {
            id: true,
            walletAddress: true,
            email: true,
          },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Verify user is project owner or manager
    const project = task.department.project;
    const isOwner = project.ownerId === userId;
    const isManager = await prisma.userRole.count({
      where: {
        userId,
        projectId: project.id,
        role: 'PROJECT_MANAGER',
        status: 'ACTIVE',
      },
    });

    if (!isOwner && !isManager) {
      return res.status(403).json({ error: 'Only project owners and managers can approve tasks' });
    }

    // Verify task is completed
    if (task.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Task must be COMPLETED before approval' });
    }

    // Check if task has payment amount
    if (!task.paymentAmount || task.paymentAmount <= 0) {
      // Approve without payment
      await prisma.task.update({
        where: { id },
        data: { status: 'APPROVED' },
      });
      return res.json({
        success: true,
        message: 'Task approved (no payment required)',
        taskId: id,
      });
    }

    // Verify payment hasn't already been processed
    if (task.paymentStatus === 'PAID' || task.paymentStatus === 'PROCESSING') {
      return res.status(400).json({ error: `Payment already ${task.paymentStatus.toLowerCase()}` });
    }

    // Verify employee has wallet address
    if (!task.assignedTo || !task.assignedTo.walletAddress) {
      return res.status(400).json({ 
        error: 'Employee does not have a verified wallet address',
        hint: 'Employee must add and verify their Algorand wallet before receiving payments',
      });
    }

    // Verify escrow exists and is funded
    if (!project.escrow) {
      return res.status(400).json({ error: 'Escrow account not created for this project' });
    }

    if (!project.escrowFunded) {
      return res.status(400).json({ error: 'Project escrow is not funded' });
    }

    // Check escrow has sufficient balance
    if (project.escrow.currentBalance < task.paymentAmount) {
      return res.status(400).json({ 
        error: 'Insufficient escrow balance',
        available: project.escrow.currentBalance,
        required: task.paymentAmount,
      });
    }

    // Update task status to APPROVED
    await prisma.task.update({
      where: { id },
      data: {
        status: 'APPROVED',
      },
    });

    // Queue employee payment
    const jobId = await queuePayment({
      taskId: id,
      projectId: project.id,
      employeeWalletAddress: task.assignedTo.walletAddress,
      amount: task.paymentAmount,
      escrowAddress: project.escrow.escrowAddress,
      encryptedPrivateKey: project.escrow.encryptedPrivateKey,
    });

    // Check for manager oversight fees
    const department = await prisma.department.findUnique({
      where: { id: task.departmentId },
      include: {
        managers: {
          include: {
            paymentConfig: true,
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                walletAddress: true,
              },
            },
          },
        },
      },
    });

    const oversightPayments = [];

    if (department && department.managers.length > 0) {
      for (const manager of department.managers) {
        if (manager.paymentConfig?.oversightRate && manager.user.walletAddress) {
          const oversightFee = task.paymentAmount * manager.paymentConfig.oversightRate;
          
          try {
            // Queue oversight payment
            const managerJobId = await queuePayment({
              taskId: `oversight-${id}`,
              projectId: project.id,
              employeeWalletAddress: manager.user.walletAddress,
              amount: oversightFee,
              escrowAddress: project.escrow.escrowAddress,
              encryptedPrivateKey: project.escrow.encryptedPrivateKey,
            });

            oversightPayments.push({
              managerId: manager.user.id,
              managerName: `${manager.user.firstName || ''} ${manager.user.lastName || ''}`.trim() || manager.user.email,
              amount: oversightFee,
              rate: manager.paymentConfig.oversightRate,
              jobId: managerJobId,
            });
          } catch (error) {
            console.error(`Failed to queue oversight payment for manager ${manager.user.id}:`, error);
          }
        }
      }
    }

    res.json({
      success: true,
      message: oversightPayments.length > 0 
        ? 'Task approved. Employee and manager payments queued for processing'
        : 'Task approved and payment queued for processing',
      taskId: id,
      employeePayment: {
        amount: task.paymentAmount,
        employeeEmail: task.assignedTo.email,
        jobId,
      },
      oversightPayments: oversightPayments.length > 0 ? oversightPayments : undefined,
    });
  } catch (error: any) {
    console.error('Error approving task:', error);
    res.status(500).json({ error: error.message || 'Failed to approve task' });
  }
});

// GET /api/tasks/:id/payment-status - Get payment status for a task
router.get('/:id/payment-status', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get task with payment details
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        department: {
          include: {
            project: {
              select: {
                id: true,
                name: true,
                ownerId: true,
              },
            },
          },
        },
        assignedTo: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            walletAddress: true,
          },
        },
        blockchainPayment: {
          select: {
            id: true,
            txHash: true,
            amount: true,
            fee: true,
            status: true,
            blockNumber: true,
            confirmations: true,
            errorMessage: true,
            submittedAt: true,
            confirmedAt: true,
          },
        },
      },
    });

    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Verify user has access to this task
    const project = task.department.project;
    const isOwner = project.ownerId === userId;
    const isEmployee = task.assignedTo?.id === userId;
    const isManager = await prisma.userRole.count({
      where: {
        userId,
        projectId: project.id,
        role: 'PROJECT_MANAGER',
        status: 'ACTIVE',
      },
    });

    if (!isOwner && !isEmployee && !isManager) {
      return res.status(403).json({ error: 'Access denied to this task' });
    }

    res.json({
      taskId: id,
      taskTitle: task.title,
      taskStatus: task.status,
      payment: {
        amount: task.paymentAmount,
        status: task.paymentStatus,
        paidAt: task.paidAt,
        txHash: task.paymentTxHash,
      },
      employee: task.assignedTo ? {
        id: task.assignedTo.id,
        name: `${task.assignedTo.firstName || ''} ${task.assignedTo.lastName || ''}`.trim() || task.assignedTo.email,
        walletAddress: task.assignedTo.walletAddress,
      } : null,
      blockchainTransaction: task.blockchainPayment ? {
        txHash: task.blockchainPayment.txHash,
        amount: task.blockchainPayment.amount,
        fee: task.blockchainPayment.fee,
        status: task.blockchainPayment.status,
        blockNumber: task.blockchainPayment.blockNumber?.toString(),
        confirmations: task.blockchainPayment.confirmations,
        errorMessage: task.blockchainPayment.errorMessage,
        submittedAt: task.blockchainPayment.submittedAt,
        confirmedAt: task.blockchainPayment.confirmedAt,
      } : null,
      project: {
        id: project.id,
        name: project.name,
      },
    });
  } catch (error: any) {
    console.error('Error fetching payment status:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch payment status' });
  }
});

export default router;
