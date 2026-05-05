import { sendMessage } from '../../services/whatsapp';
import { clearSession } from '../session';
import { releaseEscrow } from '../../services/paystack';
import Transaction from '../../models/Transaction';
import Listing     from '../../models/Listing';
import User        from '../../models/User';

export async function handleConfirm(
  phone: string,
  text:  string
): Promise<void> {
  const parts = text.split(' ');
  const txnId = parts[1];

  if (!txnId) {
    return sendMessage(phone,
      'To confirm a transfer, reply:\n*CONFIRM [Transaction ID]*\n\nExample: CONFIRM TXN-ABC123'
    );
  }

  const buyer = await User.findOne({ phone });
  if (!buyer) return;

  const txn = await Transaction.findOne({
    transactionId: txnId,
    buyer:         buyer._id,
  }).populate('seller').populate('listing');

  if (!txn) {
    return sendMessage(phone, '❌ Transaction not found. Check the ID and try again.');
  }

  if (txn.status === 'completed') {
    return sendMessage(phone, `✅ This transaction was already confirmed.\n\nTransaction: ${txnId}`);
  }

  if (!['transfer_in_progress', 'buyer_confirming'].includes(txn.status)) {
    return sendMessage(phone,
      `❌ This transaction is not ready for confirmation.\n\n` +
      `Current status: ${txn.status}\n\n` +
      `If something is wrong, type: *DISPUTE ${txnId}*`
    );
  }

  // Update transaction
  txn.status          = 'completed';
  txn.buyerConfirmedAt = new Date();
  txn.completedAt      = new Date();
  await txn.save();

  // Mark listing as sold
  await Listing.findByIdAndUpdate(txn.listing, { status: 'sold' });

  // Update seller stats
  const seller = txn.seller as any;
  seller.totalSales   += 1;
  seller.lastActiveAt  = new Date();
  await seller.save();

  // Update buyer stats
  buyer.totalPurchases += 1;
  buyer.lastActiveAt   = new Date();
  await buyer.save();

  // Release escrow to seller
  await releaseEscrow(txn);
  await clearSession(phone);

  // Notify buyer
  await sendMessage(phone,
    `🎉 *Transfer Confirmed!*\n\n` +
    `Transaction: ${txnId}\n` +
    `You now own the account.\n\n` +
    `Please rate your experience with the seller:\n` +
    `Reply: *RATE ${txnId} [1-5]*\n\n` +
    `Example: RATE ${txnId} 5\n\n` +
    `Thank you for using AdSwap! 🙏`
  );

  // Notify seller
  await sendMessage(seller.phone,
    `💰 *Payment Released!*\n\n` +
    `Transaction: ${txnId}\n` +
    `Amount: ₦${txn.sellerReceives.toLocaleString()}\n\n` +
    `Funds are being sent to your account.\n` +
    `Allow 1–2 business days for settlement.\n\n` +
    `Thank you for selling on AdSwap! 🙏`
  );
}

// ── Handle buyer rating ───────────────────────────────────────────────────────
export async function handleRate(
  phone: string,
  text:  string
): Promise<void> {
  // RATE TXN-XXXXX 5
  const parts  = text.split(' ');
  const txnId  = parts[1];
  const rating = parseInt(parts[2], 10);

  if (!txnId || isNaN(rating) || rating < 1 || rating > 5) {
    return sendMessage(phone,
      '❌ Invalid format.\n\nUse: *RATE [Transaction ID] [1-5]*\nExample: RATE TXN-ABC123 5'
    );
  }

  const buyer = await User.findOne({ phone });
  const txn   = await Transaction.findOne({
    transactionId: txnId,
    buyer:         buyer?._id,
    status:        'completed',
  }).populate<{ seller: any }>('seller');

  if (!txn) {
    return sendMessage(phone, '❌ Transaction not found or not completed.');
  }

  if (txn.buyerRating) {
    return sendMessage(phone, 'You have already rated this transaction.');
  }

  txn.buyerRating = rating;
  await txn.save();

  // Update seller rating
  const seller            = txn.seller;
  const totalRatings      = seller.totalRatings + 1;
  const newRating         = ((seller.sellerRating * seller.totalRatings) + rating) / totalRatings;
  seller.sellerRating     = Math.round(newRating * 10) / 10;
  seller.totalRatings     = totalRatings;
  await seller.save();

  await sendMessage(phone,
    `✅ Rating submitted: ${'⭐'.repeat(rating)}\n\nThank you for your feedback!`
  );
}