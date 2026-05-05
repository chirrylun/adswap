import { sendMessage, sendList } from '../../services/whatsapp';
import { TYPE_LABELS } from '../../config/constants';
import Listing from '../../models/Listing';

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
      return sendMessage(phone, '❌ Listing not found or no longer available.\n\nType *LISTINGS* to browse active ones.');
    }

    listing.viewCount += 1;
    await listing.save();

    const ratingStr = listing.seller.totalSales > 0
      ? `⭐ ${listing.seller.sellerRating.toFixed(1)} (${listing.seller.totalSales} sales)`
      : '🆕 New seller';

    return sendMessage(phone,
      `*${listing.listingId}* ${listing.isFeatured ? '⭐ FEATURED' : ''}\n\n` +
      `Type: *${TYPE_LABELS[listing.type]}*\n` +
      `Niche: ${listing.niche || 'Not specified'}\n` +
      `Price: *₦${listing.price.toLocaleString()}*\n` +
      `Description: ${listing.description}\n` +
      `Seller: ${ratingStr}\n\n` +
      `👁 ${listing.viewCount} views\n\n` +
      `To buy with escrow protection:\n` +
      `Reply: *BUY ${listing.listingId}*\n\n` +
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

  const rows = listings.map(l => ({
    id:          `VIEW ${l.listingId}`,
    title:       `${l.listingId} — ₦${l.price.toLocaleString()}`,
    description: `${TYPE_LABELS[l.type]} · ${l.niche || 'General'}${l.isFeatured ? ' ⭐' : ''}`,
  }));

  return sendList(
    phone,
    `*Verified Listings* 📋\n\n` +
    `${listings.length} account${listings.length > 1 ? 's' : ''} available.\n` +
    `Select one to view full details:`,
    'View Listings',
    [{ title: 'Available Now', rows }],
    undefined,
    'All listings are manually verified before going live.'
  );
}