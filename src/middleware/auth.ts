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
    
    // Log token for debugging (remove in production)
    console.log('Received token:', token.substring(0, 20) + '...');
    
    try {
      // First, try to verify as JWT token
      const jwtKey = process.env.CLERK_JWT_KEY;
      const secretKey = process.env.CLERK_SECRET_KEY;
      
      if (!jwtKey && !secretKey) {
        console.error('Neither CLERK_JWT_KEY nor CLERK_SECRET_KEY configured');
        return res.status(500).json({ error: 'Authentication configuration error' });
      }

      console.log('Attempting JWT verification...');
      console.log('JWT Key available:', !!jwtKey);
      console.log('Secret Key available:', !!secretKey);

      // Verify the token with Clerk
      const decoded = await verifyToken(token, {
        jwtKey: jwtKey || secretKey
      });

      console.log('JWT verification successful, decoded:', JSON.stringify(decoded, null, 2));
      console.log('Available fields in token:', Object.keys(decoded as any));

      // Extract user information from decoded token
      const userId = (decoded as any).user_id || (decoded as any).sub || (decoded as any).user || (decoded as any).id;
      const email = (decoded as any).email || (decoded as any).email_address || (decoded as any).emailAddress;
      const firstName = (decoded as any).first_name || (decoded as any).given_name || (decoded as any).firstName || (decoded as any).firstname;
      const lastName = (decoded as any).last_name || (decoded as any).family_name || (decoded as any).lastName || (decoded as any).lastname;
      
      console.log('Extracted fields:', { userId, email, firstName, lastName });

      if (!userId || !email) {
        console.error('Missing required fields in token:', { userId, email });
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
      console.error('Clerk token verification failed:', clerkError);
      console.error('Error details:', {
        message: (clerkError as any).message,
        name: (clerkError as any).name,
        stack: (clerkError as any).stack
      });
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
