import { sendMessage, sendList } from '../../services/whatsapp';
import { TYPE_LABELS } from '../../config/constants';
import Listing from '../../models/Listing';

function formatListingSnippet(l: any): string {
  switch (l.type) {
    case 'google_ad_account':
      return [
        l.googleAdsAccountAge && `📅 ${l.googleAdsAccountAge}`,
        l.googleAdsSpend      && `💸 ${l.googleAdsSpend}`,
        l.googleAdsCurrency   && `(${l.googleAdsCurrency})`,
        l.googleAdsSuspended  ? '⚠️ Suspended' : '✅ Clean',
      ].filter(Boolean).join('  ');

    case 'facebook_ad_account':
      return [
        l.metaAccountAge    && `📅 ${l.metaAccountAge}`,
        l.metaSpendLimit    && `💳 ${l.metaSpendLimit}`,
        l.metaRestricted    ? '⚠️ Restricted' : '✅ Clean',
        l.metaPixelAttached ? '📊 Pixel ✓' : null,
      ].filter(Boolean).join('  ');

    case 'adsense_site':
  return [
    l.adsenseAge             && `📅 ${l.adsenseAge}`,
    l.adsenseMonthlyEarnings && `💰 $${l.adsenseMonthlyEarnings}/mo`,
    l.adsenseSiteUrl         && `🌐 ${l.adsenseSiteUrl}`,
    l.adsenseViolations      ? '⚠️ Violations' : '✅ Clean',
  ].filter(Boolean).join('  ');

case 'play_console':
  return [
    l.playConsoleAge     && `📅 ${l.playConsoleAge}`,
    l.playConsoleApps    && `📱 ${l.playConsoleApps}`,
    l.playConsoleRevenue && `💵 $${l.playConsoleRevenue}/mo`,
    l.playConsoleSuspended ? '⚠️ Suspended' : '✅ Clean',
  ].filter(Boolean).join('  ');

    case 'gift_card':
      return [
        l.giftCardBrand    && l.giftCardBrand,
        l.giftCardValue    && `💵 ${l.giftCardValue}`,
        l.giftCardCurrency && `🌍 ${l.giftCardCurrency}`,
      ].filter(Boolean).join('  ');

    default:
      return l.description?.slice(0, 80) ?? '';
  }
}

function formatFullDetails(l: any): string {
  switch (l.type) {
    case 'google_ad_account':
      return [
        l.googleAdsAccountAge && `📅 Age: ${l.googleAdsAccountAge}`,
        l.googleAdsSpend      && `💸 Total Spend: ${l.googleAdsSpend}`,
        l.googleAdsCurrency   && `💱 Currency: ${l.googleAdsCurrency}`,
        l.googleAdsNiche      && `🏷️ Niche: ${l.googleAdsNiche}`,
        `⚠️ Suspended: ${l.googleAdsSuspended ? 'Yes' : 'No'}`,
      ].filter(Boolean).join('\n');

    case 'facebook_ad_account':
      return [
        l.metaAccountAge      && `📅 Age: ${l.metaAccountAge}`,
        l.metaSpendLimit      && `💳 Spend Limit: ${l.metaSpendLimit}`,
        `🏢 Business Manager: ${l.metaBusinessManager ? 'Yes' : 'No'}`,
        `📊 Pixel Attached: ${l.metaPixelAttached ? 'Yes' : 'No'}`,
        `⚠️ Restricted: ${l.metaRestricted ? 'Yes' : 'No'}`,
      ].filter(Boolean).join('\n');

    case 'adsense_site':
  return [
    l.adsenseAge             && `📅 Age: ${l.adsenseAge}`,
    l.adsenseMonthlyEarnings && `💰 Monthly Earnings: $${l.adsenseMonthlyEarnings}`,
    l.adsensePaymentStatus   && `💵 Payment Status: ${l.adsensePaymentStatus}`,
    l.adsenseSiteUrl         && `🌐 Site: ${l.adsenseSiteUrl}`,
    `⚠️ Violations: ${l.adsenseViolations ? 'Yes' : 'No'}`,
  ].filter(Boolean).join('\n');

case 'play_console':
  return [
    l.playConsoleAge     && `📅 Age: ${l.playConsoleAge}`,
    l.playConsoleApps    && `📱 Apps: ${l.playConsoleApps}`,
    l.playConsoleRevenue && `💵 Monthly Revenue: $${l.playConsoleRevenue}`,
    `⚠️ Suspended: ${l.playConsoleSuspended ? 'Yes' : 'No'}`,
  ].filter(Boolean).join('\n');
  
    case 'gift_card':
      return [
        l.giftCardBrand    && `🎁 Brand: ${l.giftCardBrand}`,
        l.giftCardValue    && `💵 Value: ${l.giftCardValue}`,
        l.giftCardCurrency && `🌍 Region: ${l.giftCardCurrency}`,
      ].filter(Boolean).join('\n');

    default:
      return '';
  }
}

export async function handleListings(
  phone: string,
  text:  string
): Promise<void> {

  // ── View single listing ────────────────────────────────────────────────────
  if (text.startsWith('VIEW ')) {
    const listingId = text.replace('VIEW ', '').trim();
    const listing   = await Listing.findOne({ listingId, status: 'active' })
      .populate<{ seller: any }>('seller');

    if (!listing) {
      return sendMessage(phone,
        '❌ Listing not found or no longer available.\n\n' +
        'Type *LISTINGS* to browse active ones.'
      );
    }

    listing.viewCount += 1;
    await listing.save();

    const ratingStr = listing.seller.totalSales > 0
      ? `⭐ ${listing.seller.sellerRating.toFixed(1)} (${listing.seller.totalSales} sales)`
      : '🆕 New seller';

    const details = formatFullDetails(listing);

    return sendMessage(phone,
      `${listing.isFeatured ? '⭐ *FEATURED* — ' : ''}*${TYPE_LABELS[listing.type]}*\n` +
      `🆔 ${listing.listingId}\n\n` +
      (details ? `${details}\n\n` : '') +
      `💰 Price: *₦${listing.price.toLocaleString()}*\n` +
      `👤 Seller: ${ratingStr}\n` +
      `👁 ${listing.viewCount} view${listing.viewCount !== 1 ? 's' : ''}\n\n` +
      (listing.description ? `📝 ${listing.description}\n\n` : '') +
      `─────────────────\n` +
      `To buy with escrow protection, copy and send:\n\n` +
      `\`BUY ${listing.listingId}\`\n\n` +
      `Type *LISTINGS* to see more.`
    );
  }

  // ── Browse all listings ────────────────────────────────────────────────────
  const listings = await Listing.find({ status: 'active' })
    .populate('seller')
    .sort({ isFeatured: -1, createdAt: -1 })
    .limit(10);

  if (!listings.length) {
    return sendMessage(phone,
      `📭 No active listings right now.\n\n` +
      `Check back later or type *SELL* to list your own account.`
    );
  }

  // Use sendList for the browse view — rows show the snippet as description
  const rows = listings.map(l => ({
    id:          `VIEW ${l.listingId}`,
    title:       `${TYPE_LABELS[l.type] ?? l.type}${l.isFeatured ? ' ⭐' : ''} — ₦${l.price.toLocaleString()}`,
    description: formatListingSnippet(l).slice(0, 72), // WhatsApp row description limit
  }));

  return sendList(
    phone,
    `*Verified Listings* 📋\n\n` +
    `${listings.length} account${listings.length > 1 ? 's' : ''} available.\n` +
    `Tap a listing to view full details and buy:`,
    'View Listings',
    [{ title: 'Available Now', rows }],
    undefined,
    'All listings are manually verified before going live.'
  );
}