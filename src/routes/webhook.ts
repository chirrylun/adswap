// src/routes/webhook.ts
import { Router, Request, Response } from 'express';
import { handleIncoming }        from '../bot/handler';
import { markAsRead }            from '../services/whatsapp';
import { validateMetaWebhook }   from '../middleware/validateWebhook';
import { validatePaystackWebhook}from '../middleware/validatePaystack';
import { webhookLimiter, perPhoneLimiter } from '../middleware/rateLimiter';
import { handlePaystackEvent }   from '../services/paystack';

const router = Router();

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
  webhookLimiter,       // IP-level rate limit
  perPhoneLimiter,      // Per-phone rate limit
  validateMetaWebhook,  // Signature verification
  async (req: Request, res: Response) => {
    // Always respond 200 immediately — Meta retries if you don't
    res.sendStatus(200);

    try {
      const body    = req.body;
      const entry   = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value   = changes?.value;

      // Ignore status updates (delivered, read receipts)
      if (value?.statuses) return;

      const messages = value?.messages;
      if (!messages?.length) return;

      const msg     = messages[0];
      const phone   = msg.from;
      const msgId   = msg.id;
      const msgType = msg.type;

      // Mark as read (shows blue ticks)
      await markAsRead(msgId);

      let text     = '';
      let mediaId  = '';

      switch (msgType) {
        case 'text':
          text = msg.text?.body?.trim() || '';
          break;

        case 'interactive':
          // Button reply
          if (msg.interactive?.type === 'button_reply') {
            text = msg.interactive.button_reply.id;
          }
          // List reply
          if (msg.interactive?.type === 'list_reply') {
            text = msg.interactive.list_reply.id;
          }
          break;

        case 'image':
        case 'document':
          mediaId = msg.image?.id || msg.document?.id || '';
          text    = 'MEDIA_RECEIVED';
          break;

        default:
          // Unsupported type — ignore silently
          return;
      }

      if (!phone || (!text && !mediaId)) return;

      // Process asynchronously
      setImmediate(() => {
        handleIncoming(phone, text, mediaId).catch(err => {
          console.error(`Bot handler error for ${phone}:`, err);
        });
      });

    } catch (err) {
      console.error('Webhook processing error:', err);
      // Don't rethrow — response already sent
    }
  }
);

// ─── Paystack POST — Payment events ──────────────────────────────────────────
router.post(
  '/paystack',
  validatePaystackWebhook,
  async (req: Request, res: Response) => {
    res.sendStatus(200); // Acknowledge immediately

    try {
      const event = JSON.parse(req.body.toString());
      await handlePaystackEvent(event);
    } catch (err) {
      console.error('Paystack webhook error:', err);
    }
  }
);

export default router;