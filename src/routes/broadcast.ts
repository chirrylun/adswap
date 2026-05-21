// src/routes/broadcasts.ts
import { Router, Response }        from 'express';
import { adminAuth, AdminRequest } from '../middleware/auth';
import { adminLimiter }            from '../middleware/rateLimiter';
import Broadcast                   from '../models/Broadcast';
import User                        from '../models/User';
import { sendTracked, sendImageTracked } from '../services/whatsapp';
import cloudinary                  from '../config/cloudinary';

const router = Router();
router.use(adminLimiter);

// ─── Cloudinary upload from base64 ───────────────────────────────────────────
async function uploadBase64ToCloudinary(
  base64: string,           // e.g. "data:image/png;base64,iVBORw..."
  folder = 'adswap/broadcasts',
): Promise<string> {
  // Cloudinary accepts data URIs directly — no buffer conversion needed
  const result = await cloudinary.uploader.upload(base64, {
    folder,
    resource_type:   'image',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [{ quality: 'auto', fetch_format: 'auto' }],
    exif: false,
  });
  return result.secure_url;
}

// ─── Internal broadcast runner ────────────────────────────────────────────────
async function runBroadcast(broadcastId: string): Promise<void> {
  const bc = await Broadcast.findOne({ broadcastId });
  if (!bc || bc.status !== 'draft') return;

  await Broadcast.updateOne({ _id: bc._id }, { $set: { status: 'sending' } });

  try {
    const users = await User.find({ isBanned: false }).select('phone').lean();
    await Broadcast.updateOne({ _id: bc._id }, { $set: { recipientCount: users.length } });

    const BATCH = 10;
    const DELAY = 1000;
    let sent    = 0;

    for (let i = 0; i < users.length; i += BATCH) {
      const batch = users.slice(i, i + BATCH);

      const results = await Promise.allSettled(
        batch.map(u => {
          if (bc.type === 'ad' && bc.imageUrl) {
            return sendImageTracked(u.phone, bc.imageUrl, bc.body, bc.type, bc.broadcastId);
          }
          return sendTracked(u.phone, bc.body, bc.type, bc.broadcastId);
        }),
      );

      sent += results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
      if (i + BATCH < users.length) await new Promise(r => setTimeout(r, DELAY));
    }

    await Broadcast.updateOne(
      { _id: bc._id },
      { $set: { status: 'sent', sentAt: new Date(), sentCount: sent } },
    );
    console.log(`[BROADCAST] ${bc.broadcastId} sent ${sent}/${users.length}`);
  } catch (err: any) {
    console.error('[BROADCAST] Error:', err);
    await Broadcast.updateOne(
      { _id: bc._id },
      { $set: { status: 'failed', errorMessage: err?.message ?? 'Unknown error' } },
    );
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/', adminAuth, async (req: AdminRequest, res: Response) => {
  const { status, type, page = 1, limit = 20 } = req.query;
  const filter: any = {};
  if (status) filter.status = status;
  if (type)   filter.type   = type;

  const [broadcasts, total] = await Promise.all([
    Broadcast.find(filter).sort({ createdAt: -1 }).skip((+page - 1) * +limit).limit(+limit),
    Broadcast.countDocuments(filter),
  ]);

  res.json({ broadcasts, total, page: +page, pages: Math.ceil(total / +limit) });
});

router.get('/:id', adminAuth, async (req: AdminRequest, res: Response) => {
  const bc = await Broadcast.findOne({ broadcastId: req.params.id });
  if (!bc) return res.status(404).json({ error: 'Broadcast not found' });
  res.json({ broadcast: bc });
});

// POST /admin/broadcasts
// Body (application/json):
//   type:          'announcement' | 'ad'
//   title:         string
//   body:          string
//   imageBase64?:  string  — full data URI, e.g. "data:image/png;base64,..."
//   imageCaption?: string
//   sendNow?:      boolean
router.post('/', adminAuth, async (req: AdminRequest, res: Response) => {
  const { type, title, body, imageBase64, imageCaption, sendNow } = req.body;

  if (!['announcement', 'ad'].includes(type)) {
    return res.status(400).json({ error: 'type must be announcement or ad' });
  }
  if (!title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'title and body are required' });
  }
  if (type === 'ad' && !imageBase64) {
    return res.status(400).json({ error: 'imageBase64 is required for ads' });
  }

  let imageUrl: string | undefined;

  if (imageBase64) {
    try {
      imageUrl = await uploadBase64ToCloudinary(imageBase64);
    } catch (err) {
      console.error('[BROADCAST] Cloudinary upload failed:', err);
      return res.status(500).json({ error: 'Image upload failed' });
    }
  }

  const bc = await Broadcast.create({
    type,
    title:        title.trim(),
    body:         body.trim(),
    imageUrl,
    imageCaption: imageCaption?.trim(),
    status:       'draft',
  });

  if (sendNow === true || sendNow === 'true') {
    setImmediate(() => runBroadcast(bc.broadcastId).catch(console.error));
  }

  res.status(201).json({ success: true, broadcast: bc, sending: !!sendNow });
});

router.post('/:id/send', adminAuth, async (req: AdminRequest, res: Response) => {
  const bc = await Broadcast.findOne({ broadcastId: req.params.id, status: 'draft' });
  if (!bc) return res.status(404).json({ error: 'Draft broadcast not found' });

  setImmediate(() => runBroadcast(bc.broadcastId).catch(console.error));
  res.json({ success: true, message: 'Broadcast queued' });
});

router.delete('/:id', adminAuth, async (req: AdminRequest, res: Response) => {
  const bc = await Broadcast.findOne({ broadcastId: req.params.id });
  if (!bc)                   return res.status(404).json({ error: 'Broadcast not found' });
  if (bc.status !== 'draft') return res.status(409).json({ error: 'Only drafts can be deleted' });

  await Broadcast.deleteOne({ _id: bc._id });
  res.json({ success: true });
});

export default router;