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
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    try {
      // Verify the token with Clerk using JWT verification
      const jwtSecret = process.env.CLERK_SECRET_KEY;
      
      if (!jwtSecret) {
        console.error('CLERK_SECRET_KEY not configured');
        return res.status(500).json({ error: 'Authentication configuration error' });
      }

      // Verify the token with Clerk
      const decoded = await verifyToken(token, {
        jwtKey: jwtSecret
      });

      // Extract user information from decoded token
      const userId = (decoded as any).user_id || (decoded as any).sub;
      const email = (decoded as any).email;
      const firstName = (decoded as any).first_name || (decoded as any).given_name;
      const lastName = (decoded as any).last_name || (decoded as any).family_name;

      if (!userId || !email) {
        return res.status(401).json({ error: 'Invalid token payload' });
      }

      // Check if user exists in our database, create if not
      let dbUser = await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true
        }
      });

      // If user doesn't exist, create them (first time login)
      if (!dbUser) {
        dbUser = await prisma.user.create({
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
        id: dbUser.id,
        email: dbUser.email,
        firstName: dbUser.firstName || undefined,
        lastName: dbUser.lastName || undefined
      };
      next();
    } catch (clerkError) {
      console.error('Clerk session verification failed:', clerkError);
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
