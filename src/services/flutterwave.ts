import axios, { AxiosInstance } from 'axios';
import { FEE_TIERS } from '../config/constants';
import { ITransaction } from '../models/Transaction';
import Transaction from '../models/Transaction';
import Listing     from '../models/Listing';
import User        from '../models/User';
import { sendMessage } from './whatsapp';

const fw: AxiosInstance = axios.create({
  baseURL: 'https://api.flutterwave.com/v3',
  headers: {
    Authorization:  `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// ─── Fee calculator ───────────────────────────────────────────────────────────
export function calculateFee(amount: number): {
  fee: number;
  sellerReceives: number;
} {
  const tier           = FEE_TIERS.find(t => amount <= t.max) ?? FEE_TIERS[FEE_TIERS.length - 1];
  const fee            = Math.round(amount * tier.rate);
  const sellerReceives = amount - fee;
  return { fee, sellerReceives };
}

// ─── Generate escrow payment link ─────────────────────────────────────────────
// Called when a buy request is made — link stored on the listing itself.
export async function createEscrowPaymentLink(
  transactionId: string,
  listingId:     string,
  amount:        number,
): Promise<string> {
  const res = await fw.post('/payments', {
    tx_ref:   transactionId,          // unique per buyer per listing
    amount,
    currency: 'NGN',
    customer: { email: `adswap@escrow.ng`, name: 'AdSwap Buyer' },
    customizations: {
      title:       'AdSwap Escrow',
      description: `Secure purchase — ${listingId}`,
    },
    meta: { listing_id: listingId, transaction_id: transactionId, type: 'escrow_payment' },
  });

  if (res.data?.status !== 'success' || !res.data?.data?.link) {
    throw new Error(`Flutterwave link error: ${res.data?.message}`);
  }

  return res.data.data.link;
}


// ─── Verify a FW transaction by ID ───────────────────────────────────────────
export async function verifyFlutterwaveTransaction(transactionId: string) {
  const res = await fw.get(`/transactions/${transactionId}/verify`);
  return res.data?.data;
}

// ─── Transfer to seller bank account ─────────────────────────────────────────
export async function transferToSeller(txn: ITransaction): Promise<void> {
  const seller = await User.findById(txn.seller);
  if (!seller) throw new Error('Seller not found');

  if (!seller.bankAccountNumber || !seller.bankCode) {
    // Flag for manual payout
    console.warn(`⚠️ Manual payout needed: ${txn.transactionId}`);
    await sendMessage(
      process.env.SUPPORT_PHONE!,
      `🔔 *Manual Payout Required*\n\n` +
      `TXN: ${txn.transactionId}\n` +
      `Seller: ${seller.phone}\n` +
      `Amount: ₦${txn.sellerReceives.toLocaleString()}\n\n` +
      `Seller has no bank account on file. Contact to collect details.`,
    );
    return;
  }

  // Create transfer recipient then initiate transfer
  const recipientRes = await fw.post('/transfers', {
    account_bank:   seller.bankCode,
    account_number: seller.bankAccountNumber,
    amount:         txn.sellerReceives,
    narration:      `AdSwap payout — ${txn.transactionId}`,
    currency:       'NGN',
    reference:      `PAYOUT-${txn.transactionId}`,
    callback_url:   `${process.env.APP_URL}/webhook/flutterwave`,
    debit_currency: 'NGN',
  });

  if (recipientRes.data?.status !== 'success') {
    throw new Error(`Transfer failed: ${recipientRes.data?.message}`);
  }

  txn.escrowHeld       = false;
  txn.escrowReleasedAt = new Date();
  await txn.save();
}

// ─── Process Flutterwave webhook events ──────────────────────────────────────
export async function handleFlutterwaveEvent(event: any): Promise<void> {
  const { event: eventType, data } = event;

  if (eventType === 'charge.completed' && data?.status === 'successful') {
    const meta      = data.meta ?? {};
    const type      = meta.type;
    const listingId = meta.listing_id;

    if (type === 'escrow_payment' && listingId) {
      await processEscrowPayment(data);
    }
  }

  if (eventType === 'transfer.completed') {
    if (data?.status === 'SUCCESSFUL') {
      console.log(`✅ Transfer successful: ${data.reference}`);
    } else {
      console.error(`❌ Transfer failed: ${data.reference}`);
      await sendMessage(
        process.env.SUPPORT_PHONE!,
        `❌ *Transfer Failed*\n\nReference: ${data.reference}\nReason: ${data.complete_message}`,
      );
    }
  }
}

// ─── Internal: handle confirmed escrow charge ─────────────────────────────────
async function processEscrowPayment(data: any): Promise<void> {
  const transactionId = data.meta?.transaction_id;  // ← now reliable
  const listingId     = data.meta?.listing_id;
  const fwRef         = String(data.id);

  // ✅ look up by our transactionId — unique and unambiguous
  const txn = await Transaction.findOne({
    transactionId,
    status: 'awaiting_payment',
  })
    .populate('seller')
    .populate('listing')
    .populate('buyer');

  if (!txn) {
    console.warn(`[FW Webhook] No awaiting_payment txn: ${transactionId}`);
    return;
  }

  // Amount sanity: re-check amount >= expected
  const { fee } = calculateFee(txn.amount);
  if (data.amount < txn.amount * 0.98) {
    console.warn(`[FW Webhook] Amount mismatch for ${txn.transactionId}`);
    return;
  }

  txn.status              = 'transfer_in_progress';
  txn.escrowHeld          = true;
  txn.flutterwaveRef      = transactionId;
  txn.transferStartedAt   = new Date();
  await txn.save();

  const buyer   = txn.buyer  as any;
  const seller  = txn.seller as any;
  const listing = txn.listing as any;

  // Notify buyer
  await sendMessage(buyer.phone,
    `✅ *Payment Confirmed — Escrow Active* 🔒\n\n` +
    `Transaction: *${txn.transactionId}*\n` +
    `Amount held: ₦${txn.amount.toLocaleString()}\n\n` +
    `The seller has been notified and will share account credentials shortly.\n\n` +
    `*What happens next:*\n` +
    `1️⃣  Seller shares login details here\n` +
    `2️⃣  You log in and verify full access\n` +
    `3️⃣  Change password + 2FA immediately\n` +
    `4️⃣  Confirm receipt:\n` +
    `\`CONFIRM ${txn.transactionId}\`\n\n` +
    `Problems? Reply: \`DISPUTE ${txn.transactionId}\`\n\n` +
    `⏳ Funds auto-release to seller after 48 hrs if no dispute.`,
  );

  // Notify seller — trigger credential-sharing flow
  await sendMessage(seller.phone,
    `🔔 *Your account has been purchased!*\n\n` +
    `Transaction: *${txn.transactionId}*\n` +
    `Listing: ${listing.listingId}\n` +
    `You will receive: ₦${txn.sellerReceives.toLocaleString()}\n\n` +
    `💰 Funds are held in escrow and will be released once the buyer confirms.\n\n` +
    `Reply *TRANSFER ${txn.transactionId}* to begin sharing credentials.`,
  );
}