// src/routes/webhook.ts
import { Router, Request, Response } from 'express';
import { handleIncoming }          from '../bot/handler';
import { markAsRead }              from '../services/whatsapp';
import { validateMetaWebhook }     from '../middleware/validateWebhook';
import { webhookLimiter, perPhoneLimiter } from '../middleware/rateLimiter';
import MessageLog                  from '../models/MessageLog';
import { track }                   from '../services/analytics';

/*
import { handleFlutterwaveEvent } from '../services/flutterwave';
*/

const router = Router();

// ─── Flutterwave webhook signature validator ──────────────────────────────────
function validateFlutterwaveWebhook(req: Request, res: Response, next: Function): void {
  const signature = req.headers['verif-hash'];
  if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_SECRET) {
    console.warn('[FW Webhook] Invalid signature — rejected');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// ─── Status event processor ───────────────────────────────────────────────────
// Handles delivered / read / failed status updates from Meta for outbound messages.
// Updates the MessageLog and fires an analytics event for read receipts.
async function processStatusUpdate(statuses: any[]): Promise<void> {
  for (const s of statuses) {
    const { id: wamid, status, timestamp, recipient_id } = s;

    // Only process statuses we care about
    if (!['delivered', 'read', 'failed'].includes(status)) continue;

    const ts = new Date(Number(timestamp) * 1000);

    // Build the update based on status
    const update: Record<string, any> = { status };
    if (status === 'delivered') update.deliveredAt = ts;
    if (status === 'read')      update.readAt      = ts;
    if (status === 'failed')    update.failedAt    = ts;

    // Find and update the MessageLog — only if we originally tracked this wamid
    const log = await MessageLog.findOneAndUpdate(
      { wamid },
      { $set: update },
      { new: true },
    );

    // No log means it was an untracked message (e.g. bot replies) — skip
    if (!log) continue;

    // ── Fire analytics event for read receipts ────────────────────────────────
    if (status === 'read') {
      track(
        'message_read',
        recipient_id,
        {
          wamid,
          category: log.category,
          refId:    log.refId,
          sentAt:   log.sentAt,
          readAt:   ts,
          // Time-to-read in seconds — useful for engagement benchmarking
          ttReadSeconds: log.sentAt
            ? Math.round((ts.getTime() - log.sentAt.getTime()) / 1000)
            : undefined,
        },
        log.category,  // sessionStep = category for filtering in analytics
      ).catch(() => {});
    }

    if (status === 'failed') {
      console.warn(`[MessageLog] Outbound failed — wamid:${wamid} to:${recipient_id}`);
    }
  }
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

// ─── WhatsApp POST — Incoming messages + status updates ──────────────────────
router.post(
  '/whatsapp',
  webhookLimiter,
  perPhoneLimiter,
  validateMetaWebhook,
  async (req: Request, res: Response) => {
    // Always 200 immediately — Meta retries if it doesn't get one fast
    res.sendStatus(200);

    try {
      const body    = req.body;
      const entry   = body?.entry?.[0];
      const changes = entry?.changes?.[0];
      const value   = changes?.value;

      // ── Status updates (delivered / read / failed) ────────────────────────
      if (value?.statuses?.length) {
        // Don't await — fire and forget so we don't hold up the response thread
        setImmediate(() =>
          processStatusUpdate(value.statuses).catch(err =>
            console.error('[Status] Processing error:', err),
          ),
        );
        return;
      }

      // ── Incoming messages ─────────────────────────────────────────────────
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

/*
// ─── Flutterwave POST — Payment events ───────────────────────────────────────
router.post(
  '/flutterwave',
  validateFlutterwaveWebhook,
  async (req: Request, res: Response) => {
    res.sendStatus(200);
    try {
      const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      await handleFlutterwaveEvent(event);
    } catch (err) {
      console.error('Flutterwave webhook error:', err);
    }
  },
);
*/

export default router;