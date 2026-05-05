import { sendMessage, sendButtons } from '../../services/whatsapp';
import { getSession, setSession, clearSession, updateSessionData } from '../session';
import { uploadScreenshot } from '../../services/cloudinary';
import { createListingFeePayment } from '../../services/paystack';
import { LISTING_FEES, TYPE_MAP, TYPE_LABELS, LISTING_EXPIRY_DAYS } from '../../config/constants';
import Listing from '../../models/Listing';
import User    from '../../models/User';
import { generateId } from '../../utils/helpers';
import { ISession } from '../../models/Session';

export async function handleSell(
  phone:   string,
  text:    string,
  session: ISession,
  mediaId?: string
): Promise<void> {
  const step = session.step;
  const data = session.data;

  // ── Entry ──────────────────────────────────────────────────────────────────
  if (text === 'SELL') {
    await setSession(phone, 'sell_type', {});
    return sendMessage(phone,
      `*List an Account for Sale* 💰\n\n` +
      `What are you selling?\n\n` +
      `1️⃣  Verified AdSense — ₦${LISTING_FEES.verified_adsense.toLocaleString()} fee\n` +
      `2️⃣  Payment-received AdSense — ₦${LISTING_FEES.payment_received_adsense.toLocaleString()} fee\n` +
      `3️⃣  Monetised Website Bundle — ₦${LISTING_FEES.website_bundle.toLocaleString()} fee\n` +
      `4️⃣  YouTube Monetised Channel — ₦${LISTING_FEES.youtube_channel.toLocaleString()} fee\n\n` +
      `Reply with a number (1–4)\n` +
      `Type *CANCEL* to exit.`
    );
  }

  // ── Select type ────────────────────────────────────────────────────────────
  if (step === 'sell_type') {
    const typeKey = TYPE_MAP[text];
    if (!typeKey) {
      return sendMessage(phone, '❌ Please reply with 1, 2, 3, or 4.');
    }
    await setSession(phone, 'sell_price', { type: typeKey });
    return sendMessage(phone,
      `✅ Selected: *${TYPE_LABELS[typeKey]}*\n\n` +
      `What is your asking price in Naira?\n\n` +
      `Reply with numbers only.\n` +
      `Example: *950000*\n\n` +
      `Minimum: ₦10,000`
    );
  }

  // ── Set price ──────────────────────────────────────────────────────────────
  if (step === 'sell_price') {
    const price = parseInt(text.replace(/[,₦\s]/g, ''), 10);
    if (isNaN(price) || price < 10000) {
      return sendMessage(phone, '❌ Invalid price. Minimum is ₦10,000.\nEnter numbers only, e.g. 950000');
    }
    await setSession(phone, 'sell_niche', { ...data, price });
    return sendMessage(phone,
      `✅ Price set: *₦${price.toLocaleString()}*\n\n` +
      `What niche is this account?\n\n` +
      `Examples: Finance blog, Tech news, Entertainment, Fashion, Cooking YouTube\n\n` +
      `Type your niche:`
    );
  }

  // ── Set niche ──────────────────────────────────────────────────────────────
  if (step === 'sell_niche') {
    const niche = text.slice(0, 100);
    await setSession(phone, 'sell_description', { ...data, niche });
    return sendMessage(phone,
      `✅ Niche: *${niche}*\n\n` +
      `Give a brief description of the account:\n\n` +
      `Include:\n` +
      `— Account age\n` +
      `— Payments received (if any)\n` +
      `— Attached website or YouTube?\n` +
      `— Any other useful details\n\n` +
      `Max 300 characters.`
    );
  }

  // ── Set description ────────────────────────────────────────────────────────
  if (step === 'sell_description') {
    const description = text.slice(0, 300);
    await setSession(phone, 'sell_screenshots', { ...data, description, screenshots: [] });
    return sendMessage(phone,
      `✅ Description saved.\n\n` +
      `Now send your *verification screenshots* 📸\n\n` +
      `Required:\n` +
      `1. AdSense dashboard (account status visible)\n` +
      `2. Payment history page\n` +
      `3. Account email visible\n\n` +
      `Send images one by one.\n` +
      `Type *DONE* when you've sent all of them.`
    );
  }

  // ── Collect screenshots ────────────────────────────────────────────────────
  if (step === 'sell_screenshots') {
    if (mediaId) {
      await sendMessage(phone, `⏳ Uploading screenshot...`);
      try {
        const url         = await uploadScreenshot(mediaId, `listings/${phone}`);
        const screenshots = [...(data.screenshots || []), url];
        await updateSessionData(phone, { screenshots });
        return sendMessage(phone,
          `✅ Screenshot ${screenshots.length} received.\n\n` +
          `Send more or type *DONE* when finished.`
        );
      } catch (err) {
        return sendMessage(phone, '❌ Upload failed. Please try sending the image again.');
      }
    }

    if (text === 'DONE') {
      const screenshots = data.screenshots || [];
      if (screenshots.length < 1) {
        return sendMessage(phone, '❌ Please send at least 1 screenshot before typing DONE.');
      }

      const user      = await User.findOneAndUpdate(
        { phone },
        { $setOnInsert: { phone } },
        { upsert: true, new: true }
      );

      const listingId = `ADS-${generateId(5)}`;
      const fee       = LISTING_FEES[data.type];
      const expiresAt = new Date(Date.now() + LISTING_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

      await Listing.create({
        listingId,
        seller:         user._id,
        type:           data.type,
        price:          data.price,
        description:    data.description,
        niche:          data.niche,
        screenshotUrls: screenshots,
        status:         'pending_verification',
        listingFee:     fee,
        feePaid:        false,
        expiresAt,
      });

      const paymentLink = await createListingFeePayment(phone, listingId, fee);
      await clearSession(phone);

      return sendMessage(phone,
        `🎉 *Listing submitted for verification!*\n\n` +
        `Listing ID: *${listingId}*\n` +
        `Type: ${TYPE_LABELS[data.type]}\n` +
        `Price: ₦${data.price.toLocaleString()}\n` +
        `Listing fee: ₦${fee.toLocaleString()}\n\n` +
        `*Pay listing fee to go live:*\n` +
        `${paymentLink}\n\n` +
        `Admin reviews within 24 hours.\n` +
        `Your listing goes live once verified and fee is paid.\n\n` +
        `Questions? Type *HELP*`
      );
    }

    return sendMessage(phone, 'Please send a screenshot image, or type *DONE* if finished.');
  }
}