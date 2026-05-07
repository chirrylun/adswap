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
      ? `⭐ ${listing.seller.sellerRating.toFixed(1)} · ${listing.seller.totalSales} sale${listing.seller.totalSales !== 1 ? 's' : ''}`
      : '🆕 New seller';

    const details = formatFullDetails(listing);
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
      `  💰  Price            *₦${listing.price.toLocaleString()}*\n` +
      `  👤  Seller           ${ratingStr}\n` +
      `  👁  Views            ${listing.viewCount}\n` +
      `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔\n\n` +

      `🔒 *Escrow protected — your money is safe*\n\n` +
      `To purchase, copy and send:\n` +
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
      `📭 *No active listings right now.*\n\n` +
      `Check back later or type *SELL* to list your own account.`
    );
  }

  const rows = listings.map(l => ({
    id:          `VIEW ${l.listingId}`,
    title:       `${TYPE_LABELS[l.type] ?? l.type}${l.isFeatured ? ' ⭐' : ''} — ₦${l.price.toLocaleString()}`,
    description: formatListingSnippet(l).slice(0, 72),
  }));

  return sendList(
    phone,
    `*AdSwap Verified Listings* 📋\n\n` +
    `${listings.length} account${listings.length > 1 ? 's' : ''} available right now.\n\n` +
    `All listings are manually reviewed before going live.\n` +
    `Tap any listing to view full details:`,
    'Browse Listings',
    [{ title: 'Available Now', rows }],
    undefined,
    '🔒 Every transaction is escrow-protected.'
  );
}