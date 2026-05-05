import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt    from 'jsonwebtoken';
import { adminAuth, AdminRequest } from '../middleware/auth';
import { adminLimiter, loginLimiter } from '../middleware/rateLimiter';
import { sendMessage } from '../services/whatsapp';
import Listing     from '../models/Listing';
import Transaction from '../models/Transaction';
import Dispute     from '../models/Dispute';
import User        from '../models/User';

const router = Router();

router.use(adminLimiter);

// ── Login ─────────────────────────────────────────────────────────────────────
router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH!);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });

    const token = jwt.sign({ admin: true, iat: Date.now() }, process.env.JWT_SECRET!, {
      expiresIn: '8h',
    });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Dashboard stats ───────────────────────────────────────────────────────────
router.get('/stats', adminAuth, async (_req: AdminRequest, res: Response) => {
  const [
    totalUsers,
    totalListings,
    activeListings,
    pendingVerification,
    totalTransactions,
    completedTransactions,
    openDisputes,
    revenue,
  ] = await Promise.all([
    User.countDocuments(),
    Listing.countDocuments(),
    Listing.countDocuments({ status: 'active' }),
    Listing.countDocuments({ status: 'pending_verification' }),
    Transaction.countDocuments(),
    Transaction.countDocuments({ status: 'completed' }),
    Dispute.countDocuments({ status: 'open' }),
    Transaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$platformFee' } } },
    ]),
  ]);

  res.json({
    users:        { total: totalUsers },
    listings:     { total: totalListings, active: activeListings, pendingVerification },
    transactions: { total: totalTransactions, completed: completedTransactions },
    disputes:     { open: openDisputes },
    revenue:      { total: revenue[0]?.total || 0 },
  });
});

// ── Listings ──────────────────────────────────────────────────────────────────
router.get('/listings', adminAuth, async (req: AdminRequest, res: Response) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = status ? { status: status as string } : {};

  const listings = await Listing.find(filter)
    .populate('seller', 'phone name totalSales sellerRating')
    .sort({ createdAt: -1 })
    .skip((+page - 1) * +limit)
    .limit(+limit);

  const total = await Listing.countDocuments(filter);
  res.json({ listings, total, page: +page, pages: Math.ceil(total / +limit) });
});

router.post('/listings/:id/approve', adminAuth, async (req: AdminRequest, res: Response) => {
  const listing = await Listing.findById(req.params.id)
    .populate<{ seller: any }>('seller');

  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  listing.status = listing.feePaid ? 'active' : 'pending_payment';
  await listing.save();

  await sendMessage(listing.seller.phone,
    `✅ *Listing Verified!*\n\n` +
    `Listing: *${listing.listingId}*\n\n` +
    `${listing.feePaid
      ? '🟢 Your listing is now *LIVE* and visible to buyers!'
      : `💳 Pay listing fee of ₦${listing.listingFee.toLocaleString()} to go live.\n\nType *SELL* to get a payment link.`
    }`
  );

  res.json({ success: true, status: listing.status });
});

router.post('/listings/:id/reject', adminAuth, async (req: AdminRequest, res: Response) => {
  const { reason } = req.body;
  const listing = await Listing.findById(req.params.id)
    .populate<{ seller: any }>('seller');

  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  listing.status          = 'rejected';
  listing.rejectionReason = reason || 'Screenshots insufficient or unclear';
  await listing.save();

  await sendMessage(listing.seller.phone,
    `❌ *Listing Rejected*\n\n` +
    `Listing: ${listing.listingId}\n` +
    `Reason: ${listing.rejectionReason}\n\n` +
    `Please resubmit with clearer screenshots.\n` +
    `Type *SELL* to start a new listing.`
  );

  res.json({ success: true });
});

// ── Disputes ──────────────────────────────────────────────────────────────────
router.get('/disputes', adminAuth, async (req: AdminRequest, res: Response) => {
  const { status } = req.query;
  const filter = status ? { status: status as string } : { status: 'open' };

  const disputes = await Dispute.find(filter)
    .populate('transaction')
    .populate('raisedBy', 'phone name')
    .sort({ createdAt: 1 });

  res.json({ disputes });
});

router.post('/disputes/:id/resolve', adminAuth, async (req: AdminRequest, res: Response) => {
  const { decision, resolution, adminNotes } = req.body;
  // decision: 'buyer' | 'seller'

  if (!['buyer','seller'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be buyer or seller' });
  }

  const dispute = await Dispute.findById(req.params.id)
    .populate<{ transaction: any }>('transaction');

  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  const txn = dispute.transaction;

  dispute.status      = decision === 'buyer' ? 'resolved_buyer' : 'resolved_seller';
  dispute.resolution  = resolution;
  dispute.adminNotes  = adminNotes;
  dispute.resolvedAt  = new Date();
  await dispute.save();

  if (decision === 'buyer') {
    // Refund buyer
    txn.status      = 'refunded';
    txn.refundedAt  = new Date();
    txn.escrowHeld  = false;
    await txn.save();

    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      await sendMessage(buyer.phone,
        `✅ *Dispute Resolved in Your Favour*\n\n` +
        `Transaction: ${txn.transactionId}\n` +
        `Decision: Full refund approved\n\n` +
        `₦${txn.amount.toLocaleString()} will be returned within 3–5 business days.\n\n` +
        `Resolution: ${resolution}`
      );
    }

    const seller = await User.findById(txn.seller);
    if (seller) {
      await sendMessage(seller.phone,
        `❌ *Dispute Resolved — Buyer Refunded*\n\n` +
        `Transaction: ${txn.transactionId}\n\n` +
        `Resolution: ${resolution}\n\n` +
        `Contact support if you believe this is incorrect: ${process.env.SUPPORT_PHONE}`
      );
    }
  } else {
    // Release to seller
    const { releaseEscrow } = await import('../services/paystack');
    await releaseEscrow(txn);

    txn.status      = 'completed';
    txn.completedAt = new Date();
    await txn.save();

    const seller = await User.findById(txn.seller);
    if (seller) {
      await sendMessage(seller.phone,
        `✅ *Dispute Resolved in Your Favour*\n\n` +
        `Transaction: ${txn.transactionId}\n` +
        `Payment released: ₦${txn.sellerReceives.toLocaleString()}\n\n` +
        `Resolution: ${resolution}`
      );
    }

    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      await sendMessage(buyer.phone,
        `❌ *Dispute Resolved — Payment Released to Seller*\n\n` +
        `Transaction: ${txn.transactionId}\n\n` +
        `Resolution: ${resolution}\n\n` +
        `Contact support if you believe this is incorrect: ${process.env.SUPPORT_PHONE}`
      );
    }
  }

  res.json({ success: true, status: dispute.status });
});

// ── Users ─────────────────────────────────────────────────────────────────────
router.post('/users/:phone/ban', adminAuth, async (req: AdminRequest, res: Response) => {
  const { reason } = req.body;
  await User.findOneAndUpdate(
    { phone: req.params.phone },
    { isBanned: true, banReason: reason || 'Policy violation' }
  );
  res.json({ success: true });
});

router.post('/users/:phone/unban', adminAuth, async (req: AdminRequest, res: Response) => {
  await User.findOneAndUpdate(
    { phone: req.params.phone },
    { isBanned: false, banReason: undefined }
  );
  res.json({ success: true });
});

export default router;