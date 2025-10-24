import { createClient } from 'redis';

let redisClient: ReturnType<typeof createClient> | null = null;

export function getRedisClient() {
	if (!redisClient) {
		const url = process.env.REDIS_URL || process.env.RAILWAY_REDIS_URL;
		if (!url) {
			console.warn('[Redis] REDIS_URL not set - Redis features will be disabled');
			return null;
		}

		redisClient = createClient({ 
			url,
			socket: {
				connectTimeout: 10000, // 10 seconds
				reconnectStrategy: (retries) => {
					if (retries > 5) {
						console.error('[Redis] Max reconnection attempts reached');
						return false;
					}
					return Math.min(retries * 1000, 5000);
				}
			}
		});

		redisClient.on('error', (err: unknown) => {
			console.error('[Redis] Client Error:', err);
		});

		redisClient.on('connect', () => {
			console.log('[Redis] Connecting...');
		});

		redisClient.on('ready', () => {
			console.log('[Redis] Ready');
		});

		redisClient.on('reconnecting', () => {
			console.log('[Redis] Reconnecting...');
		});
	}
	return redisClient;
}

export async function connectRedis() {
	const client = getRedisClient();
	if (!client) {
		console.warn('[Redis] Redis client not available - skipping connection');
		return null;
	}
	
	if (!client.isOpen) {
		try {
			await client.connect();
			console.log('[Redis] Connected successfully');
		} catch (error) {
			console.error('[Redis] Connection failed:', error);
			throw error;
		}
	}
	return client;
}

export async function disconnectRedis() {
	if (redisClient && redisClient.isOpen) {
		try {
			await redisClient.quit();
			console.log('[Redis] Disconnected');
		} catch (error) {
			console.error('[Redis] Disconnect error:', error);
		}
	}
}


