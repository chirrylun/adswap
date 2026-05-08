import { sendMessage, sendButtons } from '../../services/whatsapp';
import { setSession, clearSession, updateSessionData } from '../session';
import { calculateFee, transferToSeller } from '../../services/flutterwave';
import { createEscrowPaymentLink } from '../../services/flutterwave';
import { TYPE_LABELS } from '../../config/constants';
import Listing     from '../../models/Listing';
import Transaction from '../../models/Transaction';
import User        from '../../models/User';
import { generateId } from '../../utils/helpers';
import { ISession } from '../../models/Session';
const buyLocks = new Set<string>();

// ─── Credential questions per asset type ─────────────────────────────────────
// These are asked of the SELLER after payment is confirmed, to collect
// the exact details the buyer needs to take ownership.

interface CredQuestion {
  step:   string;
  prompt: string;
}

function getCredentialQuestions(type: string): CredQuestion[] {
  switch (type) {
    case 'google_ad_account':
      return [
        { step: 'cred_q_email',    prompt: `*Step 1 — Account Email*\n\nWhat is the login email address for this Google Ads account?\n\nType it now:` },
        { step: 'cred_q_password', prompt: `*Step 2 — Current Password*\n\nWhat is the current password?\n\nType it now (it will be shared directly with the buyer):` },
        { step: 'cred_q_recovery', prompt: `*Step 3 — Recovery Email/Phone*\n\nWhat recovery email or phone is linked to this account? (Or type NONE)` },
        { step: 'cred_q_notes',    prompt: `*Step 4 — Any Notes for the Buyer?*\n\nAnything the buyer should know to take full ownership? (Or type NONE)` },
      ];

    case 'facebook_ad_account':
      return [
        { step: 'cred_q_email',    prompt: `*Step 1 — Facebook Login Email*\n\nWhat email is used to log in?\n\nType it now:` },
        { step: 'cred_q_password', prompt: `*Step 2 — Current Password*\n\nWhat is the current password?` },
        { step: 'cred_q_2fa',      prompt: `*Step 3 — 2FA / Authenticator*\n\nIs 2FA enabled? If yes, what app/method? How will you hand it over?\n\nType your answer:` },
        { step: 'cred_q_notes',    prompt: `*Step 4 — Notes for Buyer*\n\nAnything the buyer needs to know? (Or type NONE)` },
      ];

    case 'twitter_account':
      return [
        { step: 'cred_q_email',    prompt: `*Step 1 — Twitter/X Login Email*\n\nWhat email is the account registered with?` },
        { step: 'cred_q_password', prompt: `*Step 2 — Current Password*\n\nWhat is the current password?` },
        { step: 'cred_q_phone',    prompt: `*Step 3 — Linked Phone Number*\n\nIs a phone number linked? If yes, enter it. (Or type NONE)` },
        { step: 'cred_q_notes',    prompt: `*Step 4 — Notes for Buyer*\n\nAnything else the buyer should know? (Or type NONE)` },
      ];

    case 'instagram_account':
      return [
        { step: 'cred_q_email',    prompt: `*Step 1 — Instagram Login Email*\n\nWhat email is the account registered with?` },
        { step: 'cred_q_password', prompt: `*Step 2 — Current Password*\n\nWhat is the current password?` },
        { step: 'cred_q_phone',    prompt: `*Step 3 — Linked Phone*\n\nIs a phone number linked? (Or type NONE)` },
        { step: 'cred_q_notes',    prompt: `*Step 4 — Notes for Buyer*\n\nAnything else the buyer should know? (Or type NONE)` },
      ];

    case 'tiktok_account':
      return [
        { step: 'cred_q_email',    prompt: `*Step 1 — TikTok Login Email*\n\nWhat email or phone is used to log in?` },
        { step: 'cred_q_password', prompt: `*Step 2 — Current Password*\n\nWhat is the current password?` },
        { step: 'cred_q_2fa',      prompt: `*Step 3 — 2FA / Device Trust*\n\nIs 2FA or device trust enabled? How will you hand it over? (Or type NONE)` },
        { step: 'cred_q_notes',    prompt: `*Step 4 — Notes for Buyer*\n\nAnything else the buyer should know? (Or type NONE)` },
      ];

    case 'adsense_site':
      return [
        { step: 'cred_q_email',    prompt: `*Step 1 — Google/AdSense Login Email*\n\nWhat email is the AdSense account under?` },
        { step: 'cred_q_password', prompt: `*Step 2 — Current Password*\n\nWhat is the current password?` },
        { step: 'cred_q_site',     prompt: `*Step 3 — Site Access*\n\nHow does the buyer gain access to the website? (e.g. cPanel login, WordPress login, domain registrar details — share what applies)` },
        { step: 'cred_q_notes',    prompt: `*Step 4 — Notes for Buyer*\n\nAnything else the buyer should know? (Or type NONE)` },
      ];

    case 'play_console':
      return [
        { step: 'cred_q_email',    prompt: `*Step 1 — Google Account Email*\n\nWhat Google account email is the Play Console under?` },
        { step: 'cred_q_password', prompt: `*Step 2 — Current Password*\n\nWhat is the current password?` },
        { step: 'cred_q_recovery', prompt: `*Step 3 — Recovery Method*\n\nWhat recovery email or phone is linked? How will 2FA be transferred? (Or type NONE)` },
        { step: 'cred_q_notes',    prompt: `*Step 4 — Notes for Buyer*\n\nAnything else the buyer should know? (Or type NONE)` },
      ];

    case 'gift_card':
      return [
        { step: 'cred_q_code',     prompt: `*Step 1 — Gift Card Code*\n\nWhat is the full redemption code on the card?\n\nType it now:` },
        { step: 'cred_q_pin',      prompt: `*Step 2 — PIN (if applicable)*\n\nIs there a PIN on the back? If yes, enter it. (Or type NONE)` },
        { step: 'cred_q_notes',    prompt: `*Step 3 — Notes for Buyer*\n\nAny redemption instructions or region notes? (Or type NONE)` },
      ];

    default:
      return [
        { step: 'cred_q_details',  prompt: `*Credentials*\n\nPlease type the login credentials and any details the buyer needs to take full ownership of this account:` },
        { step: 'cred_q_notes',    prompt: `*Notes for Buyer*\n\nAnything else the buyer should know? (Or type NONE)` },
      ];
  }
}

// ─── Bank account questions ───────────────────────────────────────────────────
const BANK_QUESTIONS: CredQuestion[] = [
  { step: 'bank_q_name',    prompt: `*Step 1 — Account Name*\n\nWhat is the full name on your bank account?\n\nType it now:` },
  { step: 'bank_q_number',  prompt: `*Step 2 — Account Number*\n\nWhat is your 10-digit NUBAN account number?\n\nType it now:` },
  { step: 'bank_q_bank',    prompt: `*Step 3 — Bank Name*\n\nWhat bank is this account with?\n\nExamples: _GTB_, _Access_, _Zenith_, _Opay_, _Kuda_\n\nType it now:` },
];

// ─── Format credential summary to send to buyer ───────────────────────────────
function formatCredentials(type: string, data: Record<string, any>): string {
  switch (type) {
    case 'gift_card':
      return [
        `🎁 *Gift Card Details*`,
        `Code: \`${data.cred_q_code}\``,
        data.cred_q_pin !== 'NONE' ? `PIN: \`${data.cred_q_pin}\`` : null,
        data.cred_q_notes !== 'NONE' ? `Notes: ${data.cred_q_notes}` : null,
      ].filter(Boolean).join('\n');

    default:
      return [
        `🔑 *Account Credentials*`,
        `Email/Login: \`${data.cred_q_email}\``,
        `Password: \`${data.cred_q_password}\``,
        data.cred_q_phone    && data.cred_q_phone    !== 'NONE' ? `Phone: ${data.cred_q_phone}`       : null,
        data.cred_q_recovery && data.cred_q_recovery !== 'NONE' ? `Recovery: ${data.cred_q_recovery}` : null,
        data.cred_q_2fa      && data.cred_q_2fa      !== 'NONE' ? `2FA: ${data.cred_q_2fa}`           : null,
        data.cred_q_site                                          ? `Site: ${data.cred_q_site}`          : null,
        data.cred_q_notes    && data.cred_q_notes    !== 'NONE' ? `Notes: ${data.cred_q_notes}`        : null,
      ].filter(Boolean).join('\n');
  }
}

// ─── Main buy handler ─────────────────────────────────────────────────────────

// ─── Main buy handler ─────────────────────────────────────────────────────────
export async function handleBuy(
  phone:   string,
  text:    string,
  session: ISession,
): Promise<void> {

  // ── LISTINGS — browse (unchanged) ─────────────────────────────────────────
  if (text === 'LISTINGS') {
    // ... your existing LISTINGS block unchanged
  }

  // ── BUY [listingId] ────────────────────────────────────────────────────────
  if (text.startsWith('BUY ')) {
    const listingId = text.replace('BUY ', '').trim();

    // ── Millisecond-level lock: one active request per phone+listing ──────────
    const lockKey = `${phone}:${listingId}`;
    if (buyLocks.has(lockKey)) {
      return sendMessage(phone,
        `⏳ Your previous request is still processing. Please wait a moment.`,
      );
    }
    buyLocks.add(lockKey);

    try {
      const listing = await Listing.findOne({ listingId, status: 'active' })
        .populate<{ seller: any }>('seller');

      if (!listing) {
        return sendMessage(phone, `❌ Listing not found or no longer available.\n\nType *LISTINGS* to browse.`);
      }

      const buyer = await User.findOneAndUpdate(
        { phone },
        { $setOnInsert: { phone } },
        { upsert: true, new: true },
      );

      if (listing.seller.phone === phone) {
        return sendMessage(phone, `❌ You can't buy your own listing.`);
      }

      const { fee, sellerReceives } = calculateFee(listing.price);
      const transactionId           = `TXN-${generateId(6)}`;

      // ── Check for existing pending txn ────────────────────────────────────
      const existing = await Transaction.findOne({
        listingId,
        buyer:  buyer._id,
        status: 'awaiting_payment',
      });

      if (existing) {
        const freshLink = await createEscrowPaymentLink(
          existing.transactionId,
          listingId,
          listing.price,
        );
        return sendMessage(phone,
          `⚠️ You already have a pending transaction for this listing.\n\n` +
          `Transaction: *${existing.transactionId}*\n\n` +
          `Complete payment here:\n${freshLink}\n\n` +
          `Type *CANCEL* to abandon it.`,
        );
      }

      // ── Generate payment link ─────────────────────────────────────────────
      let paymentLink: string;
      try {
        paymentLink = await createEscrowPaymentLink(
          transactionId,
          listingId,
          listing.price,
        );
      } catch (err: any) {
        console.error('[Buy] FW link generation failed:', err.message);
        return sendMessage(phone,
          `❌ Could not generate payment link. Please try again or contact support.`,
        );
      }

      // ── Create transaction — DB index catches any race condition duplicate ─
      try {
        await Transaction.create({
          transactionId,
          listing:        listing._id,
          listingId,
          buyer:          buyer._id,
          seller:         listing.seller._id,
          amount:         listing.price,
          platformFee:    fee,
          sellerReceives,
          status:         'awaiting_payment',
        });
      } catch (err: any) {
        // Duplicate key error from the unique index — another request won the race
        if (err.code === 11000) {
          const existing = await Transaction.findOne({
            listingId,
            buyer:  buyer._id,
            status: 'awaiting_payment',
          });
          const freshLink = existing
            ? await createEscrowPaymentLink(existing.transactionId, listingId, listing.price)
            : null;

          return sendMessage(phone,
            `⚠️ You already have a pending transaction for this listing.\n\n` +
            (freshLink ? `Complete payment here:\n${freshLink}\n\n` : '') +
            `Type *CANCEL* to abandon it.`,
          );
        }
        throw err; // rethrow unexpected errors
      }

      await setSession(phone, 'buy_awaiting_payment', { transactionId, listingId });

      const typeLabel = TYPE_LABELS[listing.type] ?? listing.type;

      await sendMessage(listing.seller.phone,
        `👀 *Someone is interested in your listing!*\n\n` +
        `Listing: *${listing.listingId}* — ${typeLabel}\n\n` +
        `A buyer is reviewing the payment page right now.\n\n` +
        `💡 Get your credentials ready — you'll be prompted once payment clears.`,
      ).catch(() => {});

      return sendMessage(phone,
        `🔒 *AdSwap Escrow Protection*\n\n` +
        `*${typeLabel}*\n` +
        `🆔 ${listingId}\n` +
        `💰 Price: ₦${listing.price.toLocaleString()}\n\n` +
        `*How escrow works:*\n` +
        `1️⃣  You pay AdSwap — not the seller directly\n` +
        `2️⃣  Funds are held securely until transfer is complete\n` +
        `3️⃣  Seller shares login credentials with you\n` +
        `4️⃣  You confirm full access within 48 hrs\n` +
        `5️⃣  Funds released to seller\n\n` +
        `*Pay now:*\n${paymentLink}\n\n` +
        `Transaction ID: *${transactionId}*\n` +
        `Save this for reference.\n\n` +
        `Type *CANCEL* to exit.`,
      );

    } finally {
      // Always release the lock — even if an error is thrown
      buyLocks.delete(lockKey);
    }
  }

// ─── Seller: TRANSFER [txnId] — begin credential-sharing flow ─────────────────
export async function handleSellerTransfer(
  phone:   string,
  text:    string,
  session: ISession,
): Promise<void> {
  const parts = text.split(' ');
  const txnId = parts[1];

  if (!txnId) {
    return sendMessage(phone, `To begin a transfer, reply:\n*TRANSFER [Transaction ID]*`);
  }

  const seller = await User.findOne({ phone });
  const txn    = await Transaction.findOne({
    transactionId: txnId,
    seller:        seller?._id,
    status:        'transfer_in_progress',
  }).populate<{ listing: any }>('listing');

  if (!txn) {
    return sendMessage(phone, `❌ Transaction not found or not ready for transfer.`);
  }

  const type      = txn.listing?.type ?? 'default';
  const questions = getCredentialQuestions(type);
  const firstQ    = questions[0];

  await setSession(phone, firstQ.step, {
    transferFlow: true,
    transactionId: txnId,
    listingType:   type,
    buyerId:       String(txn.buyer),
  });

  return sendMessage(phone,
    `🔐 *Share Account Credentials*\n\n` +
    `I'll guide you through this step by step.\n` +
    `All details go directly and only to the buyer.\n\n` +
    firstQ.prompt,
  );
}

// ─── Seller credential flow steps ─────────────────────────────────────────────
export async function handleCredentialFlow(
  phone:   string,
  text:    string,
  session: ISession,
): Promise<void> {
  const step = session.step;
  const data = session.data;

  if (!data?.transferFlow) return;

  const type      = data.listingType ?? 'default';
  const questions = getCredentialQuestions(type);
  const currentIdx = questions.findIndex(q => q.step === step);

  if (currentIdx === -1) {
    await clearSession(phone);
    return sendMessage(phone, `❌ Something went wrong. Type *TRANSFER [TXN ID]* to try again.`);
  }

  const updatedData = { ...data, [step]: text };
  const nextQ       = questions[currentIdx + 1];

  if (nextQ) {
    await setSession(phone, nextQ.step, updatedData);
    return sendMessage(phone, nextQ.prompt);
  }

  // ── All credential questions answered — now collect bank details ──────────
  const bankQ = BANK_QUESTIONS[0];
  await setSession(phone, bankQ.step, { ...updatedData, credsDone: true });
  return sendMessage(phone,
    `✅ *Credentials saved.*\n\n` +
    `Now I need your bank details to send your payment once the buyer confirms.\n\n` +
    bankQ.prompt,
  );
}

// ─── Seller bank details flow ─────────────────────────────────────────────────
export async function handleBankFlow(
  phone:   string,
  text:    string,
  session: ISession,
): Promise<void> {
  const step = session.step;
  const data = session.data;

  if (!data?.credsDone) return;

  const currentIdx = BANK_QUESTIONS.findIndex(q => q.step === step);
  if (currentIdx === -1) return;

  const updatedData = { ...data, [step]: text };
  const nextQ       = BANK_QUESTIONS[currentIdx + 1];

  if (nextQ) {
    await setSession(phone, nextQ.step, updatedData);
    return sendMessage(phone, nextQ.prompt);
  }

  // ── All bank questions answered — save to user + send creds to buyer ──────
  const seller = await User.findOne({ phone });
  if (seller) {
    seller.bankAccountName   = updatedData.bank_q_name;
    seller.bankAccountNumber = updatedData.bank_q_number;
    seller.bankName          = updatedData.bank_q_bank;
    await seller.save();
  }

  const txn = await Transaction.findOne({
    transactionId: updatedData.transactionId,
    status:        'transfer_in_progress',
  }).populate<{ buyer: any }>('buyer');

  if (!txn) {
    await clearSession(phone);
    return sendMessage(phone, `❌ Transaction not found. Contact support.`);
  }

  const buyer       = txn.buyer as any;
  const credentials = formatCredentials(updatedData.listingType, updatedData);

  // Mark seller as ready
  txn.sellerReadyAt = new Date();
  await txn.save();

  // Send credentials to buyer
  await sendMessage(buyer.phone,
    `🔑 *Account Credentials Received*\n\n` +
    `Transaction: *${txn.transactionId}*\n\n` +
    `${credentials}\n\n` +
    `─────────────────\n` +
    `⚠️ *Log in now and take these steps immediately:*\n` +
    `1. Change the password\n` +
    `2. Update the recovery email/phone to yours\n` +
    `3. Remove or reset 2FA\n\n` +
    `Once you have *full access*, confirm:\n` +
    `\`CONFIRM ${txn.transactionId}\`\n\n` +
    `Problem? Reply:\n` +
    `\`DISPUTE ${txn.transactionId}\`\n\n` +
    `⏳ If no response in 48 hours, funds auto-release to seller.`,
  );

  await clearSession(phone);

  return sendMessage(phone,
    `✅ *Done! Credentials sent to the buyer.*\n\n` +
    `Bank details saved:\n` +
    `👤 ${updatedData.bank_q_name}\n` +
    `🏦 ${updatedData.bank_q_bank} — ${updatedData.bank_q_number}\n\n` +
    `You'll be paid ₦${txn.sellerReceives?.toLocaleString()} once the buyer confirms or after 48 hours.\n\n` +
    `Questions? Type *HELP*`,
  );
}

// ─── Buyer: CONFIRM [txnId] ────────────────────────────────────────────────────
export async function handleBuyerConfirm(
  phone: string,
  text:  string,
): Promise<void> {
  const txnId = text.replace('CONFIRM ', '').trim();
  const buyer  = await User.findOne({ phone });

  const txn = await Transaction.findOne({
    transactionId: txnId,
    buyer:         buyer?._id,
    status:        'transfer_in_progress',
  }).populate<{ seller: any }>('seller');

  if (!txn) {
    return sendMessage(phone, `❌ Transaction not found or already resolved.`);
  }

  txn.status      = 'pending_release';
  txn.confirmedAt = new Date();
  txn.releaseAt   = new Date(); // immediate release flag
  await txn.save();

  // Alert admin for payout processing
  await sendMessage(
    process.env.SUPPORT_PHONE!,
    `✅ *Release Request — Buyer Confirmed*\n\n` +
    `TXN: ${txn.transactionId}\n` +
    `Seller: ${(txn.seller as any).phone}\n` +
    `Amount: ₦${txn.sellerReceives?.toLocaleString()}\n` +
    `Bank: ${(txn.seller as any).bankName} — ${(txn.seller as any).bankAccountNumber}\n\n` +
    `Approve payout on the dashboard or reply *PAYOUT ${txn.transactionId}*`,
  ).catch(() => {});

  await sendMessage((txn.seller as any).phone,
    `🎉 *Buyer has confirmed access!*\n\n` +
    `Transaction: ${txn.transactionId}\n\n` +
    `Your payout of ₦${txn.sellerReceives?.toLocaleString()} is being processed.\n` +
    `You'll receive a transfer within 24 hours.`,
  ).catch(() => {});

  return sendMessage(phone,
    `✅ *Access confirmed!*\n\n` +
    `Transaction: ${txn.transactionId}\n\n` +
    `Payment has been released to the seller. Enjoy your new account!\n\n` +
    `Any issues? Type *DISPUTE ${txnId}* within 48 hours.`,
  );
}

// ─── Scheduled: auto-release after 48 hrs of no dispute ──────────────────────
// Call this from a cron job every 15 minutes.
export async function processAutoReleases(): Promise<void> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const txns = await Transaction.find({
    status:           'transfer_in_progress',
    sellerReadyAt:    { $lte: cutoff },
    disputeRaisedAt:  { $exists: false },
  }).populate<{ seller: any; buyer: any }>(['seller', 'buyer']);

  for (const txn of txns) {
    try {
      txn.status    = 'pending_release';
      txn.releaseAt = new Date();
      await txn.save();

      await sendMessage(
        process.env.SUPPORT_PHONE!,
        `⏰ *Auto-Release — 48hr Elapsed*\n\n` +
        `TXN: ${txn.transactionId}\n` +
        `Seller: ${txn.seller?.phone}\n` +
        `Amount: ₦${txn.sellerReceives?.toLocaleString()}\n\n` +
        `No dispute filed. Process payout on the dashboard.`,
      );

      await sendMessage(txn.buyer?.phone,
        `ℹ️ *Escrow Update — Transaction ${txn.transactionId}*\n\n` +
        `48 hours have elapsed with no dispute filed.\n` +
        `Funds have been released to the seller.\n\n` +
        `Any concerns? Type *HELP*`,
      ).catch(() => {});
    } catch (err) {
      console.error(`[AutoRelease] Failed for ${txn.transactionId}:`, err);
    }
  }
}
}