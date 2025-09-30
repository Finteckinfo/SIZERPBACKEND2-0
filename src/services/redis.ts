import { createClient } from 'redis';

let redisClient: ReturnType<typeof createClient> | null = null;

export function getRedisClient() {
	if (!redisClient) {
		const url = process.env.REDIS_URL || process.env.RAILWAY_REDIS_URL;
		if (!url) throw new Error('REDIS_URL is not set');

		redisClient = createClient({ url });

    redisClient.on('error', (err: unknown) => {
			console.error('[Redis] Client Error:', err);
		});
	}
	return redisClient;
}

export async function connectRedis() {
	const client = getRedisClient();
	if (!client.isOpen) {
		await client.connect();
		console.log('[Redis] Connected');
	}
	return client;
}

export async function disconnectRedis() {
	if (redisClient && redisClient.isOpen) {
		await redisClient.quit();
		console.log('[Redis] Disconnected');
	}
}


