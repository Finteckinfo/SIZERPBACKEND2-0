/**
 * Security Monitoring and Threat Detection
 * Tracks authentication attempts, detects anomalies, and enforces security policies
 */

interface AuthAttempt {
  timestamp: number;
  success: boolean;
  ip: string;
  userAgent: string;
}

interface UserSecurityProfile {
  userId: string;
  failedAttempts: AuthAttempt[];
  successfulLogins: AuthAttempt[];
  lastKnownIP: string;
  lastKnownUserAgent: string;
  accountLockedUntil?: number;
  suspiciousActivityScore: number;
}

class SecurityMonitor {
  private userProfiles: Map<string, UserSecurityProfile> = new Map();
  private ipAttempts: Map<string, AuthAttempt[]> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  // Configuration
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes
  private readonly ATTEMPT_WINDOW = 10 * 60 * 1000; // 10 minutes
  private readonly MAX_IP_ATTEMPTS = 20;
  private readonly SUSPICIOUS_THRESHOLD = 50;

  constructor() {
    // Clean up old attempts every 15 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 15 * 60 * 1000);
  }

  /**
   * Record authentication attempt
   */
  recordAttempt(userId: string, success: boolean, ip: string, userAgent: string): void {
    const now = Date.now();
    const attempt: AuthAttempt = { timestamp: now, success, ip, userAgent };

    // Update user profile
    let profile = this.userProfiles.get(userId);
    if (!profile) {
      profile = {
        userId,
        failedAttempts: [],
        successfulLogins: [],
        lastKnownIP: ip,
        lastKnownUserAgent: userAgent,
        suspiciousActivityScore: 0
      };
      this.userProfiles.set(userId, profile);
    }

    if (success) {
      profile.successfulLogins.push(attempt);
      
      // Detect location change
      if (profile.lastKnownIP && profile.lastKnownIP !== ip) {
        profile.suspiciousActivityScore += 10;
        console.warn('[Security] IP address changed for user:', { userId, oldIP: profile.lastKnownIP, newIP: ip });
      }

      // Detect user agent change
      if (profile.lastKnownUserAgent && profile.lastKnownUserAgent !== userAgent) {
        profile.suspiciousActivityScore += 5;
        console.warn('[Security] User agent changed for user:', { userId });
      }

      profile.lastKnownIP = ip;
      profile.lastKnownUserAgent = userAgent;
      
      // Clear failed attempts on successful login
      profile.failedAttempts = [];
    } else {
      profile.failedAttempts.push(attempt);
      profile.suspiciousActivityScore += 2;
    }

    // Track IP-based attempts
    let ipAttempts = this.ipAttempts.get(ip) || [];
    ipAttempts.push(attempt);
    this.ipAttempts.set(ip, ipAttempts);

    // Clean old attempts from memory
    const cutoff = now - this.ATTEMPT_WINDOW;
    profile.failedAttempts = profile.failedAttempts.filter(a => a.timestamp > cutoff);
    profile.successfulLogins = profile.successfulLogins.filter(a => a.timestamp > cutoff);
    ipAttempts = ipAttempts.filter(a => a.timestamp > cutoff);
    this.ipAttempts.set(ip, ipAttempts);

    console.log('[Security] Auth attempt recorded:', {
      userId,
      success,
      ip,
      failedCount: profile.failedAttempts.length,
      suspiciousScore: profile.suspiciousActivityScore
    });
  }

  /**
   * Check if user account is locked
   */
  isAccountLocked(userId: string): boolean {
    const profile = this.userProfiles.get(userId);
    if (!profile) return false;

    if (profile.accountLockedUntil && Date.now() < profile.accountLockedUntil) {
      return true;
    }

    // Auto-unlock if time passed
    if (profile.accountLockedUntil && Date.now() >= profile.accountLockedUntil) {
      delete profile.accountLockedUntil;
      profile.failedAttempts = [];
      profile.suspiciousActivityScore = Math.max(0, profile.suspiciousActivityScore - 20);
    }

    return false;
  }

  /**
   * Check if account should be locked based on failed attempts
   */
  shouldLockAccount(userId: string): boolean {
    const profile = this.userProfiles.get(userId);
    if (!profile) return false;

    const recentFailed = profile.failedAttempts.filter(
      a => a.timestamp > Date.now() - this.ATTEMPT_WINDOW
    );

    if (recentFailed.length >= this.MAX_FAILED_ATTEMPTS) {
      profile.accountLockedUntil = Date.now() + this.LOCKOUT_DURATION;
      console.warn('[Security] Account locked due to failed attempts:', {
        userId,
        failedCount: recentFailed.length,
        lockedUntil: new Date(profile.accountLockedUntil).toISOString()
      });
      return true;
    }

    return false;
  }

  /**
   * Check if IP is rate limited
   */
  isIPRateLimited(ip: string): boolean {
    const attempts = this.ipAttempts.get(ip) || [];
    const recentAttempts = attempts.filter(
      a => a.timestamp > Date.now() - this.ATTEMPT_WINDOW
    );

    if (recentAttempts.length >= this.MAX_IP_ATTEMPTS) {
      console.warn('[Security] IP rate limit exceeded:', {
        ip,
        attempts: recentAttempts.length
      });
      return true;
    }

    return false;
  }

  /**
   * Check for suspicious activity
   */
  isSuspiciousActivity(userId: string): boolean {
    const profile = this.userProfiles.get(userId);
    if (!profile) return false;

    if (profile.suspiciousActivityScore >= this.SUSPICIOUS_THRESHOLD) {
      console.warn('[Security] Suspicious activity detected:', {
        userId,
        score: profile.suspiciousActivityScore
      });
      return true;
    }

    return false;
  }

  /**
   * Get security stats for a user
   */
  getUserSecurityStats(userId: string): UserSecurityProfile | null {
    return this.userProfiles.get(userId) || null;
  }

  /**
   * Reset user security profile (after password change, etc.)
   */
  resetUserProfile(userId: string): void {
    const profile = this.userProfiles.get(userId);
    if (profile) {
      profile.failedAttempts = [];
      profile.suspiciousActivityScore = 0;
      delete profile.accountLockedUntil;
      console.log('[Security] User security profile reset:', { userId });
    }
  }

  /**
   * Cleanup old data
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - (24 * 60 * 60 * 1000); // 24 hours
    let removedProfiles = 0;
    let removedIPs = 0;

    // Clean user profiles with no recent activity
    for (const [userId, profile] of this.userProfiles.entries()) {
      const hasRecentActivity = 
        profile.failedAttempts.some(a => a.timestamp > cutoff) ||
        profile.successfulLogins.some(a => a.timestamp > cutoff);
      
      if (!hasRecentActivity && !profile.accountLockedUntil) {
        this.userProfiles.delete(userId);
        removedProfiles++;
      } else {
        // Decay suspicious score over time
        profile.suspiciousActivityScore = Math.max(0, profile.suspiciousActivityScore - 1);
      }
    }

    // Clean IP attempts
    for (const [ip, attempts] of this.ipAttempts.entries()) {
      const recentAttempts = attempts.filter(a => a.timestamp > cutoff);
      if (recentAttempts.length === 0) {
        this.ipAttempts.delete(ip);
        removedIPs++;
      } else {
        this.ipAttempts.set(ip, recentAttempts);
      }
    }

    if (removedProfiles > 0 || removedIPs > 0) {
      console.log('[Security] Cleanup completed:', {
        removedProfiles,
        removedIPs,
        remainingProfiles: this.userProfiles.size,
        remainingIPs: this.ipAttempts.size
      });
    }
  }

  /**
   * Get security statistics
   */
  getStats(): object {
    const now = Date.now();
    const window = this.ATTEMPT_WINDOW;

    let totalAttempts = 0;
    let failedAttempts = 0;
    let lockedAccounts = 0;
    let suspiciousAccounts = 0;

    for (const profile of this.userProfiles.values()) {
      const recentFailed = profile.failedAttempts.filter(a => a.timestamp > now - window);
      const recentSuccess = profile.successfulLogins.filter(a => a.timestamp > now - window);
      
      totalAttempts += recentFailed.length + recentSuccess.length;
      failedAttempts += recentFailed.length;
      
      if (profile.accountLockedUntil && now < profile.accountLockedUntil) {
        lockedAccounts++;
      }
      
      if (profile.suspiciousActivityScore >= this.SUSPICIOUS_THRESHOLD) {
        suspiciousAccounts++;
      }
    }

    return {
      trackedUsers: this.userProfiles.size,
      trackedIPs: this.ipAttempts.size,
      recentAttempts: totalAttempts,
      recentFailed: failedAttempts,
      successRate: totalAttempts > 0 ? Math.round((1 - failedAttempts / totalAttempts) * 100) : 100,
      lockedAccounts,
      suspiciousAccounts,
      config: {
        maxFailedAttempts: this.MAX_FAILED_ATTEMPTS,
        lockoutDuration: this.LOCKOUT_DURATION / 60000 + ' minutes',
        attemptWindow: this.ATTEMPT_WINDOW / 60000 + ' minutes',
        maxIPAttempts: this.MAX_IP_ATTEMPTS
      }
    };
  }

  /**
   * Shutdown cleanup
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.userProfiles.clear();
    this.ipAttempts.clear();
  }
}

// Singleton instance
export const securityMonitor = new SecurityMonitor();

// Graceful shutdown
process.on('beforeExit', () => {
  securityMonitor.destroy();
});
