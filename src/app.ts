// src/app.ts
import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors    from 'cors';
import helmet  from 'helmet';
import morgan  from 'morgan';
import cookieParser from 'cookie-parser';

import { connectDB }     from './config/db';
import { errorHandler }  from './middleware/errorHandler';
import { globalLimiter, speedLimiter } from './middleware/rateLimiter';
import webhookRouter     from './routes/webhook';
import adminRouter       from './routes/admin';
import adminAuthRouter   from './routes/adminAuth';

const app = express();

// ─── Trust proxy (needed for Railway/Heroku rate limiting by IP) ──────────────
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Allow WhatsApp API responses
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use('/webhook', cors());

// Restricted CORS for everything else
app.use(cors({
  origin: [
    process.env.APP_URL!,
    process.env.ADMIN_URL!,
    'https://graph.facebook.com',
  ],
  methods:     ['GET', 'POST'],
  credentials: true,
}));

app.use(cookieParser());

// ─── Body parsing ─────────────────────────────────────────────────────────────
// CRITICAL: Webhook routes need raw body for signature verification
// Must be before express.json()

app.use('/webhook/whatsapp', express.raw({
  type:  'application/json',
  limit: '1mb',
}));

app.use('/webhook/paystack', express.raw({
  type:  'application/json',
  limit: '1mb',
}));

// Parse raw buffer back to object for handler use
app.use('/webhook', (req: Request, res, next) => {
  if (Buffer.isBuffer(req.body)) {
    (req as any).rawBody = req.body; // save raw buffer for signature check
    try {
      req.body = JSON.parse(req.body.toString());
    } catch {
      req.body = {};
    }
  }
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─── Global rate limiting ─────────────────────────────────────────────────────
app.use(globalLimiter);
app.use(speedLimiter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV,
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/webhook', webhookRouter);
app.use('/admin',   adminAuthRouter);
app.use('/admin',   adminRouter);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`AdSwap running on port ${PORT} [${process.env.NODE_ENV}]`);
    console.log(`Webhook: ${process.env.APP_URL}/webhook/whatsapp`);
  });
});

export default app;