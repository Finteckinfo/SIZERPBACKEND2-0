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
import walletRouter from "./routes/wallet.js";
import dashboardRouter from "./routes/dashboard.js";
import userRouter from "./routes/user.js";

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

// Apply CORS globally (before routes)
app.use(corsMiddleware);

// Security middleware only on app routes
app.use("/app", securityMiddleware);

// Webhooks (no CSRF)
app.use("/clerk", webhookRouter);

// Wallet routes
app.use("/api/user/wallet", walletRouter);

// Dashboard routes with rate limiting and query optimization
app.use("/api/dashboard", rateLimiter(200, 60000), queryOptimizer, dashboardRouter);

// User routes with rate limiting and query optimization
app.use("/api/user", rateLimiter(200, 60000), queryOptimizer, userRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});
