// src/middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) {
  console.error({
    message: err.message,
    stack:   process.env.NODE_ENV === 'development' ? err.stack : undefined,
    path:    req.path,
    method:  req.method,
    time:    new Date().toISOString(),
  });

  // Don't expose internals in production
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  res.status(500).json({ error: message });
}