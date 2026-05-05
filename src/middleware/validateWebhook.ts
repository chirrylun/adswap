// src/middleware/validateWebhook.ts
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function validateMetaWebhook(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const signature = req.headers['x-hub-signature-256'] as string;

  if (!signature) {
    console.warn('Missing Meta webhook signature');
    return res.status(401).json({ error: 'Missing signature' });
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET!)
    .update(req.body) // raw body buffer — see app.ts
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  const sigBuffer      = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected,  'utf8');

  if (
    sigBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
  ) {
    console.warn('Invalid Meta webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}