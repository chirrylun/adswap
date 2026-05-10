import { sendMessage, sendList } from '../../services/whatsapp';
import { setSession, clearSession } from '../session';
import { TYPE_LABELS } from '../../config/constants';
import Request  from '../../models/Request';
import User     from '../../models/User';
import { generateId } from '../../utils/helpers';
import { ISession } from '../../models/Session';

const REQUEST_EXPIRY_DAYS = 7;

const CATEGORY_EMOJI: Record<string, string> = {
  google_ad_account:   '🎯',
  facebook_ad_account: '📘',
  adsense_site:        '💵',
  play_console:        '📱',
  gift_card:           '🎁',
  twitter_account:     '🐦',
  instagram_account:   '📸',
  tiktok_account:      '🎵',
};

// ─── Broadcast request to opted-in users ─────────────────────────────────────
async function broadcastRequest(req: any, requesterPhone: string): Promise<void> {
  const users = await User.find({
    isBanned: false,
    phone:    { $ne: requesterPhone },
    $or: [
      { 'notifications.enabled': true, 'notifications.optedOutTypes': { $nin: [req.type] } },
      { 'notifications.enabled': { $exists: false } },
    ],
  }).select('phone').lean();

  if (!users.length) return;

  const label   = TYPE_LABELS[req.type] ?? req.type;
  const emoji   = CATEGORY_EMOJI[req.type] ?? '📦';
  const message =
    `📣 *Asset Wanted — ${emoji} ${label}*\n` +
    `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\n` +
    (req.details ? `📝 "${req.details}"\n\n` : '\n') +
    `Someone on AdSwap is looking to buy a *${label}*.\n\n` +
    `If you have one to sell, reply with:\n` +
    `\`RESPOND ${req.requestId}\`\n\n` +
    `─────────────────\n` +
    `Don't want these alerts?\n` +
    `\`OPTOUT ${req.type}\``;

  const BATCH = 10;
  const DELAY = 1000;
  for (let i = 0; i < users.length; i += BATCH) {
    await Promise.allSettled(users.slice(i, i + BATCH).map(u => sendMessage(u.phone, message)));
    if (i + BATCH < users.length) await new Promise(r => setTimeout(r, DELAY));
  }

  console.log(`[REQUEST] Broadcast sent to ${users.length} users for ${req.requestId}`);
}

// ─── Notify PAYMENT_PHONE of new request ─────────────────────────────────────
async function notifyPaymentPhoneOfRequest(
  req:            any,
  requesterPhone: string,
  userCount:      number,
): Promise<void> {
  const label = TYPE_LABELS[req.type] ?? req.type;
  const emoji = CATEGORY_EMOJI[req.type] ?? '📦';
  const now   = new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' });

  await sendMessage(
    process.env.PAYMENT_PHONE!,
    `📣 *New Asset Request*\n\n` +
    `🆔 Ref: *${req.requestId}*\n` +
    `${emoji} Asset: *${label}*\n` +
    `📱 Requester: ${requesterPhone}\n` +
    `🕐 Time: ${now}\n\n` +
    (req.details
      ? `📝 Requirements: _${req.details}_\n\n`
      : `📝 No specific requirements\n\n`) +
    `👥 Broadcast sent to *${userCount}* user(s)\n` +
    `⏳ Request expires in 7 days`,
  );
}

// ─── Notify respondents of cancellation ──────────────────────────────────────
async function notifyRespondentsOfCancellation(req: any): Promise<void> {
  if (!req.respondents?.length) return;

  const users = await User.find({
    _id:      { $in: req.respondents },
    isBanned: false,
  }).select('phone').lean();

  const label = TYPE_LABELS[req.type] ?? req.type;

  await Promise.allSettled(
    users.map(u => sendMessage(u.phone,
      `ℹ️ *Request Cancelled*\n\n` +
      `The request for a *${label}* (Ref: ${req.requestId}) has been cancelled by the requester.\n\n` +
      `If you were planning to list this asset, you're still welcome to — type *SELL* anytime.`,
    )),
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function handleRequest(
  phone:   string,
  text:    string,
  session: ISession,
): Promise<void> {
  const step = session?.step;
  const data = session?.data ?? {};

  // ── Entry ──────────────────────────────────────────────────────────────────
  if (text === 'REQUEST') {
    await setSession(phone, 'request_type', {});
    return sendList(
      phone,
      `📣 *Request an Asset*\n\n` +
      `Can't find what you're looking for?\n` +
      `Send a request and sellers with matching assets will be notified.\n\n` +
      `Which type of asset are you looking for?`,
      'Choose Type',
      [{
        title: 'Asset Types',
        rows:  Object.entries(TYPE_LABELS).map(([type, label]) => ({
          id:          `REQTYPE_${type}`,
          title:       `${CATEGORY_EMOJI[type] ?? '📦'} ${label}`,
          description: 'Tap to request this asset type',
        })),
      }],
    );
  }

  // ── Type selected from list ────────────────────────────────────────────────
  if (text.startsWith('REQTYPE_')) {
    const type  = text.replace('REQTYPE_', '').trim().toLowerCase();
    const label = TYPE_LABELS[type];
    if (!label) {
      return sendMessage(phone, `❌ Unknown asset type.\n\nType *REQUEST* to try again.`);
    }
    await setSession(phone, 'request_details', { type });
    return sendMessage(phone,
      `${CATEGORY_EMOJI[type]} *${label}* selected.\n\n` +
      `Do you have any specific requirements? For example:\n` +
      `_"Need a Google Ads account with at least $5,000 spend, USD billing"_\n\n` +
      `Type your requirements below, or type *SKIP* to send the request without extra details.\n\n` +
      `Type *CANCEL* to exit.`,
    );
  }

  // ── Details / skip ─────────────────────────────────────────────────────────
  if (step === 'request_details') {
    const details = text === 'SKIP' ? undefined : text.slice(0, 300);

    const user = await User.findOneAndUpdate(
      { phone },
      { $setOnInsert: { phone } },
      { upsert: true, new: true },
    );

    // Limit: 1 open request per user at a time
    const existing = await Request.findOne({ requester: user._id, status: 'open' });
    if (existing) {
      await clearSession(phone);
      return sendMessage(phone,
        `⚠️ You already have an open request (${existing.requestId}).\n\n` +
        `Cancel it first before creating a new one:\n` +
        `\`CANCEL REQUEST ${existing.requestId}\``,
      );
    }

    const requestId = `REQ-${generateId(5)}`;
    const expiresAt = new Date(Date.now() + REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const label     = TYPE_LABELS[data.type] ?? data.type;

    const newRequest = await Request.create({
      requestId,
      requester: user._id,
      type:      data.type,
      details,
      status:    'open',
      expiresAt,
    });

    await clearSession(phone);

    // Confirm to requester first
    await sendMessage(phone,
      `✅ *Request Sent!*\n\n` +
      `Asset: *${label}*\n` +
      `Ref: *${requestId}*\n` +
      (details ? `Requirements: _${details}_\n\n` : '\n') +
      `Sellers who have this asset will be notified.\n` +
      `You'll get a message when someone responds.\n\n` +
      `Your request expires in *7 days*.\n\n` +
      `To cancel your request at any time:\n` +
      `\`CANCEL REQUEST ${requestId}\``,
    );

    // Broadcast to sellers, then notify PAYMENT_PHONE with reach count
    broadcastRequest(newRequest, phone)
      .then(async () => {
        // Count how many users received the broadcast (same query as broadcastRequest)
        const userCount = await User.countDocuments({
          isBanned: false,
          phone:    { $ne: phone },
          $or: [
            { 'notifications.enabled': true, 'notifications.optedOutTypes': { $nin: [data.type] } },
            { 'notifications.enabled': { $exists: false } },
          ],
        });
        return notifyPaymentPhoneOfRequest(newRequest, phone, userCount);
      })
      .catch(err => console.error('[REQUEST] Broadcast/notify error:', err));

    return;
  }

  // ── Cancel a request ───────────────────────────────────────────────────────
  if (text.startsWith('CANCEL REQUEST ')) {
    const requestId = text.replace('CANCEL REQUEST ', '').trim();

    const user = await User.findOne({ phone });
    if (!user) return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

    const req = await Request.findOne({ requestId, requester: user._id, status: 'open' })
      .populate('respondents');

    if (!req) {
      return sendMessage(phone,
        `❌ Request *${requestId}* not found or already closed.\n\n` +
        `Type *MY REQUESTS* to see your active requests.`,
      );
    }

    await Request.updateOne({ _id: req._id }, { $set: { status: 'cancelled' } });

    await sendMessage(phone,
      `✅ Request *${requestId}* has been cancelled.\n\n` +
      `Any sellers who responded will be notified.\n\n` +
      `Type *REQUEST* to send a new one anytime.`,
    );

    notifyRespondentsOfCancellation(req).catch(err =>
      console.error('[REQUEST] Cancel notify error:', err),
    );

    return;
  }

  // ── View own requests ──────────────────────────────────────────────────────
  if (text === 'MY REQUESTS') {
    const user = await User.findOne({ phone });
    if (!user) return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

    const requests = await Request.find({ requester: user._id, status: 'open' })
      .sort({ createdAt: -1 })
      .limit(5);

    if (!requests.length) {
      return sendMessage(phone,
        `📭 You have no open requests.\n\n` +
        `Type *REQUEST* to send one.`,
      );
    }

    const lines = requests.map(r => {
      const label = TYPE_LABELS[r.type] ?? r.type;
      return (
        `${CATEGORY_EMOJI[r.type] ?? '📦'} *${label}*\n` +
        `Ref: ${r.requestId}\n` +
        `Respondents: ${r.respondents.length}\n` +
        (r.details ? `Details: _${r.details}_\n` : '') +
        `Cancel: \`CANCEL REQUEST ${r.requestId}\``
      );
    });

    return sendMessage(phone,
      `📋 *Your Open Requests*\n\n` +
      lines.join('\n\n'),
    );
  }

  // ── Respond to a request ───────────────────────────────────────────────────
  if (text.startsWith('RESPOND ')) {
    const requestId = text.replace('RESPOND ', '').trim();

    const req = await Request.findOne({ requestId, status: 'open' });
    if (!req) {
      return sendMessage(phone,
        `❌ Request *${requestId}* is no longer available.\n\n` +
        `Type *SELL* to list your asset directly.`,
      );
    }

    const user = await User.findOne({ phone });
    if (user && req.requester.toString() === user._id.toString()) {
      return sendMessage(phone, `❌ You can't respond to your own request.`);
    }

    const label = TYPE_LABELS[req.type] ?? req.type;

    // Store the requestId in session so sell flow can reference it on completion
    await setSession(phone, 'sell_type', {
      linkedRequestId:   requestId,
      linkedRequestType: req.type,
    });

    return sendMessage(phone,
      `✅ *Responding to request ${requestId}*\n\n` +
      `The requester is looking for a *${label}*.\n` +
      (req.details ? `Their requirements: _${req.details}_\n\n` : '\n') +
      `We'll now walk you through listing your asset.\n` +
      `If your listing is approved, the requester will be notified.\n\n` +
      `Proceeding to listing...\n\n` +
      `What is your asking price in Naira (₦)?\n\n` +
      `Enter numbers only — no commas or symbols.\n` +
      `Example: *75000*\n\n` +
      `Minimum: ₦1,000\n\n` +
      `Type *CANCEL* to exit.`,
    );
  }
}