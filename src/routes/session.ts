import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

/**
 * GET /api/auth/session
 * Validate NextAuth session and return user data
 * Used by satellite domains (ERP, etc.) to verify SSO authentication
 */
router.get('/session', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'No user session found' });
    }

    // Return session data compatible with NextAuth format
    const session = {
      user: {
        id: req.user.id,
        email: req.user.email,
        name: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email,
        firstName: req.user.firstName,
        lastName: req.user.lastName,
      },
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
    };

    console.log('[Session] Validated session for:', req.user.email);
    res.json(session);
  } catch (error) {
    console.error('[Session] Error validating session:', error);
    res.status(500).json({ error: 'Session validation failed' });
  }
});

export default router;
