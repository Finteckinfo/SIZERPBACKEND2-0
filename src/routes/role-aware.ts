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
    const { scope = 'all', departmentId, status, priority, search, page = '1', limit = '20' } = req.query as any;
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

    const where: any = {
      department: { projectId }
    };

    if (status) where.status = status;
    if (priority) where.priority = priority;
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
    } else if (departmentId) {
      where.departmentId = String(departmentId);
    } else {
      where.departmentId = { in: visibleDeptIds };
    }

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          status: true,
          priority: true,
          departmentId: true,
          createdAt: true,
          updatedAt: true,
          assignedRole: {
            select: {
              id: true,
              user: { select: { id: true, email: true, firstName: true, lastName: true, avatarUrl: true } }
            }
          }
        },
        skip: offset,
        take: limitNum,
        orderBy: { createdAt: 'desc' }
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

export default router;
// ---- Additional role-aware endpoints ----

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


