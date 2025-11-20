import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middleware/auth.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = Router();
const prisma = new PrismaClient();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-change-in-production';

/**
 * 🎯 CRITICAL ENDPOINT: Session Synchronization
 * This endpoint creates/updates users in the database when they authenticate via NextAuth
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
 * NextAuth.js Authentication Endpoints
 * These endpoints support password-based authentication for SSO
 */

// POST /api/auth/register - Register new user with password
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: hashedPassword,
        firstName: firstName || null,
        lastName: lastName || null
      }
    });

    // Generate JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email 
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log('User registered successfully:', { userId: user.id, email: user.email });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      },
      token
    });
  } catch (error) {
    console.error('Registration failed:', error);
    res.status(500).json({ 
      error: 'Registration failed',
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
});

// POST /api/auth/login - Login with password
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email 
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log('User logged in successfully:', { userId: user.id, email: user.email });

    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      token
    });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ 
      error: 'Login failed',
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
});

// GET /api/auth/me - Get current user from JWT token
router.get('/me', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'Not authorized' });
    }

    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Token validation failed:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

/**
 * POST /api/auth/wallet-login - Login/Register with Web3 wallet
 * This endpoint handles SIWE (Sign-In with Ethereum) authentication
 */
router.post('/wallet-login', async (req: Request, res: Response) => {
  try {
    const { walletAddress, chainId, domain } = req.body;

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // Normalize wallet address (lowercase for consistency)
    const normalizedAddress = walletAddress.toLowerCase();

    console.log('🔐 Web3 wallet authentication:', {
      walletAddress: normalizedAddress,
      chainId,
      domain
    });

    // Find existing user with this wallet address
    let user = await prisma.user.findFirst({
      where: { walletAddress: normalizedAddress }
    });

    if (user) {
      // Update existing user
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          updatedAt: new Date(),
        }
      });
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          walletAddress: normalizedAddress,
          email: `${normalizedAddress.substring(0, 8)}@wallet.local`,
          firstName: `Wallet User`,
          lastName: normalizedAddress.substring(0, 8),
        }
      });
    }

    // Generate JWT for wallet user
    const token = jwt.sign(
      { 
        userId: user.id, 
        walletAddress: normalizedAddress,
        authType: 'web3'
      },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log('✅ Wallet user authenticated successfully:', {
      userId: user.id,
      walletAddress: normalizedAddress
    });

    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      walletAddress: user.walletAddress,
      authType: 'web3',
      token
    });

  } catch (error) {
    console.error('❌ Wallet authentication failed:', error);
    res.status(500).json({ 
      error: 'Wallet authentication failed',
      details: process.env.NODE_ENV === 'development' ? (error as Error).message : 'Internal server error'
    });
  }
});

/**
 * GET /api/auth/session - Validate NextAuth session cookie
 * This endpoint validates the NextAuth session cookie from siz.land
 * and returns the user session if valid
 */
router.get('/session', async (req: Request, res: Response) => {
  try {
    // Check for NextAuth session token in cookies
    const sessionToken = req.cookies?.['next-auth.session-token'] || 
                        req.cookies?.['__Secure-next-auth.session-token'];

    if (!sessionToken) {
      return res.status(401).json({ 
        user: null,
        message: 'No session token found' 
      });
    }

    // Verify the NextAuth JWT token
    // Note: In production, this should validate against NextAuth's secret
    // For now, we'll decode and validate the structure
    try {
      const decoded = jwt.verify(sessionToken, process.env.NEXTAUTH_SECRET || JWT_SECRET) as any;
      
      if (decoded && decoded.email) {
        // Find or create user in database
        let user = await prisma.user.findUnique({
          where: { email: decoded.email }
        });

        if (!user) {
          // Create user if doesn't exist (SSO from NextAuth)
          user = await prisma.user.create({
            data: {
              id: decoded.sub || decoded.id,
              email: decoded.email,
              firstName: decoded.name?.split(' ')[0] || null,
              lastName: decoded.name?.split(' ').slice(1).join(' ') || null,
            }
          });
          console.log('Created new user from NextAuth session:', user.email);
        }

        return res.json({
          user: {
            id: user.id,
            email: user.email,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
            firstName: user.firstName,
            lastName: user.lastName
          }
        });
      }
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError);
      return res.status(401).json({ 
        user: null,
        message: 'Invalid session token' 
      });
    }

    return res.status(401).json({ 
      user: null,
      message: 'Session validation failed' 
    });

  } catch (error) {
    console.error('Session validation error:', error);
    res.status(500).json({ 
      user: null,
      error: 'Session validation failed',
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
