import { sendMessage, sendList, sendButtons } from '../../services/whatsapp';
import { TYPE_LABELS } from '../../config/constants';
import Listing from '../../models/Listing';
import { ListingType } from '../../models/Listing';

// ─── Snippet builders ─────────────────────────────────────────────────────────
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


const SHORT_TO_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_SHORT).map(([full, short]) => [short, full])
);

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

// ─── Step 1: Category picker ──────────────────────────────────────────────────

async function showCategoryPicker(phone: string): Promise<void> {
  // Only show categories that actually have active listings
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

  // Build rows only for types that have stock
  const rows = activeCounts
  .sort((a, b) => b.count - a.count)
  .map(({ _id: type, count }: { _id: string; count: number }) => ({
    id:          `BR_${TYPE_SHORT[type] ?? type}`,   // e.g. "BR_fbads" — well under 20 chars
    title:       `${CATEGORY_EMOJI[type] ?? '📦'} ${TYPE_LABELS[type] ?? type}`,
    description: `${count} listing${count !== 1 ? 's' : ''} available`,
  }));

  return sendList(
    phone,
    `*AdSwap Marketplace* 🛍️\n\n` +
    `Browse by category below.\n` +
    `All listings are verified before going live.\n\n` +
    `🔒 Every transaction is escrow-protected.`,
    'Choose Category',
    [{ title: 'Categories', rows }],
  );
}

// ─── Step 2: Listings within a category ──────────────────────────────────────

async function showCategoryListings(phone: string, type: string): Promise<void> {
  const label = TYPE_LABELS[type];
  if (!label) {
    return sendMessage(phone,
      `❌ Unknown category.\n\nType *LISTINGS* to browse categories.`
    );
  }

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
    `Tap any listing to view full details and buy:\n\n` +
    `_(Type *LISTINGS* to go back to categories)_`,
    'View Listings',
    [{ title: `${label} — Available Now`, rows }],
    undefined,
    '🔒 Every transaction is escrow-protected.'
  );
}

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

  return sendMessage(phone,
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
    `  💰  Price            *₦${(listing.buyerPays || listing.price).toLocaleString()}*\n` +
    `  👤  Seller           ${ratingStr}\n` +
    `  👁  Views            ${listing.viewCount + 1}\n` +
    `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\n\n` +

    `🔒 *Escrow protected — your money is safe*\n\n` +
    `To purchase, copy and send:\n` +
    `\`BUY ${listing.listingId}\`\n\n` +
    `_(Type *LISTINGS* to browse more)_`
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleListings(
  phone: string,
  text:  string
): Promise<void> {
  if (text.startsWith('VIEW ')) {
    const listingId = text.replace('VIEW ', '').trim();
    return showListingDetail(phone, listingId);
  }

  if (text.startsWith('BR_')) {
    const short = text.replace('BR_', '').trim().toLowerCase();
    const type  = SHORT_TO_TYPE[short] ?? short;
    return showCategoryListings(phone, type);
  }

  return showCategoryPicker(phone);
}