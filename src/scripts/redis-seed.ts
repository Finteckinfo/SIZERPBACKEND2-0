import { connectRedis, disconnectRedis } from '../services/redis.js';
import { storeMessage } from '../services/chatStore.js';

export default async function main() {
	await connectRedis();
	try {
		const roomId = process.env.SEED_ROOM_ID || 'test-room';
		const userId = process.env.SEED_USER_ID || 'test-user';
		const { messageId } = await storeMessage(roomId, userId, 'Hello from seed');
		console.log('Seeded message', { roomId, messageId });
	} finally {
		await disconnectRedis();
	}
}

// Allow running directly with ts-node/ts-node/esm in dev
if (process.argv[1] && process.argv[1].includes('redis-seed')) {
	main().catch((e) => {
		console.error(e);
		process.exit(1);
	});
}


