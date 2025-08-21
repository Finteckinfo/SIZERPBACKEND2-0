import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.js";

const router = Router();
const prisma = new PrismaClient();

/**
 * 🎯 CRITICAL ENDPOINT: Session Synchronization
 * This endpoint creates/updates users in the database when they authenticate via Clerk
 * This prevents the login loop where users get 401 errors because they don't exist in the backend
 */
router.post('/sync-user', authenticateToken, async (req: Request, res: Response) => {
  try {
    // User data is already verified and available from authenticateToken middleware
    const { user } = req;
    
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    console.log('🔄 Syncing user session:', { 
      userId: user.id, 
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName
    });

    // Upsert user (create if doesn't exist, update if exists)
    const syncedUser = await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        firstName: user.firstName || null,
        lastName: user.lastName || null,
        updatedAt: new Date()
      },
      create: {
        id: user.id,
        email: user.email,
        firstName: user.firstName || null,
        lastName: user.lastName || null
      }
    });

    console.log('✅ User session synced successfully:', { 
      userId: syncedUser.id, 
      email: syncedUser.email 
    });

    res.json({ 
      success: true, 
      user: {
        id: syncedUser.id,
        email: syncedUser.email,
        firstName: syncedUser.firstName,
        lastName: syncedUser.lastName
      }
    });

  } catch (error) {
    console.error('❌ User session sync failed:', error);
    res.status(500).json({ 
      error: 'Failed to sync user session',
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
});

/**
 * Get current user profile
 */
router.get('/profile', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { user } = req;
    
    if (!user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Get fresh user data from database
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!dbUser) {
      return res.status(404).json({ error: 'User not found in database' });
    }

    res.json({ 
      success: true, 
      user: dbUser 
    });

  } catch (error) {
    console.error('❌ Get profile failed:', error);
    res.status(500).json({ 
      error: 'Failed to get user profile',
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
});

/**
 * Health check for authentication system
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({ 
    success: true, 
    message: 'Authentication system is healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

export default router;
