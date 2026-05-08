import { sendMessage }                                     from '../services/whatsapp';
import { getSession, clearSession }                         from './session';
import { showWelcome, showHelp }                            from './flows/welcome';
import { handleSell }                                       from './flows/sell';
import {
  handleBuy,
  handleSellerTransfer,
  handleCredentialFlow,
  handleBankFlow,
  handleBuyerConfirm,
}                                                           from './flows/buy';
import { handleListings }                                   from './flows/listings';
import { handleDispute }                                    from './flows/dispute';
import { handleRate }                        from './flows/confirm';
import User                                                 from '../models/User';

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

  // ── Sell flow ──────────────────────────────────────────────────────────────
  if (upper === 'SELL' || session?.step?.startsWith('sell_')) {
    return handleSell(phone, upper, session, mediaId);
  }

  // ── Browse listings ────────────────────────────────────────────────────────
  if (upper === 'LISTINGS' || upper.startsWith('VIEW ')) {
    return handleListings(phone, upper);
  }

  // ── Buy — initiate purchase ────────────────────────────────────────────────
  if (upper.startsWith('BUY ') || upper === 'LISTINGS') {
    return handleBuy(phone, upper, session);
  }

  // ── Seller: begin credential-sharing flow ──────────────────────────────────
  // Triggered after FW payment confirmed — seller replies TRANSFER [txnId]
  if (upper.startsWith('TRANSFER ')) {
    return handleSellerTransfer(phone, upper, session);
  }

  // ── Seller: credential question steps ─────────────────────────────────────
  // step names: cred_q_email, cred_q_password, cred_q_2fa, cred_q_notes, etc.
  if (session?.step?.startsWith('cred_q_')) {
    return handleCredentialFlow(phone, text.trim(), session);
  }

  // ── Seller: bank detail steps ─────────────────────────────────────────────
  // step names: bank_q_name, bank_q_number, bank_q_bank
  if (session?.step?.startsWith('bank_q_')) {
    return handleBankFlow(phone, text.trim(), session);
  }

  // ── Buyer: confirm receipt ─────────────────────────────────────────────────
  // Replaces the old handleConfirm — now triggers pending_release + admin alert
  if (upper.startsWith('CONFIRM ')) {
    return handleBuyerConfirm(phone, upper);
  }

  // ── Dispute flow ───────────────────────────────────────────────────────────
  if (upper.startsWith('DISPUTE') || session?.step?.startsWith('dispute_')) {
    return handleDispute(phone, upper, session, mediaId);
  }

  // ── Rate seller ────────────────────────────────────────────────────────────
  if (upper.startsWith('RATE ')) {
    return handleRate(phone, upper);
  }

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