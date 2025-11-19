import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { logger } from "./middleware/logger.js";
import { corsMiddleware, securityMiddleware } from "./middleware/security.js";
import { 
  requestTimer, 
  responseOptimizer, 
  compressionMiddleware, 
  queryOptimizer, 
  rateLimiter, 
  memoryMonitor 
} from "./middleware/performance.js";
import authRouter from "./routes/auth.js";
import sessionRouter from "./routes/session.js";
import walletRouter from "./routes/wallet.js";
import dashboardRouter from "./routes/dashboard.js";
import userRouter from "./routes/user.js";

import configRouter from "./routes/config.js";
import usersRouter from "./routes/users.js";
import adminUsersRouter from "./routes/admin-users.js";
import projectsRouter from "./routes/projects.js";
import departmentsRouter from "./routes/departments.js";
import rolesRouter from "./routes/roles.js";
import invitesRouter from "./routes/invites.js";
import userRolesRouter from "./routes/user-roles.js";
import tasksRouter from "./routes/tasks.js";
import roleAwareRouter from "./routes/role-aware.js";
import analyticsRouter from "./routes/analytics.js";
import chatRouter from "./routes/chat.js";
import escrowRouter from "./routes/escrow.js";
import walletsRouter from "./routes/wallets.js";
import transactionsRouter from "./routes/transactions.js";
import paymentConfigRouter from "./routes/payment-config.js";
import recurringPaymentsRouter from "./routes/recurring-payments.js";
import escrowEnhancedRouter from "./routes/escrow-enhanced.js";
import { initializeWebSocket } from "./services/websocket.js";
import { processRecurringPayments, checkLowBalanceAlerts } from "./services/recurringPaymentProcessor.js";
import { createServer } from 'http';
import { connectRedis, disconnectRedis } from "./services/redis.js";

dotenv.config();
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(logger);

// Performance middleware
app.use(requestTimer);
app.use(memoryMonitor);
app.use(compressionMiddleware);
app.use(responseOptimizer);

// Handle OPTIONS requests before CORS middleware
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.header('Access-Control-Allow-Credentials', 'true');
    return res.sendStatus(200);
  }
  next();
});

// Apply CORS globally (before routes)
app.use(corsMiddleware);

// Trust proxy when behind Railway/Proxies
app.set('trust proxy', 1);

// Authentication routes (after middleware setup)
app.use("/api/auth", authRouter);
app.use("/api/auth", sessionRouter);

// Security middleware only on app routes
app.use("/app", securityMiddleware);

// Webhooks mounted earlier to preserve raw body



// Configuration routes
app.use("/api/config", configRouter);

// User management routes
app.use("/api/users", usersRouter);
// Admin-only user management (secure)
app.use("/api/admin/users", adminUsersRouter);

// Wallet routes
app.use("/api/user/wallet", walletRouter);

// Project management routes
app.use("/api/projects", projectsRouter);

// Department management routes
app.use("/api/departments", departmentsRouter);

// Role and invite management routes (nested under projects)
app.use("/api/projects", rolesRouter);

// Project invites routes
app.use("/api/invites", invitesRouter);

// User roles management routes
app.use("/api/user-roles", userRolesRouter);

// Task management routes
app.use("/api/tasks", tasksRouter);

// Role-aware routes
app.use("/api/role-aware", roleAwareRouter);

// Analytics routes
app.use("/api/analytics", analyticsRouter);
app.use("/api/chat", chatRouter);

// Escrow and Payment routes
app.use("/api", escrowRouter);
app.use("/api", walletsRouter);
app.use("/api", transactionsRouter);
app.use("/api", paymentConfigRouter);
app.use("/api", recurringPaymentsRouter);
app.use("/api", escrowEnhancedRouter);

// Dashboard routes with rate limiting and query optimization
app.use("/api/dashboard", rateLimiter(200, 60000), queryOptimizer, dashboardRouter);

// User routes with rate limiting and query optimization
app.use("/api/user", rateLimiter(200, 60000), queryOptimizer, userRouter);

// Redis healthcheck
import { getRedisClient } from "./services/redis.js";
app.get('/health/redis', async (req, res) => {
	try {
		const client = getRedisClient();
		if (!client) {
			return res.status(503).json({ 
				status: 'unavailable', 
				message: 'Redis not configured' 
			});
		}
		
		if (!client.isOpen) {
			return res.status(503).json({ 
				status: 'disconnected', 
				message: 'Redis not connected' 
			});
		}
		
		const pong = await client.ping();
		return res.json({ status: 'ok', pong });
	} catch (e: any) {
		return res.status(500).json({ 
			status: 'error', 
			message: e.message 
		});
	}
});

const PORT = process.env.PORT || 3000;
const server = createServer(app);

// Connect to Redis, then start server
(async () => {
	try {
		// Try to connect to Redis, but don't fail if it's not available
		const redisClient = await connectRedis();
		if (redisClient) {
			console.log('[Server] Redis connected successfully');
		} else {
			console.warn('[Server] Redis not available - some features may be limited');
		}
		
		initializeWebSocket(server);
		
		// Schedule recurring payment processing (daily at 00:00 UTC)
		const scheduleDailyPayments = () => {
			const now = new Date();
			const midnight = new Date(now);
			midnight.setUTCHours(24, 0, 0, 0);
			const msUntilMidnight = midnight.getTime() - now.getTime();
			
			setTimeout(() => {
				processRecurringPayments().catch(console.error);
				setInterval(() => {
					processRecurringPayments().catch(console.error);
				}, 24 * 60 * 60 * 1000); // Every 24 hours
			}, msUntilMidnight);
		};
		
		// Schedule low balance alerts (daily at 08:00 UTC)
		const scheduleLowBalanceAlerts = () => {
			const now = new Date();
			const eightAM = new Date(now);
			eightAM.setUTCHours(8, 0, 0, 0);
			if (eightAM < now) {
				eightAM.setDate(eightAM.getDate() + 1);
			}
			const msUntilEightAM = eightAM.getTime() - now.getTime();
			
			setTimeout(() => {
				checkLowBalanceAlerts().catch(console.error);
				setInterval(() => {
					checkLowBalanceAlerts().catch(console.error);
				}, 24 * 60 * 60 * 1000); // Every 24 hours
			}, msUntilEightAM);
		};
		
		scheduleDailyPayments();
		scheduleLowBalanceAlerts();
		console.log('[Server] Scheduled recurring payment jobs');
		
		server.listen(PORT, () => {
			console.log(`[Server] HTTP and WebSocket server running on port ${PORT}`);
		});
	} catch (err) {
		console.error('[Server] Failed to start due to Redis error:', err);
		console.log('[Server] Starting server without Redis...');
		
		// Start server anyway, but with limited functionality
		initializeWebSocket(server);
		
		server.listen(PORT, () => {
			console.log(`[Server] HTTP and WebSocket server running on port ${PORT} (Redis disabled)`);
		});
	}
})();

// Graceful shutdown
const shutdown = async () => {
	console.log('[Server] Shutting down...');
	try {
		await disconnectRedis();
	} catch (e) {
		console.error('[Server] Error during shutdown:', e);
	} finally {
		process.exit(0);
	}
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
