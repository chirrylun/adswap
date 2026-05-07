import axios, { AxiosInstance } from 'axios';
import { FEE_TIERS } from '../config/constants';
import { ITransaction } from '../models/Transaction';
import Transaction from '../models/Transaction';
import Listing     from '../models/Listing';
import User        from '../models/User';
import { sendMessage } from './whatsapp';

const paystackClient: AxiosInstance = axios.create({
  baseURL: 'https://api.paystack.co',
  headers: {
    Authorization:  `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// ─── Fee calculator ───────────────────────────────────────────────────────────
export function calculateFee(amount: number): {
  fee: number;
  sellerReceives: number;
} {
  const tier          = FEE_TIERS.find(t => amount <= t.max)!;
  const fee           = Math.round(amount * tier.rate);
  const sellerReceives = amount - fee;
  return { fee, sellerReceives };
}

// ─── Create escrow payment link ───────────────────────────────────────────────
export async function createEscrowPayment(
  phone: string,
  transactionId: string,
  amount: number,
  listingId: string
): Promise<string> {
  const email = `${phone.replace(/\D/g, '')}@adswap.ng`;

  const res = await paystackClient.post('/transaction/initialize', {
    email,
    amount:       amount * 100, // kobo
    reference:    transactionId,
    channels:     ['card', 'bank', 'ussd', 'bank_transfer'],
    metadata: {
      transaction_id: transactionId,
      listing_id:     listingId,
      phone,
      type:           'escrow_payment',
      custom_fields: [
        { display_name: 'Transaction ID', variable_name: 'transaction_id', value: transactionId },
        { display_name: 'Listing',        variable_name: 'listing_id',     value: listingId },
      ],
    },
    callback_url: `${process.env.APP_URL}/webhook/paystack`,
  });

  return res.data.data.authorization_url;
}

// ─── Create listing fee payment link ─────────────────────────────────────────
export async function createListingFeePayment(
  phone: string,
  listingId: string,
  amount: number
): Promise<string> {
  const email     = `${phone.replace(/\D/g, '')}@adswap.ng`;
  const reference = `FEE-${listingId}-${Date.now()}`;

  const res = await paystackClient.post('/transaction/initialize', {
    email,
    amount:   amount * 100,
    reference,
    channels: ['card', 'bank', 'ussd', 'bank_transfer'],
    metadata: {
      listing_id: listingId,
      phone,
      type:       'listing_fee',
    },
    callback_url: `${process.env.APP_URL}/webhook/paystack`,
  });

  return res.data.data.authorization_url;
}

// ─── Verify payment ───────────────────────────────────────────────────────────
export async function verifyPayment(reference: string) {
  const res = await paystackClient.get(`/transaction/verify/${reference}`);
  return res.data.data;
}

// ─── Create transfer recipient (seller bank account) ─────────────────────────
export async function createTransferRecipient(
  name:          string,
  accountNumber: string,
  bankCode:      string
): Promise<string> {
  const res = await paystackClient.post('/transferrecipient', {
    type:           'nuban',
    name,
    account_number: accountNumber,
    bank_code:      bankCode,
    currency:       'NGN',
  });
  return res.data.data.recipient_code;
}

// ─── Release escrow to seller ─────────────────────────────────────────────────
export async function releaseEscrow(txn: ITransaction): Promise<void> {
  const seller = await User.findById(txn.seller);
  if (!seller) throw new Error('Seller not found');

  if (seller.paystackRecipientCode) {
    // Automated transfer
    await paystackClient.post('/transfer', {
      source:    'balance',
      amount:    txn.sellerReceives * 100,
      recipient: seller.paystackRecipientCode,
      reason:    `AdSwap payout — ${txn.transactionId}`,
      reference: `PAYOUT-${txn.transactionId}`,
    });
  } else {
    // Flag for manual admin payout
    console.warn(`⚠️  Manual payout needed: ${txn.transactionId} | Seller: ${seller.phone} | Amount: ₦${txn.sellerReceives.toLocaleString()}`);
    await sendMessage(
      process.env.SUPPORT_PHONE!,
      `🔔 *Manual Payout Required*\n\n` +
      `TXN: ${txn.transactionId}\n` +
      `Seller: ${seller.phone}\n` +
      `Amount: ₦${txn.sellerReceives.toLocaleString()}\n\n` +
      `Seller has no bank account on file.\n` +
      `Contact seller to collect details.`
    );
  }

  txn.escrowHeld       = false;
  txn.escrowReleasedAt = new Date();
  await txn.save();
}

// ─── Process Paystack webhook events ─────────────────────────────────────────
export async function handlePaystackEvent(event: any): Promise<void> {
  const { event: eventType, data } = event;

  if (eventType === 'charge.success') {
    const { reference, metadata } = data;
    const type = metadata?.type;

    if (type === 'escrow_payment') {
      await processEscrowPayment(reference, metadata);
    } else if (type === 'listing_fee') {
      await processListingFee(metadata);
    }
  }

  if (eventType === 'transfer.success') {
    console.log(`✅ Transfer successful: ${data.reference}`);
  }

  if (eventType === 'transfer.failed') {
    console.error(`❌ Transfer failed: ${data.reference}`);
    await sendMessage(
      process.env.SUPPORT_PHONE!,
      `❌ *Transfer Failed*\n\nReference: ${data.reference}\nReason: ${data.gateway_response}`
    );
  }
}

// ─── Internal: process escrow payment confirmed ───────────────────────────────
async function processEscrowPayment(
  reference: string,
  metadata:  any
): Promise<void> {
  const txn = await Transaction.findOne({
    transactionId: metadata.transaction_id,
    status:        'awaiting_payment',
  }).populate('seller').populate('listing');

  if (!txn) {
    console.warn(`Escrow payment received but transaction not found: ${metadata.transaction_id}`);
    return;
  }

  txn.status            = 'transfer_in_progress';
  txn.escrowHeld        = true;
  txn.paystackReference = reference;
  txn.transferStartedAt = new Date();
  await txn.save();

  const seller  = txn.seller  as any;
  const listing = txn.listing as any;
  const buyer   = await User.findById(txn.buyer);

  if (!buyer) return;

  // Notify buyer
  await sendMessage(buyer.phone,
    `✅ *Payment Confirmed — Escrow Active* 🔒\n\n` +
    `Transaction: *${txn.transactionId}*\n` +
    `Amount held: ₦${txn.amount.toLocaleString()}\n\n` +
    `The seller has been notified and has 12 hours to begin transfer.\n\n` +
    `*Transfer checklist:*\n` +
    `□ Seller adds your email as recovery\n` +
    `□ Seller shares login credentials\n` +
    `□ You log in and verify access\n` +
    `□ You change password + 2FA\n\n` +
    `Once you have full access:\n` +
    `Reply: *CONFIRM ${txn.transactionId}*\n\n` +
    `Problems? Reply: *DISPUTE ${txn.transactionId}*`
  );

  // Notify seller
  await sendMessage(seller.phone,
    `🔔 *Your account has been purchased!*\n\n` +
    `Transaction: *${txn.transactionId}*\n` +
    `Listing: ${listing.listingId}\n` +
    `You will receive: ₦${txn.sellerReceives.toLocaleString()}\n\n` +
    `*Begin transfer within 12 hours:*\n\n` +
    `1. Add buyer's email as account recovery\n` +
    `2. Share login credentials securely\n` +
    `3. Guide buyer through access confirmation\n\n` +
    `When ready to start:\n` +
    `Reply: *READY ${txn.transactionId}*`
  );
}

// ─── Internal: process listing fee confirmed ──────────────────────────────────
async function processListingFee(metadata: any): Promise<void> {
  const listing = await Listing.findOne({ listingId: metadata.listing_id })
    .populate<{ seller: any }>('seller');

  if (!listing) return;

  // Only go live if already verified by admin
  if (listing.status === 'pending_verification') {
    listing.status = 'active';
    await listing.save();

    await sendMessage(listing.seller.phone,
      `✅ *Listing fee received!*\n\n` +
      `Listing: ${listing.listingId}\n\n` +
      `🟢 Your listing is now *LIVE* and visible to buyers!\n\n` +
      `Type *LISTINGS* to see it.`
    );
  }
}

// ─── Get list of banks ────────────────────────────────────────────────────────
export async function getBankList() {
  const res = await paystackClient.get('/bank?country=nigeria');
  return res.data.data;
}

// ─── Verify bank account ──────────────────────────────────────────────────────
export async function verifyBankAccount(
  accountNumber: string,
  bankCode:      string
) {
  const res = await paystackClient.get(
    `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`
  );
  return res.data.data;
}