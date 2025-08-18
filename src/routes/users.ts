// src/routes/users.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/users
 * Search/filter users for team assignment
 */
router.get('/', async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 20,
    search,
    role,
    hasWallet,
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
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    if (hasWallet === 'true') {
      where.walletAddress = { not: null };
    } else if (hasWallet === 'false') {
      where.walletAddress = null;
    }

    // Build orderBy clause
    const orderBy: any = {};
    orderBy[sortBy as string] = sortOrder;

    // Get users with related data
    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          walletAddress: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              roles: true,
              projectsOwned: true
            }
          }
        },
        skip: offset,
        take: limitNum,
        orderBy
      }),
      prisma.user.count({ where })
    ]);

    // Add computed fields
    const usersWithStats = users.map(user => ({
      ...user,
      fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      hasWallet: !!user.walletAddress,
      projectCount: user._count.projectsOwned,
      roleCount: user._count.roles
    }));

    res.json({
      users: usersWithStats,
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
    console.error('[Users API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/users/:userId
 * Get user details
 */
router.get('/:userId', async (req: Request, res: Response) => {
  const { userId } = req.params;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        walletAddress: true,
        createdAt: true,
        updatedAt: true,
        roles: {
          select: {
            id: true,
            role: true,
            project: {
              select: {
                id: true,
                name: true,
                type: true,
                priority: true,
                startDate: true,
                endDate: true
              }
            },
            departmentOrder: true,
            departmentScope: true,
            createdAt: true
          }
        },
        projectsOwned: {
          select: {
            id: true,
            name: true,
            type: true,
            priority: true,
            startDate: true,
            endDate: true,
            createdAt: true
          }
        },
        managedDepts: {
          select: {
            id: true,
            name: true,
            type: true,
            project: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        tasksAssigned: {
          select: {
            id: true,
            title: true,
            status: true,
            department: {
              select: {
                name: true,
                project: {
                  select: {
                    id: true,
                    name: true
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
            roles: true,
            projectsOwned: true,
            managedDepts: true,
            tasksAssigned: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate user statistics
    const userWithStats = {
      ...user,
      fullName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
      hasWallet: !!user.walletAddress,
      stats: {
        totalProjects: user._count.projectsOwned,
        totalRoles: user._count.roles,
        managedDepartments: user._count.managedDepts,
        assignedTasks: user._count.tasksAssigned
      }
    };

    res.json(userWithStats);
  } catch (error) {
    console.error('[Users API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch user details' });
  }
});

export default router;
