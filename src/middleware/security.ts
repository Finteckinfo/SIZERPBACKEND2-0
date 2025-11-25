import { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import csrf from "csurf";
import cors from "cors";

// Get allowed origins from environment variable
const getAllowedOrigins = (): string[] => {
  const envOrigins = process.env.CORS_ORIGINS || '';
  const origins = envOrigins.split(',').map(o => o.trim()).filter(Boolean);

  const defaultOrigins = [
    "https://sizerp-2-0.vercel.app",
    "https://siz.land",
    "https://erp.siz.land",
    "https://www.siz.land"
  ];

  // Merge and deduplicate to ensure critical domains are always allowed
  return Array.from(new Set([...origins, ...defaultOrigins]));
};

export const corsMiddleware = cors({
  origin: function (origin, callback) {
    // Get allowed origins dynamically (after dotenv loads)
    const allowedOrigins = getAllowedOrigins();

    // Allow requests with no origin only in development (like curl, Postman)
    if (!origin && process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    // In production, always require an origin
    if (!origin && process.env.NODE_ENV === 'production') {
      console.warn('[CORS] Blocked request with no origin in production');
      return callback(new Error("Not allowed by CORS"));
    }

    if (allowedOrigins.includes(origin!)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "X-Requested-With"],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 200,
  maxAge: 86400 // 24 hours
});

// Enhanced security headers with helmet (apply globally)
export const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

// CSRF protection (only for /app routes, not API)
export const csrfMiddleware = csrf({
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
});

// Combined security middleware for /app routes
export const securityMiddleware = [helmetMiddleware, csrfMiddleware];
