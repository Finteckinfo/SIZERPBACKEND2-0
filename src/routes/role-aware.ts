import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

type ActionName = 'create_task' | 'assign_task' | 'edit_task' | 'manage_departments' | 'schedule' | 'report_time' | 'view_task' | 'view_department' | 'view_team';

async function getProjectRoleContext(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      ownerId: true,
      departments: { select: { id: true } },
      userRoles: {
        where: { userId },
        select: {
          id: true,
          role: true,
          status: true,
          departmentScope: true,
          managedDepartments: { select: { id: true } },
          accessibleDepartments: { select: { id: true } }
        }
      }
    }
  });

  if (!project) return null;

  const isOwner = project.ownerId === userId;
  const rolesHeld = project.userRoles.map(r => r.role);
  const uniqueRoles = Array.from(new Set([...(isOwner ? ['PROJECT_OWNER'] : []), ...rolesHeld]));
  const primaryRole = uniqueRoles.includes('PROJECT_OWNER')
    ? 'PROJECT_OWNER'
    : (uniqueRoles.includes('PROJECT_MANAGER') ? 'PROJECT_MANAGER' : (uniqueRoles.includes('EMPLOYEE') ? 'EMPLOYEE' : null));

  const allDeptIds = project.departments.map(d => d.id);
  const union = (arrs: string[][]) => Array.from(new Set(arrs.flat())) as string[];
  const scopeArrays = project.userRoles.map(r => (r.departmentScope ?? []).filter(Boolean));
  const accessibleRelArrays = project.userRoles.map(r => (r.accessibleDepartments ?? []).map(d => d.id));
  const managedRelArrays = project.userRoles.map(r => (r.managedDepartments ?? []).map(d => d.id));

  const unionScope = union(scopeArrays);
  const unionAccessible = union(accessibleRelArrays);
  const unionManageable = union(managedRelArrays);

  const accessibleDepartmentIds = isOwner ? allDeptIds : (unionScope.length > 0 ? unionScope : unionAccessible);
  const manageableDepartmentIds = isOwner ? allDeptIds : unionManageable;

  return {
    projectId,
    isOwner,
    // new multi-role shape
    roles: uniqueRoles,
    primaryRole,
    userRoleIds: project.userRoles.map(r => r.id),
    // backward-compat fields
    role: primaryRole,
    userRoleId: project.userRoles[0]?.id ?? null,
    allDeptIds,
    accessibleDepartmentIds,
    manageableDepartmentIds
  };
}

function permissionsForRole(ctx: Awaited<ReturnType<typeof getProjectRoleContext>>) {
  const isOwner = !!ctx?.isOwner;
  const roles = ctx?.roles ?? [];
  const base = {
    canCreateTask: false,
    canAssignTask: false,
    canEditTask: false,
    canManageDepartments: false,
    canSchedule: false,
    canReportTime: false,
    visibleDepartmentIds: ctx?.accessibleDepartmentIds ?? [],
    manageableDepartmentIds: ctx?.manageableDepartmentIds ?? []
  };

  if (!ctx || roles.length === 0) return base;

  if (isOwner) {
    return {
      ...base,
      canCreateTask: true,
      canAssignTask: true,
      canEditTask: true,
      canManageDepartments: true,
      canSchedule: true,
      canReportTime: true,
      visibleDepartmentIds: ctx.allDeptIds,
      manageableDepartmentIds: ctx.allDeptIds
    };
  }

  if (roles.includes('PROJECT_MANAGER')) {
    return {
      ...base,
      canCreateTask: (ctx.manageableDepartmentIds.length > 0),
      canAssignTask: (ctx.manageableDepartmentIds.length > 0),
      canEditTask: (ctx.manageableDepartmentIds.length > 0),
      canManageDepartments: (ctx.manageableDepartmentIds.length > 0),
      canSchedule: (ctx.manageableDepartmentIds.length > 0),
      canReportTime: true
    };
  }

  // EMPLOYEE
  return {
    ...base,
    canReportTime: true
  };
}

function checkAction(ctx: NonNullable<Awaited<ReturnType<typeof getProjectRoleContext>>>, action: ActionName, opts: { departmentId?: string; taskId?: string }) {
  const perms = permissionsForRole(ctx);
  const deptId = opts.departmentId;
  const inManageable = deptId ? ctx.manageableDepartmentIds.includes(deptId) : false;
  const inVisible = deptId ? (ctx.accessibleDepartmentIds.includes(deptId) || ctx.allDeptIds.includes(deptId) && ctx.isOwner) : false;

  switch (action) {
    case 'create_task':
      if (ctx.isOwner) return { allow: true, reason: 'owner' };
      return { allow: perms.canCreateTask && (!!deptId && inManageable), reason: perms.canCreateTask ? (inManageable ? 'ok' : 'department out of scope') : 'not allowed' };
    case 'assign_task':
      if (ctx.isOwner) return { allow: true, reason: 'owner' };
      return { allow: perms.canAssignTask && (!!deptId && inManageable), reason: perms.canAssignTask ? (inManageable ? 'ok' : 'department out of scope') : 'not allowed' };
    case 'edit_task':
      if (ctx.isOwner) return { allow: true, reason: 'owner' };
      return { allow: perms.canEditTask && (!!deptId && inManageable), reason: perms.canEditTask ? (inManageable ? 'ok' : 'department out of scope') : 'not allowed' };
    case 'manage_departments':
      if (ctx.isOwner) return { allow: true, reason: 'owner' };
      return { allow: perms.canManageDepartments, reason: perms.canManageDepartments ? 'ok' : 'not allowed' };
    case 'schedule':
      if (ctx.isOwner) return { allow: true, reason: 'owner' };
      return { allow: perms.canSchedule && (!!deptId ? inManageable : true), reason: perms.canSchedule ? 'ok' : 'not allowed' };
    case 'report_time':
      return { allow: perms.canReportTime, reason: perms.canReportTime ? 'ok' : 'not allowed' };
    case 'view_department':
      if (ctx.isOwner) return { allow: true, reason: 'owner' };
      return { allow: !!deptId && inVisible, reason: (!!deptId && inVisible) ? 'ok' : 'not visible' };
    case 'view_task':
      // Rely on upper layers to verify via task to department mapping; here we just check visibility if dept provided
      if (ctx.isOwner) return { allow: true, reason: 'owner' };
      return { allow: !!deptId && inVisible, reason: (!!deptId && inVisible) ? 'ok' : 'not visible' };
    default:
      return { allow: false, reason: 'unknown action' };
  }
}

// GET /api/role-aware/projects/:projectId/my-role
router.get('/projects/:projectId/my-role', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || (ctx.roles ?? []).length === 0) return res.status(403).json({ error: 'No access to this project' });

    res.json({
      roles: ctx.roles,
      primaryRole: ctx.primaryRole,
      accessibleDepartmentIds: ctx.accessibleDepartmentIds,
      manageableDepartmentIds: ctx.manageableDepartmentIds
    });
  } catch (e) {
    console.error('[RoleAware] my-role error:', e);
    res.status(500).json({ error: 'Failed to resolve role' });
  }
});

// GET /api/role-aware/projects/:projectId/permissions
router.get('/projects/:projectId/permissions', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || (ctx.roles ?? []).length === 0) return res.status(403).json({ error: 'No access to this project' });

    const perms = permissionsForRole(ctx);
    res.json(perms);
  } catch (e) {
    console.error('[RoleAware] permissions error:', e);
    res.status(500).json({ error: 'Failed to resolve permissions' });
  }
});

// POST /api/role-aware/access/check
router.post('/access/check', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId, action, departmentId, taskId } = req.body as { projectId: string; action: ActionName; departmentId?: string; taskId?: string };
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    if (!projectId || !action) return res.status(400).json({ error: 'projectId and action are required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || (ctx.roles ?? []).length === 0) return res.status(403).json({ error: 'No access to this project' });

    const result = checkAction(ctx, action, { departmentId, taskId });
    res.json(result);
  } catch (e) {
    console.error('[RoleAware] access.check error:', e);
    res.status(500).json({ error: 'Failed to check access' });
  }
});

// GET /api/role-aware/projects/:projectId/departments/accessible
router.get('/projects/:projectId/departments/accessible', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || (ctx.roles ?? []).length === 0) return res.status(403).json({ error: 'No access to this project' });

    const visibleIds = ctx.isOwner ? ctx.allDeptIds : ctx.accessibleDepartmentIds;
    const manageableIds = ctx.isOwner ? ctx.allDeptIds : ctx.manageableDepartmentIds;

    const departments = await prisma.department.findMany({
      where: { projectId, id: { in: visibleIds } },
      select: { id: true, name: true, type: true, description: true, order: true }
    });

    const items = departments.map(d => ({
      ...d,
      canView: true,
      canManage: manageableIds.includes(d.id) || ctx.isOwner,
      canCreateTask: manageableIds.includes(d.id) || ctx.isOwner,
      canAssign: manageableIds.includes(d.id) || ctx.isOwner
    }));

    res.json(items);
  } catch (e) {
    console.error('[RoleAware] departments.accessible error:', e);
    res.status(500).json({ error: 'Failed to fetch accessible departments' });
  }
});

// GET /api/role-aware/projects/:projectId/tasks (role-aware)
router.get('/projects/:projectId/tasks', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;
    const {
      scope = 'all',
      departmentId,
      userRoleId,
      status,
      priority,
      dateFrom,
      dateTo,
      search,
      page = '1',
      limit = '20',
      sortBy = 'dueDate',
      sortOrder = 'desc',
      fields
    } = req.query as any;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || (ctx.roles ?? []).length === 0) return res.status(403).json({ error: 'No access to this project' });

    const pageNum = parseInt(String(page)) || 1;
    const limitNum = Math.min(parseInt(String(limit)) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    let visibleDeptIds = ctx.isOwner ? ctx.allDeptIds : ctx.accessibleDepartmentIds;

    if ((ctx.roles ?? []).includes('PROJECT_MANAGER') && ctx.manageableDepartmentIds.length > 0) {
      // Managers default to manageable depts for scope=department
      if (scope === 'department' && !departmentId) {
        visibleDeptIds = ctx.manageableDepartmentIds;
      }
    }

    if (departmentId) {
      // Ensure requested department is visible
      const allowed = ctx.isOwner ? ctx.allDeptIds.includes(String(departmentId)) : visibleDeptIds.includes(String(departmentId));
      if (!allowed) return res.status(403).json({ error: 'Department out of scope' });
    }

    const where: any = { department: { projectId } };

    // status/priority can be single or comma-separated
    const normalizeList = (v: any) => Array.isArray(v) ? v : (typeof v === 'string' && v.includes(',') ? v.split(',').map((s: string) => s.trim()) : v);
    const statusFilter = normalizeList(status);
    const priorityFilter = normalizeList(priority);
    if (statusFilter) where.status = Array.isArray(statusFilter) ? { in: statusFilter } : statusFilter;
    if (priorityFilter) where.priority = Array.isArray(priorityFilter) ? { in: priorityFilter } : priorityFilter;

    // date range: true time filtering using (dueDate OR startDate)
    if (dateFrom || dateTo) {
      const gte = dateFrom ? new Date(String(dateFrom)) : undefined;
      const lte = dateTo ? new Date(String(dateTo)) : undefined;
      if ((gte && isNaN(gte.getTime())) || (lte && isNaN(lte.getTime()))) {
        return res.status(400).json({ error: 'Invalid date range' });
      }
      where.AND = [
        {
          OR: [
            { dueDate: { gte, lte } },
            { startDate: { gte, lte } }
          ]
        }
      ];
    }
    if (search) {
      where.OR = [
        { title: { contains: String(search), mode: 'insensitive' } },
        { description: { contains: String(search), mode: 'insensitive' } }
      ];
    }

    const isOwner = ctx.isOwner;
    const isManager = (ctx.roles ?? []).includes('PROJECT_MANAGER');
    const isEmployee = (ctx.roles ?? []).includes('EMPLOYEE');

    if (isOwner) {
      // all tasks already scoped by visibleDeptIds
    } else if (scope === 'assigned_to_me' || (!isManager && isEmployee)) {
      // Tasks assigned to caller's role within this project
      const roles = await prisma.userRole.findMany({ where: { userId, projectId }, select: { id: true } });
      const roleIds = roles.map(r => r.id);
      where.assignedRoleId = { in: roleIds };
    } else if (scope === 'user' && userRoleId) {
      // Owner can filter any userRole in project
      if (isOwner) {
        where.assignedRoleId = userRoleId;
      } else if (isManager) {
        // Manager: only users inside manageable departments
        const targetRole = await prisma.userRole.findFirst({ where: { id: String(userRoleId), projectId }, select: { departmentScope: true } });
        const targetDepts = new Set((targetRole?.departmentScope ?? []) as string[]);
        const allowed = ctx.manageableDepartmentIds.some(d => targetDepts.has(d));
        if (allowed) {
          where.assignedRoleId = userRoleId;
        }
        // else silently ignore out-of-scope user filter
      }
    } 

    if (departmentId) {
      where.departmentId = String(departmentId);
    } else {
      where.departmentId = { in: visibleDeptIds };
    }

    // Sorting
    const orderBy: any = {};
    const normalizedSortBy = String(sortBy);
    const normalizedSortOrder = String(sortOrder) === 'asc' ? 'asc' : 'desc';
    if (normalizedSortBy === 'priority') orderBy.priority = normalizedSortOrder;
    else if (normalizedSortBy === 'title') orderBy.title = normalizedSortOrder;
    else if (normalizedSortBy === 'startDate') orderBy.startDate = normalizedSortOrder;
    else if (normalizedSortBy === 'createdAt') orderBy.createdAt = normalizedSortOrder;
    else /* dueDate default */ orderBy.dueDate = normalizedSortOrder;

    const minimal = String(fields || '') === 'minimal';

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: minimal ? {
          id: true,
          title: true,
          status: true,
          priority: true,
          departmentId: true,
          assignedRoleId: true,
          startDate: true,
          dueDate: true,
          createdAt: true,
          department: { select: { id: true, name: true, projectId: true, color: true } }
        } : {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          departmentId: true,
          startDate: true,
          dueDate: true,
          createdAt: true,
          updatedAt: true,
          assignedRole: {
            select: {
              id: true,
              role: true,
              user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } }
            }
          }
        },
        skip: offset,
        take: limitNum,
        orderBy
      }),
      prisma.task.count({ where })
    ]);

    const items = tasks.map(t => {
      const inManageable = ctx.isOwner || ctx.manageableDepartmentIds.includes(t.departmentId);
      return {
        ...t,
        canView: true,
        canEdit: ctx.isOwner || (((ctx.roles ?? []).includes('PROJECT_MANAGER')) && inManageable),
        canAssign: ctx.isOwner || (((ctx.roles ?? []).includes('PROJECT_MANAGER')) && inManageable),
        canReport: (ctx.roles ?? []).includes('EMPLOYEE')
      };
    });

    res.json({
      tasks: items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (e) {
    console.error('[RoleAware] project tasks error:', e);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Calendar aggregation endpoint
router.get('/projects/:projectId/tasks/calendar', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;
    const {
      start,
      end,
      granularity = 'day',
      scope = 'all',
      departmentId,
      userRoleId,
      status,
      priority
    } = req.query as any;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    if (!start || !end) return res.status(400).json({ error: 'start and end are required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || (ctx.roles ?? []).length === 0) return res.status(403).json({ error: 'No access to this project' });

    let visibleDeptIds = ctx.isOwner ? ctx.allDeptIds : ctx.accessibleDepartmentIds;
    if ((ctx.roles ?? []).includes('PROJECT_MANAGER') && ctx.manageableDepartmentIds.length > 0) {
      if (scope === 'department' && !departmentId) {
        visibleDeptIds = ctx.manageableDepartmentIds;
      }
    }

    if (departmentId) {
      const allowed = ctx.isOwner ? ctx.allDeptIds.includes(String(departmentId)) : visibleDeptIds.includes(String(departmentId));
      if (!allowed) return res.status(403).json({ error: 'Department out of scope' });
    }

    const where: any = { department: { projectId } };
    const normalizeList = (v: any) => Array.isArray(v) ? v : (typeof v === 'string' && v.includes(',') ? v.split(',').map((s: string) => s.trim()) : v);
    const statusFilter = normalizeList(status);
    const priorityFilter = normalizeList(priority);
    if (statusFilter) where.status = Array.isArray(statusFilter) ? { in: statusFilter } : statusFilter;
    if (priorityFilter) where.priority = Array.isArray(priorityFilter) ? { in: priorityFilter } : priorityFilter;
    const gte = new Date(String(start));
    const lte = new Date(String(end));
    if (isNaN(gte.getTime()) || isNaN(lte.getTime())) return res.status(400).json({ error: 'Invalid date range' });
    where.AND = [{ OR: [ { dueDate: { gte, lte } }, { startDate: { gte, lte } } ] }];

    const isOwner = ctx.isOwner;
    const isManager = (ctx.roles ?? []).includes('PROJECT_MANAGER');
    const isEmployee = (ctx.roles ?? []).includes('EMPLOYEE');

    if (isOwner) {
      // all tasks already scoped
    } else if (scope === 'assigned_to_me' || (!isManager && isEmployee)) {
      const roles = await prisma.userRole.findMany({ where: { userId, projectId }, select: { id: true } });
      const roleIds = roles.map(r => r.id);
      where.assignedRoleId = { in: roleIds };
    } else if (scope === 'user' && userRoleId) {
      if (isOwner) {
        where.assignedRoleId = userRoleId;
      } else if (isManager) {
        const targetRole = await prisma.userRole.findFirst({ where: { id: String(userRoleId), projectId }, select: { departmentScope: true } });
        const targetDepts = new Set((targetRole?.departmentScope ?? []) as string[]);
        const allowed = ctx.manageableDepartmentIds.some(d => targetDepts.has(d));
        if (allowed) where.assignedRoleId = userRoleId;
      }
    }

    if (departmentId) where.departmentId = String(departmentId); else where.departmentId = { in: visibleDeptIds };

    const tasks = await prisma.task.findMany({ where, select: { id: true, status: true, startDate: true, dueDate: true, createdAt: true } });

    // Aggregate by day/week/month
    const fmtDate = (d: Date) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const bucketsMap = new Map<string, { total: number; pending: number; inProgress: number; completed: number; approved: number }>();
    const toBucketKey = (dt: Date) => {
      if (granularity === 'week') {
        // ISO week: Monday
        const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
        const day = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() - (day - 1));
        return fmtDate(d);
      } else if (granularity === 'month') {
        const y = dt.getUTCFullYear();
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        return `${y}-${m}-01`;
      }
      return fmtDate(dt);
    };

    for (const t of tasks) {
      const when = (t.dueDate as Date | null) ?? (t.startDate as Date | null) ?? (t.createdAt as Date);
      const key = toBucketKey(new Date(when));
      if (!bucketsMap.has(key)) bucketsMap.set(key, { total: 0, pending: 0, inProgress: 0, completed: 0, approved: 0 });
      const b = bucketsMap.get(key)!;
      b.total += 1;
      if (t.status === 'PENDING') b.pending += 1;
      else if (t.status === 'IN_PROGRESS') b.inProgress += 1;
      else if (t.status === 'COMPLETED') b.completed += 1;
      else if (t.status === 'APPROVED') b.approved += 1;
    }

    const buckets = Array.from(bucketsMap.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, counts]) => ({ date, counts }));
    res.json({ buckets });
  } catch (e) {
    console.error('[RoleAware] project tasks calendar error:', e);
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

// GET /api/role-aware/projects/:projectId/team/accessible
router.get('/projects/:projectId/team/accessible', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || (ctx.roles ?? []).length === 0) return res.status(403).json({ error: 'No access to this project' });

    // Owners: all; Managers: members in manageable depts; Employees: themselves
    const roles = await prisma.userRole.findMany({
      where: { projectId },
      select: {
        id: true,
        role: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } },
        departmentScope: true
      }
    });

    let filtered = roles;
    if (!ctx.isOwner) {
      if ((ctx.roles ?? []).includes('PROJECT_MANAGER')) {
        const set = new Set(ctx.manageableDepartmentIds);
        filtered = roles.filter(r => (r.departmentScope ?? []).some((d: string) => set.has(d)) || r.role === 'PROJECT_OWNER');
      } else {
        filtered = roles.filter(r => r.user.id === userId);
      }
    }

    const items = filtered.map(r => ({
      id: r.id,
      role: r.role,
      user: r.user
    }));

    res.json(items);
  } catch (e) {
    console.error('[RoleAware] team.accessible error:', e);
    res.status(500).json({ error: 'Failed to fetch team' });
  }
});

// POST /api/role-aware/projects/:projectId/tasks - Create task (role-aware)
router.post('/projects/:projectId/tasks', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;
    const { title, description, departmentId, assignedRoleId, priority, startDate, dueDate, endDate, isAllDay, timeZone, progress, checklistCount, checklistCompleted } = req.body;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });
    if (!title || !departmentId) return res.status(400).json({ error: 'title and departmentId are required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || (ctx.roles ?? []).length === 0) return res.status(403).json({ error: 'No access to this project' });

    // Verify department belongs to project and user has access
    const department = await prisma.department.findFirst({
      where: { id: departmentId, projectId },
      select: { id: true, name: true }
    });
    if (!department) return res.status(404).json({ error: 'Department not found in this project' });

    // Check if user can create tasks in this department
    const canCreate = ctx.isOwner || (ctx.manageableDepartmentIds.includes(departmentId));
    if (!canCreate) return res.status(403).json({ error: 'No permission to create tasks in this department' });

    // Verify assignedRoleId belongs to project if provided
    if (assignedRoleId) {
      const targetRole = await prisma.userRole.findFirst({
        where: { id: assignedRoleId, projectId },
        select: { id: true, departmentScope: true }
      });
      if (!targetRole) return res.status(404).json({ error: 'Assigned role not found in this project' });
      
      // For managers, ensure assigned role is in their scope
      if (!ctx.isOwner && ctx.manageableDepartmentIds.length > 0) {
        const targetDepts = new Set((targetRole.departmentScope ?? []) as string[]);
        const hasOverlap = ctx.manageableDepartmentIds.some(d => targetDepts.has(d));
        if (!hasOverlap) return res.status(403).json({ error: 'Cannot assign to role outside your manageable departments' });
      }
    }

    // Get the user's role for createdByRoleId
    const userRole = await prisma.userRole.findFirst({
      where: { userId, projectId, status: 'ACTIVE' },
      select: { id: true }
    });

    const task = await prisma.task.create({
      data: {
        title,
        description,
        departmentId,
        assignedRoleId: assignedRoleId || null,
        priority: priority || 'MEDIUM',
        startDate: startDate ? new Date(startDate) : null,
        dueDate: dueDate ? new Date(dueDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        isAllDay: typeof isAllDay === 'boolean' ? isAllDay : false,
        timeZone: timeZone || null,
        progress: typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0,
        checklistCount: typeof checklistCount === 'number' ? Math.max(0, checklistCount) : 0,
        checklistCompleted: typeof checklistCompleted === 'number' ? Math.max(0, Math.min(checklistCount || 0, checklistCompleted)) : 0,
        createdByRoleId: userRole?.id || null
      },
      include: {
        department: { select: { id: true, name: true, color: true, projectId: true } },
        assignedRole: {
          select: {
            id: true,
            role: true,
            user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } }
          }
        }
      }
    });

    res.status(201).json({
      ...task,
      canView: true,
      canEdit: ctx.isOwner || ctx.manageableDepartmentIds.includes(departmentId),
      canAssign: ctx.isOwner || ctx.manageableDepartmentIds.includes(departmentId),
      canReport: (ctx.roles ?? []).includes('EMPLOYEE')
    });
  } catch (e) {
    console.error('[RoleAware] create task error:', e);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

export default router;
// ---- Additional role-aware endpoints ----

// ---- Cross-project: My Tasks (role-aware across all accessible projects) ----
// GET /api/role-aware/my-tasks
router.get('/my-tasks', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // Parse query params
    const {
      scope,
      projectId: projectIdRaw,
      departmentId: departmentIdRaw,
      userRoleId,
      status,
      priority,
      dateFrom,
      dateTo,
      search,
      fields,
      page = '1',
      limit = '20',
      sortBy = 'dueDate',
      sortOrder = 'asc'
    } = req.query as any;

    // Helpers to normalize arrays/CSV
    const normalizeMulti = (v: any): string[] | undefined => {
      if (!v) return undefined;
      if (Array.isArray(v)) return v.flatMap(x => String(x).split(',').map(s => s.trim()).filter(Boolean));
      if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
      return undefined;
    };
    const normalizeList = (v: any) => Array.isArray(v) ? v : (typeof v === 'string' && v.includes(',') ? v.split(',').map((s: string) => s.trim()) : v);

    const requestedProjectIds = normalizeMulti(projectIdRaw);
    const requestedDepartmentIds = normalizeMulti(departmentIdRaw);
    const statusFilter = normalizeList(status);
    const priorityFilter = normalizeList(priority);

    const pageNum = parseInt(String(page)) || 1;
    const limitNum = Math.min(parseInt(String(limit)) || 20, 100);
    const offset = (pageNum - 1) * limitNum;

    // Fetch all projects where user has any role or ownership
    const [ownedProjects, roles] = await Promise.all([
      prisma.project.findMany({ where: { ownerId: userId }, select: { id: true } }),
      prisma.userRole.findMany({
        where: { userId },
        select: {
          id: true,
          role: true,
          status: true,
          projectId: true,
          departmentScope: true,
          managedDepartments: { select: { id: true } },
          accessibleDepartments: { select: { id: true } }
        }
      })
    ]);

    const ownerProjectSet = new Set(ownedProjects.map(p => p.id));
    const activeRoles = roles.filter(r => r.status === 'ACTIVE' || r.status === 'PENDING');
    const roleProjectIds = Array.from(new Set(activeRoles.map(r => r.projectId)));

    // Determine overall caller capabilities
    const holdsOwnerAnywhere = ownerProjectSet.size > 0;
    const holdsManagerAnywhere = activeRoles.some(r => r.role === 'PROJECT_MANAGER');
    const holdsEmployeeAnywhere = activeRoles.some(r => r.role === 'EMPLOYEE');

    // Compute accessible projects depending on role
    let accessibleProjectIds = new Set<string>([...ownerProjectSet, ...roleProjectIds]);
    if (requestedProjectIds && requestedProjectIds.length > 0) {
      // Intersect with requested subset
      accessibleProjectIds = new Set(requestedProjectIds.filter(id => accessibleProjectIds.has(id)));
    }
    if (accessibleProjectIds.size === 0) return res.status(403).json({ error: 'No access to any requested scope' });

    // Build department visibility maps per project for manager/employee
    const projectToManageableDepts = new Map<string, Set<string>>();
    const projectToAccessibleDepts = new Map<string, Set<string>>();
    const myRoleIdsPerProject = new Map<string, string[]>();

    for (const r of activeRoles) {
      const manageable = new Set<string>(r.managedDepartments?.map(d => d.id) ?? []);
      const accessible = new Set<string>([...(r.departmentScope ?? []), ...(r.accessibleDepartments?.map(d => d.id) ?? [])]);
      if (!projectToManageableDepts.has(r.projectId)) projectToManageableDepts.set(r.projectId, new Set());
      if (!projectToAccessibleDepts.has(r.projectId)) projectToAccessibleDepts.set(r.projectId, new Set());
      const man = projectToManageableDepts.get(r.projectId)!;
      const acc = projectToAccessibleDepts.get(r.projectId)!;
      manageable.forEach(d => man.add(d));
      accessible.forEach(d => acc.add(d));
      if (!myRoleIdsPerProject.has(r.projectId)) myRoleIdsPerProject.set(r.projectId, []);
      myRoleIdsPerProject.get(r.projectId)!.push(r.id);
    }

    // Employees: enforce scope=assigned_to_me and disallow departmentId/userRoleId
    const isOnlyEmployee = !holdsOwnerAnywhere && !holdsManagerAnywhere && holdsEmployeeAnywhere;
    const requestedScope = String(scope || '').trim();
    if (isOnlyEmployee) {
      if (userRoleId || (requestedDepartmentIds && requestedDepartmentIds.length > 0)) {
        return res.status(400).json({ error: 'Employees cannot filter by userRoleId or departmentId' });
      }
    }

    // Build where clause across projects
    const where: any = { department: { projectId: { in: Array.from(accessibleProjectIds) } } };

    // Apply role-based scope
    if (holdsOwnerAnywhere) {
      // Owners can see all tasks in their owned projects, plus tasks in other projects where they also hold a role
      // where already limited to accessibleProjectIds
    }

    if (holdsManagerAnywhere && !holdsOwnerAnywhere) {
      // Managers limited to manageable departments per project
      // If departmentId filter provided, intersect with manageable sets
      // Else, apply union of manageable per project
      const deptFilters: string[] = [];
      for (const pid of accessibleProjectIds) {
        const set = projectToManageableDepts.get(pid) ?? new Set<string>();
        set.forEach(d => deptFilters.push(d));
      }
      if (deptFilters.length === 0) {
        // No manageable departments at all
        return res.json({ tasks: [], pagination: { page: pageNum, limit: limitNum, total: 0, totalPages: 0 } });
      }
      where.departmentId = { in: deptFilters };
    }

    if (isOnlyEmployee) {
      // Employees only tasks assigned to their roles across projects
      const myRoleIds = activeRoles.map(r => r.id);
      where.assignedRoleId = { in: myRoleIds };
    }

    // Filters: departmentId for owner/manager only, intersect with visibility
    if (!isOnlyEmployee && requestedDepartmentIds && requestedDepartmentIds.length > 0) {
      const allowedDeptIds = new Set<string>();
      for (const pid of accessibleProjectIds) {
        if (ownerProjectSet.has(pid)) {
          // owner sees all depts in owned project; fetch depts later implicitly
          // allow requested depts; owner restriction will be validated by project membership
          requestedDepartmentIds.forEach(d => allowedDeptIds.add(d));
        } else {
          const man = projectToManageableDepts.get(pid) ?? new Set<string>();
          const acc = projectToAccessibleDepts.get(pid) ?? new Set<string>();
          requestedDepartmentIds.forEach(d => { if (man.has(d) || acc.has(d)) allowedDeptIds.add(d); });
        }
      }
      if (allowedDeptIds.size > 0) {
        where.departmentId = where.departmentId?.in ? { in: Array.from(new Set([...(where.departmentId.in as string[]), ...allowedDeptIds])) } : { in: Array.from(allowedDeptIds) };
      }
    }

    // scope=user filter (owner/manager only)
    if (!isOnlyEmployee && String(requestedScope) === 'user' && userRoleId) {
      // Ensure userRoleId is within accessible scope
      const target = activeRoles.find(r => r.id === String(userRoleId));
      if (target) {
        if (holdsOwnerAnywhere && ownerProjectSet.has(target.projectId)) {
          where.assignedRoleId = userRoleId;
        } else if (holdsManagerAnywhere) {
          const man = projectToManageableDepts.get(target.projectId) ?? new Set<string>();
          const targetDepts = new Set((target.departmentScope ?? []) as string[]);
          const overlap = Array.from(targetDepts).some(d => man.has(d));
          if (overlap) where.assignedRoleId = userRoleId;
        }
      }
    }

    // status/priority filters
    if (statusFilter) where.status = Array.isArray(statusFilter) ? { in: statusFilter } : statusFilter;
    if (priorityFilter) where.priority = Array.isArray(priorityFilter) ? { in: priorityFilter } : priorityFilter;

    // Dates: currently use createdAt as a proxy (until dueDate/startDate fields exist)
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) (where.createdAt as any).gte = new Date(String(dateFrom));
      if (dateTo) (where.createdAt as any).lte = new Date(String(dateTo));
      if (isNaN((where.createdAt as any).gte?.getTime?.() ?? Date.now()) || isNaN((where.createdAt as any).lte?.getTime?.() ?? Date.now())) {
        return res.status(400).json({ error: 'Invalid date range' });
      }
    }

    // Search
    if (search) {
      where.OR = [
        { title: { contains: String(search), mode: 'insensitive' } },
        { description: { contains: String(search), mode: 'insensitive' } }
      ];
    }

    // Sorting
    const orderBy: any = {};
    const normalizedSortBy = String(sortBy);
    const normalizedSortOrder = String(sortOrder) === 'desc' ? 'desc' : 'asc';
    if (normalizedSortBy === 'priority') orderBy.priority = normalizedSortOrder;
    else if (normalizedSortBy === 'title') orderBy.title = normalizedSortOrder;
    else if (normalizedSortBy === 'createdAt') orderBy.createdAt = normalizedSortOrder;
    else /* dueDate default */ orderBy.createdAt = normalizedSortOrder;

    const minimal = String(fields || '') === 'minimal';

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: minimal ? {
          id: true,
          title: true,
          status: true,
          priority: true,
          departmentId: true,
          // expose projectId via relation select
          department: { select: { id: true, name: true, projectId: true } },
          assignedRoleId: true,
          createdAt: true,
          updatedAt: true
        } : {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          departmentId: true,
          department: { select: { id: true, name: true, projectId: true } },
          createdAt: true,
          updatedAt: true,
          assignedRole: {
            select: {
              id: true,
              role: true,
              user: { select: { id: true, email: true, firstName: true, lastName: true } }
            }
          }
        },
        skip: offset,
        take: limitNum,
        orderBy
      }),
      prisma.task.count({ where })
    ]);

    const items = tasks.map((t: any) => {
      const pid = t.department?.projectId;
      const manageable = ownerProjectSet.has(pid) || (projectToManageableDepts.get(pid)?.has(t.departmentId) ?? false);
      return {
        ...t,
        projectId: pid,
        canView: true,
        canEdit: ownerProjectSet.has(pid) || manageable,
        canAssign: ownerProjectSet.has(pid) || manageable,
        canReport: holdsEmployeeAnywhere
      };
    });

    res.json({
      tasks: items,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (e) {
    console.error('[RoleAware] my-tasks error:', e);
    res.status(500).json({ error: 'Failed to fetch my tasks' });
  }
});

// GET /api/role-aware/my-tasks/calendar
router.get('/my-tasks/calendar', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const {
      start,
      end,
      granularity = 'day',
      scope,
      projectId: projectIdRaw,
      departmentId: departmentIdRaw,
      userRoleId,
      status,
      priority,
      search
    } = req.query as any;
    if (!start || !end) return res.status(400).json({ error: 'start and end are required' });

    const normalizeMulti = (v: any): string[] | undefined => {
      if (!v) return undefined;
      if (Array.isArray(v)) return v.flatMap(x => String(x).split(',').map(s => s.trim()).filter(Boolean));
      if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
      return undefined;
    };
    const normalizeList = (v: any) => Array.isArray(v) ? v : (typeof v === 'string' && v.includes(',') ? v.split(',').map((s: string) => s.trim()) : v);

    const requestedProjectIds = normalizeMulti(projectIdRaw);
    const requestedDepartmentIds = normalizeMulti(departmentIdRaw);
    const statusFilter = normalizeList(status);
    const priorityFilter = normalizeList(priority);

    // Fetch roles and owned projects
    const [ownedProjects, roles] = await Promise.all([
      prisma.project.findMany({ where: { ownerId: userId }, select: { id: true } }),
      prisma.userRole.findMany({
        where: { userId },
        select: {
          id: true,
          role: true,
          status: true,
          projectId: true,
          departmentScope: true,
          managedDepartments: { select: { id: true } },
          accessibleDepartments: { select: { id: true } }
        }
      })
    ]);

    const ownerProjectSet = new Set(ownedProjects.map(p => p.id));
    const activeRoles = roles.filter(r => r.status === 'ACTIVE' || r.status === 'PENDING');
    const roleProjectIds = Array.from(new Set(activeRoles.map(r => r.projectId)));
    let accessibleProjectIds = new Set<string>([...ownerProjectSet, ...roleProjectIds]);
    if (requestedProjectIds && requestedProjectIds.length > 0) {
      accessibleProjectIds = new Set(requestedProjectIds.filter(id => accessibleProjectIds.has(id)));
    }
    if (accessibleProjectIds.size === 0) return res.status(403).json({ error: 'No access to any requested scope' });

    const holdsOwnerAnywhere = ownerProjectSet.size > 0;
    const holdsManagerAnywhere = activeRoles.some(r => r.role === 'PROJECT_MANAGER');
    const holdsEmployeeAnywhere = activeRoles.some(r => r.role === 'EMPLOYEE');

    const projectToManageableDepts = new Map<string, Set<string>>();
    const projectToAccessibleDepts = new Map<string, Set<string>>();
    for (const r of activeRoles) {
      const manageable = new Set<string>(r.managedDepartments?.map(d => d.id) ?? []);
      const accessible = new Set<string>([...(r.departmentScope ?? []), ...(r.accessibleDepartments?.map(d => d.id) ?? [])]);
      if (!projectToManageableDepts.has(r.projectId)) projectToManageableDepts.set(r.projectId, new Set());
      if (!projectToAccessibleDepts.has(r.projectId)) projectToAccessibleDepts.set(r.projectId, new Set());
      manageable.forEach(d => projectToManageableDepts.get(r.projectId)!.add(d));
      accessible.forEach(d => projectToAccessibleDepts.get(r.projectId)!.add(d));
    }

    const isOnlyEmployee = !holdsOwnerAnywhere && !holdsManagerAnywhere && holdsEmployeeAnywhere;
    if (isOnlyEmployee) {
      if (userRoleId || (requestedDepartmentIds && requestedDepartmentIds.length > 0)) {
        return res.status(400).json({ error: 'Employees cannot filter by userRoleId or departmentId' });
      }
    }

    const where: any = {
      department: { projectId: { in: Array.from(accessibleProjectIds) } },
      createdAt: { gte: new Date(String(start)), lte: new Date(String(end)) }
    };
    if (isNaN((where.createdAt as any).gte.getTime()) || isNaN((where.createdAt as any).lte.getTime())) {
      return res.status(400).json({ error: 'Invalid date range' });
    }

    if (holdsManagerAnywhere && !holdsOwnerAnywhere) {
      const deptFilters: string[] = [];
      for (const pid of accessibleProjectIds) {
        const set = projectToManageableDepts.get(pid) ?? new Set<string>();
        set.forEach(d => deptFilters.push(d));
      }
      if (deptFilters.length === 0) return res.json({ buckets: [], meta: { start, end, granularity } });
      where.departmentId = { in: deptFilters };
    }

    if (isOnlyEmployee) {
      const myRoleIds = activeRoles.map(r => r.id);
      where.assignedRoleId = { in: myRoleIds };
    }

    if (!isOnlyEmployee && requestedDepartmentIds && requestedDepartmentIds.length > 0) {
      const allowedDeptIds = new Set<string>();
      for (const pid of accessibleProjectIds) {
        if (ownerProjectSet.has(pid)) {
          requestedDepartmentIds.forEach(d => allowedDeptIds.add(d));
        } else {
          const man = projectToManageableDepts.get(pid) ?? new Set<string>();
          const acc = projectToAccessibleDepts.get(pid) ?? new Set<string>();
          requestedDepartmentIds.forEach(d => { if (man.has(d) || acc.has(d)) allowedDeptIds.add(d); });
        }
      }
      if (allowedDeptIds.size > 0) where.departmentId = { in: Array.from(allowedDeptIds) };
    }

    if (!isOnlyEmployee && String(scope || '') === 'user' && userRoleId) {
      const target = activeRoles.find(r => r.id === String(userRoleId));
      if (target) {
        if (holdsOwnerAnywhere && ownerProjectSet.has(target.projectId)) {
          where.assignedRoleId = userRoleId;
        } else if (holdsManagerAnywhere) {
          const man = projectToManageableDepts.get(target.projectId) ?? new Set<string>();
          const targetDepts = new Set((target.departmentScope ?? []) as string[]);
          const overlap = Array.from(targetDepts).some(d => man.has(d));
          if (overlap) where.assignedRoleId = userRoleId;
        }
      }
    }

    if (statusFilter) where.status = Array.isArray(statusFilter) ? { in: statusFilter } : statusFilter;
    if (priorityFilter) where.priority = Array.isArray(priorityFilter) ? { in: priorityFilter } : priorityFilter;
    if (search) where.OR = [ { title: { contains: String(search), mode: 'insensitive' } }, { description: { contains: String(search), mode: 'insensitive' } } ];

    const tasks = await prisma.task.findMany({ where, select: { id: true, status: true, createdAt: true } });

    const fmtDate = (d: Date) => {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const toBucketKey = (dt: Date) => {
      if (granularity === 'week') {
        const d = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
        const day = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() - (day - 1));
        return fmtDate(d);
      }
      return fmtDate(dt);
    };

    const bucketsMap = new Map<string, number>();
    for (const t of tasks) {
      const key = toBucketKey(new Date(t.createdAt));
      bucketsMap.set(key, (bucketsMap.get(key) ?? 0) + 1);
    }
    const buckets = Array.from(bucketsMap.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([date, count]) => ({ date, count }));
    res.json({ buckets, meta: { start, end, granularity } });
  } catch (e) {
    console.error('[RoleAware] my-tasks calendar error:', e);
    res.status(500).json({ error: 'Failed to fetch calendar data' });
  }
});

// GET /api/role-aware/projects/:projectId/overview
router.get('/projects/:projectId/overview', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || !ctx.role) return res.status(403).json({ error: 'No access to this project' });

    // Compute role-aware metrics
    // Owner: all project tasks; Manager: manageable departments; Employee: assigned to me
    let where: any = { department: { projectId } };
    if (!ctx.isOwner) {
      if (ctx.role === 'PROJECT_MANAGER') {
        where.departmentId = { in: ctx.manageableDepartmentIds };
      } else {
        const roles = await prisma.userRole.findMany({ where: { userId, projectId }, select: { id: true } });
        where.assignedRoleId = { in: roles.map(r => r.id) };
      }
    }

    const [totalTasks, completedTasks, userRolesCount] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.userRole.count({ where: { projectId } })
    ]);

    res.json({
      totalTasks,
      completedTasks,
      completionPercentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      teamMembers: userRolesCount
    });
  } catch (e) {
    console.error('[RoleAware] project overview error:', e);
    res.status(500).json({ error: 'Failed to fetch overview' });
  }
});

// GET /api/role-aware/projects/:projectId/stats
router.get('/projects/:projectId/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;
    const { departmentId } = req.query as any;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || !ctx.role) return res.status(403).json({ error: 'No access to this project' });

    let where: any = { department: { projectId } };
    if (departmentId) {
      const depId = String(departmentId);
      const allowed = ctx.isOwner ? ctx.allDeptIds.includes(depId) : ctx.manageableDepartmentIds.includes(depId);
      if (!allowed) return res.status(403).json({ error: 'Department out of scope' });
      where.departmentId = depId;
    } else if (!ctx.isOwner && ctx.role === 'PROJECT_MANAGER') {
      where.departmentId = { in: ctx.manageableDepartmentIds };
    }

    const [total, inProgress, completed, pending] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      prisma.task.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.task.count({ where: { ...where, status: 'PENDING' } })
    ]);

    res.json({ total, inProgress, completed, pending });
  } catch (e) {
    console.error('[RoleAware] project stats error:', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/role-aware/projects/:projectId/my-stats (employee)
router.get('/projects/:projectId/my-stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { projectId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const ctx = await getProjectRoleContext(userId, projectId);
    if (!ctx || !ctx.role) return res.status(403).json({ error: 'No access to this project' });

    const roles = await prisma.userRole.findMany({ where: { userId, projectId }, select: { id: true } });
    const roleIds = roles.map(r => r.id);

    const [total, inProgress, completed, pending] = await Promise.all([
      prisma.task.count({ where: { department: { projectId }, assignedRoleId: { in: roleIds } } }),
      prisma.task.count({ where: { department: { projectId }, assignedRoleId: { in: roleIds }, status: 'IN_PROGRESS' } }),
      prisma.task.count({ where: { department: { projectId }, assignedRoleId: { in: roleIds }, status: 'COMPLETED' } }),
      prisma.task.count({ where: { department: { projectId }, assignedRoleId: { in: roleIds }, status: 'PENDING' } })
    ]);

    res.json({ total, inProgress, completed, pending });
  } catch (e) {
    console.error('[RoleAware] my-stats error:', e);
    res.status(500).json({ error: 'Failed to fetch my stats' });
  }
});

// GET /api/role-aware/departments/:departmentId/stats
router.get('/departments/:departmentId/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { departmentId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // Resolve project via department
    const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, projectId: true } });
    if (!department) return res.status(404).json({ error: 'Department not found' });

    const ctx = await getProjectRoleContext(userId, department.projectId);
    if (!ctx || (ctx.roles ?? []).length === 0) return res.status(403).json({ error: 'No access to this project' });

    const allowed = ctx.isOwner || ctx.manageableDepartmentIds.includes(departmentId) || ctx.accessibleDepartmentIds.includes(departmentId);
    if (!allowed) return res.status(403).json({ error: 'Department out of scope' });

    const [total, inProgress, completed, pending] = await Promise.all([
      prisma.task.count({ where: { departmentId } }),
      prisma.task.count({ where: { departmentId, status: 'IN_PROGRESS' } }),
      prisma.task.count({ where: { departmentId, status: 'COMPLETED' } }),
      prisma.task.count({ where: { departmentId, status: 'PENDING' } })
    ]);

    res.json({ total, inProgress, completed, pending });
  } catch (e) {
    console.error('[RoleAware] department stats error:', e);
    res.status(500).json({ error: 'Failed to fetch department stats' });
  }
});

// GET /api/role-aware/departments/:departmentId/team
router.get('/departments/:departmentId/team', authenticateToken, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    const { departmentId } = req.params;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { id: true, projectId: true } });
    if (!department) return res.status(404).json({ error: 'Department not found' });

    const ctx = await getProjectRoleContext(userId, department.projectId);
    if (!ctx || (ctx.roles ?? []).length === 0) return res.status(403).json({ error: 'No access to this project' });

    let roles = await prisma.userRole.findMany({
      where: { projectId: department.projectId },
      select: {
        id: true,
        role: true,
        user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } },
        departmentScope: true
      }
    });

    if (!ctx.isOwner) {
      if (ctx.role === 'PROJECT_MANAGER') {
        const set = new Set([departmentId]);
        roles = roles.filter(r => (r.departmentScope ?? []).some((d: string) => set.has(d)) || r.role === 'PROJECT_OWNER');
      } else {
        roles = roles.filter(r => r.user.id === userId);
      }
    }

    res.json(roles.map(r => ({ id: r.id, role: r.role, user: r.user })));
  } catch (e) {
    console.error('[RoleAware] department team error:', e);
    res.status(500).json({ error: 'Failed to fetch department team' });
  }
});


