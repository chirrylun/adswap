// src/routes/webhook.ts
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { handleIncoming } from '../bot/handler';
import { markAsRead } from '../services/whatsapp';
import { validateMetaWebhook } from '../middleware/validateWebhook';
import { webhookLimiter, perPhoneLimiter } from '../middleware/rateLimiter';
import { handleFlutterwaveEvent } from '../services/flutterwave';

const router = Router();

// ─── Flutterwave webhook signature validator ──────────────────────────────────
function validateFlutterwaveWebhook(
  req: Request,
  res: Response,
  next: Function,
): void {
  const signature = req.headers['verif-hash'];
  if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
    console.warn('[FW Webhook] Invalid signature — rejected');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ─── WhatsApp GET — Meta verification handshake ───────────────────────────────
router.get('/whatsapp', (req: Request, res: Response) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    console.log('Meta webhook verified');
    return res.status(200).send(challenge);
  }

  console.warn('Meta webhook verification failed');
  res.status(403).send('Forbidden');
});

// ─── WhatsApp POST — Incoming messages ───────────────────────────────────────
router.post(
  '/whatsapp',
  webhookLimiter,
  perPhoneLimiter,
  validateMetaWebhook,
  async (req: Request, res: Response) => {
    res.sendStatus(200);

    try {
      const body    = req.body;
      const entry   = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value   = changes?.value;

      if (value?.statuses) return;

      const messages = value?.messages;
      if (!messages?.length) return;

      const msg     = messages[0];
      const phone   = msg.from;
      const msgId   = msg.id;
      const msgType = msg.type;

      await markAsRead(msgId);

      let text    = '';
      let mediaId = '';

      switch (msgType) {
        case 'text':
          text = msg.text?.body?.trim() || '';
          break;
        case 'interactive':
          if (msg.interactive?.type === 'button_reply') text = msg.interactive.button_reply.id;
          if (msg.interactive?.type === 'list_reply')   text = msg.interactive.list_reply.id;
          break;
        case 'image':
        case 'document':
          mediaId = msg.image?.id || msg.document?.id || '';
          text    = 'MEDIA_RECEIVED';
          break;
        default:
          return;
      }

      if (!phone || (!text && !mediaId)) return;

      setImmediate(() => {
        handleIncoming(phone, text, mediaId).catch(err => {
          console.error(`Bot handler error for ${phone}:`, err);
        });
      });
    } catch (err) {
      console.error('Webhook processing error:', err);
    }
  },
);

// ─── Flutterwave POST — Payment events ───────────────────────────────────────
// ─── Flutterwave POST — Payment events ───────────────────────────────────────
router.post(
  '/flutterwave',
  validateFlutterwaveWebhook,
  async (req: Request, res: Response) => {
    res.sendStatus(200);

    try {
      console.log('[FW Webhook] Raw body type:', typeof req.body);
      console.log('[FW Webhook] Body:', JSON.stringify(req.body, null, 2));

      const event = typeof req.body === 'string'
        ? JSON.parse(req.body)
        : req.body;

      console.log('[FW Webhook] Event type:', event?.event);
      console.log('[FW Webhook] Data status:', event?.data?.status);

      await handleFlutterwaveEvent(event);
    } catch (err) {
      console.error('Flutterwave webhook error:', err);
    }
  },
);

export default router;