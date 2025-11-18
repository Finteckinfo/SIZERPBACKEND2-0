import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';
import { requireNextAuthToken, requireAdmin } from '../middleware/nextauth.js';

const router = Router();

// GET /api/admin/users - admin-only user listing with pagination & search
router.get('/', requireNextAuthToken, requireAdmin, async (req: Request, res: Response) => {
  const {
    page = 1,
    limit = 50,
    search,
    hasWallet,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query as any;

  try {
    const pageNum = Math.max(parseInt(page as string) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit as string) || 50, 1), 200);
    const offset = (pageNum - 1) * limitNum;

    const where: any = {};
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (hasWallet === 'true') where.walletAddress = { not: null };
    if (hasWallet === 'false') where.walletAddress = null;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          walletAddress: true,
          createdAt: true
        },
        skip: offset,
        take: limitNum,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.user.count({ where })
    ]);

    res.json({ users, pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) } });
  } catch (err: any) {
    console.error('[Admin Users] Error:', err.message || err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

export default router;
