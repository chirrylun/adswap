import { sendMessage }        from '../services/whatsapp';
import { getSession, clearSession } from './session';
import { showWelcome, showHelp }    from './flows/welcome';
import { handleSell }               from './flows/sell';
import { handleBuy, handleSellerReady } from './flows/buy';
import { handleListings }           from './flows/listings';
import { handleDispute }            from './flows/dispute';
import { handleConfirm, handleRate }from './flows/confirm';
import User from '../models/User';

export async function handleIncoming(
  phone:   string,
  text:    string,
  mediaId?: string
): Promise<void> {
   console.log(`Incoming message from ${phone}: "${text}"`);
  const upper   = text.trim().toUpperCase();
  const session = await getSession(phone);

  // ── Ensure user record exists + update last active ─────────────────────────
  await User.findOneAndUpdate(
    { phone },
    { $setOnInsert: { phone }, lastActiveAt: new Date() },
    { upsert: true }
  );

  // ── Check for banned users ─────────────────────────────────────────────────
  const user = await User.findOne({ phone });
  if (user?.isBanned) {
    return sendMessage(phone,
      `❌ Your account has been suspended.\n\nReason: ${user.banReason || 'Policy violation'}\n\nContact support: ${process.env.SUPPORT_PHONE}`
    );
  }

  // ── Global commands — work from any state ──────────────────────────────────
  if (['MENU','START','HI','HELLO','HEY'].includes(upper)) {
    return showWelcome(phone);
  }

  if (upper === 'HELP') {
    return showHelp(phone);
  }

  if (upper === 'CANCEL') {
    await clearSession(phone);
    return sendMessage(phone, '❌ Action cancelled.\n\nType *MENU* to start again.');
  }

  // ── Sell flow ──────────────────────────────────────────────────────────────
  if (upper === 'SELL' || session.step.startsWith('sell_')) {
    return handleSell(phone, upper, session, mediaId);
  }

  // ── Buy flow ───────────────────────────────────────────────────────────────
  if (upper.startsWith('BUY ')) {
    return handleBuy(phone, upper, session);
  }

  // ── Listings ───────────────────────────────────────────────────────────────
  if (upper === 'LISTINGS' || upper.startsWith('VIEW ')) {
    return handleListings(phone, upper);
  }

  // ── Seller ready ───────────────────────────────────────────────────────────
  if (upper.startsWith('READY ')) {
    return handleSellerReady(phone, upper);
  }

  // ── Dispute flow ───────────────────────────────────────────────────────────
  if (
    upper.startsWith('DISPUTE') ||
    session.step.startsWith('dispute_')
  ) {
    return handleDispute(phone, upper, session, mediaId);
  }

  // ── Confirm transfer ───────────────────────────────────────────────────────
  if (upper.startsWith('CONFIRM ')) {
    return handleConfirm(phone, upper);
  }

  // ── Rate seller ────────────────────────────────────────────────────────────
  if (upper.startsWith('RATE ')) {
    return handleRate(phone, upper);
  }

  // ── Media received outside a flow ─────────────────────────────────────────
  if (upper === 'MEDIA_RECEIVED' && !session.step.startsWith('sell_') && !session.step.startsWith('dispute_')) {
    return sendMessage(phone,
      "I received an image, but I'm not sure what it's for.\n\nType *MENU* to see options."
    );
  }

  // ── Default fallback ───────────────────────────────────────────────────────
  return showWelcome(phone);
}