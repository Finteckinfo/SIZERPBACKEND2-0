// src/routes/wallet.ts
import { Router, Request, Response } from 'express';
import { prisma } from '../utils/database.js';

const router = Router();

/**
 * GET /api/users/:userId/wallet/connected
 * Check if user's wallet is connected
 */
router.get('/:userId/connected', async (req: Request, res: Response) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { walletAddress: true },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ 
      connected: !!user.walletAddress,
      walletAddress: user.walletAddress || null,
    });
  } catch (error) {
    console.error('[Wallet API] Error:', error);
    res.status(500).json({ error: 'Failed to check wallet connection' });
  }
});

/**
 * POST /api/user/wallet
 * body: { userId, walletAddress }
 * Sync wallet to DB
 */
router.post('/', async (req: Request, res: Response) => {
  const { userId, walletAddress } = req.body;

  if (!userId || !walletAddress) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    // Check if wallet is already assigned to a different user
    const existingUser = await prisma.user.findFirst({
      where: { walletAddress },
    });

    if (existingUser && existingUser.id !== userId) {
      return res.status(409).json({
        error: 'This wallet is already linked to another account',
      });
    }

    // Update the user's walletAddress
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { walletAddress },
    });

    return res.json({ 
      success: true, 
      userId: updatedUser.id,
      walletAddress: updatedUser.walletAddress,
    });
  } catch (err) {
    console.error('[Wallet API] Error:', err);
    return res.status(500).json({ error: 'Failed to update wallet' });
  }
});

export default router;
