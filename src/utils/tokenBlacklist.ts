/**
 * Token Blacklist for Logout and Revocation
 * Stores revoked tokens to prevent reuse after logout
 * 
 * For production with multiple servers, migrate to Redis
 */

interface BlacklistEntry {
  token: string;
  expiresAt: number;
  revokedAt: number;
  userId: string;
  reason: 'logout' | 'security' | 'admin';
}

class TokenBlacklist {
  private blacklist: Map<string, BlacklistEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired tokens every 15 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 15 * 60 * 1000);
  }

  /**
   * Add token to blacklist
   */
  add(token: string, expiresAt: number, userId: string, reason: 'logout' | 'security' | 'admin' = 'logout'): void {
    // Create a hash of the token to save memory (don't store full token)
    const tokenHash = this.hashToken(token);
    
    this.blacklist.set(tokenHash, {
      token: tokenHash,
      expiresAt,
      revokedAt: Date.now(),
      userId,
      reason
    });

    console.log('[Security] Token blacklisted:', { 
      userId, 
      reason, 
      expiresAt: new Date(expiresAt).toISOString(),
      totalBlacklisted: this.blacklist.size
    });
  }

  /**
   * Check if token is blacklisted
   */
  isBlacklisted(token: string): boolean {
    const tokenHash = this.hashToken(token);
    const entry = this.blacklist.get(tokenHash);
    
    if (!entry) {
      return false;
    }

    // Check if entry has expired
    if (Date.now() > entry.expiresAt) {
      this.blacklist.delete(tokenHash);
      return false;
    }

    return true;
  }

  /**
   * Revoke all tokens for a user (for security incidents)
   */
  revokeAllForUser(userId: string, reason: 'security' | 'admin' = 'security'): number {
    let revokedCount = 0;
    
    for (const [hash, entry] of this.blacklist.entries()) {
      if (entry.userId === userId) {
        entry.reason = reason;
        entry.revokedAt = Date.now();
        revokedCount++;
      }
    }

    console.warn('[Security] Revoked all tokens for user:', { userId, reason, count: revokedCount });
    return revokedCount;
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [hash, entry] of this.blacklist.entries()) {
      if (now > entry.expiresAt) {
        this.blacklist.delete(hash);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      console.log('[Security] Cleaned up expired blacklist entries:', { 
        removed: removedCount, 
        remaining: this.blacklist.size 
      });
    }
  }

  /**
   * Get statistics
   */
  getStats(): { total: number; byReason: Record<string, number> } {
    const stats = {
      total: this.blacklist.size,
      byReason: {
        logout: 0,
        security: 0,
        admin: 0
      }
    };

    for (const entry of this.blacklist.values()) {
      stats.byReason[entry.reason]++;
    }

    return stats;
  }

  /**
   * Simple hash function for tokens
   * In production, use crypto.createHash('sha256')
   */
  private hashToken(token: string): string {
    // Use Node.js crypto for production
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Shutdown cleanup
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.blacklist.clear();
  }
}

// Singleton instance
export const tokenBlacklist = new TokenBlacklist();

// Graceful shutdown
process.on('beforeExit', () => {
  tokenBlacklist.destroy();
});
