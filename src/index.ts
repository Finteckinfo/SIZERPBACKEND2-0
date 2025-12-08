import { initializeWebSocket } from "./services/websocket.js";
import { processRecurringPayments, checkLowBalanceAlerts } from "./services/recurringPaymentProcessor.js";
import { createServer } from 'http';
import { connectRedis, disconnectRedis } from "./services/redis.js";
import app from './app.js';

const PORT = process.env.PORT || 3000;
const server = createServer(app);

// Connect to Redis, then start server
(async () => {
	try {
		// Try to connect to Redis, but don't fail if it's not available
		const redisClient = await connectRedis();
		if (redisClient) {
			console.log('[Server] Redis connected successfully');
		} else {
			console.warn('[Server] Redis not available - some features may be limited');
		}
		
		initializeWebSocket(server);
		
		// Schedule recurring payment processing (daily at 00:00 UTC)
		const scheduleDailyPayments = () => {
			const now = new Date();
			const midnight = new Date(now);
			midnight.setUTCHours(24, 0, 0, 0);
			const msUntilMidnight = midnight.getTime() - now.getTime();
			
			setTimeout(() => {
				processRecurringPayments().catch(console.error);
				setInterval(() => {
					processRecurringPayments().catch(console.error);
				}, 24 * 60 * 60 * 1000); // Every 24 hours
			}, msUntilMidnight);
		};
		
		// Schedule low balance alerts (daily at 08:00 UTC)
		const scheduleLowBalanceAlerts = () => {
			const now = new Date();
			const eightAM = new Date(now);
			eightAM.setUTCHours(8, 0, 0, 0);
			if (eightAM < now) {
				eightAM.setDate(eightAM.getDate() + 1);
			}
			const msUntilEightAM = eightAM.getTime() - now.getTime();
			
			setTimeout(() => {
				checkLowBalanceAlerts().catch(console.error);
				setInterval(() => {
					checkLowBalanceAlerts().catch(console.error);
				}, 24 * 60 * 60 * 1000); // Every 24 hours
			}, msUntilEightAM);
		};
		
		scheduleDailyPayments();
		scheduleLowBalanceAlerts();
		console.log('[Server] Scheduled recurring payment jobs');
		
		server.listen(PORT, () => {
			console.log(`[Server] HTTP and WebSocket server running on port ${PORT}`);
		});
	} catch (err) {
		console.error('[Server] Failed to start due to Redis error:', err);
		console.log('[Server] Starting server without Redis...');
		
		// Start server anyway, but with limited functionality
		initializeWebSocket(server);
		
		server.listen(PORT, () => {
			console.log(`[Server] HTTP and WebSocket server running on port ${PORT} (Redis disabled)`);
		});
	}
})();

// Graceful shutdown
const shutdown = async () => {
	console.log('[Server] Shutting down...');
	try {
		await disconnectRedis();
	} catch (e) {
		console.error('[Server] Error during shutdown:', e);
	} finally {
		process.exit(0);
	}
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
