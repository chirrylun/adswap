import { sendMessage }    from '../services/whatsapp';
import { getSession, clearSession } from './session';
import { showWelcome, showHelp }    from './flows/welcome';
import { handleSell }               from './flows/sell';
import { handleBuy }                from './flows/buy';
import { handleListings }           from './flows/listings';
/*
import { handleDispute }            from './flows/dispute';

import { handleRate }               from './flows/confirm';
*/
import {
  handleOptOut,
  handleOptIn,
  handleNotificationsToggle,
} from '../services/notifications';
import User from '../models/User';

export async function handleIncoming(
  phone:    string,
  text:     string,
  mediaId?: string,
): Promise<void> {
  console.log(`Incoming message from ${phone}: "${text}"`);

  const upper   = text.trim().toUpperCase();
  const session = await getSession(phone);

  // ── Ensure user record exists + update last active ─────────────────────────
  await User.findOneAndUpdate(
    { phone },
    { $setOnInsert: { phone }, lastActiveAt: new Date() },
    { upsert: true },
  );

  // ── Check for banned users ─────────────────────────────────────────────────
  const user = await User.findOne({ phone });
  if (user?.isBanned) {
    return sendMessage(phone,
      `❌ Your account has been suspended.\n\n` +
      `Reason: ${user.banReason || 'Policy violation'}\n\n` +
      `Contact support: ${process.env.SUPPORT_PHONE}`,
    );
  }

  // ── Global commands — work from any state ──────────────────────────────────
  if (['MENU', 'START', 'HI', 'HELLO', 'HEY'].includes(upper)) {
    await clearSession(phone);
    return showWelcome(phone);
  }

  if (upper === 'HELP') {
    return showHelp(phone);
  }

  if (upper === 'CANCEL') {
    await clearSession(phone);
    return sendMessage(phone, '❌ Action cancelled.\n\nType *MENU* to start again.');
  }

  // ── Notification commands ──────────────────────────────────────────────────
  if (upper.startsWith('OPTOUT ')) {
    const assetType = upper.replace('OPTOUT ', '').trim().toLowerCase();
    return handleOptOut(phone, assetType);
  }

  if (upper.startsWith('OPTIN ')) {
    const assetType = upper.replace('OPTIN ', '').trim().toLowerCase();
    return handleOptIn(phone, assetType);
  }

  if (upper === 'NOTIFICATIONS ON') {
    return handleNotificationsToggle(phone, true);
  }

  if (upper === 'NOTIFICATIONS OFF') {
    return handleNotificationsToggle(phone, false);
  }

  // ── Sell flow ──────────────────────────────────────────────────────────────
  if (upper === 'SELL' || session?.step?.startsWith('sell_')) {
    return handleSell(phone, upper, session, mediaId);
  }

  // ── Browse listings ────────────────────────────────────────────────────────
  if (upper === 'LISTINGS' || upper.startsWith('VIEW ') || upper.startsWith('BR_')) {
  return handleListings(phone, upper);
}

  // ── Buy flow ───────────────────────────────────────────────────────────────
  // Handles both LISTINGS (browse) and BUY [id] (initiate purchase).
  // No session steps needed — buy is a single-shot command in the new flow.
  if (upper.startsWith('BUY ')) {
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
    upper === 'MEDIA_RECEIVED' &&
    !session?.step?.startsWith('sell_') &&
    !session?.step?.startsWith('dispute_')
  ) {
    return sendMessage(phone,
      `I received an image, but I'm not sure what it's for.\n\nType *MENU* to see options.`,
    );
  }

  // ── Default fallback ───────────────────────────────────────────────────────
  return showWelcome(phone);
}