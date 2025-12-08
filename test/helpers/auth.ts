import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { getSecurityConfig } from '../../src/config/security.js';

export function buildAuthCookies(payload: Partial<{ id: string; email: string; name: string }> = {}) {
  const config = getSecurityConfig();
  const now = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    {
      sub: payload.id || 'test-user',
      email: payload.email || 'owner@siz.land',
      name: payload.name || 'Test Owner',
      iat: now,
      exp: now + config.maxTokenAge - 60,
    },
    config.nextAuthSecret,
    { algorithm: config.jwtAlgorithm }
  );

  return [
    `next-auth.session-token=${token}; Path=/; HttpOnly`,
    `__Secure-next-auth.session-token=${token}; Path=/; HttpOnly`,
  ];
}

export function injectAuthCookies(res: Response, cookies: string[]) {
  res.setHeader('Set-Cookie', cookies);
}
