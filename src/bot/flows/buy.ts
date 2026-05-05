import { sendMessage } from '../../services/whatsapp';
import { setSession, clearSession } from '../session';
import { createEscrowPayment, calculateFee } from '../../services/paystack';
import Listing     from '../../models/Listing';
import Transaction from '../../models/Transaction';
import User        from '../../models/User';
import { generateId } from '../../utils/helpers';
import { ISession } from '../../models/Session';

export async function handleBuy(
  phone:   string,
  text:    string,
  session: ISession
): Promise<void> {

  // ── BUY ADS-XXXXX ──────────────────────────────────────────────────────────
  if (text.startsWith('BUY ')) {
    const listingId = text.replace('BUY ', '').trim();

    const listing = await Listing.findOne({ listingId, status: 'active' })
      .populate<{ seller: any }>('seller');

    if (!listing) {
      return sendMessage(phone, '❌ Listing not found or no longer available.\n\nType *LISTINGS* to browse active listings.');
    }

    const buyer = await User.findOneAndUpdate(
      { phone },
      { $setOnInsert: { phone } },
      { upsert: true, new: true }
    );

    // Prevent self-purchase
    if (listing.seller.phone === phone) {
      return sendMessage(phone, "❌ You can't buy your own listing.");
    }

    // Check for existing pending transaction
    const existing = await Transaction.findOne({
      listing: listing._id,
      buyer:   buyer._id,
      status:  'awaiting_payment',
    });

    if (existing) {
      const paymentLink = await createEscrowPayment(
        phone, existing.transactionId, listing.price, listingId
      );
      return sendMessage(phone,
        `⚠️ You already have a pending transaction for this listing.\n\n` +
        `Transaction: *${existing.transactionId}*\n\n` +
        `Complete payment here:\n${paymentLink}\n\n` +
        `Type *CANCEL* to abandon it.`
      );
    }

    const { fee, sellerReceives } = calculateFee(listing.price);
    const transactionId           = `TXN-${generateId(6)}`;

    await Transaction.create({
      transactionId,
      listing:        listing._id,
      buyer:          buyer._id,
      seller:         listing.seller._id,
      amount:         listing.price,
      platformFee:    fee,
      sellerReceives,
      status:         'awaiting_payment',
    });

    await setSession(phone, 'buy_awaiting_payment', { transactionId, listingId });

    const paymentLink = await createEscrowPayment(
      phone, transactionId, listing.price, listingId
    );

    return sendMessage(phone,
      `🔒 *AdSwap Escrow Protection*\n\n` +
      `You're buying: *${listingId}*\n` +
      `Amount: ₦${listing.price.toLocaleString()}\n` +
      `Platform fee (included): ₦${fee.toLocaleString()}\n\n` +
      `*How escrow works:*\n` +
      `1️⃣  You pay AdSwap — not the seller\n` +
      `2️⃣  We hold your money securely\n` +
      `3️⃣  Seller transfers the account to you\n` +
      `4️⃣  You confirm full access within 48hrs\n` +
      `5️⃣  We release payment to seller\n\n` +
      `*Pay now:*\n${paymentLink}\n\n` +
      `Transaction ID: *${transactionId}*\n` +
      `Save this for reference.\n\n` +
      `Type *CANCEL* to exit.`
    );
  }
}

// ── Seller signals ready to transfer ─────────────────────────────────────────
export async function handleSellerReady(
  phone: string,
  text:  string
): Promise<void> {
  const parts = text.split(' ');
  const txnId = parts[1];

  if (!txnId) {
    return sendMessage(phone, 'To signal readiness, reply:\n*READY [Transaction ID]*');
  }

  const seller = await User.findOne({ phone });
  const txn    = await Transaction.findOne({
    transactionId: txnId,
    seller:        seller?._id,
    status:        'transfer_in_progress',
  }).populate('buyer');

  if (!txn) {
    return sendMessage(phone, '❌ Transaction not found or not in transfer stage.');
  }

  txn.sellerReadyAt = new Date();
  await txn.save();

  const buyer = txn.buyer as any;

  // Notify buyer
  await sendMessage(buyer.phone,
    `🔔 *Seller is ready to transfer!*\n\n` +
    `Transaction: *${txnId}*\n\n` +
    `*Transfer steps:*\n` +
    `1. Seller will add your email as account recovery\n` +
    `2. Seller will share login credentials here\n` +
    `3. Log in and verify you have full access\n` +
    `4. Change password and 2FA immediately\n` +
    `5. Confirm: *CONFIRM ${txnId}*\n\n` +
    `You have 48 hours to confirm.\n` +
    `Problems? Reply: *DISPUTE ${txnId}*`
  );

  await sendMessage(phone,
    `✅ Buyer notified.\n\n` +
    `Proceed with the account transfer.\n` +
    `Share credentials securely in your direct chat with the buyer.\n\n` +
    `Once buyer confirms, you get paid immediately.`
  );
}