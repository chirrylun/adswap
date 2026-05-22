import { sendMessage } from "../services/whatsapp";
import { getSession, clearSession } from "./session";
import { showWelcome, showHelp } from "./flows/welcome";
import { handleSell } from "./flows/sell";
import { handleBuy } from "./flows/buy";
import {
  handleListings,
  handleMyListings,
  handleRemoveListing,
} from "./flows/listings";
import { handleRequest } from "./flows/request";
import {
  handleMakeOffer,
  handleAcceptOffer,
  handleRejectOffer,
  handleCounterOffer,
  handleCancelOffer,
  handleMyOffers,
} from "./flows/offer";
import { track } from "../services/analytics";
/*
import { handleDispute }            from './flows/dispute';
import { handleRate }               from './flows/confirm';
*/
import {
  handleOptOut,
  handleOptIn,
  handleNotificationsToggle,
} from "../services/notifications";
import User from "../models/User";

export async function handleIncoming(
  phone: string,
  text: string,
  mediaId?: string,
): Promise<void> {
  console.log(`Incoming message from ${phone}: "${text}"`);

  const upper = text.trim().toUpperCase();
  const session = await getSession(phone);

  // ── Ensure user record exists + update last active ─────────────────────────
  const userResult = await User.findOneAndUpdate(
    { phone },
    {
      $setOnInsert: {
        phone,
        notifications: { enabled: true, optedOutTypes: [] },
      },
      $set: { lastActiveAt: new Date() },
    },
    { upsert: true, new: false },
  );

  const isNewUser = userResult === null;

  if (isNewUser) {
    track("user_joined", phone);
    sendMessage(
      process.env.PAYMENT_PHONE!,
      `👤 *New User Joined*\n\n` +
        `📱 Phone: ${phone}\n` +
        `🕐 Time: ${new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}\n\n` +
        `They just sent their first message to AdSwap.`,
    ).catch((err) => console.error("[NewUser] Notify error:", err));
  }

  // ── Check for banned users ─────────────────────────────────────────────────
  const user = await User.findOne({ phone });
  if (user?.isBanned) {
    return sendMessage(
      phone,
      `❌ Your account has been suspended.\n\n` +
        `Reason: ${user.banReason || "Policy violation"}\n\n` +
        `Contact support: ${process.env.SUPPORT_PHONE}`,
    );
  }

  // ── Global commands ────────────────────────────────────────────────────────
  if (["MENU", "START", "HI", "HELLO", "HEY"].includes(upper)) {
    track("menu_opened", phone, { trigger: upper });
    await clearSession(phone);
    return showWelcome(phone);
  }

  if (upper === "HELP") {
    track("help_opened", phone);
    return showHelp(phone);
  }

  // ── Cancel variants — must be checked before generic CANCEL ───────────────
  if (upper.startsWith("CANCEL TXN-")) {
    return handleBuy(phone, upper, session);
  }

  if (upper.startsWith("CANCEL OFFER ")) {
    const offerId = upper.replace("CANCEL OFFER ", "").trim();
    return handleCancelOffer(phone, offerId);
  }

  if (upper.startsWith("CANCEL REQUEST ")) {
    return handleRequest(phone, upper, session);
  }

  if (upper === "CANCEL") {
    track("session_cancelled", phone, { fromStep: session?.step });
    await clearSession(phone);
    return sendMessage(
      phone,
      "❌ Action cancelled.\n\nType *MENU* to start again.",
    );
  }

  // ── Notification commands ──────────────────────────────────────────────────
  if (upper.startsWith("OPTOUT ")) {
    const assetType = upper.replace("OPTOUT ", "").trim().toLowerCase();
    return handleOptOut(phone, assetType);
  }

  if (upper.startsWith("OPTIN ")) {
    const assetType = upper.replace("OPTIN ", "").trim().toLowerCase();
    return handleOptIn(phone, assetType);
  }

  if (upper === "NOTIFICATIONS ON")
    return handleNotificationsToggle(phone, true);
  if (upper === "NOTIFICATIONS OFF")
    return handleNotificationsToggle(phone, false);

  // ── Offer commands ─────────────────────────────────────────────────────────
  // These are checked BEFORE the generic sell/buy/listings blocks so that
  // ACCEPT / REJECT / COUNTER are never accidentally swallowed by a sell step.

  if (upper.startsWith("OFFER ") || session?.step === "offer_amount") {
    return handleMakeOffer(phone, upper, session);
  }

  if (upper.startsWith("ACCEPT ")) {
    const offerId = upper.replace("ACCEPT ", "").trim();
    return handleAcceptOffer(phone, offerId);
  }

  if (upper.startsWith("REJECT ")) {
    const offerId = upper.replace("REJECT ", "").trim();
    return handleRejectOffer(phone, offerId);
  }

  if (upper.startsWith("COUNTER ")) {
    return handleCounterOffer(phone, upper);
  }

  if (upper === "MY OFFERS") {
    return handleMyOffers(phone);
  }

  // ── Request flow ───────────────────────────────────────────────────────────
  if (
    upper === "REQUEST" ||
    upper === "MY REQUESTS" ||
    upper.startsWith("REQTYPE_") ||
    upper.startsWith("RESPOND ") ||
    session?.step === "request_details" ||
    session?.step === "request_budget" ||
    session?.step === "request_notes" ||
    session?.step?.startsWith("req_q_")
  ) {
    return handleRequest(phone, upper, session);
  }

  // ── My listings ────────────────────────────────────────────────────────────
  if (upper === "MY LISTINGS") {
    return handleMyListings(phone);
  }

  // ── Remove listing ─────────────────────────────────────────────────────────
  if (upper.startsWith("REMOVE ")) {
    return handleRemoveListing(phone, upper);
  }

  // ── Sell flow ──────────────────────────────────────────────────────────────
  if (upper === "SELL" || session?.step?.startsWith("sell_")) {
    return handleSell(phone, upper, session, mediaId);
  }

  // ── Browse listings ────────────────────────────────────────────────────────
  if (
    upper === "LISTINGS" ||
    upper.startsWith("VIEW ") ||
    upper.startsWith("BR_")
  ) {
    return handleListings(phone, upper);
  }

  // ── Buy flow ───────────────────────────────────────────────────────────────
  if (upper.startsWith("BUY ")) {
    return handleBuy(phone, upper, session);
  }

  /*
  // ── Dispute flow ───────────────────────────────────────────────────────────
  if (upper.startsWith('DISPUTE') || session?.step?.startsWith('dispute_')) {
    return handleDispute(phone, upper, session, mediaId);
  }

  // ── Rate seller ────────────────────────────────────────────────────────────
  if (upper.startsWith('RATE ')) {
    return handleRate(phone, upper);
  }
  */

  // ── Media received outside a known flow ───────────────────────────────────
  if (
    upper === "MEDIA_RECEIVED" &&
    !session?.step?.startsWith("sell_") &&
    !session?.step?.startsWith("dispute_")
  ) {
    return sendMessage(
      phone,
      `I received an image, but I'm not sure what it's for.\n\nType *MENU* to see options.`,
    );
  }

  // ── Default fallback ───────────────────────────────────────────────────────
  track("drop_off", phone, { text: upper }, session?.step ?? "none");
  return showWelcome(phone);
}
