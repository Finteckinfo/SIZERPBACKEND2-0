import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

// NextAuth secret for JWT validation
const NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'fallback-nextauth-secret-change-in-production';

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

/**
 * NextAuth JWT-based authentication middleware
 * Validates session token from cookies and syncs user to database
 */
export const authenticateToken = async (req: Request, res: Response, next: NextFunction) => {
	try {
		// 1) Get NextAuth session token from cookies
		const token =
			req.cookies?.['next-auth.session-token'] ||
			req.cookies?.['__Secure-next-auth.session-token'];

		if (!token) {
			return res.status(401).json({ error: 'No session token provided' });
		}

		// 2) Verify NextAuth JWT
		let decoded: any;
		try {
			decoded = jwt.verify(token, NEXTAUTH_SECRET);
		} catch (err) {
			console.error('[Auth] JWT verification failed:', err);
			return res.status(401).json({ error: 'Invalid or expired session token' });
		}

		// 3) Extract user info from token
		const email = decoded.email;
		const sub = decoded.sub || decoded.id;
		const name = decoded.name;

		if (!email) {
			return res.status(401).json({ error: 'Session token missing email' });
		}

		// 4) Sync / fetch user in Prisma
		try {
			let dbUser = await prisma.user.findUnique({
				where: { email },
				select: { id: true, email: true, firstName: true, lastName: true }
			});

			if (!dbUser) {
				// Create user from NextAuth session
				const nameParts = name ? name.split(' ') : [];
				dbUser = await prisma.user.create({
					data: {
						id: sub,
						email,
						firstName: nameParts[0] || null,
						lastName: nameParts.slice(1).join(' ') || null,
					},
					select: { id: true, email: true, firstName: true, lastName: true }
				});
				console.log('[Auth] Created new user from NextAuth session:', email);
			}

			req.user = {
				id: dbUser.id,
				email: dbUser.email,
				firstName: dbUser.firstName || undefined,
				lastName: dbUser.lastName || undefined,
			};

			return next();
		} catch (dbErr) {
			console.error('[Auth] Database error:', dbErr);
			return res.status(503).json({ error: 'Service unavailable', details: 'Database error' });
		}
	} catch (error) {
		console.error('[Auth] Middleware fatal error:', error);
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
