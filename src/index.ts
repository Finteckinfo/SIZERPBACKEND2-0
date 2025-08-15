// src/index.ts
import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import { logger } from "./middleware/logger.js";
import { securityMiddleware } from "./middleware/security.js";
import webhookRouter from "./routes/webhook.js";
import walletRouter from "./routes/wallet.js"; // <-- import wallet route

dotenv.config();
const app = express();

// Parse JSON and cookies
app.use(express.json()); // parse JSON bodies
app.use(cookieParser());

// Logging middleware
app.use(logger);

// Security middleware (helmet + csrf) - apply only to app routes
app.use("/app", securityMiddleware);

// Webhook route (no CSRF here) — mounted directly at /clerk
app.use("/clerk", webhookRouter);

// Wallet route — mounted at /api/user/wallet
app.use("/api/user/wallet", walletRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`);
});
