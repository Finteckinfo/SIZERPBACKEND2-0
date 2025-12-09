/**
 * Security Configuration Module
 * Validates critical security settings and fails fast if misconfigured
 */

interface SecurityConfig {
  jwtSecret: string;
  nextAuthSecret: string;
  bcryptRounds: number;
  jwtExpiresIn: string;
  jwtAlgorithm: 'HS256';
  maxTokenAge: number; // seconds
  sessionTimeout: number; // seconds
  isProduction: boolean;
}

/**
 * Validate that secrets are strong enough
 */
function validateSecret(secret: string, name: string): void {
  if (!secret) {
    throw new Error(`${name} is not set. Application cannot start.`);
  }

  // Check for weak/default secrets
  const weakSecrets = [
    'fallback-secret-key-change-in-production',
    'fallback-nextauth-secret-change-in-production',
    'change-me',
    'secret',
    'password',
    '123456',
    'default'
  ];

  if (weakSecrets.includes(secret.toLowerCase())) {
    throw new Error(`${name} is using a default/weak value. Set a strong secret in environment variables.`);
  }

  // Minimum length check
  if (secret.length < 32) {
    throw new Error(`${name} must be at least 32 characters long. Current length: ${secret.length}`);
  }

  // Check for sufficient entropy (simple check)
  const uniqueChars = new Set(secret).size;
  if (uniqueChars < 16) {
    throw new Error(`${name} has insufficient entropy. Use a randomly generated secret.`);
  }
}

/**
 * Load and validate security configuration
 * Fails fast if security requirements are not met
 */
export function loadSecurityConfig(): SecurityConfig {
  const isProduction = process.env.NODE_ENV === 'production';

  // In production, fail if secrets are not set
  // In development, allow (but warn about) fallbacks
  let jwtSecret = process.env.JWT_SECRET;
  let nextAuthSecret = process.env.NEXTAUTH_SECRET;

  if (isProduction) {
    if (!jwtSecret || !nextAuthSecret) {
      throw new Error(
        'CRITICAL SECURITY ERROR: JWT_SECRET and NEXTAUTH_SECRET must be set in production. Application will not start.'
      );
    }
    validateSecret(jwtSecret, 'JWT_SECRET');
    validateSecret(nextAuthSecret, 'NEXTAUTH_SECRET');
  } else {
    // Development mode - allow fallbacks but warn
    if (!jwtSecret) {
      console.warn('[SECURITY WARNING] JWT_SECRET not set. Using development fallback. DO NOT USE IN PRODUCTION.');
      jwtSecret = 'dev-jwt-secret-NOT-FOR-PRODUCTION-' + Math.random().toString(36);
    }
    if (!nextAuthSecret) {
      console.warn('[SECURITY WARNING] NEXTAUTH_SECRET not set. Using development fallback. DO NOT USE IN PRODUCTION.');
      nextAuthSecret = 'dev-nextauth-secret-NOT-FOR-PRODUCTION-' + Math.random().toString(36);
    }
  }

  const config: SecurityConfig = {
    jwtSecret,
    nextAuthSecret,
    bcryptRounds: 12,
    jwtExpiresIn: '30d',
    jwtAlgorithm: 'HS256', // Explicitly set algorithm
    maxTokenAge: 30 * 24 * 60 * 60, // 30 days in seconds
    sessionTimeout: 24 * 60 * 60, // 24 hours in seconds
    isProduction
  };

  // Log security configuration (without secrets)
  console.log('[Security] Configuration loaded:', {
    bcryptRounds: config.bcryptRounds,
    jwtExpiresIn: config.jwtExpiresIn,
    jwtAlgorithm: config.jwtAlgorithm,
    maxTokenAge: config.maxTokenAge,
    isProduction: config.isProduction,
    jwtSecretLength: jwtSecret.length,
    nextAuthSecretLength: nextAuthSecret.length
  });

  return config;
}

// Singleton instance
let securityConfig: SecurityConfig | null = null;

export function getSecurityConfig(): SecurityConfig {
  if (!securityConfig) {
    securityConfig = loadSecurityConfig();
  }
  return securityConfig;
}

/**
 * Validate JWT token age
 */
export function validateTokenAge(iat: number): boolean {
  const config = getSecurityConfig();
  const now = Math.floor(Date.now() / 1000);
  const tokenAge = now - iat;
  
  if (tokenAge > config.maxTokenAge) {
    return false;
  }
  
  if (tokenAge < 0) {
    // Token issued in the future - clock skew or manipulation
    console.warn('[Security] Token issued in the future. Possible clock skew or manipulation.');
    return Math.abs(tokenAge) < 300; // Allow 5 minutes clock skew
  }
  
  return true;
}

/**
 * Validate JWT claims
 */
export function validateJWTClaims(decoded: any): { valid: boolean; error?: string } {
  // Check required claims - allow sub, id, userId, or email as identifier
  if (!decoded.sub && !decoded.id && !decoded.userId && !decoded.email) {
    return { valid: false, error: 'Missing user identifier in token' };
  }

  if (!decoded.email) {
    return { valid: false, error: 'Missing email in token' };
  }

  // Check issued at time
  if (!decoded.iat) {
    return { valid: false, error: 'Missing issued at time' };
  }

  if (!validateTokenAge(decoded.iat)) {
    return { valid: false, error: 'Token is too old or invalid timestamp' };
  }

  // Check expiration
  if (decoded.exp) {
    const now = Math.floor(Date.now() / 1000);
    if (now >= decoded.exp) {
      return { valid: false, error: 'Token has expired' };
    }
  }

  // Check not before
  if (decoded.nbf) {
    const now = Math.floor(Date.now() / 1000);
    if (now < decoded.nbf) {
      return { valid: false, error: 'Token not yet valid' };
    }
  }

  return { valid: true };
}
