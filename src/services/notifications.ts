import User from '../models/User';
import { sendMessage } from './whatsapp';
import { TYPE_LABELS } from '../config/constants';

// ── Snippet builders per type (mirrors listings.ts) ──────────────────────────
function buildListingBlurb(listing: any): string {
  const label = TYPE_LABELS[listing.type] ?? listing.type;

  let details = '';
  switch (listing.type) {
    case 'google_ad_account':
      details = [
        listing.googleAdsAccountAge && `📅 ${listing.googleAdsAccountAge}`,
        listing.googleAdsSpend      && `💸 ${listing.googleAdsSpend}`,
        listing.googleAdsCurrency   && `(${listing.googleAdsCurrency})`,
        listing.googleAdsSuspended  ? '⚠️ Suspended' : '✅ Clean',
      ].filter(Boolean).join('  ');
      break;
    case 'facebook_ad_account':
      details = [
        listing.metaAccountAge    && `📅 ${listing.metaAccountAge}`,
        listing.metaSpendLimit    && `💳 ${listing.metaSpendLimit}`,
        listing.metaRestricted    ? '⚠️ Restricted' : '✅ Clean',
        listing.metaPixelAttached ? '📊 Pixel ✓' : null,
      ].filter(Boolean).join('  ');
      break;
    case 'adsense_site':
      details = [
        listing.adsenseAge             && `📅 ${listing.adsenseAge}`,
        listing.adsenseMonthlyEarnings && `💰 $${listing.adsenseMonthlyEarnings}/mo`,
        listing.adsenseSiteUrl         && `🌐 ${listing.adsenseSiteUrl}`,
        listing.adsenseViolations      ? '⚠️ Violations' : '✅ Clean',
      ].filter(Boolean).join('  ');
      break;
    case 'play_console':
      details = [
        listing.playConsoleAge     && `📅 ${listing.playConsoleAge}`,
        listing.playConsoleApps    && `📱 ${listing.playConsoleApps}`,
        listing.playConsoleRevenue && `💵 $${listing.playConsoleRevenue}/mo`,
        listing.playConsoleSuspended ? '⚠️ Suspended' : '✅ Clean',
      ].filter(Boolean).join('  ');
      break;
    case 'gift_card':
      details = [
        listing.giftCardBrand    && listing.giftCardBrand,
        listing.giftCardValue    && `💵 ${listing.giftCardValue}`,
        listing.giftCardCurrency && `🌍 ${listing.giftCardCurrency}`,
      ].filter(Boolean).join('  ');
      break;
    case 'twitter_account':
      details = [
        listing.twitterFollowers && `👥 ${listing.twitterFollowers}`,
        listing.twitterNiche     && `🏷️ ${listing.twitterNiche}`,
        listing.twitterMonetized ? '💰 Monetized ✓' : null,
        listing.twitterSuspended ? '⚠️ Was suspended' : '✅ Clean',
      ].filter(Boolean).join('  ');
      break;
    case 'instagram_account':
      details = [
        listing.instagramFollowers && `👥 ${listing.instagramFollowers}`,
        listing.instagramNiche     && `🏷️ ${listing.instagramNiche}`,
        listing.instagramMonetized  ? '💰 Monetized ✓' : null,
        listing.instagramRestricted ? '⚠️ Restricted'  : '✅ Clean',
      ].filter(Boolean).join('  ');
      break;
    case 'tiktok_account':
      details = [
        listing.tiktokFollowers && `👥 ${listing.tiktokFollowers}`,
        listing.tiktokNiche     && `🏷️ ${listing.tiktokNiche}`,
        listing.tiktokMonetized ? '💰 Monetized ✓'    : null,
        listing.tiktokLives     ? '🔴 LIVE enabled ✓' : null,
        listing.tiktokBanned    ? '⚠️ Was banned'     : '✅ Clean',
      ].filter(Boolean).join('  ');
      break;
  }

  return (
    `🆕 *New Listing — ${label}*${listing.isFeatured ? ' ⭐' : ''}\n` +
    `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\n` +
    (details ? `${details}\n` : '') +
    `💰 Price: *₦${listing.price.toLocaleString()}*\n\n` +
    `To view full details and buy:\n` +
    `\`VIEW ${listing.listingId}\`\n\n` +
    `─────────────────\n` +
    `Don't want alerts for *${label}*?\n` +
    `\`OPTOUT ${listing.type}\``
  );
}

// ── Broadcast to all opted-in users ──────────────────────────────────────────
export async function broadcastNewListing(listing: any): Promise<void> {
  // Fetch all non-banned users who haven't opted out of this type
  const users = await User.find({
  isBanned: false,
  _id:      { $ne: listing.seller },
  $or: [
    { 'notifications.enabled': true,  'notifications.optedOutTypes': { $nin: [listing.type] } },
    { 'notifications': { $exists: false } },  // legacy users with no prefs yet
    { 'notifications.enabled': { $exists: false } },  // partial doc
  ],
}).select('phone').lean();

  if (!users.length) return;

  const message = buildListingBlurb(listing);

  // Send in batches of 10 with a small delay to avoid rate limits
  const BATCH  = 10;
  const DELAY  = 1000; // ms between batches

  for (let i = 0; i < users.length; i += BATCH) {
    const batch = users.slice(i, i + BATCH);
    await Promise.allSettled(
      batch.map(u => sendMessage(u.phone, message))
    );
    if (i + BATCH < users.length) {
      await new Promise(r => setTimeout(r, DELAY));
    }
  }

  console.log(`[NOTIFY] Broadcast sent to ${users.length} users for listing ${listing.listingId}`);
}

// ── Handle OPTOUT command ─────────────────────────────────────────────────────
export async function handleOptOut(
  phone:     string,
  assetType: string,
): Promise<void> {
  
  const label = TYPE_LABELS[assetType];

  if (!label) {
    return sendMessage(phone,
      `❌ Unknown asset type.\n\n` +
      `To opt out, use the link in any listing notification.`
    );
  }

  await User.findOneAndUpdate(
    { phone },
    { $addToSet: { 'notifications.optedOutTypes': assetType } },
    { upsert: true },
  );

  return sendMessage(phone,
    `✅ Done — you won't receive new listing alerts for *${label}* anymore.\n\n` +
    `To re-enable, type:\n` +
    `\`OPTIN ${assetType}\``
  );
}

// ── Handle OPTIN command ──────────────────────────────────────────────────────
export async function handleOptIn(
  phone:     string,
  assetType: string,
): Promise<void> {

  const label = TYPE_LABELS[assetType];

  if (!label) {
    return sendMessage(phone,
      `❌ Unknown asset type. Valid types:\n\n` +
      Object.entries(TYPE_LABELS).map(([k, v]) => `• \`OPTIN ${k}\` — ${v}`).join('\n')
    );
  }

  await User.findOneAndUpdate(
    { phone },
    { $pull: { 'notifications.optedOutTypes': assetType } },
  );

  return sendMessage(phone,
    `✅ You'll now receive new listing alerts for *${label}*.\n\n` +
    `To stop again:\n` +
    `\`OPTOUT ${assetType}\``
  );
}

// ── Handle NOTIFICATIONS OFF/ON master switch ─────────────────────────────────
export async function handleNotificationsToggle(
  phone:   string,
  enabled: boolean,
): Promise<void> {
  await User.findOneAndUpdate(
    { phone },
    { 'notifications.enabled': enabled },
    { upsert: true },
  );

  return sendMessage(phone,
    enabled
      ? `✅ Listing notifications *enabled*. You'll be alerted when new accounts go live.\n\nTo disable: *NOTIFICATIONS OFF*`
      : `🔕 Listing notifications *disabled*. You won't receive any listing alerts.\n\nTo re-enable: *NOTIFICATIONS ON*`
  );
}