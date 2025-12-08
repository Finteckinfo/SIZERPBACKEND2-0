import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from '../utils/prismaMock.js';
import { buildAuthCookies } from '../helpers/auth.js';

const mockAuthenticate = vi.fn();
const mockCheckProjectAccess = vi.fn();
let app: any;

vi.mock('../../src/utils/database.js', () => ({
  default: prismaMock,
  prisma: prismaMock,
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticateToken: (req: any, res: any, next: any) => mockAuthenticate(req, res, next),
  requireProjectRole: () => (_req: any, _res: any, next: any) => next(),
  requireProjectOwner: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/utils/accessControl.js', () => ({
  checkProjectAccess: (...args: any[]) => mockCheckProjectAccess(...args),
  checkProjectRole: vi.fn(),
  getUserProjectRole: vi.fn(),
}));

beforeAll(async () => {
  app = (await import('../../src/app.js')).default;
});

describe('POST /api/projects', () => {
  beforeEach(() => {
    resetPrismaMock();
    mockAuthenticate.mockReset();
    mockAuthenticate.mockImplementation((req: any, _res: any, next: any) => {
      req.user = { id: 'user-1', email: 'owner@siz.land' };
      next();
    });
    mockCheckProjectAccess.mockReset();
    prismaMock.user.findUnique.mockResolvedValue({ walletAddress: 'WALLET-1' });
    prismaMock.project.findFirst.mockResolvedValue(null);
    prismaMock.projectTag.create.mockResolvedValue({});
    prismaMock.projectInvite.create.mockResolvedValue({});
  });

  it('creates a project with related departments and roles', async () => {
    const createdProject = {
      id: 'proj-1',
      name: 'Atlas',
      description: 'Core ERP rollout',
      type: 'PROGRESSIVE',
      priority: 'HIGH',
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-02-01'),
      ownerId: 'user-1',
    };

    const departmentA = { id: 'dept-1', name: 'Ops', type: 'MAJOR', description: 'Ops', order: 0, isVisible: true, projectId: 'proj-1' };
    const departmentB = { id: 'dept-2', name: 'Finance', type: 'MAJOR', description: 'Fin', order: 1, isVisible: true, projectId: 'proj-1' };
    const ownerRole = { id: 'role-1', projectId: 'proj-1', userId: 'user-1', role: 'PROJECT_OWNER', status: 'ACTIVE', acceptedAt: new Date() };

    prismaMock.project.create.mockResolvedValue(createdProject);
    prismaMock.department.create
      .mockResolvedValueOnce(departmentA)
      .mockResolvedValueOnce(departmentB);
    prismaMock.userRole.create.mockResolvedValue(ownerRole);

    const payload = {
      name: 'Atlas',
      description: 'Core ERP rollout',
      type: 'PROGRESSIVE',
      startDate: '2025-01-01',
      endDate: '2025-02-01',
      priority: 'HIGH',
      budgetRange: '100k-200k',
      tags: ['finance'],
      departments: [
        { name: 'Ops', type: 'MAJOR', description: 'Ops lane', order: 0, isVisible: true },
        { name: 'Finance', type: 'MAJOR', description: 'Finance lane', order: 1, isVisible: true },
      ],
      roles: [],
      walletAddress: 'WALLET-1',
      idempotencyKey: 'idem-1',
    };

    const cookies = buildAuthCookies();

    const response = await request(app)
      .post('/api/projects')
      .set('Cookie', cookies)
      .send(payload)
      .expect(201);

    expect(prismaMock.project.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Atlas',
        ownerId: 'user-1',
      }),
    });

    expect(prismaMock.department.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.userRole.create).toHaveBeenCalledTimes(1);

    expect(response.body.project).toEqual(expect.objectContaining({ id: 'proj-1' }));
    expect(response.body.departments).toHaveLength(2);
    expect(response.body.roles[0].role).toBe('PROJECT_OWNER');
  });

  it('rejects wallet mismatch for authenticated user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ walletAddress: 'OTHER' });
    const cookies = buildAuthCookies();

    await request(app)
      .post('/api/projects')
      .set('Cookie', cookies)
      .send({
        name: 'Mismatch',
        description: 'Wallet mismatch case',
        type: 'PARALLEL',
        startDate: '2025-03-01',
        endDate: '2025-04-01',
        walletAddress: 'WALLET-1',
      })
      .expect(400)
      .expect(res => {
        expect(res.body.error).toMatch(/wallet address/i);
      });
  });
});
