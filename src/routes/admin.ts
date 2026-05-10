import { Router, Request, Response } from 'express';
import bcrypt    from 'bcryptjs';
import jwt       from 'jsonwebtoken';
import mongoose from 'mongoose';
import { adminAuth, AdminRequest } from '../middleware/auth';
import { adminLimiter, loginLimiter } from '../middleware/rateLimiter';
import { sendMessage } from '../services/whatsapp';
import { broadcastNewListing } from '../services/notifications';
import { listingDetailCTA } from '../bot/flows/listings';
import Listing     from '../models/Listing';
import Transaction from '../models/Transaction';
import Dispute     from '../models/Dispute';
import User        from '../models/User';
import BuyRequest  from '../models/Request';
import { TYPE_LABELS } from '../config/constants';

const router = Router();

router.use(adminLimiter);

// ── Message template helpers ──────────────────────────────────────────────────

export const approvalSellerMessage = (listingId: string): string =>
  `✅ *Listing Verified!*\n\n` +
  `Listing: *${listingId}*\n\n` +
  `🟢 Your listing is now *LIVE* and visible to buyers!\n\n` +
  `Buyers can purchase at your listed price or send you an offer to negotiate.\n` +
  `You'll be notified of any offers and can accept, reject, or counter them.\n\n` +
  `🔒 All payments are arranged through *Koji Agudah escrow* — your payout is protected.\n\n` +
  `To see active offers on your listings, type *MY OFFERS*`;

// ── Safe ID filter helpers ────────────────────────────────────────────────────
function txnFilter(id: string): Record<string, any> {
  if (mongoose.isValidObjectId(id)) {
    return { $or: [{ transactionId: id }, { _id: id }] };
  }
  return { transactionId: id };
}

function reqFilter(id: string): Record<string, any> {
  if (mongoose.isValidObjectId(id)) {
    return { $or: [{ requestId: id }, { _id: id }] };
  }
  return { requestId: id };
}

function paramId(req: AdminRequest): string {
  return Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
}

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
    totalTransactions, completedTransactions, pendingTransactions, openDisputes,
    totalRequests, openRequests,
    revenue,
  ] = await Promise.all([
    User.countDocuments(),
    Listing.countDocuments(),
    Listing.countDocuments({ status: 'active' }),
    Listing.countDocuments({ status: 'pending_verification' }),
    Transaction.countDocuments(),
    Transaction.countDocuments({ status: 'completed' }),
    Transaction.countDocuments({ status: 'pending' }),
    Dispute.countDocuments({ status: 'open' }),
    BuyRequest.countDocuments(),
    BuyRequest.countDocuments({ status: 'open' }),
    Transaction.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$platformFee' } } },
    ]),
  ]);

  res.json({
    users:        { total: totalUsers },
    listings:     { total: totalListings, active: activeListings, pendingVerification },
    transactions: { total: totalTransactions, completed: completedTransactions, pending: pendingTransactions },
    disputes:     { open: openDisputes },
    requests:     { total: totalRequests, open: openRequests },
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

router.post('/listings/:id/approve', adminAuth, async (req: AdminRequest, res: Response) => {
  const listing = await Listing.findById(req.params.id)
    .populate<{ seller: any }>('seller');

  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  await Listing.updateOne({ _id: listing._id }, { $set: { status: 'active' } });

  await sendMessage(listing.seller.phone, approvalSellerMessage(listing.listingId)).catch(() => {});

  broadcastNewListing(listing).catch(err =>
    console.error('[NOTIFY] Broadcast error:', err),
  );

  const linkedReq = await BuyRequest.findOne({
    type:        listing.type,
    status:      'open',
    respondents: listing.seller._id,
  }).populate<{ requester: any }>('requester');

  if (linkedReq) {
    const label = TYPE_LABELS[listing.type] ?? listing.type;
    await sendMessage(linkedReq.requester.phone,
      `🟢 *Good news! A seller responded to your request*\n\n` +
      `You requested a *${label}* (Ref: ${linkedReq.requestId}).\n\n` +
      `A seller has listed a verified asset that matches:\n\n` +
      `\`VIEW ${listing.listingId}\`\n\n` +
      `🔒 Ready to buy? Your payment will be protected by *Koji Agudah escrow*.\n\n` +
      `Type *LISTINGS* to browse all available listings.`,
    ).catch(() => {});

    await BuyRequest.updateOne({ _id: linkedReq._id }, { $set: { status: 'filled' } });
  }

  res.json({ success: true, status: 'active' });
});

router.post('/listings/:id/reject', adminAuth, async (req: AdminRequest, res: Response) => {
  const { reason } = req.body;

  const listing = await Listing.findById(req.params.id)
    .populate<{ seller: any }>('seller');

  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const rejectionReason = reason || 'Screenshots insufficient or unclear';

  await Listing.updateOne(
    { _id: listing._id },
    { $set: { status: 'rejected', rejectionReason } },
  );

  await sendMessage(listing.seller.phone,
    `❌ *Listing Rejected*\n\n` +
    `Listing: ${listing.listingId}\n` +
    `Reason: ${rejectionReason}\n\n` +
    `Please resubmit with clearer screenshots.\n` +
    `Type *SELL* to start a new listing.`,
  ).catch(() => {});

  res.json({ success: true });
});

// ── Transactions ──────────────────────────────────────────────────────────────
router.get('/transactions', adminAuth, async (req: AdminRequest, res: Response) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter: any = status && status !== 'all' ? { status } : {};

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .populate('buyer',   'phone')
      .populate('seller',  'phone')
      .populate('listing', 'listingId type')
      .sort({ createdAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit),
    Transaction.countDocuments(filter),
  ]);

  res.json({ transactions, total, page: +page, pages: Math.ceil(total / +limit) });
});

router.get('/transactions/:id', adminAuth, async (req: AdminRequest, res: Response) => {
  const txn = await Transaction.findOne(txnFilter(paramId(req)) as any)
    .populate('buyer',   'phone')
    .populate('seller',  'phone')
    .populate('listing', 'listingId type price');

  if (!txn) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ transaction: txn });
});

router.post('/transactions/:id/complete', adminAuth, async (req: AdminRequest, res: Response) => {
  const { adminNote } = req.body;

  const txn = await Transaction.findOne(
    Object.assign(txnFilter(paramId(req)), { status: 'pending' }) as any,
  ).populate<{ seller: any; buyer: any }>(['seller', 'buyer']);

  if (!txn) return res.status(404).json({ error: 'Transaction not found or not in pending status' });

  txn.status      = 'completed';
  txn.completedAt = new Date();
  if (adminNote) txn.adminNote = adminNote;
  await txn.save();

  await sendMessage(txn.seller.phone,
    `💸 *Payment Released!*\n\n` +
    `Transaction: ${txn.transactionId}\n` +
    `Amount: ₦${txn.sellerReceives?.toLocaleString()}\n\n` +
    `Your payment has been sent via Koji Agudah escrow. Please check your account.\n\n` +
    `Thank you for selling on Swappa! 🎉`,
  ).catch(() => {});

  await sendMessage(txn.buyer.phone,
    `✅ *Transaction Completed*\n\n` +
    `Transaction: ${txn.transactionId}\n\n` +
    `Your deal is complete. Enjoy your new account!\n\n` +
    `Any concerns? Type *HELP*`,
  ).catch(() => {});

  res.json({ success: true, transactionId: txn.transactionId, status: 'completed' });
});

router.post('/transactions/:id/cancel', adminAuth, async (req: AdminRequest, res: Response) => {
  const { adminNote } = req.body;

  const txn = await Transaction.findOne(
    Object.assign(txnFilter(paramId(req)), { status: 'pending' }) as any,
  ).populate<{ seller: any; buyer: any }>(['seller', 'buyer']);

  if (!txn) return res.status(404).json({ error: 'Transaction not found or not in pending status' });

  txn.status      = 'cancelled';
  txn.cancelledAt = new Date();
  if (adminNote) txn.adminNote = adminNote;
  await txn.save();

  await sendMessage(txn.buyer.phone,
    `❌ *Transaction Cancelled*\n\n` +
    `Transaction: ${txn.transactionId}\n\n` +
    `This deal has been cancelled. If you paid into escrow, our team will arrange your refund.\n\n` +
    `Type *LISTINGS* to browse other deals or *HELP* for support.`,
  ).catch(() => {});

  await sendMessage(txn.seller.phone,
    `❌ *Transaction Cancelled*\n\n` +
    `Transaction: ${txn.transactionId}\n\n` +
    `This deal has been cancelled. Your listing may still be active — type *LISTINGS* to check.\n\n` +
    `Questions? Type *HELP*`,
  ).catch(() => {});

  res.json({ success: true, transactionId: txn.transactionId, status: 'cancelled' });
});

router.post('/transactions/:id/reopen', adminAuth, async (req: AdminRequest, res: Response) => {
  const { adminNote } = req.body;

  const txn = await Transaction.findOne(
    Object.assign(txnFilter(paramId(req)), { status: 'cancelled' }) as any,
  );

  if (!txn) return res.status(404).json({ error: 'Transaction not found or not cancelled' });

  txn.status      = 'pending';
  txn.cancelledAt = undefined;
  if (adminNote) txn.adminNote = adminNote;
  await txn.save();

  res.json({ success: true, transactionId: txn.transactionId, status: 'pending' });
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
    txn.status      = 'cancelled';
    txn.cancelledAt = new Date();
    txn.adminNote   = `Dispute resolved in buyer's favour: ${resolution}`;
    await txn.save();

    await sendMessage(
      process.env.PAYMENT_PHONE!,
      `🔔 *Dispute Resolved — Refund Required*\n\n` +
      `TXN: ${txn.transactionId}\n` +
      `Amount to refund: ₦${txn.amount?.toLocaleString()}\n\n` +
      `Resolution: ${resolution}\n\n` +
      `Process refund to buyer via Koji Agudah escrow dashboard.`,
    ).catch(() => {});

    const buyer = await User.findById(txn.buyer);
    if (buyer) {
      await sendMessage(buyer.phone,
        `✅ *Dispute Resolved in Your Favour*\n\n` +
        `Transaction: ${txn.transactionId}\n` +
        `₦${txn.amount?.toLocaleString()} will be refunded to you via escrow.\n\n` +
        `Resolution: ${resolution}`,
      ).catch(() => {});
    }

    const seller = await User.findById(txn.seller);
    if (seller) {
      await sendMessage(seller.phone,
        `❌ *Dispute Resolved — Buyer Refunded*\n\n` +
        `Transaction: ${txn.transactionId}\n` +
        `Resolution: ${resolution}\n\n` +
        `Contact support if you believe this is incorrect: ${process.env.SUPPORT_PHONE}`,
      ).catch(() => {});
    }
  } else {
    txn.status      = 'completed';
    txn.completedAt = new Date();
    txn.adminNote   = `Dispute resolved in seller's favour: ${resolution}`;
    await txn.save();

    await sendMessage(
      process.env.PAYMENT_PHONE!,
      `✅ *Dispute Resolved — Release to Seller*\n\n` +
      `TXN: ${txn.transactionId}\n` +
      `Amount: ₦${txn.sellerReceives?.toLocaleString()}\n\n` +
      `Resolution: ${resolution}\n\n` +
      `Process payout to seller via Koji Agudah escrow dashboard.`,
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

// ── Requests ──────────────────────────────────────────────────────────────────
router.get('/requests', adminAuth, async (req: AdminRequest, res: Response) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter: any = status && status !== 'all' ? { status } : {};

  const [requests, total] = await Promise.all([
    BuyRequest.find(filter)
      .populate('requester', 'phone name')
      .sort({ createdAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit),
    BuyRequest.countDocuments(filter),
  ]);

  res.json({ requests, total, page: +page, pages: Math.ceil(total / +limit) });
});

router.get('/requests/:id', adminAuth, async (req: AdminRequest, res: Response) => {
  const request = await BuyRequest.findOne(reqFilter(paramId(req)) as any)
    .populate('requester', 'phone name');

  if (!request) return res.status(404).json({ error: 'Request not found' });
  res.json({ request });
});

router.post('/requests/:id/cancel', adminAuth, async (req: AdminRequest, res: Response) => {
  const request = await BuyRequest.findOne(
    Object.assign(reqFilter(paramId(req)), { status: 'open' }) as any,
  );

  if (!request) return res.status(404).json({ error: 'Request not found or already closed' });

  await BuyRequest.updateOne({ _id: request._id }, { $set: { status: 'cancelled' } });

  res.json({ success: true, requestId: request.requestId, status: 'cancelled' });
});

// ── Users ─────────────────────────────────────────────────────────────────────
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

  const userIds       = users.map(u => u._id);
  const listingCounts = await Listing.aggregate([
    { $match: { seller: { $in: userIds }, status: 'active' } },
    { $group: { _id: '$seller', count: { $sum: 1 } } },
  ]);
  const countMap = Object.fromEntries(
    listingCounts.map(l => [l._id.toString(), l.count]),
  );

  const enriched = users.map(u => ({
    ...u.toObject(),
    activeListings: countMap[u._id.toString()] ?? 0,
  }));

  res.json({ users: enriched, total, page: +page, pages: Math.ceil(total / +limit) });
});

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