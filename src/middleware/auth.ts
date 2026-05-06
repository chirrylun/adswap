import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AdminRequest extends Request {
  // keep old shape, add adminRole for new routes
  admin?: { id: string; adminId?: string; adminRole?: string };
}

export function adminAuth(req: AdminRequest, res: Response, next: NextFunction) {
  // Cookie first (new dashboard), fall back to Bearer (existing scripts)
  const token =
    req.cookies?.admin_token ??
    req.headers.authorization?.replace('Bearer ', '');

  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    // Normalise: old tokens have { admin: true }, new have { adminId, adminRole }
    req.admin = { id: payload.adminId ?? 'legacy', ...payload };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}