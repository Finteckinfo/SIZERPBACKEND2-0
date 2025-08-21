import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { verifyToken, createClerkClient } from '@clerk/backend';
import jwt from 'jsonwebtoken';

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
			// Log incoming token for debugging
			console.log('[Auth] Verifying token with length:', token.length);
			
			// Decode token header to check algorithm
			try {
				const headerJson = Buffer.from(token.split('.')[0] || '', 'base64').toString('utf8');
				const header = JSON.parse(headerJson);
				console.log('[Auth] Token header alg:', header.alg, 'kid:', header.kid);
			} catch (e) {
				console.log('[Auth] Could not decode token header');
			}

			// Decode token payload (without verification) for debugging
			try {
				const payloadJson = Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8');
				const payload = JSON.parse(payloadJson);
				console.log('[Auth] Token claims - iss:', payload.iss, 'aud:', payload.aud, 'sub:', payload.sub);
			} catch (e) {
				console.log('[Auth] Could not decode token payload');
			}

			// Get verification options from environment
			const jwksUrl = process.env.CLERK_JWKS_URL;
			const issuer = process.env.CLERK_ISSUER_URL;
			const audience = process.env.CLERK_AUDIENCE;

			console.log('[Auth] Verification config:', { 
				jwksUrl: jwksUrl ? 'configured' : 'missing',
				issuer: issuer ? 'configured' : 'missing', 
				audience: audience ? 'configured' : 'missing'
			});

			if (!jwksUrl) {
				console.error('CLERK_JWKS_URL not configured');
				return res.status(500).json({ error: 'Authentication configuration error' });
			}

			// Verify token using JWKS (RS256)
			const decoded = await verifyToken(token, {
				clockSkewInMs: 30000
			});

			console.log('[Auth] Token verification successful');

			// Extract user information with proper type handling
			const userId = (decoded as any).sub || (decoded as any).user_id;
			const email = (decoded as any).email;
			const firstName = (decoded as any).first_name || (decoded as any).given_name;
			const lastName = (decoded as any).last_name || (decoded as any).family_name;

			if (!userId || !email) {
				console.error('Token missing required claims:', { userId, email });
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
				console.log('[Auth] Created new user:', dbUser.id);
			}

			req.user = {
				id: dbUser.id,
				email: dbUser.email,
				firstName: dbUser.firstName || undefined,
				lastName: dbUser.lastName || undefined
			};

			return next();
		} catch (err) {
			console.error('[Auth] Token verification failed:', err);
			return res.status(401).json({ 
				error: 'Invalid or expired token',
				...(process.env.NODE_ENV !== 'production' ? { details: (err as any)?.message } : {})
			});
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
