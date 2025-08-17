import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { logger } from "./middleware/logger.js";
import { corsMiddleware, securityMiddleware } from "./middleware/security.js";
import webhookRouter from "./routes/webhook.js";
import walletRouter from "./routes/wallet.js";
import dashboardRouter from "./routes/dashboard.js";

dotenv.config();
const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(logger);

// Apply CORS globally (before routes)
app.use(corsMiddleware);

// Security middleware only on app routes
app.use("/app", securityMiddleware);

// Webhooks (no CSRF)
app.use("/clerk", webhookRouter);

// Wallet routes
app.use("/api/user/wallet", walletRouter);

// Dashboard routes
app.use("/api/dashboard", dashboardRouter);
app.use("/api/user", dashboardRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});
