// src/middleware/validatePaystack.ts
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function validatePaystackWebhook(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const signature = req.headers['x-paystack-signature'] as string;

  if (!signature) {
    return res.status(401).json({ error: 'Missing Paystack signature' });
  }

  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
    .update(req.body) // raw body buffer
    .digest('hex');

  if (hash !== signature) {
    console.warn('Invalid Paystack webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  next();
}