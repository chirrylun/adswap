// src/middleware/rateLimiter.ts
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import slowDown  from 'express-slow-down';
import { Request, Response, NextFunction } from 'express';

// ─── 1. Global API limiter ────────────────────────────────────────────────────
export const globalLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              500,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/health',
});

// ─── 2. Webhook limiter ───────────────────────────────────────────────────────
export const webhookLimiter = rateLimit({
  windowMs:        1 * 60 * 1000,
  max:             120,
  standardHeaders: true,
  legacyHeaders:   false,
 keyGenerator: (req) => {
  const body  = (req as any).body;
  const phone = body?.entry?.[0]?.changes?.[0]
                    ?.value?.messages?.[0]?.from;
  return phone || ipKeyGenerator(req as any);
},
  message: { error: 'Webhook rate limit exceeded.' },
});

// ─── 3. Per-phone bot limiter ─────────────────────────────────────────────────
const phoneMessageCounts = new Map<string, { count: number; reset: number }>();

export function perPhoneLimiter(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const phone = extractPhone(req.body);
  if (!phone) return next();

  const now    = Date.now();
  const limit  = 20;
  const window = 60 * 1000;

  const record = phoneMessageCounts.get(phone);

  if (!record || now > record.reset) {
    phoneMessageCounts.set(phone, { count: 1, reset: now + window });
    return next();
  }

  if (record.count >= limit) {
    res.sendStatus(200);
    import('../services/whatsapp').then(({ sendMessage }) => {
      sendMessage(
        phone,
        '⚠️ You\'re sending messages too fast.\n\nPlease wait a minute and try again.'
      ).catch(console.error);
    });
    return;
  }

  record.count++;
  phoneMessageCounts.set(phone, record);
  next();
}

// ─── 4. Admin route limiter ───────────────────────────────────────────────────
export const adminLimiter = rateLimit({
  windowMs:        10 * 60 * 1000,
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Admin rate limit exceeded.' },
});

// ─── 5. Login brute-force protection ─────────────────────────────────────────
export const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000,
  max:             5,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// ─── 6. Slow down repeated requests ──────────────────────────────────────────
export const speedLimiter = slowDown({
  windowMs:    15 * 60 * 1000,
  delayAfter:  50,
  delayMs:     () => 500,
});

// ─── Helper ───────────────────────────────────────────────────────────────────
function extractPhone(body: any): string | null {
  try {
    return body?.entry?.[0]?.changes?.[0]
               ?.value?.messages?.[0]?.from || null;
  } catch {
    return null;
  }
}

// ─── Cleanup old phone records every 5 minutes ───────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [phone, record] of phoneMessageCounts.entries()) {
    if (now > record.reset) phoneMessageCounts.delete(phone);
  }
}, 5 * 60 * 1000);