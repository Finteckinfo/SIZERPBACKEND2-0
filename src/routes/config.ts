// src/routes/config.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/config/enums
 * Get all enum values for roles, project types, department types
 */
router.get('/enums', async (req: Request, res: Response) => {
  try {
    const enums = {
      roles: ['PROJECT_OWNER', 'PROJECT_MANAGER', 'EMPLOYEE'],
      projectTypes: ['PROGRESSIVE', 'PARALLEL'],
      departmentTypes: ['MAJOR', 'MINOR'],
      taskStatuses: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'APPROVED'],
      priorities: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      paymentStatuses: ['PENDING', 'TIMELY', 'PER_COMPLETION', 'RELEASED'],
    };

    res.json(enums);
  } catch (error) {
    console.error('[Config API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch enum values' });
  }
});

/**
 * GET /api/config/budget-ranges
 * Get predefined budget ranges
 */
router.get('/budget-ranges', async (req: Request, res: Response) => {
  try {
    const budgetRanges = [
      'Under $1,000',
      '$1,000 - $5,000',
      '$5,000 - $10,000',
      '$10,000 - $25,000',
      '$25,000 - $50,000',
      '$50,000 - $100,000',
      '$100,000 - $250,000',
      '$250,000 - $500,000',
      '$500,000 - $1,000,000',
      'Over $1,000,000',
    ];

    res.json({ ranges: budgetRanges });
  } catch (error) {
    console.error('[Config API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch budget ranges' });
  }
});

/**
 * GET /api/tags/suggest?query=...
 * Get tag suggestions based on query
 */
router.get('/tags/suggest', async (req: Request, res: Response) => {
  const { query } = req.query;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid query parameter' });
  }

  try {
    // Get existing tags that match the query
    const existingTags = await prisma.projectTag.findMany({
      where: {
        name: {
          contains: query,
          mode: 'insensitive',
        },
      },
      select: { name: true },
      distinct: ['name'],
      take: 10,
    });

    // Get unique tag names
    const tagNames = [...new Set(existingTags.map(tag => tag.name))];

    res.json(tagNames);
  } catch (error) {
    console.error('[Config API] Error:', error);
    res.status(500).json({ error: 'Failed to fetch tag suggestions' });
  }
});

export default router;
