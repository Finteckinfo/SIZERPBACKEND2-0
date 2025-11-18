import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/database.js';

// Middleware to verify NextAuth-issued JWT using NEXTAUTH_SECRET
export const requireNextAuthToken = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) {
      console.error('[NextAuth] NEXTAUTH_SECRET is not set');
      return res.status(500).json({ error: 'Server misconfiguration' });
    }

    const decoded = jwt.verify(token, secret) as any;
    // Attach decoded token for downstream handlers
    (req as any).nextAuthToken = decoded;
    next();
  } catch (err: any) {
    console.error('[NextAuth] Token verification failed:', err.message || err);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Middleware to require admin access. Admins are identified by the ADMIN_EMAILS env var
// (comma-separated list). If ADMIN_EMAILS is not set, falls back to checking if the
// user has a PROJECT_OWNER UserRole in the database.
export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Ensure token was verified earlier (or verify here)
    let decoded = (req as any).nextAuthToken as any;
    if (!decoded) {
      // Try to verify now
      const authHeader = req.headers.authorization || '';
      if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided' });
      const token = authHeader.substring(7);
      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) return res.status(500).json({ error: 'Server misconfiguration' });
      decoded = jwt.verify(token, secret) as any;
    }

    const email = decoded?.email as string | undefined;
    if (!email) return res.status(401).json({ error: 'Token missing email claim' });

    const adminEmailsRaw = process.env.ADMIN_EMAILS || '';
    const adminEmails = adminEmailsRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (adminEmails.length > 0 && adminEmails.includes(email.toLowerCase())) {
      // authorized
      return next();
    }

    // Fallback: check DB for a user role that signals admin privileges (PROJECT_OWNER)
    const dbUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!dbUser) return res.status(403).json({ error: 'Access denied' });

    const ownerRole = await prisma.userRole.findFirst({ where: { userId: dbUser.id, role: 'PROJECT_OWNER' } });
    if (ownerRole) return next();

    return res.status(403).json({ error: 'Admin access required' });
  } catch (err: any) {
    console.error('[RequireAdmin] Error:', err.message || err);
    return res.status(500).json({ error: 'Failed to verify admin access' });
  }
};

export default requireAdmin;
