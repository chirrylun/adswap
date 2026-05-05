// src/middleware/rateLimiter.ts
import rateLimit from 'express-rate-limit';
import slowDown  from 'express-slow-down';
import { Request, Response, NextFunction } from 'express';

// ─── 1. Global API limiter ────────────────────────────────────────────────────
// Applies to all routes. Stops bulk hammering.
export const globalLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              500,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/health',
});

// ─── 2. Webhook limiter ───────────────────────────────────────────────────────
// WhatsApp sends bursts — allow higher limit but still cap abuse
export const webhookLimiter = rateLimit({
  windowMs:        1 * 60 * 1000,  // 1 minute
  max:             120,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    (req) => {
    // Key by sender phone if available, fallback to IP
    const body   = req.body;
    const phone  = body?.entry?.[0]?.changes?.[0]
                       ?.value?.messages?.[0]?.from;
    return phone || req.ip || 'unknown';
  },
  message: { error: 'Webhook rate limit exceeded.' },
});

// ─── 3. Per-phone bot limiter ─────────────────────────────────────────────────
// Prevents one user spamming the bot
const phoneMessageCounts = new Map<string, { count: number; reset: number }>();

export function perPhoneLimiter(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const phone = extractPhone(req.body);
  if (!phone) return next();

  const now   = Date.now();
  const limit = 20;              // max 20 messages
  const window = 60 * 1000;     // per 60 seconds

  const record = phoneMessageCounts.get(phone);

  if (!record || now > record.reset) {
    phoneMessageCounts.set(phone, { count: 1, reset: now + window });
    return next();
  }

  if (record.count >= limit) {
    // Don't respond with HTTP error — send WhatsApp message instead
    res.sendStatus(200);
    // Import sendMessage lazily to avoid circular deps
    import('../services/whatsapp.ts').then(({ sendMessage }) => {
      sendMessage(phone,
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
  windowMs:        10 * 60 * 1000, // 10 minutes
  max:             100,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Admin rate limit exceeded.' },
});

// ─── 5. Login brute-force protection ─────────────────────────────────────────
export const loginLimiter = rateLimit({
  windowMs:        15 * 60 * 1000, // 15 minutes
  max:             5,              // only 5 login attempts
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// ─── 6. Slow down repeated requests ──────────────────────────────────────────
export const speedLimiter = slowDown({
  windowMs:        15 * 60 * 1000,
  delayAfter:      50,             // start slowing after 50 requests
  delayMs:         () => 500,      // add 500ms delay per request after limit
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