import { sendMessage } from '../../services/whatsapp';
import { setSession, clearSession } from '../session';
import { createEscrowPayment, calculateFee } from '../../services/paystack';
import { TYPE_LABELS } from '../../config/constants';
import Listing     from '../../models/Listing';
import Transaction from '../../models/Transaction';
import User        from '../../models/User';
import { generateId } from '../../utils/helpers';
import { ISession } from '../../models/Session';

function formatListingSnippet(listing: any): string {
  const l = listing;
  switch (l.type) {
    case 'google_ad_account':
      return [
        l.googleAdsAccountAge && `📅 Age: ${l.googleAdsAccountAge}`,
        l.googleAdsSpend      && `💸 Spend: ${l.googleAdsSpend}`,
        l.googleAdsCurrency   && `(${l.googleAdsCurrency})`,
        l.googleAdsSuspended  ? '⚠️ Was suspended' : '✅ Clean',
      ].filter(Boolean).join('  ');

    case 'facebook_ad_account':
      return [
        l.metaAccountAge  && `📅 Age: ${l.metaAccountAge}`,
        l.metaSpendLimit  && `💳 Limit: ${l.metaSpendLimit}`,
        l.metaRestricted  ? '⚠️ Has restrictions' : '✅ Clean',
        l.metaPixelAttached ? '📊 Pixel ✓' : null,
      ].filter(Boolean).join('  ');

    case 'adsense_site':
      return [
        l.adsenseAge             && `📅 Age: ${l.adsenseAge}`,
        l.adsenseMonthlyEarnings && `💰 ${l.adsenseMonthlyEarnings}/mo`,
        l.adsenseSiteUrl         && `🌐 ${l.adsenseSiteUrl}`,
        l.adsenseViolations      ? '⚠️ Has violations' : '✅ Clean',
      ].filter(Boolean).join('  ');

    case 'play_console':
      return [
        l.playConsoleAge     && `📅 Age: ${l.playConsoleAge}`,
        l.playConsoleApps    && `📱 ${l.playConsoleApps} apps`,
        l.playConsoleRevenue && `💵 ${l.playConsoleRevenue}/mo`,
        l.playConsoleSuspended ? '⚠️ Had issues' : '✅ Clean',
      ].filter(Boolean).join('  ');

    case 'gift_card':
      return [
        l.giftCardBrand    && l.giftCardBrand,
        l.giftCardValue    && `💵 ${l.giftCardValue}`,
        l.giftCardCurrency && `🌍 ${l.giftCardCurrency}`,
      ].filter(Boolean).join('  ');

    default:
      return '';
  }
}

export async function handleBuy(
  phone:   string,
  text:    string,
  session: ISession
): Promise<void> {

  // ── LISTINGS — browse active listings ──────────────────────────────────────
  if (text === 'LISTINGS') {
    const listings = await Listing.find({ status: 'active' })
      .sort({ isFeatured: -1, createdAt: -1 })
      .limit(10);

    if (!listings.length) {
      return sendMessage(phone, '😔 No active listings right now.\n\nCheck back soon or type *SELL* to list something!');
    }

    const lines = listings.map((l, i) => {
      const snippet = formatListingSnippet(l);
      return (
        `*${i + 1}. ${TYPE_LABELS[l.type] ?? l.type}*${l.isFeatured ? ' ⭐' : ''}\n` +
        `💰 ₦${l.price.toLocaleString()}\n` +
        (snippet ? `${snippet}\n` : '') +
        `🆔 \`BUY ${l.listingId}\``
      );
    });

    return sendMessage(phone,
      `🛒 *Active Listings* (${listings.length})\n\n` +
      lines.join('\n\n') +
      `\n\n─────────────────\n` +
      `To buy, copy and send the *BUY [ID]* command under any listing.\n\n` +
      `Type *SELL* to list your own.`
    );
  }

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

    if (listing.seller.phone === phone) {
      return sendMessage(phone, "❌ You can't buy your own listing.");
    }

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
    const snippet                 = formatListingSnippet(listing);

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
      `*${TYPE_LABELS[listing.type] ?? listing.type}*\n` +
      `🆔 ${listingId}\n` +
      (snippet ? `${snippet}\n` : '') +
      `💰 Price: ₦${listing.price.toLocaleString()}\n` +
      `🏦 Platform fee (included): ₦${fee.toLocaleString()}\n\n` +
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

  await sendMessage(buyer.phone,
    `🔔 *Seller is ready to transfer!*\n\n` +
    `Transaction: *${txnId}*\n\n` +
    `*Transfer steps:*\n` +
    `1. Seller will add your email as account recovery\n` +
    `2. Seller will share login credentials here\n` +
    `3. Log in and verify you have full access\n` +
    `4. Change password and 2FA immediately\n` +
    `5. Confirm:\n` +
    `\`CONFIRM ${txnId}\`\n\n` +
    `You have 48 hours to confirm.\n` +
    `Problems? Reply:\n` +
    `\`DISPUTE ${txnId}\``
  );

  await sendMessage(phone,
    `✅ Buyer notified.\n\n` +
    `Proceed with the account transfer.\n` +
    `Share credentials securely in your direct chat with the buyer.\n\n` +
    `Once buyer confirms, you get paid immediately.`
  );
}