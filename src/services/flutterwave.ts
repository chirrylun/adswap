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

  const payload = {
    tx_ref:   transactionId,
    amount,
    currency: 'NGN',
    redirect_url: `${process.env.APP_URL}/payment/done`,
    customer: { email: `adswap@escrow.ng`, name: 'AdSwap Buyer' },
    customizations: {
      title:       'AdSwap Escrow',
      description: `Secure purchase — ${listingId}`,
    },
    meta: { listing_id: listingId, transaction_id: transactionId, type: 'escrow_payment' },
  };

  console.log('[FW] createEscrowPaymentLink — payload:', JSON.stringify(payload, null, 2));
  console.log('[FW] Key present:', !!process.env.FLUTTERWAVE_SECRET_KEY);
  console.log('[FW] Key prefix:', process.env.FLUTTERWAVE_SECRET_KEY?.slice(0, 15));

  try {
    const res = await fw.post('/payments', payload);

    console.log('[FW] Response status:', res.status);
    console.log('[FW] Response body:', JSON.stringify(res.data, null, 2));

    if (res.data?.status !== 'success' || !res.data?.data?.link) {
      throw new Error(`Flutterwave link error: ${res.data?.message}`);
    }

    return res.data.data.link;

  } catch (err: any) {
    // Axios wraps non-2xx as errors — log the actual FW response body
    if (err.response) {
      console.error('[FW] Error status:', err.response.status);
      console.error('[FW] Error body:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('[FW] Network/unknown error:', err.message);
    }
    throw err;
  }
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
  console.log('[FW] handleFlutterwaveEvent called — event:', event?.event, '| status:', event?.data?.status);

  if (event.event === 'charge.completed' && event.data?.status === 'successful') {
    await processEscrowPayment(event.data);
  } else {
    console.log('[FW] Event ignored — not a successful charge');
  }
}

// ─── Internal: handle confirmed escrow charge ─────────────────────────────────
async function processEscrowPayment(data: any): Promise<void> {
  // ── tx_ref is always reliable — meta is not ───────────────────────────────
  const transactionId = data.tx_ref;   // e.g. "TXN-B02B83"
  const fwRef         = String(data.id);

  console.log('[FW] processEscrowPayment — tx_ref/transactionId:', transactionId, '| fwRef:', fwRef);

  if (!transactionId) {
    console.warn('[FW] No tx_ref on webhook payload — skipping');
    return;
  }

  // ── Idempotency — don't process twice ─────────────────────────────────────
  const alreadyProcessed = await Transaction.findOne({
    transactionId,
    status: { $ne: 'awaiting_payment' },
  });
  if (alreadyProcessed) {
    console.log('[FW] Already processed:', transactionId);
    return;
  }

  const txn = await Transaction.findOne({
    transactionId,
    status: 'awaiting_payment',
  })
    .populate('seller')
    .populate('listing')
    .populate('buyer');

  console.log('[FW] Transaction lookup result:', txn ? `found — ${txn.transactionId}` : 'NOT FOUND');

  if (!txn) {
    console.warn(`[FW] No awaiting_payment txn for tx_ref: ${transactionId}`);
    return;
  }

  // ── Amount sanity check ───────────────────────────────────────────────────
  if (data.amount < txn.amount * 0.98) {
    console.warn(`[FW] Amount mismatch — received: ${data.amount}, expected: ${txn.amount}`);
    return;
  }

  txn.status            = 'transfer_in_progress';
  txn.escrowHeld        = true;
  txn.flutterwaveRef    = fwRef;
  txn.transferStartedAt = new Date();
  await txn.save();

  const buyer   = txn.buyer  as any;
  const seller  = txn.seller as any;
  const listing = txn.listing as any;

  console.log('[FW] Notifying buyer:', buyer?.phone, '| seller:', seller?.phone);

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

  // Notify seller
  await sendMessage(seller.phone,
    `🔔 *Your account has been purchased!*\n\n` +
    `Transaction: *${txn.transactionId}*\n` +
    `Listing: ${listing?.listingId}\n` +
    `You will receive: ₦${txn.sellerReceives.toLocaleString()}\n\n` +
    `💰 Funds are held in escrow.\n\n` +
    `Reply *TRANSFER ${txn.transactionId}* to begin sharing credentials.`,
  );

  console.log('[FW] ✅ Escrow confirmed and both parties notified for:', transactionId);
}