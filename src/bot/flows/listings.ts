import { sendMessage, sendList } from '../../services/whatsapp';
import { TYPE_LABELS } from '../../config/constants';
import Listing, { ListingType } from '../../models/Listing';
import User from '../../models/User';
import Transaction from '../../models/Transaction';
import { track } from '../../services/analytics';
import { sendImage } from '../../services/whatsapp';

// ─── Short code maps (row IDs must be ≤20 chars) ─────────────────────────────

const TYPE_SHORT: Record<string, string> = {
  google_ad_account:   'gads',
  facebook_ad_account: 'fbads',
  adsense_site:        'adsense',
  play_console:        'play',
  gift_card:           'gc',
  twitter_account:     'tw',
  instagram_account:   'ig',
  tiktok_account:      'tt',
};

// Handles both upper and lower case keys from WhatsApp
const SHORT_TO_TYPE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(TYPE_SHORT).map(([full, short]) => [short.toLowerCase(), full])),
  ...Object.fromEntries(Object.entries(TYPE_SHORT).map(([full, short]) => [short.toUpperCase(), full])),
};

// ─── Category emoji map ───────────────────────────────────────────────────────

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

// ─── CTA builder ──────────────────────────────────────────────────────────────

export function listingDetailCTA(listingId: string, price: number): string {
  return (
    `🔒 *Escrow protected — your money is safe*\n\n` +
    `─── Buy or Make an Offer ───\n\n` +
    `💳 *Buy at full price:*\n` +
    `\`BUY ${listingId}\`\n\n` +
    `💬 *Make an offer*\n` +
    `\`OFFER ${listingId}\`\n\n` +
    `_(Type *LISTINGS* to go back to categories)_`
  );
}

// ─── Snippet builders ─────────────────────────────────────────────────────────

function formatListingSnippet(l: any): string {
  switch (l.type) {
    case 'google_ad_account':
      return [
        l.googleAdsAccountAge && `${l.googleAdsAccountAge} old`,
        l.googleAdsSpend      && `${l.googleAdsSpend} spent`,
        l.googleAdsCurrency   && `(${l.googleAdsCurrency})`,
        l.accountCountry      && `· ${l.accountCountry}`,
        l.googleAdsSuspended  ? '⚠️ Suspended' : '✅ Clean',
      ].filter(Boolean).join('  ');

    case 'facebook_ad_account':
      return [
        l.metaAccountAge    && `${l.metaAccountAge} old`,
        l.metaSpendLimit    && `Limit: ${l.metaSpendLimit}`,
        l.accountCountry    && `· ${l.accountCountry}`,
        l.metaRestricted    ? '⚠️ Restricted' : '✅ Clean',
        l.metaPixelAttached ? '· Pixel ✓' : null,
      ].filter(Boolean).join('  ');

    case 'twitter_account':
      return [
        l.twitterFollowers && `${l.twitterFollowers} followers`,
        l.twitterNiche     && `· ${l.twitterNiche}`,
        l.accountCountry   && `· ${l.accountCountry}`,
        l.twitterMonetized ? '💰 Monetized' : null,
        l.twitterSuspended ? '⚠️ Suspended' : '✅ Clean',
      ].filter(Boolean).join('  ');

    case 'instagram_account':
      return [
        l.instagramFollowers && `${l.instagramFollowers} followers`,
        l.instagramNiche     && `· ${l.instagramNiche}`,
        l.accountCountry     && `· ${l.accountCountry}`,
        l.instagramMonetized  ? '💰 Monetized' : null,
        l.instagramRestricted ? '⚠️ Restricted' : '✅ Clean',
      ].filter(Boolean).join('  ');

    case 'tiktok_account':
      return [
        l.tiktokFollowers && `${l.tiktokFollowers} followers`,
        l.tiktokNiche     && `· ${l.tiktokNiche}`,
        l.accountCountry  && `· ${l.accountCountry}`,
        l.tiktokMonetized ? '💰 Monetized' : null,
        l.tiktokLives     ? '🔴 LIVE ✓'   : null,
        l.tiktokBanned    ? '⚠️ Banned'   : '✅ Clean',
      ].filter(Boolean).join('  ');

    case 'adsense_site':
      return [
        l.adsenseMonthlyEarnings && `$${l.adsenseMonthlyEarnings}/mo`,
        l.adsenseSiteUrl         && `· ${l.adsenseSiteUrl}`,
        l.accountCountry         && `· ${l.accountCountry}`,
        l.adsenseViolations      ? '⚠️ Violations' : '✅ Clean',
      ].filter(Boolean).join('  ');

    case 'play_console':
      return [
        l.playConsoleApps    && `${l.playConsoleApps}`,
        l.playConsoleRevenue && `· $${l.playConsoleRevenue}/mo`,
        l.accountCountry     && `· ${l.accountCountry}`,
        l.playConsoleSuspended ? '⚠️ Suspended' : '✅ Clean',
      ].filter(Boolean).join('  ');

    case 'gift_card':
      return [
        l.giftCardBrand    && l.giftCardBrand,
        l.giftCardValue    && `· ${l.giftCardValue}`,
        l.giftCardCurrency && `(${l.giftCardCurrency})`,
      ].filter(Boolean).join('  ');

    default:
      return l.description?.slice(0, 72) ?? '';
  }
}

function formatFullDetails(l: any): string {
  switch (l.type) {
    case 'google_ad_account':
      return [
        `  📅  Age              ${l.googleAdsAccountAge ?? '—'}`,
        `  💸  Total Spend      ${l.googleAdsSpend ?? '—'}`,
        `  💱  Currency         ${l.googleAdsCurrency ?? '—'}`,
        `  🏷️  Niche            ${l.googleAdsNiche ?? '—'}`,
        `  🔒  Status           ${l.googleAdsSuspended ? '⚠️ Was suspended' : '✅ Clean'}`,
      ].join('\n');

    case 'facebook_ad_account':
      return [
        `  📅  Age              ${l.metaAccountAge ?? '—'}`,
        `  💳  Spend Limit      ${l.metaSpendLimit ?? '—'}`,
        `  🏢  Business Mgr     ${l.metaBusinessManager ? 'Yes' : 'No'}`,
        `  📊  Pixel            ${l.metaPixelAttached ? 'Attached ✓' : 'Not attached'}`,
        `  🔒  Status           ${l.metaRestricted ? '⚠️ Has restrictions' : '✅ Clean'}`,
      ].join('\n');

    case 'twitter_account':
      return [
        `  👥  Followers         ${l.twitterFollowers ?? '—'}`,
        `  📅  Age               ${l.twitterAge ?? '—'}`,
        `  🏷️  Niche             ${l.twitterNiche ?? '—'}`,
        `  💰  Monetized         ${l.twitterMonetized ? 'Yes ✓' : 'No'}`,
        `  🔒  Status            ${l.twitterSuspended ? '⚠️ Was suspended' : '✅ Clean'}`,
      ].join('\n');

    case 'instagram_account':
      return [
        `  👥  Followers         ${l.instagramFollowers ?? '—'}`,
        `  📅  Age               ${l.instagramAge ?? '—'}`,
        `  🏷️  Niche             ${l.instagramNiche ?? '—'}`,
        `  💰  Monetized         ${l.instagramMonetized  ? 'Yes ✓' : 'No'}`,
        `  🔒  Status            ${l.instagramRestricted ? '⚠️ Has restrictions' : '✅ Clean'}`,
      ].join('\n');

    case 'tiktok_account':
      return [
        `  👥  Followers         ${l.tiktokFollowers ?? '—'}`,
        `  📅  Age               ${l.tiktokAge ?? '—'}`,
        `  🏷️  Niche             ${l.tiktokNiche ?? '—'}`,
        `  💰  Monetized         ${l.tiktokMonetized ? 'Yes ✓' : 'No'}`,
        `  🔴  LIVE Access       ${l.tiktokLives    ? 'Yes ✓' : 'No'}`,
        `  🔒  Status            ${l.tiktokBanned   ? '⚠️ Was banned' : '✅ Clean'}`,
      ].join('\n');

    case 'adsense_site':
      return [
        `  📅  Age              ${l.adsenseAge ?? '—'}`,
        `  💰  Monthly Earn     ${l.adsenseMonthlyEarnings ? `$${l.adsenseMonthlyEarnings}/mo` : '—'}`,
        `  💵  Payment Hist.    ${l.adsensePaymentStatus === 'received' ? '✅ Received' : l.adsensePaymentStatus === 'threshold' ? '⏳ At threshold' : 'None yet'}`,
        `  🌐  Site             ${l.adsenseSiteUrl ?? 'Not included'}`,
        `  🔒  Status           ${l.adsenseViolations ? '⚠️ Has violations' : '✅ Clean'}`,
      ].join('\n');

    case 'play_console':
      return [
        `  📅  Age              ${l.playConsoleAge ?? '—'}`,
        `  📱  Published Apps   ${l.playConsoleApps ?? '—'}`,
        `  💵  Monthly Rev.     ${l.playConsoleRevenue ? `$${l.playConsoleRevenue}/mo` : '—'}`,
        `  🔒  Status           ${l.playConsoleSuspended ? '⚠️ Had issues' : '✅ Clean'}`,
      ].join('\n');

    case 'gift_card':
      return [
        `  🎁  Brand            ${l.giftCardBrand ?? '—'}`,
        `  💵  Face Value       ${l.giftCardValue ?? '—'}`,
        `  🌍  Region           ${l.giftCardCurrency ?? '—'}`,
      ].join('\n');

    default:
      return '';
  }
}

// ─── Step 1: Category picker ──────────────────────────────────────────────────

async function showCategoryPicker(phone: string): Promise<void> {
  track('listings_viewed', phone);
  const activeCounts = await Listing.aggregate([
    { $match: { status: 'active' } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]);

  if (!activeCounts.length) {
    return sendMessage(phone,
      `📭 *No active listings right now.*\n\n` +
      `Check back later or type *SELL* to list your own account.`
    );
  }

  const rows = activeCounts
    .sort((a, b) => b.count - a.count)
    .map(({ _id: type, count }: { _id: string; count: number }) => {
      const short = TYPE_SHORT[type] ?? type;
      return {
        id:          `BR_${short}`,   // e.g. BR_fbads — always ≤20 chars
        title:       `${CATEGORY_EMOJI[type] ?? '📦'} ${TYPE_LABELS[type] ?? type}`,
        description: `${count} listing${count !== 1 ? 's' : ''} available`,
      };
    });

  return sendList(
    phone,
    `*Swappa Marketplace* 🛍️\n\n` +
    `Browse by category below.\n` +
    `All listings are verified before going live.\n\n` +
    `🔒 Every transaction is escrow-protected.`,
    'Choose Category',
    [{ title: 'Categories', rows }],
  );
}

// ─── Step 2: Listings within a category ──────────────────────────────────────

async function showCategoryListings(phone: string, rawShort: string): Promise<void> {


  // Normalise — WhatsApp may return the id uppercased or as-sent
  const short = rawShort.toLowerCase();
  const type  = SHORT_TO_TYPE[short];
  

  if (!type) {
    return sendMessage(phone,
      `❌ Unknown category.\n\nType *LISTINGS* to browse categories.`
    );
  }

  const label    = TYPE_LABELS[type] ?? type;
    track('category_selected', phone, { category: type, label });
  const listings = await Listing.find({ status: 'active', type: type as ListingType })
    .populate('seller')
    .sort({ isFeatured: -1, createdAt: -1 })
    .limit(10);

  if (!listings.length) {
    return sendMessage(phone,
      `📭 No active *${label}* listings right now.\n\n` +
      `Type *LISTINGS* to browse other categories.`
    );
  }

  const rows = listings.map(l => ({
    id:          `VIEW ${l.listingId}`,
    title:       `${l.isFeatured ? '⭐ ' : ''}₦${(l.buyerPays || l.price).toLocaleString()}`,
    description: formatListingSnippet(l).slice(0, 72),
  }));

  return sendList(
    phone,
    `${CATEGORY_EMOJI[type] ?? '📦'} *${label}*\n\n` +
    `${listings.length} listing${listings.length !== 1 ? 's' : ''} available.\n` +
    `Tap any listing to view full details and make an offer to the seller:\n\n` +
    `_(Type *LISTINGS* to go back to categories)_`,
    'View Listings',
    [{ title: 'Available Now', rows }],
    undefined,
    '🔒 Every transaction is escrow-protected.'
  );
}

// ─── Step 3: Single listing detail ───────────────────────────────────────────

// ─── Step 3: Single listing detail ───────────────────────────────────────────

async function showListingDetail(phone: string, listingId: string): Promise<void> {
  
  const listing = await Listing.findOne({ listingId, status: 'active' })
    .populate<{ seller: any }>('seller');

  if (!listing) {
    return sendMessage(phone,
      '❌ Listing not found or no longer available.\n\n' +
      'Type *LISTINGS* to browse categories.'
    );
  }

  await Listing.updateOne({ _id: listing._id }, { $inc: { viewCount: 1 } });

  const ratingStr = listing.seller.totalSales > 0
    ? `⭐ ${listing.seller.sellerRating.toFixed(1)} · ${listing.seller.totalSales} sale${listing.seller.totalSales !== 1 ? 's' : ''}`
    : '🆕 New seller';

  const details   = formatFullDetails(listing);
  const typeLabel = TYPE_LABELS[listing.type] ?? listing.type;
  const price     = listing.buyerPays || listing.price;

  track('listing_viewed', phone, { listingId, type: listing.type, price });

  // ── 1. Send the main detail message ────────────────────────────────────────
  await sendMessage(phone,
    `${listing.isFeatured ? '⭐ *FEATURED*\n' : ''}` +
    `*${typeLabel}*\n` +
    `_${listingId}_\n` +
    `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\n\n` +

    `*Account Details*\n` +
    `${details}\n\n` +

    (listing.description
      ? `*About this listing*\n  ${listing.description}\n\n`
      : '') +

    `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\n` +
    `  💰  Price            *₦${price.toLocaleString()}*\n` +
    `  👤  Seller           ${ratingStr}\n` +
    `  👁  Views            ${listing.viewCount + 1}\n` +
    `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\n\n` +

    listingDetailCTA(listingId, price),
  );

  // ── 2. Send screenshots if present ─────────────────────────────────────────
  const screenshots: string[] = listing.screenshotUrls ?? [];

  if (screenshots.length > 0) {
    // Caption on first image only; subsequent images sent silently
    await sendImage(phone, screenshots[0],
      `🖼️ *Verification screenshots* (${screenshots.length} total)\n` +
      `_Submitted by seller as proof of account details._`
    );

    // Send remaining screenshots without captions
    for (let i = 1; i < screenshots.length; i++) {
      await sendImage(phone, screenshots[i]);
    }
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleListings(
  phone: string,
  text:  string   // arrives already uppercased from handler.ts
): Promise<void> {
  // Step 3 — single listing detail
  if (text.startsWith('VIEW ')) {
    const listingId = text.replace('VIEW ', '').trim();
    return showListingDetail(phone, listingId);
  }

  // Step 2 — category listings
  // text arrives as "BR_FBADS" (uppercased by handler) or "BR_fbads" (as sent)
  // showCategoryListings normalises to lowercase internally
  if (text.startsWith('BR_')) {
    const rawShort = text.replace('BR_', '').trim();
    return showCategoryListings(phone, rawShort);
  }

  // Step 1 — category picker
  return showCategoryPicker(phone);
}

export async function handleMyListings(phone: string): Promise<void> {
  const user = await User.findOne({ phone });
  if (!user) return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

  const listings = await Listing.find({
    seller: user._id,
    status: { $in: ['pending_verification', 'active'] },
  }).sort({ createdAt: -1 }).limit(10);

  if (!listings.length) {
    return sendMessage(phone,
      `📭 You have no active listings.\n\n` +
      `Type *SELL* to list an asset.`,
    );
  }

  const lines = listings.map(l => {
    const label      = TYPE_LABELS[l.type] ?? l.type;
    const statusIcon = l.status === 'active' ? '🟢' : '⏳';
    const statusText = l.status === 'active' ? 'Live' : 'Pending review';
    return (
      `${statusIcon} *${label}*\n` +
      `ID: ${l.listingId}\n` +
      `Price: ₦${l.price.toLocaleString()} _(you receive ₦${l.sellerReceives?.toLocaleString() ?? '—'})_\n` +
      `Status: ${statusText}\n` +
      `Views: ${l.viewCount}\n` +
      `Remove: \`REMOVE ${l.listingId}\``
    );
  });

  return sendMessage(phone,
    `📋 *Your Listings*\n\n` +
    lines.join('\n\n'),
  );
}


// ─── Remove listing ───────────────────────────────────────────────────────────
export async function handleRemoveListing(
  phone: string,
  text:  string,
): Promise<void> {
  const listingId = text.replace('REMOVE ', '').trim();

  if (!listingId) {
    return sendMessage(phone,
      `To remove a listing, send:\n` +
      `\`REMOVE [Listing ID]\`\n\n` +
      `Example: \`REMOVE ADS-12345\``,
    );
  }

  const user = await User.findOne({ phone });
  if (!user) return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

  const listing = await Listing.findOne({
    listingId: listingId.toUpperCase(),
    seller:    user._id,
  });

  if (!listing) {
    return sendMessage(phone,
      `❌ Listing *${listingId.toUpperCase()}* not found or doesn't belong to you.\n\n` +
      `Type *MY LISTINGS* to see your active listings.`,
    );
  }

  if (['sold', 'rejected', 'expired'].includes(listing.status)) {
    return sendMessage(phone,
      `❌ Listing *${listingId.toUpperCase()}* is already ${listing.status} and cannot be removed.`,
    );
  }

  // Check for ongoing transactions
  const ongoingTxn = await Transaction.findOne({
    listingId: listing.listingId,
    status:    'pending',
  });

  if (ongoingTxn) {
    return sendMessage(phone,
      `❌ *Cannot remove listing ${listing.listingId}*\n\n` +
      `There is an ongoing transaction for this listing:\n` +
      `Transaction: *${ongoingTxn.transactionId}*\n\n` +
      `The listing can only be removed after the transaction is completed or cancelled.\n\n` +
      `If you need help, contact support: ${process.env.SUPPORT_PHONE}`,
    );
  }

  // Safe to remove
  await Listing.updateOne(
    { _id: listing._id },
    { $set: { status: 'expired' } },
  );

  // Notify admin
  await sendMessage(
    process.env.SUPPORT_PHONE!,
    `🗑️ *Listing Removed by Seller*\n\n` +
    `Listing: *${listing.listingId}*\n` +
    `Type: ${TYPE_LABELS[listing.type] ?? listing.type}\n` +
    `Seller: ${phone}\n\n` +
    `Status set to expired. No action needed.`,
  ).catch(() => {});

  return sendMessage(phone,
    `✅ *Listing Removed*\n\n` +
    `Listing *${listing.listingId}* has been removed from the marketplace.\n\n` +
    `Type *SELL* to create a new listing anytime.`,
  );
}
