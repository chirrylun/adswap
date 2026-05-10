import { sendMessage } from "../../services/whatsapp";
import { setSession, clearSession } from "../session";
import { FEE_TIERS, TYPE_LABELS } from "../../config/constants";
import Listing from "../../models/Listing";
import Transaction from "../../models/Transaction";
import User from "../../models/User";
import { generateId } from "../../utils/helpers";
import { ISession } from "../../models/Session";

const buyLocks = new Set<string>();

// ─── Fee calculation (removed from seller price) ───────────────────────
function calcFee(price: number): { fee: number; sellerReceives: number } {
  const tier =
    FEE_TIERS.find((t) => price <= t.max) ?? FEE_TIERS[FEE_TIERS.length - 1];
  const fee = Math.round(price * tier.rate);
  return { fee, sellerReceives: price - fee };
}

// ─── Build escrow briefing for PAYMENT_PHONE ──────────────────────────────────
function buildEscrowBriefing(
  txnId: string,
  listingId: string,
  typeLabel: string,
  buyerPhone: string,
  sellerPhone: string,
  price: number,
  fee: number,
  sellerReceives: number,
): string {
  const now = new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" });

  return (
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🔔 *NEW ESCROW TRANSACTION*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🆔 Transaction: *${txnId}*\n` +
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
    `2. Funds are held — NOT released until buyer confirms access\n` +
    `3. Seller shares credentials after escrow confirms receipt\n` +
    `4. Buyer has 48 hours to verify full access and confirm\n` +
    `5. On buyer confirmation, ₦${sellerReceives.toLocaleString()} is released to seller\n` +
    `6. If buyer disputes within 48 hrs, funds are held pending review\n` +
    `7. If no action within 48 hrs, funds auto-release to seller\n\n` +
    `─────── ACTION ───────\n` +
    `📲 Contact buyer (${buyerPhone}) with Koji Agudah escrow payment details.\n` +
    `Copy this message as the deal summary for both parties.\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━`
  );
}

// ─── Main buy handler ─────────────────────────────────────────────────────────
export async function handleBuy(
  phone: string,
  text: string,
  session: ISession,
): Promise<void> {
  // ── LISTINGS — browse ──────────────────────────────────────────────────────
  if (text === "LISTINGS") {
    const listings = await Listing.find({ status: "active" })
      .sort({ isFeatured: -1, createdAt: -1 })
      .limit(10);

    if (!listings.length) {
      return sendMessage(
        phone,
        `😔 *No active listings right now.*\n\nCheck back soon or type *SELL* to list something!`,
      );
    }

    const lines = listings.map((l, i) => {
      const typeLabel = TYPE_LABELS[l.type] ?? l.type;
      const { fee, sellerReceives } = calcFee(l.price);
      return (
        `*${i + 1}. ${typeLabel}*${l.isFeatured ? " ⭐" : ""}\n` +
        `💰 ₦${l.price.toLocaleString()} _(seller receives ₦${sellerReceives.toLocaleString()})_\n` +
        `🆔 \`BUY ${l.listingId}\``
      );
    });

    return sendMessage(
      phone,
      `🛒 *Active Listings* (${listings.length})\n\n` +
        lines.join("\n\n") +
        `\n\n─────────────────\n` +
        `To buy, copy and send the *BUY [ID]* command.\n\n` +
        `Type *SELL* to list your own.`,
    );
  }

  if (text.startsWith('CANCEL TXN-')) {
  const transactionId = text.replace('CANCEL ', '').trim();

  const buyer = await User.findOne({ phone });
  if (!buyer) {
    return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);
  }

  const txn = await Transaction.findOne({
    transactionId,
    buyer:  buyer._id,
    status: 'pending',
  });

  if (!txn) {
    return sendMessage(phone,
      `❌ Transaction *${transactionId}* not found or already closed.\n\n` +
      `It may have already been cancelled or completed.`
    );
  }

  await Transaction.updateOne(
    { _id: txn._id },
    { $set: { status: 'cancelled', cancelledAt: new Date() } }
  );

  // Notify payment handler
  await sendMessage(
    process.env.PAYMENT_PHONE!,
    `🚫 *Transaction Cancelled by Buyer*\n\n` +
    `Transaction: *${transactionId}*\n` +
    `Buyer: ${phone}\n\n` +
    `No further action needed unless escrow was already initiated.`
  ).catch(err => console.error('[Cancel] Payment notify error:', err?.response?.data ?? err?.message ?? err));

  return sendMessage(phone,
    `✅ Transaction *${transactionId}* has been cancelled.\n\n` +
    `If you already sent funds to escrow, contact support immediately.\n\n` +
    `Type *LISTINGS* to browse other listings.`
  );
}

  // ── BUY [listingId] ────────────────────────────────────────────────────────
  if (text.startsWith("BUY ")) {
    const listingId = text.replace("BUY ", "").trim();

    const lockKey = `${phone}:${listingId}`;
    if (buyLocks.has(lockKey)) {
      return sendMessage(
        phone,
        `⏳ Your previous request is still processing. Please wait a moment.`,
      );
    }
    buyLocks.add(lockKey);

    try {
      const listing = await Listing.findOne({
        listingId,
        status: "active",
      }).populate<{ seller: any }>("seller");

      if (!listing) {
        return sendMessage(
          phone,
          `❌ Listing not found or no longer available.\n\nType *LISTINGS* to browse.`,
        );
      }

      const buyer = await User.findOneAndUpdate(
        { phone },
        { $setOnInsert: { phone } },
        { upsert: true, returnDocument: "after" },
      );

      if (listing.seller.phone === phone) {
        return sendMessage(phone, `❌ You can't buy your own listing.`);
      }

      const typeLabel = TYPE_LABELS[listing.type] ?? listing.type;
      const { fee, sellerReceives } = calcFee(listing.price);
      const buyerPays = listing.price;

      // ── Check for existing open transaction ────────────────────────────────
      const existing = await Transaction.findOne({
        listingId,
        buyer: buyer._id,
        status: "pending",
      });

      if (existing) {
        return sendMessage(
          phone,
          `⚠️ You already have an open transaction for this listing.\n\n` +
            `Transaction: *${existing.transactionId}*\n\n` +
           `Our team will be in touch.\n\n` +
`To cancel this transaction, send:\n` +
`\`CANCEL ${existing.transactionId}\``,
        );
      }

      // ── Create transaction record ──────────────────────────────────────────
      const transactionId = `TXN-${generateId(6)}`;

      await Transaction.create({
        transactionId,
        listing: listing._id,
        listingId,
        buyer: buyer._id,
        seller: listing.seller._id,
        amount: listing.price, // buyer pays the listed price
        platformFee: fee,
        sellerReceives, // seller gets price minus fee
        status: "pending",
      });

      // ── Notify payment handler with full escrow briefing ───────────────────
      await sendMessage(
        process.env.PAYMENT_PHONE!,
        buildEscrowBriefing(
          transactionId,
          listingId,
          typeLabel,
          phone,
          listing.seller.phone,
          listing.price,
          fee,
          sellerReceives,
        ),
      ).catch((err) =>
        console.error(
          "[Buy] Payment notify error:",
          err?.response?.data ?? err?.message ?? err,
        ),
      );

      // ── Notify seller ──────────────────────────────────────────────────────
      await sendMessage(
        listing.seller.phone,
        `🎉 *Someone wants to buy your listing!*\n\n` +
          `Asset: *${typeLabel}*\n` +
          `Listing: *${listingId}*\n` +
          `You will receive: *₦${sellerReceives.toLocaleString()}* _(after Swappa's fee)_\n\n` +
          `🔒 The transaction will be handled through *Koji Agudah escrow* — your payment is protected.\n\n` +
          `Our team will contact both parties shortly to initiate the escrow payment.\n\n` +
          `Transaction ref: *${transactionId}*\n\n` +
          `Questions? Type *HELP*`,
      ).catch(() => {});

      // ── Notify buyer ───────────────────────────────────────────────────────
      return sendMessage(
        phone,
        `✅ *Purchase Request Received!*\n\n` +
          `Asset: *${typeLabel}*\n` +
          `Listing: *${listingId}*\n\n` +
          `Payment Amount ───────\n\n` +
          `*You pay: ₦${listing.price.toLocaleString()}*\n\n` +
          `─────────────────\n` +
          `🔒 *How it works:*\n` +
          `1️⃣  Our team will contact both parties shortly to initiate a *Koji Agudah escrow* escrow payment\n` +
          `2️⃣  Your ₦${listing.price.toLocaleString()} is held securely — not sent to the seller yet\n` +
          `3️⃣  Seller shares account credentials once escrow confirms your payment\n` +
          `4️⃣  You verify access and confirm\n` +
          `5️⃣  Funds released to seller\n\n` +
          `Transaction ref: *${transactionId}*\n` +
          `_Save this for reference._\n\n` +
          `Questions? Type *HELP*`,
      );
    } finally {
      buyLocks.delete(lockKey);
    }
  }
}
