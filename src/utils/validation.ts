import validator from 'validator';

/**
 * Security-focused input validation utilities
 */

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validate email address
 */
export const validateEmail = (email: string): ValidationResult => {
  const errors: string[] = [];
  
  if (!email) {
    errors.push('Email is required');
    return { isValid: false, errors };
  }
  
  // Sanitize and validate
  const sanitized = validator.normalizeEmail(email) || email;
  
  if (!validator.isEmail(sanitized)) {
    errors.push('Invalid email format');
  }
  
  if (sanitized.length > 254) {
    errors.push('Email too long (max 254 characters)');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate password strength
 * Requirements:
 * - Minimum 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export const validatePassword = (password: string): ValidationResult => {
  const errors: string[] = [];
  
  if (!password) {
    errors.push('Password is required');
    return { isValid: false, errors };
  }
  
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  if (password.length > 128) {
    errors.push('Password too long (max 128 characters)');
  }
  
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  // Check for common weak passwords
  const weakPasswords = [
    'password', 'password123', '12345678', 'qwerty', 'abc123',
    'password1', '123456789', 'admin', 'letmein', 'welcome'
  ];
  
  if (weakPasswords.includes(password.toLowerCase())) {
    errors.push('Password is too common');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate wallet address (Ethereum format)
 */
export const validateWalletAddress = (address: string): ValidationResult => {
  const errors: string[] = [];
  
  if (!address) {
    errors.push('Wallet address is required');
    return { isValid: false, errors };
  }
  
  // Ethereum address format (0x + 40 hex characters)
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    errors.push('Invalid wallet address format');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Sanitize string input to prevent XSS
 */
export const sanitizeString = (input: string): string => {
  if (!input) return '';
  
  // Escape HTML entities
  return validator.escape(input.trim());
};

/**
 * Validate and sanitize name fields
 */
export const validateName = (name: string, fieldName: string = 'Name'): ValidationResult => {
  const errors: string[] = [];
  
  if (!name) {
    // Names are optional, but if provided must be valid
    return { isValid: true, errors };
  }
  
  const sanitized = sanitizeString(name);
  
  if (sanitized.length < 1) {
    errors.push(`${fieldName} cannot be empty`);
  }
  
  if (sanitized.length > 100) {
    errors.push(`${fieldName} too long (max 100 characters)`);
  }
  
  // Only allow letters, spaces, hyphens, and apostrophes
  if (!/^[a-zA-Z\s\-']+$/.test(sanitized)) {
    errors.push(`${fieldName} contains invalid characters`);
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Rate limiting helper - stores failed login attempts
 */
interface LoginAttempt {
  count: number;
  lastAttempt: number;
  lockedUntil?: number;
}

const loginAttempts = new Map<string, LoginAttempt>();

// Clean up old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, attempt] of loginAttempts.entries()) {
    // Remove entries older than 1 hour
    if (now - attempt.lastAttempt > 3600000) {
      loginAttempts.delete(key);
    }
  }
}, 600000);

/**
 * Check if login is rate limited
 */
export const checkLoginRateLimit = (identifier: string): { 
  allowed: boolean; 
  remainingTime?: number;
  message?: string;
} => {
  const attempt = loginAttempts.get(identifier);
  const now = Date.now();
  
  if (!attempt) {
    return { allowed: true };
  }
  
  // Check if account is locked
  if (attempt.lockedUntil && now < attempt.lockedUntil) {
    const remainingMs = attempt.lockedUntil - now;
    const remainingMin = Math.ceil(remainingMs / 60000);
    return { 
      allowed: false, 
      remainingTime: remainingMs,
      message: `Account temporarily locked. Try again in ${remainingMin} minute(s)`
    };
  }
  
  // Reset if locked period has passed
  if (attempt.lockedUntil && now >= attempt.lockedUntil) {
    loginAttempts.delete(identifier);
    return { allowed: true };
  }
  
  // Check if too many attempts in short time
  if (attempt.count >= 5 && now - attempt.lastAttempt < 900000) { // 15 minutes
    const remainingMs = 900000 - (now - attempt.lastAttempt);
    const remainingMin = Math.ceil(remainingMs / 60000);
    return { 
      allowed: false, 
      remainingTime: remainingMs,
      message: `Too many failed attempts. Try again in ${remainingMin} minute(s)`
    };
  }
  
  return { allowed: true };
};

/**
 * Record failed login attempt
 */
export const recordFailedLogin = (identifier: string): void => {
  const now = Date.now();
  const attempt = loginAttempts.get(identifier);
  
  if (!attempt) {
    loginAttempts.set(identifier, {
      count: 1,
      lastAttempt: now
    });
    return;
  }
  
  attempt.count += 1;
  attempt.lastAttempt = now;
  
  // Lock account for 30 minutes after 10 failed attempts
  if (attempt.count >= 10) {
    attempt.lockedUntil = now + 1800000; // 30 minutes
    console.warn(`[Security] Account locked after ${attempt.count} failed attempts: ${identifier}`);
  }
  
  loginAttempts.set(identifier, attempt);
};

/**
 * Reset login attempts (on successful login)
 */
export const resetLoginAttempts = (identifier: string): void => {
  loginAttempts.delete(identifier);
};
