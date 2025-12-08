import { vi, type Mock } from 'vitest';

type MockFn = Mock<(...args: any[]) => any>;

type PrismaMock = {
  $transaction: MockFn;
  user: {
    findUnique: MockFn;
    create: MockFn;
  };
  userRole: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
  };
  project: {
    findMany: MockFn;
    findFirst: MockFn;
    create: MockFn;
  };
  projectTag: {
    create: MockFn;
  };
  department: {
    create: MockFn;
    findUnique: MockFn;
  };
  task: {
    findMany: MockFn;
    findUnique: MockFn;
    update: MockFn;
  };
  projectInvite: {
    create: MockFn;
  };
  taskActivity: {
    create: MockFn;
  };
};

const buildFn = () => vi.fn();

export const prismaMock: PrismaMock = {
  $transaction: vi.fn(),
  user: {
    findUnique: buildFn(),
    create: buildFn(),
  },
  userRole: {
    findMany: buildFn(),
    findFirst: buildFn(),
    create: buildFn(),
  },
  project: {
    findMany: buildFn(),
    findFirst: buildFn(),
    create: buildFn(),
  },
  projectTag: {
    create: buildFn(),
  },
  department: {
    create: buildFn(),
    findUnique: buildFn(),
  },
  task: {
    findMany: buildFn(),
    findUnique: buildFn(),
    update: buildFn(),
  },
  projectInvite: {
    create: buildFn(),
  },
  taskActivity: {
    create: buildFn(),
  },
};

export function resetPrismaMock() {
  prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
  prismaMock.user.findUnique.mockReset();
  prismaMock.user.create.mockReset();
  prismaMock.userRole.findMany.mockReset();
  prismaMock.userRole.findFirst.mockReset();
  prismaMock.userRole.create.mockReset();
  prismaMock.project.findMany.mockReset();
  prismaMock.project.findFirst.mockReset();
  prismaMock.project.create.mockReset();
  prismaMock.projectTag.create.mockReset();
  prismaMock.department.create.mockReset();
  prismaMock.department.findUnique.mockReset();
  prismaMock.task.findMany.mockReset();
  prismaMock.task.findUnique.mockReset();
  prismaMock.task.update.mockReset();
  prismaMock.projectInvite.create.mockReset();
  prismaMock.taskActivity.create.mockReset();

  prismaMock.$transaction.mockClear();
}

resetPrismaMock();
