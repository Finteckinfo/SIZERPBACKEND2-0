// src/routes/users.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/users/search?query=...
 * Search users by name or email
 */
router.get('/search', async (req: Request, res: Response) => {
  const { query } = req.query;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid query parameter' });
  }

  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          {
            firstName: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            lastName: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            email: {
              contains: query,
              mode: 'insensitive',
            },
          },
        ],
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
      },
      take: 20,
    });

    res.json(users);
  } catch (error) {
    console.error('[Users API] Error:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

/**
 * POST /api/users/resolve-by-emails
 * Resolve user IDs by email addresses
 * body: { emails: string[] }
 */
router.post('/resolve-by-emails', async (req: Request, res: Response) => {
  const { emails } = req.body;

  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'Missing or invalid emails array' });
  }

  try {
    const results = await Promise.all(
      emails.map(async (email: string) => {
        const user = await prisma.user.findUnique({
          where: { email },
          select: { id: true, email: true },
        });

        return {
          email,
          id: user?.id || null,
          status: user ? 'exists' : 'invite',
        };
      })
    );

    res.json(results);
  } catch (error) {
    console.error('[Users API] Error:', error);
    res.status(500).json({ error: 'Failed to resolve emails' });
  }
});

export default router;
