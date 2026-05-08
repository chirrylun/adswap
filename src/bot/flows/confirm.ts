import { sendMessage }   from '../../services/whatsapp';
import { clearSession }  from '../session';
import Transaction       from '../../models/Transaction';
import Listing           from '../../models/Listing';
import User              from '../../models/User';

// ── CONFIRM [txnId] — buyer confirms they have full access ────────────────────
export async function handleBuyerConfirm(
  phone: string,
  text:  string,
): Promise<void> {
  const txnId = text.replace('CONFIRM ', '').trim();

  if (!txnId) {
    return sendMessage(phone,
      `To confirm a transfer, reply:\n*CONFIRM [Transaction ID]*\n\nExample: CONFIRM TXN-ABC123`,
    );
  }

  const buyer = await User.findOne({ phone });
  if (!buyer) return;

  const txn = await Transaction.findOne({
    transactionId: txnId,
    buyer:         buyer._id,
  }).populate<{ seller: any; listing: any }>(['seller', 'listing']);

  if (!txn) {
    return sendMessage(phone, `❌ Transaction not found. Check the ID and try again.`);
  }

  if (txn.status === 'pending_release' || txn.status === 'completed') {
    return sendMessage(phone,
      `✅ This transaction has already been confirmed.\n\nTransaction: ${txnId}`,
    );
  }

  if (txn.status !== 'transfer_in_progress') {
    return sendMessage(phone,
      `❌ This transaction is not ready for confirmation.\n\n` +
      `Current status: ${txn.status}\n\n` +
      `If something is wrong, type: *DISPUTE ${txnId}*`,
    );
  }

  // ── Flip to pending_release — admin processes the payout ──────────────────
  txn.status      = 'pending_release';
  txn.confirmedAt = new Date();
  txn.releaseAt   = new Date();
  await txn.save();

  // Mark listing as sold
  await Listing.findByIdAndUpdate(txn.listing?._id ?? txn.listing, { status: 'sold' });

  // Update seller stats
  txn.seller.totalSales  += 1;
  txn.seller.lastActiveAt = new Date();
  await txn.seller.save();

  // Update buyer stats
  buyer.totalPurchases = (buyer.totalPurchases ?? 0) + 1;
  buyer.lastActiveAt   = new Date();
  await buyer.save();

  await clearSession(phone);

  // ── Alert admin for payout processing ─────────────────────────────────────
  await sendMessage(
    process.env.SUPPORT_PHONE!,
    `✅ *Release Request — Buyer Confirmed*\n\n` +
    `TXN: ${txn.transactionId}\n` +
    `Seller: ${txn.seller.phone}\n` +
    `Amount: ₦${txn.sellerReceives?.toLocaleString()}\n` +
    `Bank: ${txn.seller.bankName} — ${txn.seller.bankAccountNumber}\n` +
    `Account Name: ${txn.seller.bankAccountName}\n\n` +
    `Process payout on the dashboard.`,
  ).catch(() => {});

  // ── Notify buyer ───────────────────────────────────────────────────────────
  await sendMessage(phone,
    `🎉 *Access Confirmed!*\n\n` +
    `Transaction: ${txnId}\n\n` +
    `Payment has been released to the seller and is being processed.\n\n` +
    `Please rate your experience:\n` +
    `Reply: *RATE ${txnId} [1-5]*\n\n` +
    `Example: *RATE ${txnId} 5*\n\n` +
    `Thank you for using AdSwap! 🙏`,
  );

  // ── Notify seller ──────────────────────────────────────────────────────────
  await sendMessage(txn.seller.phone,
    `🎉 *Buyer has confirmed access!*\n\n` +
    `Transaction: ${txnId}\n` +
    `Your payout of ₦${txn.sellerReceives?.toLocaleString()} is being processed.\n\n` +
    `Funds will be sent to:\n` +
    `🏦 ${txn.seller.bankName} — ${txn.seller.bankAccountNumber}\n\n` +
    `Allow 1–2 business days for settlement.\n\n` +
    `Thank you for selling on AdSwap! 🙏`,
  ).catch(() => {});
}

// ── RATE [txnId] [1-5] — buyer rates the seller ───────────────────────────────
export async function handleRate(
  phone: string,
  text:  string,
): Promise<void> {
  const parts  = text.split(' ');
  const txnId  = parts[1];
  const rating = parseInt(parts[2], 10);

  if (!txnId || isNaN(rating) || rating < 1 || rating > 5) {
    return sendMessage(phone,
      `❌ Invalid format.\n\nUse: *RATE [Transaction ID] [1-5]*\nExample: RATE TXN-ABC123 5`,
    );
  }

  const buyer = await User.findOne({ phone });
  const txn   = await Transaction.findOne({
    transactionId: txnId,
    buyer:         buyer?._id,
    status:        { $in: ['pending_release', 'completed'] },
  }).populate<{ seller: any }>('seller');

  if (!txn) {
    return sendMessage(phone, `❌ Transaction not found or not yet confirmed.`);
  }

  if (txn.buyerRating) {
    return sendMessage(phone, `You have already rated this transaction.`);
  }

  txn.buyerRating = rating;
  await txn.save();

  // Update seller rolling rating
  const seller        = txn.seller;
  const totalRatings  = (seller.totalRatings ?? 0) + 1;
  const newRating     = (((seller.sellerRating ?? 0) * (seller.totalRatings ?? 0)) + rating) / totalRatings;
  seller.sellerRating = Math.round(newRating * 10) / 10;
  seller.totalRatings = totalRatings;
  await seller.save();

  await sendMessage(phone,
    `✅ Rating submitted: ${'⭐'.repeat(rating)}\n\nThank you for your feedback!`,
  );
}