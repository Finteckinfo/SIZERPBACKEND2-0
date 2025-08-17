// src/middleware/performance.ts
import { Request, Response, NextFunction } from 'express';
import compression from 'compression';

// Request timing middleware
export const requestTimer = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, url } = req;
    const { statusCode } = res;
    
    // Log slow requests (> 1 second)
    if (duration > 1000) {
      console.warn(`[SLOW REQUEST] ${method} ${url} - ${statusCode} (${duration}ms)`);
    } else {
      console.log(`[REQUEST] ${method} ${url} - ${statusCode} (${duration}ms)`);
    }
  });
  
  next();
};

// Response optimization middleware
export const responseOptimizer = (req: Request, res: Response, next: NextFunction) => {
  // Add performance headers
  res.setHeader('X-Response-Time', '0ms');
  res.setHeader('X-Cache-Control', 'no-cache');
  
  // Enable gzip compression for JSON responses
  if (req.headers.accept?.includes('application/json')) {
    res.setHeader('Content-Encoding', 'gzip');
  }
  
  next();
};

// Compression middleware configuration
export const compressionMiddleware = compression({
  filter: (req, res) => {
    // Don't compress responses with this request header
    if (req.headers['x-no-compression']) {
      return false;
    }
    
    // Fall back to standard filter function
    return compression.filter(req, res);
  },
  level: 6, // Balanced compression level
  threshold: 1024, // Only compress responses larger than 1KB
});

// Query optimization middleware
export const queryOptimizer = (req: Request, res: Response, next: NextFunction) => {
  // Validate and sanitize query parameters
  const { page, limit, userId } = req.query;
  
  // Ensure page is a positive integer
  if (page && (isNaN(Number(page)) || Number(page) < 1)) {
    return res.status(400).json({ error: 'Invalid page parameter' });
  }
  
  // Ensure limit is within reasonable bounds
  if (limit && (isNaN(Number(limit)) || Number(limit) < 1 || Number(limit) > 100)) {
    return res.status(400).json({ error: 'Invalid limit parameter (1-100)' });
  }
  
  // Ensure userId is provided for protected routes
  if (!userId && req.path.includes('/api/')) {
    return res.status(400).json({ error: 'Missing userId parameter' });
  }
  
  next();
};

// Rate limiting helper (basic implementation)
const requestCounts = new Map<string, { count: number; resetTime: number }>();

export const rateLimiter = (maxRequests: number = 100, windowMs: number = 60000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userId = req.query.userId as string || req.ip;
    const now = Date.now();
    
    const userRequests = requestCounts.get(userId);
    
    if (!userRequests || now > userRequests.resetTime) {
      requestCounts.set(userId, { count: 1, resetTime: now + windowMs });
    } else if (userRequests.count >= maxRequests) {
      return res.status(429).json({ 
        error: 'Too many requests',
        retryAfter: Math.ceil((userRequests.resetTime - now) / 1000)
      });
    } else {
      userRequests.count++;
    }
    
    next();
  };
};

// Memory usage monitoring
export const memoryMonitor = (req: Request, res: Response, next: NextFunction) => {
  const memUsage = process.memoryUsage();
  const memUsageMB = {
    rss: Math.round(memUsage.rss / 1024 / 1024),
    heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
    heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
    external: Math.round(memUsage.external / 1024 / 1024),
  };
  
  // Log high memory usage
  if (memUsageMB.heapUsed > 500) { // 500MB threshold
    console.warn(`[HIGH MEMORY] ${JSON.stringify(memUsageMB)}`);
  }
  
  next();
};
