import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { logger } from './middleware/logger.js';
import { corsMiddleware, helmetMiddleware, securityMiddleware } from './middleware/security.js';
import {
  requestTimer,
  responseOptimizer,
  compressionMiddleware,
  queryOptimizer,
  rateLimiter,
  memoryMonitor,
} from './middleware/performance.js';
import authRouter from './routes/auth.js';
import sessionRouter from './routes/session.js';
import walletRouter from './routes/wallet.js';
import dashboardRouter from './routes/dashboard.js';
import userRouter from './routes/user.js';
import configRouter from './routes/config.js';
import usersRouter from './routes/users.js';
import adminUsersRouter from './routes/admin-users.js';
import projectsRouter from './routes/projects.js';
import departmentsRouter from './routes/departments.js';
import rolesRouter from './routes/roles.js';
import invitesRouter from './routes/invites.js';
import userRolesRouter from './routes/user-roles.js';
import tasksRouter from './routes/tasks.js';
import roleAwareRouter from './routes/role-aware.js';
import analyticsRouter from './routes/analytics.js';
import chatRouter from './routes/chat.js';
import escrowRouter from './routes/escrow.js';
import walletsRouter from './routes/wallets.js';
import transactionsRouter from './routes/transactions.js';
import paymentConfigRouter from './routes/payment-config.js';
import recurringPaymentsRouter from './routes/recurring-payments.js';
import escrowEnhancedRouter from './routes/escrow-enhanced.js';
import { setupCspReportRoutes } from './routes/csp-report.js';
import { getRedisClient } from './services/redis.js';

dotenv.config();

export const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(logger);

// Performance middleware
app.use(requestTimer);
app.use(memoryMonitor);
app.use(compressionMiddleware);
app.use(responseOptimizer);

// Apply CORS globally (handles OPTIONS automatically)
app.use(corsMiddleware);

// Apply security headers globally to all routes
app.use(helmetMiddleware);

// Trust proxy when behind Railway/Proxies
app.set('trust proxy', 1);

// Setup CSP report routes
setupCspReportRoutes(app);

// Authentication routes (after middleware setup)
app.use('/api/auth', authRouter);
app.use('/api/auth', sessionRouter);

// Security middleware only on app routes
app.use('/app', securityMiddleware);

// Configuration routes
app.use('/api/config', configRouter);

// User management routes
app.use('/api/users', usersRouter);
app.use('/api/admin/users', adminUsersRouter);

// Wallet routes
app.use('/api/user/wallet', walletRouter);

// Project management routes
app.use('/api/projects', projectsRouter);

// Department management routes
app.use('/api/departments', departmentsRouter);

// Role and invite management routes (nested under projects)
app.use('/api/projects', rolesRouter);

// Project invites routes
app.use('/api/invites', invitesRouter);

// User roles management routes
app.use('/api/user-roles', userRolesRouter);

// Task management routes
app.use('/api/tasks', tasksRouter);

// Role-aware routes
app.use('/api/role-aware', roleAwareRouter);

// Analytics routes
app.use('/api/analytics', analyticsRouter);
app.use('/api/chat', chatRouter);

// Escrow and Payment routes
app.use('/api', escrowRouter);
app.use('/api', walletsRouter);
app.use('/api', transactionsRouter);
app.use('/api', paymentConfigRouter);
app.use('/api', recurringPaymentsRouter);
app.use('/api', escrowEnhancedRouter);

// Dashboard routes with rate limiting and query optimization
app.use('/api/dashboard', rateLimiter(200, 60000), queryOptimizer, dashboardRouter);

// User routes with rate limiting and query optimization
app.use('/api/user', rateLimiter(200, 60000), queryOptimizer, userRouter);

// Redis healthcheck endpoint
app.get('/health/redis', async (_req, res) => {
  try {
    const client = getRedisClient();
    if (!client) {
      return res.status(503).json({
        status: 'unavailable',
        message: 'Redis not configured',
      });
    }

    if (!client.isOpen) {
      return res.status(503).json({
        status: 'disconnected',
        message: 'Redis not connected',
      });
    }

    const pong = await client.ping();
    return res.json({ status: 'ok', pong });
  } catch (e: any) {
    return res.status(500).json({
      status: 'error',
      message: e.message,
    });
  }
});

export default app;
