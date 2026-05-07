import { sendMessage, sendButtons, sendList } from '../../services/whatsapp';
import { setSession, clearSession, updateSessionData } from '../session';
import { uploadScreenshot } from '../../services/cloudinary';
import { FEE_TIERS, TYPE_MAP, TYPE_LABELS, LISTING_EXPIRY_DAYS } from '../../config/constants';
import Listing from '../../models/Listing';
import User    from '../../models/User';
import { generateId } from '../../utils/helpers';
import { ISession } from '../../models/Session';

// ─── Fee calculation ──────────────────────────────────────────────────────────
function calcFee(price: number): { fee: number; rate: number } {
  const tier = FEE_TIERS.find(t => price <= t.max) ?? FEE_TIERS[FEE_TIERS.length - 1];
  return { fee: Math.round(price * tier.rate), rate: tier.rate * 100 };
}

// ─── Question definitions per asset type ─────────────────────────────────────
interface Question {
  step:     string;
  prompt:   string;
  buttons?: { id: string; title: string }[];
}

function getQuestions(type: string): Question[] {
  switch (type) {

    // ── Google Ads Account ──────────────────────────────────────────────────
    case 'google_ad_account':
      return [
        {
          step:   'sell_q_gads_age',
          prompt: `*Step 1 of 5 — Account Age* 📅\n\nHow long has this Google Ads account been active?\n\nExamples: _3 months_, _1 year_, _4 years_\n\nType your answer:`,
        },
        {
          step:   'sell_q_gads_spend',
          prompt: `*Step 2 of 5 — Total Spend* 💸\n\nWhat is the total lifetime spend on this account?\n\nExamples: _$500_, _$10,000_, _$50,000+_\n\nType your answer:`,
        },
        {
          step:   'sell_q_gads_currency',
          prompt: `*Step 3 of 5 — Billing Currency* 💱\n\nWhat currency is this account billed in?\n\nExamples: _USD_, _GBP_, _NGN_, _EUR_\n\nType your answer:`,
        },
        {
          step:   'sell_q_gads_niche',
          prompt: `*Step 4 of 5 — Account Niche* 🏷️\n\nWhat niche or industry were ads running in?\n\nExamples: _E-commerce_, _Finance_, _Real Estate_, _Health_\n\nType your answer:`,
        },
        {
          step:    'sell_q_gads_suspended',
          prompt:  `*Step 5 of 5 — Account Status* ⚠️\n\nHas this account ever been suspended or restricted?`,
          buttons: [
            { id: 'GADS_SUSP_NO',  title: '✅ No issues'       },
            { id: 'GADS_SUSP_YES', title: '⚠️ Was suspended'   },
          ],
        },
      ];

    // ── Facebook/Meta Ads Account ───────────────────────────────────────────
    case 'facebook_ad_account':
      return [
        {
          step:   'sell_q_meta_age',
          prompt: `*Step 1 of 5 — Account Age* 📅\n\nHow old is this Facebook/Meta Ads account?\n\nExamples: _6 months_, _2 years_\n\nType your answer:`,
        },
        {
          step:   'sell_q_meta_limit',
          prompt: `*Step 2 of 5 — Spend Limit* 💳\n\nWhat is the current daily or total spend limit on this account?\n\nExamples: _$50/day_, _$500 total_, _No limit_\n\nType your answer:`,
        },
        {
          step:    'sell_q_meta_bm',
          prompt:  `*Step 3 of 5 — Business Manager* 🏢\n\nIs this account inside a Business Manager (BM)?`,
          buttons: [
            { id: 'META_BM_YES', title: '✅ Yes — inside BM' },
            { id: 'META_BM_NO',  title: '❌ No — personal'   },
          ],
        },
        {
          step:    'sell_q_meta_pixel',
          prompt:  `*Step 4 of 5 — Facebook Pixel* 📊\n\nIs a Facebook Pixel attached to this account?`,
          buttons: [
            { id: 'META_PIX_YES', title: '✅ Yes, pixel attached' },
            { id: 'META_PIX_NO',  title: '❌ No pixel'             },
          ],
        },
        {
          step:    'sell_q_meta_restricted',
          prompt:  `*Step 5 of 5 — Restrictions* ⚠️\n\nDoes this account have any restrictions or policy violations?`,
          buttons: [
            { id: 'META_RES_NO',  title: '✅ Clean account'     },
            { id: 'META_RES_YES', title: '⚠️ Has restrictions'  },
          ],
        },
      ];

    // ── AdSense Monetised Site ──────────────────────────────────────────────
    case 'adsense_site':
      return [
        {
          step:   'sell_q_ads_age',
          prompt: `*Step 1 of 5 — Account Age* 📅\n\nHow old is this AdSense account?\n\nExamples: _1 year_, _3 years_\n\nType your answer:`,
        },
        {
          step:    'sell_q_ads_payment',
          prompt:  `*Step 2 of 5 — Payment History* 💵\n\nHas AdSense ever made a payment to this account?`,
          buttons: [
            { id: 'ADS_PAY_YES',   title: '✅ Yes — received payment' },
            { id: 'ADS_PAY_THRESH',title: '⏳ At threshold, not paid' },
            { id: 'ADS_PAY_NO',    title: '❌ No payments yet'        },
          ],
        },
        {
          step:   'sell_q_ads_earnings',
          prompt: `*Step 3 of 5 — Monthly Earnings* 💰\n\nApproximate monthly earnings on this account?\n\nExamples: _$20/month_, _$200/month_, _$500+/month_\n\nType your answer:`,
        },
        {
          step:   'sell_q_ads_url',
          prompt: `*Step 4 of 5 — Website URL* 🌐\n\nWhat is the URL of the site attached to this AdSense account?\n\nExample: _myblog.com_\n\nType your answer (or type *NONE* if no site):`,
        },
        {
          step:    'sell_q_ads_violations',
          prompt:  `*Step 5 of 5 — Policy Violations* ⚠️\n\nDoes this AdSense account have any policy violations?`,
          buttons: [
            { id: 'ADS_VIO_NO',  title: '✅ No violations'  },
            { id: 'ADS_VIO_YES', title: '⚠️ Has violations' },
          ],
        },
      ];

    // ── Google Play Console ─────────────────────────────────────────────────
    case 'play_console':
      return [
        {
          step:   'sell_q_play_age',
          prompt: `*Step 1 of 4 — Account Age* 📅\n\nHow old is this Play Console account?\n\nExamples: _1 year_, _5 years_\n\nType your answer:`,
        },
        {
          step:   'sell_q_play_apps',
          prompt: `*Step 2 of 4 — Published Apps* 📱\n\nHow many apps are published on this account? What are their names?\n\nExamples: _2 apps — CleanMaster, VPN Pro_\n\nType your answer:`,
        },
        {
          step:   'sell_q_play_revenue',
          prompt: `*Step 3 of 4 — Monthly Revenue* 💵\n\nApproximate monthly revenue from all apps combined?\n\nExamples: _$50/month_, _$500/month_, _No revenue yet_\n\nType your answer:`,
        },
        {
          step:    'sell_q_play_suspended',
          prompt:  `*Step 4 of 4 — Account Status* ⚠️\n\nHas this Play Console account ever been suspended or had apps removed?`,
          buttons: [
            { id: 'PLAY_SUSP_NO',  title: '✅ Clean account'   },
            { id: 'PLAY_SUSP_YES', title: '⚠️ Had issues'      },
          ],
        },
      ];

    // ── Gift Card ───────────────────────────────────────────────────────────
    case 'gift_card':
      return [
        {
          step:   'sell_q_gc_brand',
          prompt: `*Step 1 of 3 — Card Brand* 🎁\n\nWhat brand is this gift card?\n\nExamples: _Amazon_, _iTunes/Apple_, _Steam_, _Google Play_, _Visa_\n\nType your answer:`,
        },
        {
          step:   'sell_q_gc_value',
          prompt: `*Step 2 of 3 — Card Value* 💵\n\nWhat is the face value of this card?\n\nExamples: _$50_, _$100_, _£25_\n\nType your answer:`,
        },
        {
          step:   'sell_q_gc_currency',
          prompt: `*Step 3 of 3 — Card Region* 🌍\n\nWhat region/country is this card valid for?\n\nExamples: _USA_, _UK_, _Global_\n\nType your answer:`,
        },
      ];

    default:
      return [];
  }
}

// ─── Build description from answers ──────────────────────────────────────────
function buildDescription(type: string, data: Record<string, any>): string {
  const yesNo = (val: string, yesId: string) => val === yesId ? 'Yes' : 'No';

  switch (type) {
    case 'google_ad_account':
      return [
        `Age: ${data.sell_q_gads_age}`,
        `Total spend: ${data.sell_q_gads_spend}`,
        `Currency: ${data.sell_q_gads_currency}`,
        `Niche: ${data.sell_q_gads_niche}`,
        `Suspended: ${yesNo(data.sell_q_gads_suspended, 'GADS_SUSP_YES')}`,
      ].join(' | ');

    case 'facebook_ad_account':
      return [
        `Age: ${data.sell_q_meta_age}`,
        `Spend limit: ${data.sell_q_meta_limit}`,
        `Business Manager: ${yesNo(data.sell_q_meta_bm, 'META_BM_YES')}`,
        `Pixel attached: ${yesNo(data.sell_q_meta_pixel, 'META_PIX_YES')}`,
        `Restrictions: ${yesNo(data.sell_q_meta_restricted, 'META_RES_YES')}`,
      ].join(' | ');

    case 'adsense_site':
      return [
        `Age: ${data.sell_q_ads_age}`,
        `Payment: ${data.sell_q_ads_payment === 'ADS_PAY_YES' ? 'Received' : data.sell_q_ads_payment === 'ADS_PAY_THRESH' ? 'At threshold' : 'None yet'}`,
        `Monthly earnings: ${data.sell_q_ads_earnings}`,
        `Site: ${data.sell_q_ads_url?.toUpperCase() === 'NONE' ? 'Not included' : data.sell_q_ads_url}`,
        `Violations: ${yesNo(data.sell_q_ads_violations, 'ADS_VIO_YES')}`,
      ].join(' | ');

    case 'play_console':
      return [
        `Age: ${data.sell_q_play_age}`,
        `Apps: ${data.sell_q_play_apps}`,
        `Monthly revenue: ${data.sell_q_play_revenue}`,
        `Suspended: ${yesNo(data.sell_q_play_suspended, 'PLAY_SUSP_YES')}`,
      ].join(' | ');

    case 'gift_card':
      return [
        `Brand: ${data.sell_q_gc_brand}`,
        `Value: ${data.sell_q_gc_value}`,
        `Region: ${data.sell_q_gc_currency}`,
      ].join(' | ');

    default:
      return '';
  }
}

// ─── Map question answers to Listing model fields ─────────────────────────────
function buildListingFields(type: string, data: Record<string, any>): Record<string, any> {
  switch (type) {
    case 'google_ad_account':
      return {
        googleAdsAccountAge: data.sell_q_gads_age,
        googleAdsSpend:      data.sell_q_gads_spend,
        googleAdsCurrency:   data.sell_q_gads_currency,
        googleAdsNiche:      data.sell_q_gads_niche,
        googleAdsSuspended:  data.sell_q_gads_suspended === 'GADS_SUSP_YES',
      };
    case 'facebook_ad_account':
      return {
        metaAccountAge:      data.sell_q_meta_age,
        metaSpendLimit:      data.sell_q_meta_limit,
        metaBusinessManager: data.sell_q_meta_bm === 'META_BM_YES',
        metaPixelAttached:   data.sell_q_meta_pixel === 'META_PIX_YES',
        metaRestricted:      data.sell_q_meta_restricted === 'META_RES_YES',
      };
    case 'adsense_site':
      return {
        adsenseAge:             data.sell_q_ads_age,
        adsensePaymentStatus:   data.sell_q_ads_payment === 'ADS_PAY_YES' ? 'received' : data.sell_q_ads_payment === 'ADS_PAY_THRESH' ? 'threshold' : 'none',
        adsenseMonthlyEarnings: data.sell_q_ads_earnings,
        adsenseSiteUrl:         data.sell_q_ads_url?.toUpperCase() === 'NONE' ? undefined : data.sell_q_ads_url,
        adsenseViolations:      data.sell_q_ads_violations === 'ADS_VIO_YES',
      };
    case 'play_console':
      return {
        playConsoleAge:       data.sell_q_play_age,
        playConsoleApps:      data.sell_q_play_apps,
        playConsoleRevenue:   data.sell_q_play_revenue,
        playConsoleSuspended: data.sell_q_play_suspended === 'PLAY_SUSP_YES',
      };
    case 'gift_card':
      return {
        giftCardBrand:    data.sell_q_gc_brand,
        giftCardValue:    data.sell_q_gc_value,
        giftCardCurrency: data.sell_q_gc_currency,
      };
    default:
      return {};
  }
}

// ─── Screenshot requirements per type ────────────────────────────────────────
function screenshotGuide(type: string): string {
  switch (type) {
    case 'google_ad_account':
      return `📸 *Required screenshots:*\n1. Google Ads dashboard (account overview visible)\n2. Billing summary showing spend history\n3. Account email address visible`;
    case 'facebook_ad_account':
      return `📸 *Required screenshots:*\n1. Facebook Ads Manager overview\n2. Billing or payment history\n3. Account email and spend limit visible`;
    case 'adsense_site':
      return `📸 *Required screenshots:*\n1. AdSense dashboard (account status visible)\n2. Payment history page\n3. Account email visible`;
    case 'play_console':
      return `📸 *Required screenshots:*\n1. Play Console dashboard showing published apps\n2. Revenue or stats overview\n3. Account email visible`;
    case 'gift_card':
      return `📸 *Required screenshots:*\n1. Front of the gift card (with code hidden/blurred)\n2. Balance check screenshot if available\n3. Receipt or purchase proof`;
    default:
      return `📸 Send screenshots that clearly show the account details.`;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function handleSell(
  phone:    string,
  text:     string,
  session:  ISession,
  mediaId?: string
): Promise<void> {
  const step = session.step;
  const data = session.data;

  // ── Entry ──────────────────────────────────────────────────────────────────
  if (text === 'SELL') {
    await setSession(phone, 'sell_type', {});
    return sendMessage(phone,
      `💰 *List an Account or Asset for Sale*\n\n` +
      `What are you selling?\n\n` +
      `1️⃣  Google Ads Account\n` +
      `2️⃣  Facebook/Meta Ads Account\n` +
      `3️⃣  AdSense Monetised Site\n` +
      `4️⃣  Google Play Console Account\n` +
      `5️⃣  Gift Card\n\n` +
      `Reply with a number (1–5)\n\n` +
      `💡 *Listing is free.* AdSwap only charges a small % when your item is sold — nothing upfront.\n\n` +
      `Type *CANCEL* to go back.`
    );
  }

  // ── Select type ────────────────────────────────────────────────────────────
  if (step === 'sell_type') {
    const typeKey = TYPE_MAP[text];
    if (!typeKey) {
      return sendMessage(phone, '❌ Please reply with a number from 1 to 5.');
    }
    await setSession(phone, 'sell_price', { type: typeKey });
    return sendMessage(phone,
      `✅ *${TYPE_LABELS[typeKey]}* selected.\n\n` +
      `What is your asking price in Naira (₦)?\n\n` +
      `Enter numbers only — no commas or symbols.\n` +
      `Example: *75000*\n\n` +
      `Minimum: ₦1,000\n\n` +
      `Type *CANCEL* to exit.`
    );
  }

  // ── Set price ──────────────────────────────────────────────────────────────
  if (step === 'sell_price') {
    const price = parseInt(text.replace(/[,₦\s]/g, ''), 10);
    if (isNaN(price) || price < 1000) {
      return sendMessage(phone, '❌ Invalid price. Minimum is ₦1,000.\n\nEnter numbers only — example: 75000');
    }
    const { fee, rate } = calcFee(price);
    await setSession(phone, 'sell_questions', { type: data.type, price });
    return sendMessage(phone,
      `✅ *Price set: ₦${price.toLocaleString()}*\n\n` +
      `AdSwap fee: *${rate}% (₦${fee.toLocaleString()})* — only charged when sold.\n\n` +
      `Now I'll ask you a few quick questions about the account.\n` +
      `This helps buyers trust your listing.\n\n` +
      `Type *CANCEL* at any time to exit.`
    );
  }

  // ── Start questionnaire ────────────────────────────────────────────────────
  if (step === 'sell_questions') {
    const questions = getQuestions(data.type);
    const firstQ    = questions[0];
    if (!firstQ) {
      // No questions for this type — skip to screenshots
      await setSession(phone, 'sell_screenshots', { ...data, description: '', screenshots: [] });
      return sendMessage(phone, `${screenshotGuide(data.type)}\n\nSend images one by one.\nType *DONE* when finished.`);
    }
    await setSession(phone, firstQ.step, { ...data });
    return firstQ.buttons
      ? sendButtons(phone, firstQ.prompt, firstQ.buttons)
      : sendMessage(phone, firstQ.prompt);
  }

  // ── Questionnaire steps ────────────────────────────────────────────────────
  if (step.startsWith('sell_q_')) {
    const questions  = getQuestions(data.type);
    const currentIdx = questions.findIndex(q => q.step === step);

    if (currentIdx === -1) {
      await clearSession(phone);
      return sendMessage(phone, '❌ Something went wrong. Type *SELL* to start again.');
    }

    const updatedData = { ...data, [step]: text };
    const nextQ       = questions[currentIdx + 1];

    if (nextQ) {
      await setSession(phone, nextQ.step, updatedData);
      return nextQ.buttons
        ? sendButtons(phone, nextQ.prompt, nextQ.buttons)
        : sendMessage(phone, nextQ.prompt);
    }

    // All questions answered — move to screenshots
    const description = buildDescription(data.type, updatedData);
    await setSession(phone, 'sell_screenshots', { ...updatedData, description, screenshots: [] });

    return sendMessage(phone,
      `✅ *Details confirmed!*\n\n` +
      `*${TYPE_LABELS[updatedData.type]}*\n` +
      `Price: ₦${Number(updatedData.price).toLocaleString()}\n\n` +
      `Now send your verification screenshots. 📸\n\n` +
      `${screenshotGuide(data.type)}\n\n` +
      `Send images one by one.\n` +
      `Type *DONE* when finished.`
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
          `✅ Screenshot ${screenshots.length} saved.\n\n` +
          `Send more or type *DONE* when finished.`
        );
      } catch (err) {
        console.error('[SELL] Screenshot upload error:', err);
        return sendMessage(phone, '❌ Upload failed. Please try sending the image again.');
      }
    }

    if (text === 'DONE') {
      const screenshots = data.screenshots || [];
      if (screenshots.length < 1) {
        return sendMessage(phone, '❌ Please send at least 1 screenshot before typing DONE.');
      }

      try {
        const user = await User.findOneAndUpdate(
          { phone },
          { $setOnInsert: { phone } },
          { upsert: true, new: true }
        );

        const listingId     = `ADS-${generateId(5)}`;
        const { fee, rate } = calcFee(data.price);
        const expiresAt     = new Date(Date.now() + LISTING_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        const extraFields   = buildListingFields(data.type, data);

        await Listing.create({
          listingId,
          seller:         user._id,
          type:           data.type,
          price:          data.price,
          description:    data.description,
          screenshotUrls: screenshots,
          status:         'pending_verification',
          expiresAt,
          ...extraFields,
        });

        await clearSession(phone);

        return sendMessage(phone,
          `🎉 *Listing submitted!*\n\n` +
          `Listing ID: *${listingId}*\n` +
          `Type: ${TYPE_LABELS[data.type]}\n` +
          `Price: ₦${data.price.toLocaleString()}\n\n` +
          `⏳ Admin will review your listing within *24 hours*.\n` +
          `You'll get a WhatsApp notification once it goes live.\n\n` +
          `💡 AdSwap charges *${rate}% (₦${fee.toLocaleString()})* only when your item is sold — nothing now.\n\n` +
          `Questions? Type *HELP*`
        );
      } catch (err) {
        console.error('[SELL] DONE handler error:', err);
        return sendMessage(phone, '❌ Something went wrong saving your listing. Please try again or type *HELP*.');
      }
    }

    return sendMessage(phone, 'Please send a screenshot image, or type *DONE* when finished.');
  }
}