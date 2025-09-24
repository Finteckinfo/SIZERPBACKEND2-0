import { Request, Response, NextFunction } from 'express';
import { PrismaClient, Role } from '@prisma/client';
import { createClerkClient } from '@clerk/backend';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const prisma = new PrismaClient();
const clerk = (createClerkClient as any)({
	secretKey: process.env.CLERK_SECRET_KEY,
	publishableKey: process.env.CLERK_PUBLISHABLE_KEY
});

// Resolve JWKS per issuer to support multiple Clerk instances if needed
function getJwksClientForIssuer(issuer: string) {
    const jwksUri = `${issuer.replace(/\/$/, '')}/.well-known/jwks.json`;
    return jwksClient({ jwksUri });
}

function getKeyWithIssuer(issuer: string) {
    const client = getJwksClientForIssuer(issuer);
    return function getKey(header: any, callback: any) {
        client.getSigningKey(header.kid, function(err, key) {
            if (err) {
                callback(err);
                return;
            }
            const signingKey = key?.getPublicKey();
            callback(null, signingKey);
        });
    };
}

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

        // 1) Decode payload to get issuer and audience
        const payloadJson = Buffer.from(token.split('.')[1] || '', 'base64').toString('utf8');
        let unverified: any;
        try {
            unverified = JSON.parse(payloadJson);
        } catch {
            return res.status(401).json({ error: 'Invalid token payload' });
        }

        const tokenIssuer = (unverified?.iss || '').replace(/\/$/, '');
        const expectedIssuer = (process.env.CLERK_ISSUER_URL || '').replace(/\/$/, '');
        if (!tokenIssuer || (expectedIssuer && tokenIssuer !== expectedIssuer)) {
            return res.status(401).json({ error: 'Issuer mismatch' });
        }

        // Audience allowlist: env audience plus any additional allowed values
        const envAudience = (process.env.CLERK_AUDIENCE || '').replace(/\/$/, '');
        const allowedAudiences = new Set<string>([
            envAudience,
            'https://sizerpbackend2-0-production.up.railway.app'
        ].filter(Boolean));

        // 2) Verify signature via JWKS for that issuer
        try {
            const decoded = await new Promise((resolve, reject) => {
                jwt.verify(token, getKeyWithIssuer(tokenIssuer), {
                    issuer: tokenIssuer,
                    audience: Array.from(allowedAudiences) as [string, ...string[]],
                    algorithms: ['RS256'],
                    clockTolerance: 90
                }, (err: any, decoded: any) => {
                    if (err) return reject(err);
                    resolve(decoded);
                });
            });

            // 3) Extract claims
            const userId = (decoded as any).sub || (decoded as any).user_id;
            const email = (decoded as any).email;
            const firstName = (decoded as any).first_name || (decoded as any).given_name;
            const lastName = (decoded as any).last_name || (decoded as any).family_name;

            if (!userId || !email) {
                return res.status(401).json({ error: 'Invalid token payload' });
            }

            // 4) DB user sync (separate error handling -> not 401)
            try {
                let dbUser = await prisma.user.findUnique({
                    where: { email },
                    select: { id: true, email: true, firstName: true, lastName: true }
                });

                if (!dbUser) {
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
            } catch (dbErr) {
                return res.status(503).json({ error: 'Service unavailable', details: 'Database error' });
            }

            return next();
        } catch (verifyErr) {
            return res.status(401).json({ error: 'Invalid or expired token' });
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
