import { Router } from 'express';
import { prisma } from '../utils/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { storeMessage, fetchMessages, startTyping, stopTyping, getTypingUsers, getOnlineUsers, joinRoom, leaveRoom, incrementUnread, resetUnread, getUnread, addReaction, removeReaction } from '../services/chatStore.js';

const router = Router();

// Helper: ensure participant
async function assertParticipant(roomId: string, userId: string) {
	const p = await (prisma as any).chatParticipant?.findFirst?.({ where: { roomId, userId } });
	if (!p) throw Object.assign(new Error('Forbidden'), { status: 403 });
}

// GET rooms current user participates in
router.get('/rooms', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const rooms = await (prisma as any).chatParticipant?.findMany?.({
			where: { userId },
			select: {
				room: {
					select: { id: true, roomName: true, roomType: true, projectId: true, createdAt: true }
				}
			}
		});
		return res.json((rooms || []).map((r: any) => r.room));
	} catch (e: any) {
		return res.status(e.status || 500).json({ error: e.message || 'Failed to fetch rooms' });
	}
});

// GET messages for a room
router.get('/rooms/:roomId/messages', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId } = req.params;
		const limit = Math.min(Number(req.query.limit) || 50, 200);
		const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;

		await assertParticipant(roomId, userId);
		const { messages, nextCursor } = await fetchMessages(roomId, limit, cursor);
		return res.json({ messages, nextCursor });
	} catch (e: any) {
		return res.status(e.status || 500).json({ error: e.message || 'Failed to fetch messages' });
	}
});

// POST send a message
router.post('/rooms/:roomId/messages', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId } = req.params;
		const { content, attachments, replyTo, messageType } = req.body || {};
		if (!content || typeof content !== 'string') {
			return res.status(400).json({ error: 'content is required' });
		}
		await assertParticipant(roomId, userId);

		const result = await storeMessage(roomId, userId, content, { attachments, replyTo });
		if (!result) {
			return res.status(503).json({ error: 'Message storage unavailable' });
		}
		
		const { messageId, timestamp, key } = result;

		await (prisma as any).messageMetadata?.create?.({
			data: {
				roomId,
				senderUserId: userId,
				messageRedisKey: key,
				messageType: messageType || 'text'
			}
		});

		return res.status(201).json({ id: messageId, timestamp });
	} catch (e: any) {
		return res.status(e.status || 500).json({ error: e.message || 'Failed to send message' });
	}
});

// Presence: join/leave, online list
router.post('/rooms/:roomId/join', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId } = req.params;
		await assertParticipant(roomId, userId);
		await joinRoom(roomId, userId);
		return res.json({ ok: true });
	} catch (e: any) { return res.status(e.status || 500).json({ error: e.message }); }
});

router.post('/rooms/:roomId/leave', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId } = req.params;
		await assertParticipant(roomId, userId);
		await leaveRoom(roomId, userId);
		return res.json({ ok: true });
	} catch (e: any) { return res.status(e.status || 500).json({ error: e.message }); }
});

router.get('/rooms/:roomId/online', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId } = req.params;
		await assertParticipant(roomId, userId);
		const online = await getOnlineUsers(roomId);
		return res.json({ online });
	} catch (e: any) { return res.status(e.status || 500).json({ error: e.message }); }
});

// Typing
router.post('/rooms/:roomId/typing/start', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId } = req.params;
		await assertParticipant(roomId, userId);
		await startTyping(roomId, userId);
		return res.json({ ok: true });
	} catch (e: any) { return res.status(e.status || 500).json({ error: e.message }); }
});

router.post('/rooms/:roomId/typing/stop', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId } = req.params;
		await assertParticipant(roomId, userId);
		await stopTyping(roomId, userId);
		return res.json({ ok: true });
	} catch (e: any) { return res.status(e.status || 500).json({ error: e.message }); }
});

router.get('/rooms/:roomId/typing', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId } = req.params;
		await assertParticipant(roomId, userId);
		const typing = await getTypingUsers(roomId);
		return res.json({ typing });
	} catch (e: any) { return res.status(e.status || 500).json({ error: e.message }); }
});

// Unread counters
router.get('/rooms/:roomId/unread', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId } = req.params;
		await assertParticipant(roomId, userId);
		const count = await getUnread(roomId, userId);
		return res.json({ count });
	} catch (e: any) { return res.status(e.status || 500).json({ error: e.message }); }
});

router.post('/rooms/:roomId/unread/reset', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId } = req.params;
		await assertParticipant(roomId, userId);
		await resetUnread(roomId, userId);
		return res.json({ ok: true });
	} catch (e: any) { return res.status(e.status || 500).json({ error: e.message }); }
});

// Reactions
router.post('/rooms/:roomId/messages/:messageId/reactions', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId, messageId } = req.params;
		const { emoji } = req.body || {};
		if (!emoji) return res.status(400).json({ error: 'emoji is required' });
		await assertParticipant(roomId, userId);
		await addReaction(roomId, messageId, emoji, userId);
		return res.json({ ok: true });
	} catch (e: any) { return res.status(e.status || 500).json({ error: e.message }); }
});

router.delete('/rooms/:roomId/messages/:messageId/reactions', authenticateToken, async (req, res) => {
	try {
		const userId = req.user!.id;
		const { roomId, messageId } = req.params;
		const { emoji } = req.body || {};
		if (!emoji) return res.status(400).json({ error: 'emoji is required' });
		await assertParticipant(roomId, userId);
		await removeReaction(roomId, messageId, emoji, userId);
		return res.json({ ok: true });
	} catch (e: any) { return res.status(e.status || 500).json({ error: e.message }); }
});

export default router;


