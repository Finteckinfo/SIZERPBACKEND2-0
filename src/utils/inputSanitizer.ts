/**
 * Input Sanitization and Validation Utilities
 * Prevents injection attacks, validates data integrity, and enforces security constraints
 */

import validator from 'validator';

/**
 * Sanitize string input - removes dangerous characters
 */
export function sanitizeString(input: string): string {
  if (!input) return '';
  
  // Remove null bytes
  let sanitized = input.replace(/\0/g, '');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Limit length to prevent DoS
  if (sanitized.length > 10000) {
    sanitized = sanitized.substring(0, 10000);
  }
  
  return sanitized;
}

/**
 * Validate and sanitize email
 */
export function sanitizeEmail(email: string): string | null {
  if (!email) return null;
  
  const sanitized = sanitizeString(email).toLowerCase();
  
  if (!validator.isEmail(sanitized)) {
    return null;
  }
  
  // Additional checks
  if (sanitized.length > 254) return null; // RFC 5321
  if (sanitized.includes('..')) return null; // Consecutive dots
  if (sanitized.startsWith('.')) return null; // Leading dot
  if (sanitized.endsWith('.')) return null; // Trailing dot
  
  return sanitized;
}

/**
 * Validate password strength
 */
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!password) {
    return { valid: false, errors: ['Password is required'] };
  }
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters');
  }
  
  if (password.length > 128) {
    errors.push('Password must be less than 128 characters');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  // Check for common weak passwords
  const weakPasswords = [
    'password', 'password123', '12345678', 'qwerty', 'abc123',
    'monkey', '1234567890', 'letmein', 'trustno1', 'dragon',
    'baseball', 'iloveyou', 'master', 'sunshine', 'ashley',
    'bailey', 'passw0rd', 'shadow', '123123', '654321'
  ];
  
  if (weakPasswords.includes(password.toLowerCase())) {
    errors.push('Password is too common. Please choose a stronger password');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate wallet address
 */
export function validateWalletAddress(address: string, chainId?: number): { valid: boolean; error?: string } {
  if (!address) {
    return { valid: false, error: 'Wallet address is required' };
  }
  
  const sanitized = sanitizeString(address);
  
  // Ethereum/EVM chains
  if (!chainId || chainId === 1 || chainId === 5 || chainId === 137 || chainId === 80001) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(sanitized)) {
      return { valid: false, error: 'Invalid Ethereum address format' };
    }
  }
  
  // Algorand
  else if (chainId === 416001 || chainId === 416002) {
    if (!/^[A-Z2-7]{58}$/.test(sanitized)) {
      return { valid: false, error: 'Invalid Algorand address format' };
    }
  }
  
  return { valid: true };
}

/**
 * Sanitize URL - prevents open redirect and SSRF
 */
export function sanitizeURL(url: string): string | null {
  if (!url) return null;
  
  const sanitized = sanitizeString(url);
  
  if (!validator.isURL(sanitized, {
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
    allow_underscores: false
  })) {
    return null;
  }
  
  // Prevent localhost/internal network access
  const urlObj = new URL(sanitized);
  const hostname = urlObj.hostname.toLowerCase();
  
  const blockedHosts = [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '[::]',
    '[::1]'
  ];
  
  if (blockedHosts.includes(hostname)) {
    console.warn('[Security] Blocked localhost URL:', hostname);
    return null;
  }
  
  // Block internal IP ranges
  if (hostname.match(/^10\./) || 
      hostname.match(/^172\.(1[6-9]|2[0-9]|3[01])\./) ||
      hostname.match(/^192\.168\./)) {
    console.warn('[Security] Blocked internal network URL:', hostname);
    return null;
  }
  
  return sanitized;
}

/**
 * Sanitize and validate JSON input
 */
export function sanitizeJSON(input: string, maxSize: number = 100000): { valid: boolean; data?: any; error?: string } {
  if (!input) {
    return { valid: false, error: 'Empty JSON input' };
  }
  
  if (input.length > maxSize) {
    return { valid: false, error: 'JSON input too large' };
  }
  
  try {
    const data = JSON.parse(input);
    return { valid: true, data };
  } catch (err) {
    return { valid: false, error: 'Invalid JSON format' };
  }
}

/**
 * Validate numeric input with range
 */
export function validateNumber(input: any, min?: number, max?: number): { valid: boolean; value?: number; error?: string } {
  const num = Number(input);
  
  if (isNaN(num)) {
    return { valid: false, error: 'Invalid number' };
  }
  
  if (!isFinite(num)) {
    return { valid: false, error: 'Number must be finite' };
  }
  
  if (min !== undefined && num < min) {
    return { valid: false, error: `Number must be at least ${min}` };
  }
  
  if (max !== undefined && num > max) {
    return { valid: false, error: `Number must be at most ${max}` };
  }
  
  return { valid: true, value: num };
}

/**
 * Sanitize filename for safe storage
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return 'unnamed';
  
  let sanitized = sanitizeString(filename);
  
  // Remove path traversal attempts
  sanitized = sanitized.replace(/\.\./g, '');
  sanitized = sanitized.replace(/[\/\\]/g, '');
  
  // Remove dangerous characters
  sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  // Limit length
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }
  
  // Ensure not empty after sanitization
  if (!sanitized || sanitized === '') {
    sanitized = 'unnamed';
  }
  
  return sanitized;
}

/**
 * Validate and sanitize date string
 */
export function sanitizeDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  const sanitized = sanitizeString(dateStr);
  
  if (!validator.isISO8601(sanitized)) {
    return null;
  }
  
  const date = new Date(sanitized);
  
  if (isNaN(date.getTime())) {
    return null;
  }
  
  // Reject dates too far in past or future (sanity check)
  const minDate = new Date('1900-01-01');
  const maxDate = new Date('2100-12-31');
  
  if (date < minDate || date > maxDate) {
    return null;
  }
  
  return date;
}

/**
 * Rate limit key generation (for consistent hashing)
 */
export function generateRateLimitKey(identifier: string, scope: string): string {
  const sanitizedId = sanitizeString(identifier);
  const sanitizedScope = sanitizeString(scope);
  return `ratelimit:${sanitizedScope}:${sanitizedId}`;
}

/**
 * Validate UUID format
 */
export function validateUUID(uuid: string): boolean {
  if (!uuid) return false;
  return validator.isUUID(uuid);
}

/**
 * SQL injection detection (defense in depth - Prisma already protects)
 */
export function detectSQLInjection(input: string): boolean {
  if (!input) return false;
  
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/i,
    /(union.*select)/i,
    /(or\s+1\s*=\s*1)/i,
    /(and\s+1\s*=\s*1)/i,
    /('|")\s*(or|and)\s*('|")/i,
    /(--|#|\/\*)/,
    /(\bxp_\w+)/i,
    /(\bsp_\w+)/i
  ];
  
  for (const pattern of sqlPatterns) {
    if (pattern.test(input)) {
      console.warn('[Security] Potential SQL injection detected:', input.substring(0, 50));
      return true;
    }
  }
  
  return false;
}

/**
 * XSS detection (defense in depth)
 */
export function detectXSS(input: string): boolean {
  if (!input) return false;
  
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /<iframe\b/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /<object\b/gi,
    /<embed\b/gi
  ];
  
  for (const pattern of xssPatterns) {
    if (pattern.test(input)) {
      console.warn('[Security] Potential XSS detected:', input.substring(0, 50));
      return true;
    }
  }
  
  return false;
}

/**
 * Comprehensive input validation
 */
export function validateInput(input: string, type: 'email' | 'password' | 'wallet' | 'url' | 'string' = 'string'): { valid: boolean; sanitized?: string; errors?: string[] } {
  if (detectSQLInjection(input)) {
    return { valid: false, errors: ['Invalid input: potential SQL injection'] };
  }
  
  if (detectXSS(input)) {
    return { valid: false, errors: ['Invalid input: potential XSS'] };
  }
  
  switch (type) {
    case 'email':
      const email = sanitizeEmail(input);
      return email ? { valid: true, sanitized: email } : { valid: false, errors: ['Invalid email format'] };
    
    case 'password':
      const pwdValidation = validatePassword(input);
      return pwdValidation.valid ? { valid: true, sanitized: input } : { valid: false, errors: pwdValidation.errors };
    
    case 'wallet':
      const walletValidation = validateWalletAddress(input);
      return walletValidation.valid ? { valid: true, sanitized: input } : { valid: false, errors: [walletValidation.error || 'Invalid wallet'] };
    
    case 'url':
      const url = sanitizeURL(input);
      return url ? { valid: true, sanitized: url } : { valid: false, errors: ['Invalid URL'] };
    
    case 'string':
    default:
      return { valid: true, sanitized: sanitizeString(input) };
  }
}
