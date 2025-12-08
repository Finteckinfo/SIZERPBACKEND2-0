import { fileURLToPath } from 'url';
import path from 'path';
import { beforeAll, afterAll, vi } from 'vitest';
import dotenv from 'dotenv';
import { prisma } from './src/utils/prisma.js';

// Load env from .env.test if available, fallback to .env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env.test') });

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.NEXTAUTH_SECRET =
  process.env.NEXTAUTH_SECRET || 'test-nextauth-secret-please-change-this-in-prod';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-jwt-secret-please-change-this-in-prod';

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(async () => {
  await prisma.$disconnect();
  vi.restoreAllMocks();
});
