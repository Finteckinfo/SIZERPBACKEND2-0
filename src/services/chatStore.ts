import { v4 as uuidv4 } from 'uuid';
import { getRedisClient } from './redis.js';

// TTLs (seconds)
const MESSAGE_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const TYPING_TTL_SEC = 3;                  // 3 seconds
const ONLINE_TTL_SEC = 60 * 5;             // 5 minutes
const SESSION_TTL_SEC = 60 * 60 * 24;      // 24 hours

// Helpers to build keys
const messageKey = (roomId: string, messageId: string) => `message:${roomId}:${messageId}`;
const roomIndexKey = (roomId: string) => `room:${roomId}:messages`;
const onlineSetKey = (roomId: string) => `online:${roomId}`;
const onlineHeartbeatKey = (roomId: string, userId: string) => `online:${roomId}:${userId}`;
const typingKey = (roomId: string, userId: string) => `typing:${roomId}:${userId}`;
const unreadKey = (roomId: string, userId: string) => `unread:${roomId}:${userId}`;
const sessionKey = (userId: string) => `session:${userId}`;

export type StoredMessage = {
	content: string;
	attachments?: string[];
	reactions?: Record<string, string[]>;
	reply_to?: string;
	edited?: boolean;
	timestamp: number; // ms
	sender_user_id: string;
};

export async function storeMessage(
	roomId: string,
	senderUserId: string,
	content: string,
	options?: { attachments?: string[]; replyTo?: string; reactions?: Record<string, string[]> }
) {
	const client = getRedisClient();
	const messageId = uuidv4();
	const key = messageKey(roomId, messageId);
	const timestamp = Date.now();

	const payload: StoredMessage = {
		content,
		attachments: options?.attachments,
		reactions: options?.reactions,
		reply_to: options?.replyTo,
		edited: false,
		timestamp,
		sender_user_id: senderUserId
	};

	await client.hSet(key, {
		content: payload.content,
		attachments: JSON.stringify(payload.attachments ?? []),
		reactions: JSON.stringify(payload.reactions ?? {}),
		reply_to: payload.reply_to ?? '',
		edited: String(payload.edited ?? false),
		timestamp: String(payload.timestamp),
		sender_user_id: payload.sender_user_id
	});
	await client.expire(key, MESSAGE_TTL_SEC);

	await client.zAdd(roomIndexKey(roomId), [{ value: messageId, score: timestamp }]);

	return { messageId, timestamp, key };
}

export async function editMessage(roomId: string, messageId: string, newContent: string) {
	const client = getRedisClient();
	const key = messageKey(roomId, messageId);
	await client.hSet(key, { content: newContent, edited: 'true' });
	return key;
}

export async function addReaction(roomId: string, messageId: string, emoji: string, userId: string) {
	const client = getRedisClient();
	const key = messageKey(roomId, messageId);
	const raw = await client.hGet(key, 'reactions');
	const reactions = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
	const current = new Set(reactions[emoji] || []);
	current.add(userId);
	reactions[emoji] = Array.from(current);
	await client.hSet(key, { reactions: JSON.stringify(reactions) });
}

export async function removeReaction(roomId: string, messageId: string, emoji: string, userId: string) {
	const client = getRedisClient();
	const key = messageKey(roomId, messageId);
	const raw = await client.hGet(key, 'reactions');
	const reactions = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
	const current = new Set(reactions[emoji] || []);
	current.delete(userId);
	if (current.size === 0) {
		delete reactions[emoji];
	} else {
		reactions[emoji] = Array.from(current);
	}
	await client.hSet(key, { reactions: JSON.stringify(reactions) });
}

export async function fetchMessages(
	roomId: string,
	limit = 50,
	cursor?: number // timestamp ms; fetch messages with timestamp <= cursor
) {
	const client = getRedisClient();
	const end = cursor ?? Number.MAX_SAFE_INTEGER;
	const ids = await (client as any).zRevRangeByScore(roomIndexKey(roomId), end, 0, {
		LIMIT: { offset: 0, count: limit }
	});
	if (ids.length === 0) return { messages: [], nextCursor: undefined as number | undefined };

	const keys = ids.map((id: string) => messageKey(roomId, id));
	const rows = await Promise.all(keys.map((k: string) => client.hGetAll(k)));
	const messages = rows.map((r, idx) => ({
		id: ids[idx],
		content: r.content,
		attachments: JSON.parse(r.attachments || '[]') as string[],
		reactions: JSON.parse(r.reactions || '{}') as Record<string, string[]>,
		reply_to: r.reply_to || undefined,
		edited: r.edited === 'true',
		timestamp: Number(r.timestamp || '0'),
		sender_user_id: r.sender_user_id
	}));

	const nextCursor = messages.length > 0 ? messages[messages.length - 1].timestamp - 1 : undefined;
	return { messages, nextCursor };
}

// Presence / typing
export async function joinRoom(roomId: string, userId: string) {
	const client = getRedisClient();
	await client.sAdd(onlineSetKey(roomId), userId);
	await client.set(onlineHeartbeatKey(roomId, userId), '1', { EX: ONLINE_TTL_SEC });
}

export async function heartbeat(roomId: string, userId: string) {
	const client = getRedisClient();
	await client.set(onlineHeartbeatKey(roomId, userId), '1', { EX: ONLINE_TTL_SEC });
}

export async function leaveRoom(roomId: string, userId: string) {
	const client = getRedisClient();
	await client.sRem(onlineSetKey(roomId), userId);
	await client.del(onlineHeartbeatKey(roomId, userId));
}

export async function getOnlineUsers(roomId: string) {
	const client = getRedisClient();
	return client.sMembers(onlineSetKey(roomId));
}

export async function startTyping(roomId: string, userId: string) {
	const client = getRedisClient();
	await client.set(typingKey(roomId, userId), '1', { EX: TYPING_TTL_SEC });
}

export async function stopTyping(roomId: string, userId: string) {
	const client = getRedisClient();
	await client.del(typingKey(roomId, userId));
}

export async function getTypingUsers(roomId: string) {
	const client = getRedisClient();
	const prefix = `typing:${roomId}:`;
	const keys = await client.keys(`${prefix}*`);
	return keys.map(k => k.slice(prefix.length));
}

// Unread counters
export async function incrementUnread(roomId: string, userId: string) {
	const client = getRedisClient();
	await client.incr(unreadKey(roomId, userId));
}

export async function resetUnread(roomId: string, userId: string) {
	const client = getRedisClient();
	await client.del(unreadKey(roomId, userId));
}

export async function getUnread(roomId: string, userId: string) {
	const client = getRedisClient();
	const v = await client.get(unreadKey(roomId, userId));
	return Number(v ?? '0');
}

// Sessions
export async function setSession(userId: string, data: Record<string, unknown>) {
	const client = getRedisClient();
	await client.set(sessionKey(userId), JSON.stringify(data), { EX: SESSION_TTL_SEC });
}

export async function getSession(userId: string) {
	const client = getRedisClient();
	const v = await client.get(sessionKey(userId));
	return v ? JSON.parse(v) : null;
}


