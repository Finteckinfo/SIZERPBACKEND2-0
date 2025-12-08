import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

export enum KYCLevel {
    NONE = 0,
    BASIC = 1, // Email + Phone
    VERIFIED = 2, // ID + Selfie
    ENHANCED = 3 // Address Proof
}

export interface KYCStatus {
    userId: string;
    level: KYCLevel;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'INIT';
    limit: number; // Daily withdrawal limit in FIN
}

export class KYCService {
    private appToken: string;
    private secretKey: string;

    constructor() {
        this.appToken = process.env.SUMSUB_APP_TOKEN || 'mock_token';
        this.secretKey = process.env.SUMSUB_SECRET_KEY || 'mock_secret';
    }

    /**
     * Generate an access token for the Sumsub Web SDK
     * @param userId Internal user ID
     */
    public async generateAccessToken(userId: string): Promise<string> {
        // In production, call Sumsub API to generate token
        // POST /resources/accessTokens
        console.log(`Generating KYC access token for user ${userId}`);
        return `mock_access_token_${userId}_${Date.now()}`;
    }

    /**
     * Get user's current KYC status and limits
     * @param userId Internal user ID
     */
    public async getKYCStatus(userId: string): Promise<KYCStatus> {
        // In production, fetch from database or Sumsub API
        // Mock response for now
        return {
            userId,
            level: KYCLevel.NONE,
            status: 'INIT',
            limit: 1000 // Default unverified limit
        };
    }

    /**
     * Handle webhook from Sumsub
     * @param payload Webhook payload
     * @param signature Webhook signature for verification
     */
    public async handleWebhook(payload: any, signature: string) {
        if (!this.verifyWebhookSignature(payload, signature)) {
            throw new Error('Invalid webhook signature');
        }

        const { type, applicantId, reviewStatus } = payload;

        if (type === 'applicantReviewed') {
            if (reviewStatus === 'completed') {
                // Update user status in DB to VERIFIED
                console.log(`KYC completed for applicant ${applicantId}`);
                // await db.user.update(...)
            } else {
                console.log(`KYC rejected for applicant ${applicantId}`);
            }
        }
    }

    private verifyWebhookSignature(payload: any, signature: string): boolean {
        // HMAC-SHA256 verification
        // const calculated = crypto.createHmac('sha256', this.secretKey).update(JSON.stringify(payload)).digest('hex');
        // return calculated === signature;
        return true; // Mock pass
    }
}

export const kycService = new KYCService();
