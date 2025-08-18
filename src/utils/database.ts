// src/utils/database.ts
import { PrismaClient } from '@prisma/client';

// Create a singleton Prisma client with connection pooling
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Database query optimization utilities
export const dbUtils = {
  // Batch queries for better performance
  async batchQuery<T>(
    queries: (() => Promise<T>)[],
    batchSize: number = 10
  ): Promise<T[]> {
    const results: T[] = [];
    
    for (let i = 0; i < queries.length; i += batchSize) {
      const batch = queries.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(query => query()));
      results.push(...batchResults);
    }
    
    return results;
  },

  // Optimized select fields for common queries
  selectFields: {
    projectBasic: {
      id: true,
      name: true,
      description: true,
      type: true,
      createdAt: true,
    },
    projectWithStats: {
      id: true,
      name: true,
      description: true,
      type: true,
      createdAt: true,
      departments: {
        select: {
          id: true,
          tasks: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      },
      userRoles: {
        select: {
          userId: true,
        },
      },
    },
    taskBasic: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
    userBasic: {
      id: true,
      email: true,
    },
  },

  // Cache utilities
  cache: new Map<string, { data: any; timestamp: number; ttl: number }>(),

  getCached<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data as T;
    }
    if (cached) {
      this.cache.delete(key);
    }
    return null;
  },

  setCached(key: string, data: any, ttl: number = 5 * 60 * 1000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
    });
  },

  clearCache(pattern?: string): void {
    if (pattern) {
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  },
};

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

export default prisma;
