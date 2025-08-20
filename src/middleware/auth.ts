import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import jwt from 'jsonwebtoken';

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

    // Verify JWT token
    const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-in-production';
    
    try {
      const decoded = jwt.verify(token, jwtSecret) as { userId: string };
      const userId = decoded.userId;

      // Verify user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true
        }
      });

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Add user to request object
      req.user = {
        id: user.id,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined
      };
      next();
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError);
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
