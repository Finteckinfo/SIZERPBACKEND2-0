import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { prisma } from '../utils/prisma.js';
import { getSecurityConfig, validateJWTClaims } from '../config/security.js';
import { tokenBlacklist } from '../utils/tokenBlacklist.js';
import { securityMonitor } from '../utils/securityMonitor.js';

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
		// 1) Get NextAuth session token from Authorization header (preferred) or cookies
		const authHeader = req.headers['authorization'] || req.headers['Authorization'];
		let token: string | undefined;

		if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
			token = authHeader.slice(7).trim();
		}

		if (!token) {
			token =
				req.cookies?.['next-auth.session-token'] ||
				req.cookies?.['__Secure-next-auth.session-token'];
		}

		if (!token) {
			return res.status(401).json({ error: 'No session token provided' });
		}

		// 1.5) Check IP rate limiting
		const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
		if (securityMonitor.isIPRateLimited(clientIP)) {
			console.warn('[Security] IP rate limited:', clientIP);
			return res.status(429).json({ error: 'Too many requests. Please try again later.' });
		}

		// 2) Check if token is blacklisted
		if (tokenBlacklist.isBlacklisted(token)) {
			console.warn('[Security] Attempt to use blacklisted token');
			return res.status(401).json({ error: 'Session has been revoked' });
		}

		// 3) Verify NextAuth JWT with explicit algorithm
		const securityConfig = getSecurityConfig();
		let decoded: any;
		try {
			decoded = jwt.verify(token, securityConfig.nextAuthSecret, {
				algorithms: [securityConfig.jwtAlgorithm], // Prevent algorithm confusion attacks
				maxAge: securityConfig.maxTokenAge + 's'
			});
		} catch (err) {
			console.error('[Auth] JWT verification failed:', err);
			// Record failed attempt (use email from token payload if available)
			const userAgent = req.headers['user-agent'] || 'unknown';
			const clientIP = req.ip || req.socket.remoteAddress || 'unknown';
			if ((err as any).message?.includes('jwt')) {
				try {
					const partial = jwt.decode(token) as any;
					if (partial?.email) {
						securityMonitor.recordAttempt(partial.email, false, clientIP, userAgent);
					}
				} catch {}
			}
			return res.status(401).json({ error: 'Invalid or expired session token' });
		}

		// 4) Validate JWT claims
		const claimValidation = validateJWTClaims(decoded);
		if (!claimValidation.valid) {
			console.error('[Auth] Invalid JWT claims:', claimValidation.error);
			return res.status(401).json({ error: 'Invalid session token: ' + claimValidation.error });
		}

		// 5) Extract user info from token
		const email = decoded.email;
		const sub = decoded.sub || decoded.id;
		const name = decoded.name;

		if (!email) {
			return res.status(401).json({ error: 'Session token missing email' });
		}

		// 5.5) Check account lockout
		if (securityMonitor.isAccountLocked(sub || email)) {
			console.warn('[Security] Attempt to access locked account:', email);
			return res.status(423).json({ error: 'Account temporarily locked due to security concerns' });
		}

		// 6) Sync / fetch user in Prisma
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

			// Record successful authentication
			const userAgent = req.headers['user-agent'] || 'unknown';
			securityMonitor.recordAttempt(dbUser.id, true, clientIP, userAgent);

			return next();
		} catch (dbErr) {
			console.error('[Auth] Database error:', dbErr);
			// Don't leak database details
			return res.status(503).json({ error: 'Service unavailable' });
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
