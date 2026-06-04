import { Router } from 'express';
import { handleSlackEmojiTask } from '../controllers/webhookController';

const router = Router();

// POST /api/webhooks/slack/emoji-task
// Public — authenticated via x-webhook-secret header (no JWT)
router.post('/slack/emoji-task', handleSlackEmojiTask);

export default router;
