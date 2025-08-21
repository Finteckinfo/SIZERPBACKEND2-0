import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { verifyToken, createClerkClient } from '@clerk/backend';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const clerk = (createClerkClient as any)({
	secretKey: process.env.CLERK_SECRET_KEY,
	publishableKey: process.env.CLERK_PUBLISHABLE_KEY
});

// Note: JWKS retrieval is handled by @clerk/backend verifyToken

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
			// Verify JWT token with proper validation
			const jwksUrl = process.env.CLERK_JWKS_URL;
			const issuer = process.env.CLERK_ISSUER_URL;
			const audience = process.env.CLERK_AUDIENCE || 'https://sizerpbackend2-0-production.up.railway.app';
			const skipAudience = process.env.SKIP_AUDIENCE_VALIDATION === 'true';
			const skipIssuer = process.env.SKIP_ISSUER_VALIDATION === 'true';

			if (!jwksUrl) {
				console.error('CLERK_JWKS_URL not configured');
				return res.status(500).json({ error: 'Authentication configuration error' });
			}

			let decoded: any | null = null;
			let lastError: unknown = null;

			// Log incoming token claims (decoded without verification) for debugging
			try {
				const unsafePayloadJson = Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8');
				const unsafePayload = JSON.parse(unsafePayloadJson);
				console.log('[Auth] Incoming token iss:', unsafePayload.iss, 'aud:', unsafePayload.aud);
			} catch {
				// ignore decoding errors
			}
			console.log('[Auth] Verification options:', { issuer, audience, jwksUrl, skipAudience, skipIssuer });

			// Method 1: Try JWKS verification (recommended for RS256 tokens)
			if (!decoded && jwksUrl) {
				try {
					console.log('Attempting JWT verification with JWKS:', jwksUrl);
					// Verify token using JWKS with proper validation
					const options: any = { jwksUrl, clockSkewInMs: 30000 };
					if (!skipIssuer) options.issuer = issuer;
					if (!skipAudience) options.audience = audience;
					decoded = await verifyToken(token, options);
					
					console.log('JWKS verification successful');
				} catch (e) {
					lastError = e;
					console.error('JWKS verification failed:', e);
				}
			}

			// Method 2: (Disabled) Manual verification using CLERK_JWKS_PUBLIC_KEY unless it's a valid PEM
			// Rely on JWKS above for RS256. Uncomment guarded fallback if you provide a proper PEM-formatted public key.
			// if (!decoded && process.env.CLERK_JWKS_PUBLIC_KEY?.includes('BEGIN PUBLIC KEY')) {
			// 	try {
			// 		console.log('Attempting JWT verification with PEM public key fallback');
			// 		decoded = jwt.verify(token, process.env.CLERK_JWKS_PUBLIC_KEY, {
			// 			algorithms: ['RS256'],
			// 			issuer,
			// 			audience,
			// 			clockTolerance: 30
			// 		});
			// 		console.log('PEM public key verification successful');
			// 	} catch (e) {
			// 		lastError = e;
			// 		console.error('PEM public key verification failed:', e);
			// 	}
			// }

			// Method 3: Fallback to secret key (for HS256 templates if needed)
			if (!decoded && process.env.CLERK_SECRET_KEY) {
				try {
					console.log('Attempting JWT verification with secret key fallback');
					const secretOptions: any = { jwtKey: process.env.CLERK_SECRET_KEY!, clockSkewInMs: 30000 };
					if (!skipIssuer) secretOptions.issuer = issuer;
					if (!skipAudience) secretOptions.audience = audience;
					decoded = await verifyToken(token, secretOptions);
					console.log('Secret key verification successful');
				} catch (e) {
					lastError = e;
					console.error('Secret key verification failed:', e);
				}
			}

			if (!decoded) {
				console.error('All token verification methods failed. Last error:', lastError);
				return res.status(401).json({
					error: 'Invalid or expired token',
					...(process.env.NODE_ENV !== 'production'
						? { details: (lastError as any)?.message || String(lastError) }
						: {})
				});
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
