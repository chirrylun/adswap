import { sendMessage }           from '../../services/whatsapp';
import { setSession, clearSession } from '../session';
import { FEE_TIERS, TYPE_LABELS }  from '../../config/constants';
import Listing     from '../../models/Listing';
import Offer       from '../../models/Offer';
import Transaction from '../../models/Transaction';
import User        from '../../models/User';
import { generateId } from '../../utils/helpers';
import { ISession }   from '../../models/Session';

// ─── Constants ────────────────────────────────────────────────────────────────
const OFFER_EXPIRY_HOURS = 72;

// ─── Fee helper ───────────────────────────────────────────────────────────────
function calcFee(price: number): { fee: number; sellerReceives: number } {
  const tier = FEE_TIERS.find(t => price <= t.max) ?? FEE_TIERS[FEE_TIERS.length - 1];
  const fee  = Math.round(price * tier.rate);
  return { fee, sellerReceives: price - fee };
}

// ─── Escrow briefing ──────────────────────────────────────────────────────────
function buildEscrowBriefing(
  txnId:          string,
  listingId:      string,
  typeLabel:      string,
  buyerPhone:     string,
  sellerPhone:    string,
  price:          number,
  fee:            number,
  sellerReceives: number,
  offerId:        string,
): string {
  const now = new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });
  return (
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔔 *NEW ESCROW TRANSACTION (Offer Accepted)*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🆔 Transaction: *${txnId}*\n` +
    `🤝 Offer: *${offerId}*\n` +
    `📦 Asset: *${typeLabel}*\n` +
    `🔖 Listing: *${listingId}*\n` +
    `🕐 Time: ${now}\n\n` +
    `─────── PARTIES ───────\n` +
    `👤 *Buyer:* ${buyerPhone}\n` +
    `🏪 *Seller:* ${sellerPhone}\n\n` +
    `─────── PAYMENT BREAKDOWN ───────\n` +
    `💳 Buyer pays:      ₦${price.toLocaleString()}\n` +
    `➖ Swappa fee:       ₦${fee.toLocaleString()}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `💸 Seller receives: ₦${sellerReceives.toLocaleString()}\n\n` +
    `─────── ESCROW TERMS ───────\n` +
    `1. Buyer sends ₦${price.toLocaleString()} into Koji Agudah escrow\n` +
    `2. Funds held until buyer confirms access\n` +
    `3. Seller shares credentials after escrow confirms receipt\n` +
    `4. Buyer has 48 hours to verify and confirm\n` +
    `5. On confirmation, ₦${sellerReceives.toLocaleString()} released to seller\n\n` +
    `─────── ACTION ───────\n` +
    `📲 Contact buyer (${buyerPhone}) with escrow payment details.\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━`
  );
}

// ─── Create transaction from accepted offer ───────────────────────────────────
async function createTransactionFromOffer(offer: any, listing: any): Promise<string> {
  const { fee, sellerReceives } = calcFee(offer.amount);
  const transactionId = `TXN-${generateId(6)}`;
  await Transaction.create({
    transactionId,
    listing:        listing._id,
    listingId:      listing.listingId,
    buyer:          offer.buyer,
    seller:         offer.seller,
    amount:         offer.amount,
    platformFee:    fee,
    sellerReceives,
    status:         'pending',
    adminNote:      `Created from offer ${offer.offerId}`,
  });
  return transactionId;
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFER [listingId]  — validate listing, then ask for amount
// ─────────────────────────────────────────────────────────────────────────────
export async function handleOfferStart(
  phone:   string,
  text:    string,
  session: ISession,
): Promise<void> {

  // ── Step 2 of 2: user just typed their offer amount ───────────────────────
  if (session?.step === 'offer_amount') {
    const { listingId, listingPrice } = session.data ?? {};

    const raw    = text.replace(/[,₦\s]/g, '');
    const amount = parseInt(raw, 10);

    if (isNaN(amount) || amount < 1000) {
      return sendMessage(phone,
        `❌ Invalid amount. Please enter a number — minimum ₦1,000.\n\n` +
        `Example: *50000*\n\n` +
        `Or type *CANCEL* to exit.`,
      );
    }

    if (amount >= listingPrice) {
      await clearSession(phone);
      return sendMessage(phone,
        `❌ Your offer (₦${amount.toLocaleString()}) is at or above the asking price (₦${listingPrice.toLocaleString()}).\n\n` +
        `To buy at the listed price, send:\n\`BUY ${listingId}\`\n\n` +
        `Or type *LISTINGS* to browse.`,
      );
    }

    // Re-fetch listing (brief window between steps where it could be sold/expired)
    const listing = await Listing.findOne({ listingId, status: 'active' })
      .populate<{ seller: any }>('seller');

    if (!listing) {
      await clearSession(phone);
      return sendMessage(phone,
        `❌ Listing *${listingId}* is no longer available.\n\nType *LISTINGS* to browse.`,
      );
    }

    const buyer = await User.findOneAndUpdate(
      { phone },
      { $setOnInsert: { phone } },
      { upsert: true, new: true },
    );

    // One active offer per buyer per listing
    const existing = await Offer.findOne({
      listingId,
      buyer:  buyer._id,
      status: { $in: ['pending', 'countered', 'buyer_countered'] },
    });

    if (existing) {
      await clearSession(phone);
      return sendMessage(phone,
        `⚠️ You already have an active offer on listing *${listingId}*.\n\n` +
        `Offer ref: *${existing.offerId}*\n` +
        `Current amount: ₦${existing.amount.toLocaleString()}\n\n` +
        `To withdraw it: \`CANCEL OFFER ${existing.offerId}\``,
      );
    }

    const offerId   = `OFR-${generateId(6)}`;
    const expiresAt = new Date(Date.now() + OFFER_EXPIRY_HOURS * 60 * 60 * 1000);
    const { fee, sellerReceives } = calcFee(amount);
    const typeLabel = TYPE_LABELS[listing.type] ?? listing.type;

    await Offer.create({
      offerId,
      listingId,
      listing:  listing._id,
      buyer:    buyer._id,
      seller:   listing.seller._id,
      amount,
      turn:     'seller',
      status:   'pending',
      history:  [{ actor: 'buyer', action: 'offer', amount, at: new Date() }],
      expiresAt,
    });

    await clearSession(phone);

    // Confirm to buyer
    await sendMessage(phone,
      `✅ *Offer Submitted!*\n\n` +
      `Asset: *${typeLabel}*\n` +
      `Listing: *${listingId}*\n` +
      `Your offer: *₦${amount.toLocaleString()}*\n` +
      `Listed price: ₦${listing.price.toLocaleString()}\n\n` +
      `Offer ref: *${offerId}*\n` +
      `_The seller will be notified and has 72 hours to respond._\n\n` +
      `To withdraw your offer:\n` +
      `\`CANCEL OFFER ${offerId}\``,
    );

    // Notify seller
    await sendMessage(listing.seller.phone,
      `💬 *New Offer on Your Listing!*\n\n` +
      `Asset: *${typeLabel}*\n` +
      `Listing: *${listingId}*\n\n` +
      `─────── Offer Details ───────\n` +
      `Offer: *₦${amount.toLocaleString()}*\n` +
      `Your asking price: ₦${listing.price.toLocaleString()}\n` +
      `You'd receive: *₦${sellerReceives.toLocaleString()}* _(after Swappa fee)_\n\n` +
      `Offer ref: *${offerId}*\n\n` +
      `Reply with one of:\n` +
      `✅ Accept:  \`ACCEPT ${offerId}\`\n` +
      `❌ Reject:  \`REJECT ${offerId}\`\n` +
      `💬 Counter: \`COUNTER ${offerId} [your price]\`\n\n` +
      `_This offer expires in 72 hours._`,
    ).catch(() => {});

    return;
  }

  // ── Step 1 of 2: OFFER [listingId] received ───────────────────────────────
  const listingId = text.replace('OFFER ', '').trim();

  if (!listingId) {
    return sendMessage(phone,
      `To make an offer, send:\n` +
      `\`OFFER [Listing ID]\`\n\n` +
      `Example: \`OFFER ADS-12345\`\n\n` +
      `Or type *LISTINGS* to browse available listings.`,
    );
  }

  const listing = await Listing.findOne({ listingId: listingId.toUpperCase(), status: 'active' });

  if (!listing) {
    return sendMessage(phone,
      `❌ Listing *${listingId.toUpperCase()}* not found or no longer available.\n\n` +
      `Type *LISTINGS* to browse.`,
    );
  }

  const user = await User.findOne({ phone });
  if (user) {
    const sellerCheck = await Listing.findOne({ listingId: listing.listingId, seller: user._id });
    if (sellerCheck) {
      return sendMessage(phone, `❌ You can't make an offer on your own listing.`);
    }
  }

  const typeLabel = TYPE_LABELS[listing.type] ?? listing.type;

  // Save listing context into session, ask for amount
  await setSession(phone, 'offer_amount', {
    listingId:    listing.listingId,
    listingPrice: listing.price,
  });

  return sendMessage(phone,
    `💬 *Make an Offer*\n\n` +
    `Asset: *${typeLabel}*\n` +
    `Listing: *${listing.listingId}*\n` +
    `Asking price: *₦${listing.price.toLocaleString()}*\n\n` +
    `─────────────────\n` +
    `How much would you like to offer? (in Naira)\n\n` +
    `Enter numbers only — no symbols.\n` +
    `Example: *50000*\n\n` +
    `_(Must be less than ₦${listing.price.toLocaleString()})_\n\n` +
    `Type *CANCEL* to exit.`,
  );
}

// ─── Export alias — handler.ts imports this name ──────────────────────────────
export { handleOfferStart as handleMakeOffer };

// ─────────────────────────────────────────────────────────────────────────────
// ACCEPT [offerId]
// ─────────────────────────────────────────────────────────────────────────────
export async function handleAcceptOffer(phone: string, offerId: string): Promise<void> {
  const user = await User.findOne({ phone });
  if (!user) return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

  const offer = await Offer.findOne({
    offerId,
    status: { $in: ['pending', 'countered', 'buyer_countered'] },
  })
    .populate<{ listing: any }>('listing')
    .populate<{ buyer: any }>('buyer')
    .populate<{ seller: any }>('seller');

  if (!offer) {
    return sendMessage(phone,
      `❌ Offer *${offerId}* not found or no longer active.\n\nType *MY OFFERS* to see your offers.`,
    );
  }

  const isBuyer  = offer.buyer._id.toString()  === user._id.toString();
  const isSeller = offer.seller._id.toString() === user._id.toString();

  if (!isBuyer && !isSeller) return sendMessage(phone, `❌ This offer doesn't belong to you.`);

  if (isBuyer  && offer.turn !== 'buyer')  {
    return sendMessage(phone, `⏳ It's the seller's turn to respond to offer *${offerId}*.`);
  }
  if (isSeller && offer.turn !== 'seller') {
    return sendMessage(phone, `⏳ It's the buyer's turn to respond to offer *${offerId}*.`);
  }

  const actor = isBuyer ? 'buyer' : 'seller';
  offer.status = 'accepted';
  offer.history.push({ actor, action: 'accept', at: new Date() });
  await offer.save();

  const listing   = offer.listing;
  const typeLabel = TYPE_LABELS[listing.type] ?? listing.type;
  const { fee, sellerReceives } = calcFee(offer.amount);
  const transactionId = await createTransactionFromOffer(offer, listing);

  await sendMessage(
    process.env.PAYMENT_PHONE!,
    buildEscrowBriefing(
      transactionId,
      listing.listingId,
      typeLabel,
      offer.buyer.phone,
      offer.seller.phone,
      offer.amount,
      fee,
      sellerReceives,
      offerId,
    ),
  ).catch(err => console.error('[Offer Accept] Payment notify error:', err));

  const agreedMsg =
    `🤝 *Offer Accepted!*\n\n` +
    `Asset: *${typeLabel}*\n` +
    `Agreed price: *₦${offer.amount.toLocaleString()}*\n` +
    `Offer ref: *${offerId}*\n` +
    `Transaction ref: *${transactionId}*\n\n` +
    `🔒 Our team will be in touch to arrange payment via *Koji Agudah escrow*.`;

  await sendMessage(offer.buyer.phone,  agreedMsg).catch(() => {});
  await sendMessage(offer.seller.phone, agreedMsg).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// REJECT [offerId]
// ─────────────────────────────────────────────────────────────────────────────
export async function handleRejectOffer(phone: string, offerId: string): Promise<void> {
  const user = await User.findOne({ phone });
  if (!user) return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

  const offer = await Offer.findOne({
    offerId,
    status: { $in: ['pending', 'countered', 'buyer_countered'] },
  })
    .populate<{ buyer: any }>('buyer')
    .populate<{ seller: any }>('seller')
    .populate<{ listing: any }>('listing');

  if (!offer) return sendMessage(phone, `❌ Offer *${offerId}* not found or no longer active.`);

  const isBuyer  = offer.buyer._id.toString()  === user._id.toString();
  const isSeller = offer.seller._id.toString() === user._id.toString();

  if (!isBuyer && !isSeller) return sendMessage(phone, `❌ This offer doesn't belong to you.`);

  if (isBuyer  && offer.turn !== 'buyer')  {
    return sendMessage(phone, `⏳ It's the seller's turn to respond to offer *${offerId}*.`);
  }
  if (isSeller && offer.turn !== 'seller') {
    return sendMessage(phone, `⏳ It's the buyer's turn to respond to offer *${offerId}*.`);
  }

  const actor     = isBuyer ? 'buyer' : 'seller';
  const other     = isBuyer ? offer.seller : offer.buyer;
  const typeLabel = TYPE_LABELS[offer.listing.type] ?? offer.listing.type;

  offer.status = 'rejected';
  offer.history.push({ actor, action: 'reject', at: new Date() });
  await offer.save();

  await sendMessage(phone,
    `❌ *Offer Rejected*\n\n` +
    `Offer *${offerId}* on *${typeLabel}* has been rejected.\n\n` +
    `Type *LISTINGS* to browse other listings.`,
  );

  await sendMessage(other.phone,
    `❌ *Offer Rejected*\n\n` +
    `The ${actor === 'buyer' ? 'buyer' : 'seller'} has rejected offer *${offerId}*.\n\n` +
    `Offer: ₦${offer.amount.toLocaleString()} on *${typeLabel}*\n\n` +
    (isSeller
      ? `You may send a new offer if you wish:\n\`OFFER ${offer.listing.listingId}\`\n\nType *LISTINGS* to browse more.`
      : `Type *LISTINGS* to browse other listings.`),
  ).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNTER [offerId] [amount]
// ─────────────────────────────────────────────────────────────────────────────
export async function handleCounterOffer(phone: string, text: string): Promise<void> {
  const parts = text.replace('COUNTER ', '').trim().split(/\s+/);

  if (parts.length < 2) {
    return sendMessage(phone,
      `To counter an offer, send:\n` +
      `\`COUNTER [Offer ID] [Your Price]\`\n\n` +
      `Example: \`COUNTER OFR-123456 75000\``,
    );
  }

  const offerId = parts[0].toUpperCase();
  const amount  = parseInt(parts[1].replace(/[,₦\s]/g, ''), 10);

  if (isNaN(amount) || amount < 1000) {
    return sendMessage(phone,
      `❌ Invalid counter amount. Minimum is ₦1,000.\n\nExample: \`COUNTER ${offerId} 75000\``,
    );
  }

  const user = await User.findOne({ phone });
  if (!user) return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

  const offer = await Offer.findOne({
    offerId,
    status: { $in: ['pending', 'countered', 'buyer_countered'] },
  })
    .populate<{ buyer: any }>('buyer')
    .populate<{ seller: any }>('seller')
    .populate<{ listing: any }>('listing');

  if (!offer) return sendMessage(phone, `❌ Offer *${offerId}* not found or no longer active.`);

  const isBuyer  = offer.buyer._id.toString()  === user._id.toString();
  const isSeller = offer.seller._id.toString() === user._id.toString();

  if (!isBuyer && !isSeller) return sendMessage(phone, `❌ This offer doesn't belong to you.`);

  if (isBuyer  && offer.turn !== 'buyer')  {
    return sendMessage(phone, `⏳ It's the seller's turn to respond to offer *${offerId}*.`);
  }
  if (isSeller && offer.turn !== 'seller') {
    return sendMessage(phone, `⏳ It's the buyer's turn to respond to offer *${offerId}*.`);
  }

  const listing   = offer.listing;
  const typeLabel = TYPE_LABELS[listing.type] ?? listing.type;

  if (amount >= listing.price) {
    return sendMessage(phone,
      `❌ Counter (₦${amount.toLocaleString()}) must be below the asking price (₦${listing.price.toLocaleString()}).` +
      (isBuyer ? `\n\nTo buy at full price: \`BUY ${listing.listingId}\`` : ''),
    );
  }

  const actor     = isBuyer ? 'buyer' : 'seller';
  const nextTurn  = isBuyer ? 'seller' : 'buyer';
  const newStatus = isBuyer ? 'buyer_countered' : 'countered';
  const other     = isBuyer ? offer.seller : offer.buyer;
  const { fee, sellerReceives } = calcFee(amount);

  offer.amount = amount;
  offer.turn   = nextTurn;
  offer.status = newStatus;
  offer.history.push({ actor, action: 'counter', amount, at: new Date() });
  await offer.save();

  await sendMessage(phone,
    `💬 *Counter Offer Sent*\n\n` +
    `Offer: *${offerId}*\n` +
    `Your counter: *₦${amount.toLocaleString()}*\n\n` +
    `_The ${nextTurn} has been notified and has 72 hours to respond._`,
  );

  await sendMessage(other.phone,
    `💬 *Counter Offer Received*\n\n` +
    `Asset: *${typeLabel}*\n` +
    `Listing: *${listing.listingId}*\n\n` +
    `─────── Counter Details ───────\n` +
    `Counter offer: *₦${amount.toLocaleString()}*\n` +
    (nextTurn === 'seller'
      ? `You'd receive: *₦${sellerReceives.toLocaleString()}* _(after Swappa fee)_`
      : `Listed price: ₦${listing.price.toLocaleString()}`) +
    `\n\nOffer ref: *${offerId}*\n\n` +
    `Reply with:\n` +
    `✅ Accept:  \`ACCEPT ${offerId}\`\n` +
    `❌ Reject:  \`REJECT ${offerId}\`\n` +
    `💬 Counter: \`COUNTER ${offerId} [your price]\`\n\n` +
    `_Offer expires 72 hours from original submission._`,
  ).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL OFFER [offerId]  — buyer only
// ─────────────────────────────────────────────────────────────────────────────
export async function handleCancelOffer(phone: string, offerId: string): Promise<void> {
  const user = await User.findOne({ phone });
  if (!user) return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

  const offer = await Offer.findOne({
    offerId,
    buyer:  user._id,
    status: { $in: ['pending', 'countered', 'buyer_countered'] },
  })
    .populate<{ seller: any }>('seller')
    .populate<{ listing: any }>('listing');

  if (!offer) {
    return sendMessage(phone,
      `❌ Offer *${offerId}* not found or cannot be cancelled.\n\n` +
      `Only your active offers can be cancelled.`,
    );
  }

  const typeLabel = TYPE_LABELS[offer.listing.type] ?? offer.listing.type;

  offer.status = 'cancelled';
  offer.history.push({ actor: 'buyer', action: 'cancel', at: new Date() });
  await offer.save();

  await sendMessage(phone,
    `✅ Offer *${offerId}* has been cancelled.\n\nType *LISTINGS* to browse other listings.`,
  );

  await sendMessage(offer.seller.phone,
    `ℹ️ *Offer Withdrawn*\n\n` +
    `A buyer has withdrawn their offer on your *${typeLabel}* listing (${offer.listing.listingId}).\n\n` +
    `Offer: ₦${offer.amount.toLocaleString()} — Ref: ${offerId}\n\n` +
    `Your listing remains active.`,
  ).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// MY OFFERS
// ─────────────────────────────────────────────────────────────────────────────
export async function handleMyOffers(phone: string): Promise<void> {
  const user = await User.findOne({ phone });
  if (!user) return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

  const [buyerOffers, sellerOffers] = await Promise.all([
    Offer.find({ buyer: user._id, status: { $in: ['pending', 'countered', 'buyer_countered'] } })
      .populate<{ listing: any }>('listing')
      .sort({ createdAt: -1 })
      .limit(5),
    Offer.find({ seller: user._id, status: { $in: ['pending', 'countered', 'buyer_countered'] } })
      .populate<{ listing: any }>('listing')
      .sort({ createdAt: -1 })
      .limit(5),
  ]);

  if (!buyerOffers.length && !sellerOffers.length) {
    return sendMessage(phone,
      `📭 You have no active offers.\n\n` +
      `To make an offer on a listing:\n` +
      `\`OFFER [Listing ID]\``,
    );
  }

  const lines: string[] = [];

  if (buyerOffers.length) {
    lines.push(`*Offers You Made:*`);
    for (const o of buyerOffers) {
      const label  = TYPE_LABELS[o.listing?.type] ?? '—';
      const action = o.turn === 'buyer'
        ? `_(your turn — ACCEPT / REJECT / COUNTER)_`
        : `_(awaiting seller)_`;
      lines.push(`${o.offerId} · ${label}\n₦${o.amount.toLocaleString()} · ${o.status}\n${action}`);
    }
  }

  if (sellerOffers.length) {
    if (lines.length) lines.push('');
    lines.push(`*Offers on Your Listings:*`);
    for (const o of sellerOffers) {
      const label  = TYPE_LABELS[o.listing?.type] ?? '—';
      const action = o.turn === 'seller'
        ? `_(your turn — ACCEPT / REJECT / COUNTER)_`
        : `_(awaiting buyer)_`;
      lines.push(`${o.offerId} · ${label}\n₦${o.amount.toLocaleString()} · ${o.status}\n${action}`);
    }
  }

  return sendMessage(phone,
    `📋 *Active Offers*\n\n` +
    lines.join('\n\n') +
    `\n\n─────────────────\n` +
    `Commands:\n` +
    `\`ACCEPT [Offer ID]\`\n` +
    `\`REJECT [Offer ID]\`\n` +
    `\`COUNTER [Offer ID] [Amount]\`\n` +
    `\`CANCEL OFFER [Offer ID]\``,
  );
}