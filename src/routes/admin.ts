import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt    from 'jsonwebtoken';
import { adminAuth, AdminRequest } from '../middleware/auth';
import { adminLimiter, loginLimiter } from '../middleware/rateLimiter';
import { sendMessage } from '../services/whatsapp';
import { createEscrowPaymentLink, transferToSeller } from '../services/flutterwave';
import { broadcastNewListing } from '../services/notifications';
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

    const token = jwt.sign(
      { admin: true, iat: Date.now() },
      process.env.JWT_SECRET!,
      { expiresIn: '8h' },
    );
    res.json({ token });
  } catch {
    res.status(500).json({ error: 'Login failed' });
  }
});

// ── Dashboard stats ───────────────────────────────────────────────────────────
router.get('/stats', adminAuth, async (_req: AdminRequest, res: Response) => {
  const [
    totalUsers, totalListings, activeListings, pendingVerification,
    totalTransactions, completedTransactions, openDisputes,
    pendingReleases, revenue,
  ] = await Promise.all([
    User.countDocuments(),
    Listing.countDocuments(),
    Listing.countDocuments({ status: 'active' }),
    Listing.countDocuments({ status: 'pending_verification' }),
    Transaction.countDocuments(),
    Transaction.countDocuments({ status: 'completed' }),
    Dispute.countDocuments({ status: 'open' }),
    Transaction.countDocuments({ status: 'pending_release' }),
    Transaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$platformFee' } } },
    ]),
  ]);

  res.json({
    users:        { total: totalUsers },
    listings:     { total: totalListings, active: activeListings, pendingVerification },
    transactions: { total: totalTransactions, completed: completedTransactions, pendingRelease: pendingReleases },
    disputes:     { open: openDisputes },
    revenue:      { total: revenue[0]?.total || 0 },
  });
});

// ── Listings ──────────────────────────────────────────────────────────────────
router.get('/listings', adminAuth, async (req: AdminRequest, res: Response) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter: any = status ? { status: status as string } : {};

  const listings = await Listing.find(filter)
    .populate('seller', 'phone name totalSales sellerRating')
    .sort({ createdAt: -1 })
    .skip((+page - 1) * +limit)
    .limit(+limit);

  const total = await Listing.countDocuments(filter);
  res.json({ listings, total, page: +page, pages: Math.ceil(total / +limit) });
});

// When a listing is approved, generate a Flutterwave payment link and store it.
// Buyers will use this link when they trigger BUY.
router.post('/listings/:id/approve', adminAuth, async (req: AdminRequest, res: Response) => {
  const listing = await Listing.findById(req.params.id)
    .populate<{ seller: any }>('seller');

  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  listing.status = 'active';
  await listing.save();

  // Notify seller
  await sendMessage(listing.seller.phone,
    `✅ *Listing Verified!*\n\n` +
    `Listing: *${listing.listingId}*\n\n` +
    `🟢 Your listing is now *LIVE* and visible to buyers!`
  );

  // Broadcast to all users (fire-and-forget — don't block the response)
  broadcastNewListing(listing).catch(err =>
    console.error('[NOTIFY] Broadcast error:', err)
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
    `Type *SELL* to start a new listing.`,
  ).catch(() => {});

  res.json({ success: true });
});

// ── Payout release ────────────────────────────────────────────────────────────
// Called manually from dashboard or via WhatsApp PAYOUT command.
router.post('/transactions/:id/release', adminAuth, async (req: AdminRequest, res: Response) => {
  const txn = await Transaction.findOne({
    $or: [{ _id: req.params.id }, { transactionId: req.params.id }],
    status: 'pending_release',
  }).populate<{ seller: any; buyer: any }>(['seller', 'buyer']);

  if (!txn) return res.status(404).json({ error: 'Transaction not found or not ready for release' });

  try {
    await transferToSeller(txn as any);

    txn.status      = 'completed';
    txn.completedAt = new Date();
    await txn.save();

    await sendMessage(txn.seller.phone,
      `💸 *Payment Sent!*\n\n` +
      `Transaction: ${txn.transactionId}\n` +
      `Amount: ₦${txn.sellerReceives?.toLocaleString()}\n` +
      `Bank: ${txn.seller.bankName} — ${txn.seller.bankAccountNumber}\n\n` +
      `Transfer is on its way. Check your account shortly.`,
    ).catch(() => {});

    res.json({ success: true, transactionId: txn.transactionId });
  } catch (err: any) {
    console.error('[Admin] Release failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── All transactions (paginated + filterable) ─────────────────────────────────
router.get('/transactions', adminAuth, async (req: AdminRequest, res: Response) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter: any = status && status !== 'all' ? { status } : {};

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .populate('buyer',  'phone')
      .populate('seller', 'phone bankName bankAccountNumber bankAccountName')
      .sort({ createdAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit),
    Transaction.countDocuments(filter),
  ]);

  res.json({
    transactions,
    total,
    page:  +page,
    pages: Math.ceil(total / +limit),
  });
});

// Pending release queue — for the dashboard payout list
router.get('/transactions/pending-release', adminAuth, async (_req: AdminRequest, res: Response) => {
  const txns = await Transaction.find({ status: 'pending_release' })
    .populate('seller', 'phone bankName bankAccountNumber bankAccountName')
    .populate('buyer',  'phone')
    .sort({ releaseAt: 1 });

  res.json({ transactions: txns });
});


// ── Disputes ──────────────────────────────────────────────────────────────────
router.get('/disputes', adminAuth, async (req: AdminRequest, res: Response) => {
  const { status } = req.query;
  const filter: any = status ? { status: status as string } : { status: 'open' };

  const disputes = await Dispute.find(filter)
    .populate('transaction')
    .populate('raisedBy', 'phone name')
    .sort({ createdAt: 1 });

  res.json({ disputes });
});

router.post('/disputes/:id/resolve', adminAuth, async (req: AdminRequest, res: Response) => {
  const { decision, resolution } = req.body;

  if (!['buyer', 'seller'].includes(decision)) {
    return res.status(400).json({ error: 'Decision must be buyer or seller' });
  }

  const dispute = await Dispute.findById(req.params.id)
    .populate<{ transaction: any }>('transaction');

  if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

  const txn = dispute.transaction;

  dispute.status     = decision === 'buyer' ? 'resolved_buyer' : 'resolved_seller';
  dispute.resolution = resolution;
  dispute.resolvedAt = new Date();
  await dispute.save();

  if (decision === 'buyer') {
    // Refund buyer — mark for manual refund (FW refunds via dashboard or API)
    txn.status     = 'refunded';
    txn.refundedAt = new Date();
    txn.escrowHeld = false;
    await txn.save();

    await sendMessage(
      process.env.SUPPORT_PHONE!,
      `🔔 *Refund Required*\n\nTXN: ${txn.transactionId}\nAmount: ₦${txn.amount?.toLocaleString()}\nFW Ref: ${txn.flutterwaveRef}\n\nProcess refund via Flutterwave dashboard.`,
    ).catch(() => {});

    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      await sendMessage(buyer.phone,
        `✅ *Dispute Resolved in Your Favour*\n\n` +
        `Transaction: ${txn.transactionId}\n` +
        `₦${txn.amount?.toLocaleString()} will be refunded within 3–5 business days.\n\n` +
        `Resolution: ${resolution}`,
      ).catch(() => {});
    }

    const seller = await User.findById(txn.seller);
    if (seller) {
      await sendMessage(seller.phone,
        `❌ *Dispute Resolved — Buyer Refunded*\n\n` +
        `Transaction: ${txn.transactionId}\nResolution: ${resolution}\n\n` +
        `Contact support if you believe this is incorrect: ${process.env.SUPPORT_PHONE}`,
      ).catch(() => {});
    }
  } else {
    // Release to seller
    txn.status    = 'pending_release';
    txn.releaseAt = new Date();
    await txn.save();

    // Re-use the release endpoint logic by notifying admin
    await sendMessage(
      process.env.SUPPORT_PHONE!,
      `✅ *Dispute Resolved — Release to Seller*\n\nTXN: ${txn.transactionId}\nProcess payout via: POST /admin/transactions/${txn.transactionId}/release`,
    ).catch(() => {});

    const seller = await User.findById(txn.seller);
    if (seller) {
      await sendMessage(seller.phone,
        `✅ *Dispute Resolved in Your Favour*\n\n` +
        `Transaction: ${txn.transactionId}\n` +
        `Your payment of ₦${txn.sellerReceives?.toLocaleString()} is being processed.\n\n` +
        `Resolution: ${resolution}`,
      ).catch(() => {});
    }
  }

  res.json({ success: true, status: dispute.status });
});

router.get('/users', adminAuth, async (req: AdminRequest, res: Response) => {
  const { page = 1, limit = 20, search } = req.query;

  const filter: any = {};
  if (search) {
    filter.$or = [
      { phone: { $regex: search, $options: 'i' } },
      { name:  { $regex: search, $options: 'i' } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('phone name isBanned banReason sellerRating totalSales totalPurchases lastActiveAt joinedAt notifications isVerified')
      .sort({ lastActiveAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit),
    User.countDocuments(filter),
  ]);

  res.json({ users, total, page: +page, pages: Math.ceil(total / +limit) });
});

// ── Users ─────────────────────────────────────────────────────────────────────
router.post('/users/:phone/ban', adminAuth, async (req: AdminRequest, res: Response) => {
  const { reason } = req.body;
  await User.findOneAndUpdate(
    { phone: req.params.phone },
    { isBanned: true, banReason: reason || 'Policy violation' },
  );
  res.json({ success: true });
});

router.post('/users/:phone/unban', adminAuth, async (req: AdminRequest, res: Response) => {
  await User.findOneAndUpdate(
    { phone: req.params.phone },
    { isBanned: false, banReason: undefined },
  );
  res.json({ success: true });
});

export default router;