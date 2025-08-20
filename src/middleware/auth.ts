import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { verifyToken } from '@clerk/backend';

const prisma = new PrismaClient();

// Extend the Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        firstName?: string;
        lastName?: string;
      };
    }
  }
}

export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    try {
      // Verify Clerk session token
      const sessionToken = token;
      const jwtSecret = process.env.CLERK_JWT_KEY || process.env.CLERK_SECRET_KEY;
      
      if (!jwtSecret) {
        console.error('CLERK_JWT_KEY or CLERK_SECRET_KEY not configured');
        return res.status(500).json({ error: 'Authentication configuration error' });
      }

      // Verify the token with Clerk
      const decoded = await verifyToken(sessionToken, {
        jwtKey: jwtSecret
      });

      // Extract user information from Clerk token
      const userId = (decoded as any).sub; // Clerk user ID
      const email = (decoded as any).email;
      const firstName = (decoded as any).first_name || (decoded as any).given_name;
      const lastName = (decoded as any).last_name || (decoded as any).family_name;

      if (!userId || !email) {
        return res.status(401).json({ error: 'Invalid token payload' });
      }

      // Check if user exists in our database, create if not
      let user = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true
        }
      });

      // If user doesn't exist, create them (first time login)
      if (!user) {
        user = await prisma.user.create({
          data: {
            id: userId, // Use Clerk's user ID
            email,
            firstName: firstName || null,
            lastName: lastName || null
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        });
      }

      // Add user to request object
      req.user = {
        id: user.id,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined
      };
      next();
    } catch (clerkError) {
      console.error('Clerk token verification failed:', clerkError);
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// Optional: Middleware to check if user has specific role in a project
export const requireProjectRole = (allowedRoles: Role[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projectId } = req.params;
      
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const userRole = await prisma.userRole.findFirst({
        where: {
          userId: req.user.id,
          projectId: projectId,
          role: {
            in: allowedRoles
          }
        }
      });

      if (!userRole) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      next();
    } catch (error) {
      console.error('Role check middleware error:', error);
      return res.status(500).json({ error: 'Failed to verify permissions' });
    }
  };
};

// Optional: Middleware to check if user owns a project
export const requireProjectOwner = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = await prisma.userRole.findFirst({
      where: {
        userId: req.user.id,
        projectId: projectId,
        role: 'PROJECT_OWNER'
      }
    });

    if (!userRole) {
      return res.status(403).json({ error: 'Project owner access required' });
    }

    next();
  } catch (error) {
    console.error('Project owner check middleware error:', error);
    return res.status(500).json({ error: 'Failed to verify project ownership' });
  }
};
