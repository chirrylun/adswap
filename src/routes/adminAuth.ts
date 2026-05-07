import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt    from 'jsonwebtoken';
import { loginLimiter } from '../middleware/rateLimiter';
import Admin from '../models/Admin';

const router = Router();

// POST /admin/create — bootstrap only, gate with ADMIN_BOOTSTRAP_SECRET
router.post('/create', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { name, email, password, adminRole, secret } = req.body;

    if (secret !== process.env.ADMIN_BOOTSTRAP_SECRET) {
      return res.status(403).json({ error: 'Invalid bootstrap secret.' });
    }
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required.' });
    }

    const pwRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!pwRegex.test(password)) {
      return res.status(400).json({
        error: 'Password must be ≥8 chars with upper, lower, and a number.',
      });
    }

    const existing = await Admin.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Email already in use.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await Admin.create({
      name,
      email: email.toLowerCase(),
      passwordHash,
      adminRole: adminRole ?? 'ADMIN',
    });

    res.status(201).json({
      admin: { id: admin._id, name: admin.name, email: admin.email, adminRole: admin.adminRole },
    });
  } catch (err) {
    console.error('[admin/create]', err);
    res.status(500).json({ error: 'Failed to create admin.' });
  }
});

// POST /admin/signin — email + password → HttpOnly cookie + admin payload
router.post('/signin', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin || !(await admin.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { adminId: String(admin._id), adminRole: admin.adminRole },
      process.env.JWT_SECRET!,
      { expiresIn: '8h' },
    );

    admin.lastLoginAt = new Date();
    await admin.save();

   res.cookie('admin_token', token, {
  httpOnly: true,
  secure:   true,
  sameSite: 'none',
  maxAge:   8 * 60 * 60 * 1000,
});

    res.json({
      admin: {
        id:        String(admin._id),
        name:      admin.name,
        email:     admin.email,
        adminRole: admin.adminRole,
      },
    });
  } catch (err) {
    console.error('[admin/signin]', err);
    res.status(500).json({ error: 'Sign-in failed.' });
  }
});

// POST /admin/signout
router.post('/signout', (_req: Request, res: Response) => {
  res.clearCookie('admin_token', {
    httpOnly: true,
    secure:   true,
    sameSite: 'none',
  });
  res.json({ success: true });
});

export default router;