import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { verifyToken, createClerkClient } from '@clerk/backend';

const prisma = new PrismaClient();
const clerk = (createClerkClient as any)({
	secretKey: process.env.CLERK_SECRET_KEY,
	publishableKey: process.env.CLERK_PUBLISHABLE_KEY
});

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

		const token = authHeader.substring(7);

		try {
			// Attempt JWT verification using preferred key sources
			const jwtKey = process.env.CLERK_JWT_KEY; // PEM public key for RS256
			const jwksUrl = process.env.CLERK_JWKS_URL; // Optional JWKS endpoint
			const issuer = process.env.CLERK_ISSUER_URL; // Optional issuer

			if (!jwtKey && !jwksUrl && !process.env.CLERK_SECRET_KEY) {
				console.error('No verification material configured (CLERK_JWT_KEY, CLERK_JWKS_URL, or CLERK_SECRET_KEY)');
				return res.status(500).json({ error: 'Authentication configuration error' });
			}

			let decoded: any | null = null;
			let lastError: unknown = null;

			// 1) Try public key (fast path for RS256)
			if (!decoded && jwtKey) {
				try {
					decoded = await verifyToken(token, { jwtKey });
				} catch (e) {
					lastError = e;
				}
			}

			// 2) Try JWKS URL if provided
			if (!decoded && jwksUrl) {
				try {
					decoded = await verifyToken(token, { jwksUrl } as any);
				} catch (e) {
					lastError = e;
				}
			}

			// 3) Fallback: secret key (for HS256 templates)
			if (!decoded && process.env.CLERK_SECRET_KEY) {
				try {
					decoded = await verifyToken(token, { jwtKey: process.env.CLERK_SECRET_KEY! });
				} catch (e) {
					lastError = e;
				}
			}

			if (!decoded) {
				console.error('Token verification failed:', lastError);
				return res.status(401).json({ error: 'Invalid or expired token' });
			}

			// Extract fields with robust fallbacks
			const userId: string | undefined =
				decoded.user_id || decoded.sub || decoded.user || decoded.id;
			let email: string | undefined =
				decoded.email || decoded.email_address || decoded.emailAddress;
			let firstName: string | undefined =
				decoded.first_name || decoded.given_name || decoded.firstName || decoded.firstname;
			let lastName: string | undefined =
				decoded.last_name || decoded.family_name || decoded.lastName || decoded.lastname;

			if (!userId) {
				console.error('Token payload missing user id fields');
				return res.status(401).json({ error: 'Invalid token payload' });
			}

			// If email is missing in JWT, fetch from Clerk as a fallback
			if (!email && clerk) {
				try {
					const clerkUser = await (clerk.users.getUser as any)(userId);
					email = clerkUser?.emailAddresses?.[0]?.emailAddress;
					if (!firstName) firstName = clerkUser?.firstName ?? undefined;
					if (!lastName) lastName = clerkUser?.lastName ?? undefined;
				} catch (e) {
					console.warn('Failed to fetch user from Clerk for email fallback');
				}
			}

			if (!email) {
				return res.status(401).json({ error: 'Invalid token payload' });
			}

			// Ensure user exists in our DB
			let dbUser = await prisma.user.findUnique({
				where: { email },
				select: { id: true, email: true, firstName: true, lastName: true }
			});

			if (!dbUser) {
				// Create user on first login
				dbUser = await prisma.user.create({
					data: {
						id: userId,
						email,
						firstName: firstName || null,
						lastName: lastName || null
					},
					select: { id: true, email: true, firstName: true, lastName: true }
				});
			}

			req.user = {
				id: dbUser.id,
				email: dbUser.email,
				firstName: dbUser.firstName || undefined,
				lastName: dbUser.lastName || undefined
			};
			return next();
		} catch (err) {
			console.error('Auth middleware error:', err);
			return res.status(401).json({ error: 'Invalid or expired token' });
		}
	} catch (error) {
		console.error('Auth middleware fatal error:', error);
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
