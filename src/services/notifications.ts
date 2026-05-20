import User from '../models/User';
import { sendMessage } from './whatsapp';
import { TYPE_LABELS } from '../config/constants';

// ── Snippet builders per type (mirrors listings.ts) ──────────────────────────
function buildListingBlurb(listing: any): string {
  const label   = TYPE_LABELS[listing.type] ?? listing.type;
  const price   = listing.buyerPays || listing.price;
  const country = listing.accountCountry ? `\n  🌍  Country           ${listing.accountCountry}` : '';

  let details = '';

  switch (listing.type) {
    case 'google_ad_account':
      details = [
        `  📅  Account Age        ${listing.googleAdsAccountAge ?? '—'}`,
        `  💸  Total Spend        ${listing.googleAdsSpend ?? '—'}`,
        `  💱  Billing Currency   ${listing.googleAdsCurrency ?? '—'}`,
        `  🏷️  Niche              ${listing.googleAdsNiche ?? '—'}`,
        `  🪪  Advertiser Verified ${listing.googleAdsVerified ? '✅ Yes' : '❌ No'}`,
        `  📢  Active Campaigns   ${listing.googleAdsActiveCampaigns ? '✅ Yes' : '❌ No'}`,
        `  ⚠️  Account Status     ${listing.googleAdsSuspended ? '⚠️ Was suspended' : '✅ Never suspended'}`,
      ].join('\n') + country;
      break;

    case 'facebook_ad_account':
      details = [
        `  📅  Account Age        ${listing.metaAccountAge ?? '—'}`,
        `  💳  Spend Limit        ${listing.metaSpendLimit ?? '—'}`,
        `  🏢  Business Manager   ${listing.metaBusinessManager ? '✅ Yes' : '❌ No'}`,
        `  📊  Facebook Pixel     ${listing.metaPixelAttached ? '✅ Attached' : '❌ Not attached'}`,
        `  ⚠️  Account Status     ${listing.metaRestricted ? '⚠️ Has restrictions' : '✅ Clean'}`,
      ].join('\n') + country;
      break;

    case 'adsense_site':
      details = [
        `  📅  Account Age        ${listing.adsenseAge ?? '—'}`,
        `  💰  Monthly Earnings   ${listing.adsenseMonthlyEarnings ? `$${listing.adsenseMonthlyEarnings}/mo` : '—'}`,
        `  💵  Payment History    ${listing.adsensePaymentStatus === 'received' ? '✅ Has received payments' : listing.adsensePaymentStatus === 'threshold' ? '⏳ At threshold, not paid yet' : '❌ No payments yet'}`,
        `  🌐  Website            ${listing.adsenseSiteUrl ?? 'Not provided'}`,
        `  🔗  Domain Included    ${listing.adsenseDomainIncluded ? '✅ Yes — transfers with sale' : '❌ No — AdSense account only'}`,
        `  🪪  Identity Verified  ${listing.adsenseVerified ? '✅ Yes' : '❌ Not verified'}`,
        `  ⚠️  Policy Violations  ${listing.adsenseViolations ? '⚠️ Has violations' : '✅ None'}`,
      ].join('\n') + country;
      break;

    case 'play_console':
      details = [
        `  📅  Account Age        ${listing.playConsoleAge ?? '—'}`,
        `  🏢  Account Type       ${listing.playConsoleAccountType === 'organization' ? 'Organization' : 'Personal'}`,
        `  🔒  Account Status     ${listing.playConsoleAccountStatus === 'active' ? '✅ Active' : '❌ Closed'}`,
        `  📱  Published Apps     ${listing.playConsoleApps ?? '—'}`,
        `  💵  Monthly Revenue    ${listing.playConsoleRevenue ? `$${listing.playConsoleRevenue}/mo` : '❌ No revenue'}`,
        `  ⚠️  Ever Suspended     ${listing.playConsoleSuspended ? '⚠️ Yes' : '✅ Never'}`,
        `  ⚠️  Suspended Apps     ${listing.playConsoleSuspendedApps ? '⚠️ Yes' : '✅ None'}`,
        `  🗑️  Removed Apps       ${listing.playConsoleRemovedApps ? '⚠️ Yes' : '✅ None'}`,
        `  🔑  Keystore File      ${listing.playConsoleKeystoreAvailable ? '✅ Available' : '❌ Not available'}`,
        `  🔄  Keystore Reset     ${listing.playConsoleKeystoreReset ? '✅ Possible' : '❌ Not possible'}`,
      ].join('\n') + country;
      break;

    case 'twitter_account':
      details = [
        `  👥  Followers          ${listing.twitterFollowers ?? '—'}`,
        `  📅  Account Age        ${listing.twitterAge ?? '—'}`,
        `  🏷️  Niche              ${listing.twitterNiche ?? '—'}`,
        `  💰  Monetized          ${listing.twitterMonetized ? '✅ Yes' : '❌ No'}`,
        `  ⚠️  Account Status     ${listing.twitterSuspended ? '⚠️ Was suspended' : '✅ Never suspended'}`,
      ].join('\n') + country;
      break;

    case 'instagram_account':
      details = [
        `  👥  Followers          ${listing.instagramFollowers ?? '—'}`,
        `  📅  Account Age        ${listing.instagramAge ?? '—'}`,
        `  🏷️  Niche              ${listing.instagramNiche ?? '—'}`,
        `  💰  Monetized          ${listing.instagramMonetized ? '✅ Yes' : '❌ No'}`,
        `  ⚠️  Account Status     ${listing.instagramRestricted ? '⚠️ Has restrictions' : '✅ Clean'}`,
      ].join('\n') + country;
      break;

    case 'tiktok_account':
      details = [
        `  👥  Followers          ${listing.tiktokFollowers ?? '—'}`,
        `  📅  Account Age        ${listing.tiktokAge ?? '—'}`,
        `  🏷️  Niche              ${listing.tiktokNiche ?? '—'}`,
        `  💰  Monetized          ${listing.tiktokMonetized ? '✅ Yes' : '❌ No'}`,
        `  🔴  LIVE Access        ${listing.tiktokLives ? '✅ Enabled' : '❌ Not enabled'}`,
        `  ⚠️  Account Status     ${listing.tiktokBanned ? '⚠️ Was banned' : '✅ Never banned'}`,
      ].join('\n') + country;
      break;

    case 'gift_card':
      details = [
        `  🎁  Brand              ${listing.giftCardBrand ?? '—'}`,
        `  💵  Face Value         ${listing.giftCardValue ?? '—'}`,
        `  🌍  Valid In           ${listing.giftCardCurrency ?? '—'}`,
      ].join('\n');
      break;
  }

  return (
    `${listing.isFeatured ? '⭐ *FEATURED*\n' : ''}` +
    `🆕 *New Listing — ${label}*\n` +
    `🆔 ${listing.listingId}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +

    `📋 *Account Details*\n` +
    `${details}\n\n` +

    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Price: ₦${price.toLocaleString()}*\n` +
    `🔒 Escrow protected — your money is safe\n\n` +

    `👇 *To view full details:*\n` +
    `Reply with 👉 \`VIEW ${listing.listingId}\`\n\n` +

    `─────────────────\n` +
    `Don't want alerts for *${label}*?\n` +
    `Send 👉 \`OPTOUT ${listing.type}\``
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
    { 'notifications.enabled': { $exists: false } },  // legacy users without the field — include them
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