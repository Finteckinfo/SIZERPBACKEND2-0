import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from '../utils/prismaMock.js';
import { buildAuthCookies } from '../helpers/auth.js';

const mockAuthenticate = vi.hoisted(() =>
  vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', email: 'owner@siz.land' };
    next();
  })
);

const mockCheckProjectAccess = vi.hoisted(() => vi.fn());
let app: any;

vi.mock('../../src/utils/database.js', () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticateToken: mockAuthenticate,
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
  requireProjectOwner: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/utils/accessControl.js', () => ({
  checkProjectAccess: mockCheckProjectAccess,
  checkProjectRole: vi.fn(),
  getUserProjectRole: vi.fn(),
}));

vi.mock('../../src/services/websocket.js', () => ({
  broadcastTaskMoved: vi.fn(),
  broadcastTaskAssigned: vi.fn(),
  broadcastTaskCreated: vi.fn(),
  broadcastTaskUpdated: vi.fn(),
}));

beforeAll(async () => {
  app = (await import('../../src/app.js')).default;
});

describe('Kanban task endpoints', () => {
  const cookies = buildAuthCookies();

  beforeEach(() => {
    resetPrismaMock();
    mockAuthenticate.mockClear();
    mockCheckProjectAccess.mockReset();
  });

  it('returns grouped kanban data across all accessible projects', async () => {
    prismaMock.userRole.findMany.mockResolvedValue([
      {
        id: 'role-owner',
        projectId: 'proj-1',
        role: 'PROJECT_OWNER',
        project: { id: 'proj-1', name: 'Atlas', type: 'PROGRESSIVE', priority: 'HIGH' },
      },
    ]);

    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Kickoff',
        status: 'PENDING',
        priority: 'HIGH',
        estimatedHours: 4,
        dueDate: new Date().toISOString(),
        progress: 10,
        order: 1,
        assignedRoleId: 'role-owner',
        departmentId: 'dept-1',
        createdByRoleId: 'role-owner',
        checklistCount: 3,
        checklistCompleted: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assignedRole: {
          user: {
            id: 'user-1',
            email: 'owner@siz.land',
            firstName: 'Owner',
            lastName: 'One',
            avatarUrl: null,
          },
        },
        department: {
          id: 'dept-1',
          name: 'Ops',
          color: '#111',
          type: 'MAJOR',
          project: { id: 'proj-1', name: 'Atlas', type: 'PROGRESSIVE', priority: 'HIGH' },
        },
      },
    ]);

    const response = await request(app)
      .get('/api/tasks/kanban/all-projects')
      .set('Cookie', cookies)
      .expect(200);

    expect(prismaMock.userRole.findMany).toHaveBeenCalled();
    expect(response.body.totalTasks).toBe(1);
    expect(response.body.columns.PENDING).toHaveLength(1);
    expect(response.body.userPermissions.canCreateTasks).toBe(true);
    expect(response.body.projectSummary[0]).toMatchObject({
      projectId: 'proj-1',
      projectName: 'Atlas',
      taskCount: 1,
    });
  });

  it('returns project-specific kanban data when user has access', async () => {
    mockCheckProjectAccess.mockResolvedValue({ hasAccess: true });
    prismaMock.userRole.findMany.mockResolvedValue([
      { id: 'role-manager', role: 'PROJECT_MANAGER' },
    ]);
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 'task-2',
        title: 'Spec draft',
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
        estimatedHours: 6,
        dueDate: new Date().toISOString(),
        assignedRoleId: 'role-manager',
        order: 2,
        progress: 55,
        departmentId: 'dept-1',
        createdByRoleId: 'role-manager',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assignedRole: { user: { id: 'user-2', email: 'manager@siz.land', firstName: 'Mgr', lastName: 'One', avatarUrl: null } },
        department: { id: 'dept-1', name: 'Ops', color: '#111', type: 'MAJOR', project: { id: 'proj-1', name: 'Atlas', type: 'PROGRESSIVE', priority: 'HIGH' } },
      },
    ]);

    const response = await request(app)
      .get('/api/tasks/kanban/proj-1')
      .set('Cookie', cookies)
      .expect(200);

    expect(mockCheckProjectAccess).toHaveBeenCalledWith('user-1', 'proj-1');
    expect(response.body.projectId).toBe('proj-1');
    expect(response.body.columns.IN_PROGRESS).toHaveLength(1);
    expect(response.body.userPermissions.canAssignTasks).toBe(true);
  });

  it('reorders a task when dragging to new status', async () => {
    mockCheckProjectAccess.mockResolvedValue({ hasAccess: true });
    prismaMock.task.findUnique.mockResolvedValue({
      id: 'task-3',
      status: 'PENDING',
      order: 1,
      departmentId: 'dept-1',
      department: { id: 'dept-1', projectId: 'proj-1' },
      assignedRoleId: 'role-owner',
    });
    prismaMock.userRole.findFirst.mockResolvedValue({ id: 'role-owner', role: 'PROJECT_OWNER' });

    prismaMock.task.update
      .mockResolvedValueOnce({
        id: 'task-3',
        status: 'IN_PROGRESS',
        order: 0,
        department: { id: 'dept-1', name: 'Ops', color: '#111', type: 'MAJOR' },
        assignedRole: { user: { id: 'user-1', email: 'owner@siz.land', firstName: 'Owner', lastName: 'One', avatarUrl: null } },
      })
      .mockResolvedValue({ id: 'task-4', order: 2 });

    prismaMock.task.findMany.mockResolvedValue([{ id: 'task-4', order: 2 }]);

    prismaMock.task.findUnique
      .mockResolvedValueOnce({
        id: 'task-3',
        status: 'PENDING',
        order: 1,
        departmentId: 'dept-1',
        department: { id: 'dept-1', projectId: 'proj-1' },
        assignedRoleId: 'role-owner',
      })
      .mockResolvedValue({
        id: 'task-4',
        department: { projectId: 'proj-1' },
      });

    const response = await request(app)
      .patch('/api/tasks/task-3/position')
      .set('Cookie', cookies)
      .send({ status: 'IN_PROGRESS', order: 0 })
      .expect(200);

    expect(response.body.status).toBe('IN_PROGRESS');
    expect(prismaMock.task.update).toHaveBeenCalled();
  });
});
