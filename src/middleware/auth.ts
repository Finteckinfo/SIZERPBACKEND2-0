import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Role } from '@prisma/client';

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

    // For now, we'll use a simple approach where the token contains the user ID
    // In a production environment, you should verify JWT tokens properly
    // This is a placeholder implementation - replace with your actual JWT verification
    
    // Option 1: If token is the user ID directly (for development/testing)
    let userId = token;
    
    // Option 2: If you want to implement proper JWT verification later
    // const decoded = jwt.verify(token, process.env.JWT_SECRET!);
    // userId = decoded.userId;

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
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Add user to request object
    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined
    };
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Invalid token' });
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
