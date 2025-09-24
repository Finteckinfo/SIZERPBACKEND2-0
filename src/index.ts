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
import webhookRouter from "./routes/webhook.js";
import authRouter from "./routes/auth.js";
import walletRouter from "./routes/wallet.js";
import dashboardRouter from "./routes/dashboard.js";
import userRouter from "./routes/user.js";

import configRouter from "./routes/config.js";
import usersRouter from "./routes/users.js";
import projectsRouter from "./routes/projects.js";
import departmentsRouter from "./routes/departments.js";
import rolesRouter from "./routes/roles.js";
import invitesRouter from "./routes/invites.js";
import userRolesRouter from "./routes/user-roles.js";
import tasksRouter from "./routes/tasks.js";
import roleAwareRouter from "./routes/role-aware.js";
import analyticsRouter from "./routes/analytics.js";
import { initializeWebSocket } from "./services/websocket.js";
import { createServer } from 'http';

dotenv.config();
const app = express();

// Webhooks (raw body required) must be mounted before JSON body parser
app.use("/clerk", webhookRouter);

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

// Security middleware only on app routes
app.use("/app", securityMiddleware);

// Webhooks mounted earlier to preserve raw body



// Configuration routes
app.use("/api/config", configRouter);

// User management routes
app.use("/api/users", usersRouter);

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

// Dashboard routes with rate limiting and query optimization
app.use("/api/dashboard", rateLimiter(200, 60000), queryOptimizer, dashboardRouter);

// User routes with rate limiting and query optimization
app.use("/api/user", rateLimiter(200, 60000), queryOptimizer, userRouter);

const PORT = process.env.PORT || 3000;
const server = createServer(app);

// Initialize WebSocket server
initializeWebSocket(server);

server.listen(PORT, () => {
  console.log(`[Server] HTTP and WebSocket server running on port ${PORT}`);
});
