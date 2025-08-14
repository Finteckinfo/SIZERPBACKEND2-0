import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { logger } from "./middleware/logger.js";
import { securityMiddleware } from "./middleware/security.js";
import webhookRouter from "./routes/webhook.js";

dotenv.config();
const app = express();

// Parse cookies for CSRF
app.use(cookieParser());

// Logging middleware
app.use(logger);

// Security middleware (helmet + csrf) - apply only to app routes
app.use("/app", securityMiddleware);

// Webhook route (no CSRF here) — mounted directly at /clerk
app.use("/clerk", webhookRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});
