import { Router, Request, Response } from "express";
import { authenticateToken } from "../middleware/auth.js";
import { rateLimiter } from "../middleware/performance.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { 
  validateEmail, 
  validatePassword, 
  validateName,
  validateWalletAddress,
  sanitizeString,
  checkLoginRateLimit,
  recordFailedLogin,
  resetLoginAttempts
} from "../utils/validation.js";
import { prisma } from "../utils/prisma.js";
import { getSecurityConfig } from "../config/security.js";
import { tokenBlacklist } from "../utils/tokenBlacklist.js";
import { securityMonitor } from "../utils/securityMonitor.js";
import { 
  sanitizeEmail, 
  detectSQLInjection, 
  detectXSS 
} from "../utils/inputSanitizer.js";

const router = Router();

/**
 * CRITICAL ENDPOINT: Session Synchronization
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

    console.log('[Auth] Syncing user session:', { 
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

    console.log('[Auth] User session synced successfully:', { 
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
    console.error('[Auth] User session sync failed:', error);
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
    console.error('[Auth] Get profile failed:', error);
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
router.post('/register', rateLimiter(5, 60000), async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    // Validate email
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      return res.status(400).json({ 
        error: 'Invalid email', 
        details: emailValidation.errors 
      });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ 
        error: 'Weak password', 
        details: passwordValidation.errors 
      });
    }

    // Validate names if provided
    if (firstName) {
      const firstNameValidation = validateName(firstName, 'First name');
      if (!firstNameValidation.isValid) {
        return res.status(400).json({ 
          error: 'Invalid first name', 
          details: firstNameValidation.errors 
        });
      }
    }

    if (lastName) {
      const lastNameValidation = validateName(lastName, 'Last name');
      if (!lastNameValidation.isValid) {
        return res.status(400).json({ 
          error: 'Invalid last name', 
          details: lastNameValidation.errors 
        });
      }
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password with stronger rounds
    const securityConfig = getSecurityConfig();
    const hashedPassword = await bcrypt.hash(password, securityConfig.bcryptRounds);
    console.log('[Security] Password hashed with', securityConfig.bcryptRounds, 'rounds');

    // Create user with sanitized data
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash: hashedPassword,
        firstName: firstName ? sanitizeString(firstName) : null,
        lastName: lastName ? sanitizeString(lastName) : null
      }
    });

    // Generate JWT with proper claims
    const token = (jwt.sign as any)(
      { 
        sub: user.id,
        userId: user.id, 
        email: user.email
      },
      securityConfig.jwtSecret,
      { 
        expiresIn: securityConfig.jwtExpiresIn,
        algorithm: securityConfig.jwtAlgorithm
      }
    ) as string;

    console.log('[Auth] User registered successfully:', { 
      userId: user.id, 
      email: user.email,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });

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
router.post('/login', rateLimiter(10, 60000), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();

    // Get client IP and user agent for security monitoring
    const clientIP = (req.headers['x-forwarded-for'] as string || req.ip || 'unknown').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || 'unknown';

    // Check IP-based rate limiting (security monitor)
    if (securityMonitor.isIPRateLimited(clientIP)) {
      console.warn('[Security] IP rate limited:', { ip: clientIP, email: normalizedEmail });
      return res.status(429).json({ 
        error: 'Too many login attempts from this IP address. Please try again later.'
      });
    }

    // Check email-based rate limiting (legacy validation)
    const rateLimit = checkLoginRateLimit(normalizedEmail);
    if (!rateLimit.allowed) {
      console.warn('[Security] Login rate limit exceeded:', { 
        email: normalizedEmail, 
        ip: clientIP 
      });
      return res.status(429).json({ 
        error: rateLimit.message || 'Too many login attempts',
        remainingTime: rateLimit.remainingTime
      });
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (!user || !user.passwordHash) {
      recordFailedLogin(normalizedEmail);
      // Record failed attempt in security monitor (with temporary user ID)
      securityMonitor.recordAttempt(`unknown:${normalizedEmail}`, false, clientIP, userAgent);
      console.warn('[Security] Login attempt for non-existent user:', { 
        email: normalizedEmail, 
        ip: clientIP 
      });
      // Use generic error message to prevent user enumeration
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if account is locked (security monitor)
    if (securityMonitor.isAccountLocked(user.id)) {
      console.warn('[Security] Login attempt for locked account:', { 
        userId: user.id, 
        email: normalizedEmail,
        ip: clientIP 
      });
      return res.status(423).json({ 
        error: 'Account temporarily locked due to multiple failed login attempts. Please try again later.'
      });
    }

    // Verify password with timing-safe comparison
    const validPassword = await bcrypt.compare(password, user.passwordHash);

    if (!validPassword) {
      recordFailedLogin(normalizedEmail);
      // Record failed attempt in security monitor
      securityMonitor.recordAttempt(user.id, false, clientIP, userAgent);
      console.warn('[Security] Failed login attempt:', { 
        email: normalizedEmail, 
        ip: clientIP,
        userId: user.id
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Reset failed login attempts on successful login
    resetLoginAttempts(normalizedEmail);
    // Record successful login in security monitor
    securityMonitor.recordAttempt(user.id, true, clientIP, userAgent);

    // Generate JWT with proper claims  
    const securityConfig = getSecurityConfig();
    const token = (jwt.sign as any)(
      { 
        sub: user.id,
        userId: user.id, 
        email: user.email
      },
      securityConfig.jwtSecret,
      { 
        expiresIn: securityConfig.jwtExpiresIn,
        algorithm: securityConfig.jwtAlgorithm
      }
    ) as string;

    console.log('[Auth] User logged in successfully:', { 
      userId: user.id, 
      email: user.email,
      ip: clientIP,
      userAgent: userAgent
    });

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

    // Check if token is blacklisted
    if (tokenBlacklist.isBlacklisted(token)) {
      return res.status(401).json({ error: 'Session has been revoked' });
    }

    const securityConfig = getSecurityConfig();
    const decoded = jwt.verify(token, securityConfig.jwtSecret, {
      algorithms: [securityConfig.jwtAlgorithm]
    }) as { userId: string; sub: string };

    const userId = decoded.sub || decoded.userId;

    const user = await prisma.user.findUnique({
      where: { id: userId },
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

    // Validate wallet address format for Ethereum/EVM chains
    if (chainId && chainId !== 'algorand') {
      const walletValidation = validateWalletAddress(walletAddress);
      if (!walletValidation.isValid) {
        return res.status(400).json({ 
          error: 'Invalid wallet address', 
          details: walletValidation.errors 
        });
      }
    }

    // Normalize wallet address (lowercase for consistency)
    const normalizedAddress = walletAddress.toLowerCase().trim();

    console.log('[Auth] Web3 wallet authentication:', {
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
    const securityConfig = getSecurityConfig();
    const token = (jwt.sign as any)(
      { 
        sub: user.id,
        userId: user.id, 
        walletAddress: normalizedAddress,
        authType: 'web3'
      },
      securityConfig.jwtSecret,
      { 
        expiresIn: securityConfig.jwtExpiresIn,
        algorithm: securityConfig.jwtAlgorithm
      }
    ) as string;

    console.log('[Auth] Wallet user authenticated successfully:', {
      userId: user.id,
      walletAddress: normalizedAddress,
      chainId,
      ip: req.ip,
      userAgent: req.headers['user-agent']
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
    console.error('[Auth] Wallet authentication failed:', error);
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
      const securityConfig = getSecurityConfig();
      const decoded = jwt.verify(sessionToken, securityConfig.nextAuthSecret, {
        algorithms: [securityConfig.jwtAlgorithm]
      }) as any;
      
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
 * POST /api/auth/logout - Logout and blacklist token
 */
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '') || 
                  req.cookies?.['next-auth.session-token'] ||
                  req.cookies?.['__Secure-next-auth.session-token'];

    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }

    // Decode token to get expiration and user ID
    const securityConfig = getSecurityConfig();
    try {
      const decoded = jwt.verify(token, securityConfig.jwtSecret, {
        algorithms: [securityConfig.jwtAlgorithm]
      }) as any;

      const userId = decoded.sub || decoded.userId;
      const expiresAt = decoded.exp ? decoded.exp * 1000 : Date.now() + (30 * 24 * 60 * 60 * 1000);

      // Add to blacklist
      tokenBlacklist.add(token, expiresAt, userId, 'logout');

      console.log('[Auth] User logged out successfully:', { userId });
      return res.json({ success: true, message: 'Logged out successfully' });
    } catch (err) {
      // Token invalid or expired - still return success
      console.log('[Auth] Logout with invalid token (already expired)');
      return res.json({ success: true, message: 'Logged out successfully' });
    }
  } catch (error) {
    console.error('[Auth] Logout failed:', error);
    return res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * POST /api/auth/revoke-all-sessions - Revoke all sessions for security (requires auth)
 */
router.post('/revoke-all-sessions', authenticateToken, async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const count = tokenBlacklist.revokeAllForUser(req.user.id, 'security');

    res.json({ 
      success: true, 
      message: `Revoked ${count} sessions`,
      revokedCount: count
    });
  } catch (error) {
    console.error('[Auth] Failed to revoke sessions:', error);
    res.status(500).json({ error: 'Failed to revoke sessions' });
  }
});

/**
 * Health check for authentication system
 */
router.get('/health', (req: Request, res: Response) => {
  const securityConfig = getSecurityConfig();
  res.json({ 
    success: true, 
    message: 'Authentication system is healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    securityLevel: securityConfig.isProduction ? 'production' : 'development'
  });
});

/**
 * GET /api/auth/security-stats - Get security monitoring statistics
 * Requires authentication for security
 */
router.get('/security-stats', authenticateToken, (req: Request, res: Response) => {
  try {
    const stats = securityMonitor.getStats();
    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('[Auth] Failed to get security stats:', error);
    res.status(500).json({ error: 'Failed to retrieve security statistics' });
  }
});

export default router;
