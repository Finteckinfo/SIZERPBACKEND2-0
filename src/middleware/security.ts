import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import csrf from "csurf";
import cors from "cors";

// Allow only your production site
const allowedOrigins = [
  "https://sizerp-2-0.vercel.app"
];

export const corsMiddleware = cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
});

export const securityMiddleware = [
  helmet(),
  csrf({ cookie: true })
];
