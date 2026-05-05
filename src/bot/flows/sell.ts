import { sendMessage, sendButtons, sendList } from '../../services/whatsapp';
import { setSession, clearSession, updateSessionData } from '../session';
import { uploadScreenshot } from '../../services/cloudinary';
import { FEE_TIERS, TYPE_MAP, TYPE_LABELS, LISTING_EXPIRY_DAYS } from '../../config/constants';
import Listing from '../../models/Listing';
import User    from '../../models/User';
import { generateId } from '../../utils/helpers';
import { ISession } from '../../models/Session';

// ─── Niches ───────────────────────────────────────────────────────────────────
const NICHES = [
  { id: 'NICHE_FINANCE',       title: 'Finance & Banking',      description: 'Personal finance, investment, crypto' },
  { id: 'NICHE_TECH',          title: 'Tech & Gadgets',         description: 'Software, hardware, reviews' },
  { id: 'NICHE_ENTERTAINMENT', title: 'Entertainment',          description: 'Music, movies, celebrity news' },
  { id: 'NICHE_FASHION',       title: 'Fashion & Beauty',       description: 'Style, makeup, lifestyle' },
  { id: 'NICHE_FOOD',          title: 'Food & Cooking',         description: 'Recipes, restaurants, nutrition' },
  { id: 'NICHE_HEALTH',        title: 'Health & Fitness',       description: 'Wellness, workouts, diet' },
  { id: 'NICHE_EDUCATION',     title: 'Education & Career',     description: 'Tutorials, e-learning, jobs' },
  { id: 'NICHE_SPORTS',        title: 'Sports & Gaming',        description: 'Football, esports, betting tips' },
  { id: 'NICHE_TRAVEL',        title: 'Travel & Tourism',       description: 'Destinations, hotels, vlogs' },
  { id: 'NICHE_OTHER',         title: 'Other / Mixed',          description: 'General or mixed content' },
];

const NICHE_LABELS: Record<string, string> = Object.fromEntries(
  NICHES.map(n => [n.id, n.title])
);

// ─── Fee calculation ──────────────────────────────────────────────────────────
function calcFee(price: number): { fee: number; rate: number } {
  const tier = FEE_TIERS.find(t => price <= t.max) || FEE_TIERS[FEE_TIERS.length - 1];
  return {
    fee:  Math.round(price * tier.rate),
    rate: tier.rate * 100,
  };
}

// ─── Questionnaire ────────────────────────────────────────────────────────────
type QuestionKey =
  | 'sell_q_age'
  | 'sell_q_payments'
  | 'sell_q_monthly_earnings'
  | 'sell_q_website'
  | 'sell_q_channel_subs'
  | 'sell_q_channel_views'
  | 'sell_q_violations'
  | 'sell_q_extras';

interface Question {
  step:     QuestionKey;
  prompt:   string;
  buttons?: { id: string; title: string }[];
}

function getQuestions(type: string): Question[] {
  const questions: Question[] = [
    {
      step:   'sell_q_age',
      prompt: `*Question 1* 📅\n\n*How old is this account?*\n\nExamples: 6 months, 2 years, 4 years\n\nType your answer:`,
    },
    {
      step:   'sell_q_payments',
      prompt: `*Question 2* 💳\n\n*Has AdSense ever made a payment to this account?*`,
      buttons: [
        { id: 'Q_PAY_YES',    title: '✅ Yes, received' },
        { id: 'Q_PAY_NO',     title: '❌ No payments'   },
        { id: 'Q_PAY_THRESH', title: '⏳ At threshold'  },
      ],
    },
    {
      step:   'sell_q_monthly_earnings',
      prompt: `*Question 3* 💵\n\n*Approximate monthly earnings (USD)?*\n\nExamples: $20, $150, $500+\n\nType your answer:`,
    },
  ];

  if (type === 'verified_adsense' || type === 'payment_received_adsense' || type === 'website_bundle') {
    questions.push({
      step:   'sell_q_website',
      prompt: `*Question 4* 🌐\n\n*Is a website attached to this AdSense account?*`,
      buttons: [
        { id: 'Q_WEB_YES', title: '✅ Yes, included' },
        { id: 'Q_WEB_NO',  title: '❌ No website'    },
      ],
    });
  }

  if (type === 'youtube_channel') {
    questions.push(
      {
        step:   'sell_q_channel_subs',
        prompt: `*Question 4* 📺\n\n*How many subscribers does the channel have?*\n\nExamples: 1,200 | 50K | 200K\n\nType your answer:`,
      },
      {
        step:   'sell_q_channel_views',
        prompt: `*Question 5* 👁️\n\n*Average monthly views?*\n\nExamples: 10K/month, 500K/month\n\nType your answer:`,
      }
    );
  }

  const nextNum = questions.length + 1;

  questions.push(
    {
      step:   'sell_q_violations',
      prompt: `*Question ${nextNum}* ⚠️\n\n*Any policy violations or strikes on this account?*`,
      buttons: [
        { id: 'Q_VIO_NO',  title: '✅ No violations'  },
        { id: 'Q_VIO_YES', title: '⚠️ Has violations' },
      ],
    },
    {
      step:   'sell_q_extras',
      prompt: `*Last question* 📝\n\n*Any extra details a buyer should know?*\n\nE.g. login credentials included, country-specific traffic, authority site, etc.\n\nType *NONE* to skip:`,
    }
  );

  return questions;
}

// ─── Build description from answers ──────────────────────────────────────────
function buildDescription(data: Record<string, any>): string {
  const payLabel: Record<string, string> = {
    Q_PAY_YES:    'Yes — payments received',
    Q_PAY_NO:     'No payments yet',
    Q_PAY_THRESH: 'Reached threshold, not yet paid',
  };
  const webLabel: Record<string, string> = {
    Q_WEB_YES: 'Yes',
    Q_WEB_NO:  'No',
  };
  const vioLabel: Record<string, string> = {
    Q_VIO_NO:  'None',
    Q_VIO_YES: 'Has violations',
  };

  const lines: string[] = [
    `Age: ${data.sell_q_age || 'N/A'}`,
    `Payments: ${payLabel[data.sell_q_payments] || data.sell_q_payments || 'N/A'}`,
    `Monthly earnings: ${data.sell_q_monthly_earnings || 'N/A'}`,
  ];

  if (data.sell_q_website) {
    lines.push(`Website attached: ${webLabel[data.sell_q_website] || data.sell_q_website}`);
  }
  if (data.sell_q_channel_subs) {
    lines.push(`Subscribers: ${data.sell_q_channel_subs}`);
  }
  if (data.sell_q_channel_views) {
    lines.push(`Monthly views: ${data.sell_q_channel_views}`);
  }

  lines.push(`Violations: ${vioLabel[data.sell_q_violations] || data.sell_q_violations || 'N/A'}`);

  if (data.sell_q_extras && data.sell_q_extras.toUpperCase() !== 'NONE') {
    lines.push(`Notes: ${data.sell_q_extras}`);
  }

  return lines.join(' | ');
}

// ─── Niche list helper ────────────────────────────────────────────────────────
async function sendNicheList(phone: string, intro: string): Promise<void> {
  return sendList(
    phone,
    intro,
    'Select Niche',
    [
      {
        title: 'Content Categories',
        rows:  NICHES.map(n => ({
          id:          n.id,
          title:       n.title,
          description: n.description,
        })),
      },
    ],
    'Select Account Niche'
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────
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
      `1️⃣  Verified AdSense\n` +
      `2️⃣  Payment-received AdSense\n` +
      `3️⃣  Monetised Website Bundle\n` +
      `4️⃣  YouTube Monetised Channel\n\n` +
      `Reply with a number (1–4)\n\n` +
      `💡 *Listing is free. AdSwap only takes a small % of your sale price when your account is sold — nothing paid upfront.*\n\n` +
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
    const { fee, rate } = calcFee(price);
    await setSession(phone, 'sell_niche', { ...data, price });
    return sendNicheList(
      phone,
      `✅ Price set: *₦${price.toLocaleString()}*\n\n` +
      `AdSwap fee on sale: *${rate}% (₦${fee.toLocaleString()})* — only charged when sold.\n\n` +
      `What niche is this account?`
    );
  }

  // ── Set niche ──────────────────────────────────────────────────────────────
  if (step === 'sell_niche') {
    const niche = NICHE_LABELS[text];
    if (!niche) {
      return sendNicheList(phone, `Please select a niche from the list:`);
    }
    const questions = getQuestions(data.type);
    const firstQ    = questions[0];
    await setSession(phone, firstQ.step, { ...data, niche });
    return firstQ.buttons
      ? sendButtons(phone, firstQ.prompt, firstQ.buttons)
      : sendMessage(phone, firstQ.prompt);
  }

  // ── Questionnaire ──────────────────────────────────────────────────────────
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

    // All questions done — move to screenshots
    const description = buildDescription(updatedData);
    await setSession(phone, 'sell_screenshots', { ...updatedData, description, screenshots: [] });

    return sendMessage(phone,
      `✅ *Details confirmed! Here's your listing summary:*\n\n` +
      `*Type:* ${TYPE_LABELS[updatedData.type]}\n` +
      `*Price:* ₦${Number(updatedData.price).toLocaleString()}\n` +
      `*Niche:* ${updatedData.niche}\n\n` +
      `Now send your *verification screenshots* 📸\n\n` +
      `Required:\n` +
      `1. AdSense dashboard (account status visible)\n` +
      `2. Payment history page\n` +
      `3. Account email visible\n\n` +
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
          `✅ Screenshot ${screenshots.length} received.\n\n` +
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

      console.log(`[SELL] DONE received for ${phone}, screenshots: ${screenshots.length}`);

      try {
        const user = await User.findOneAndUpdate(
          { phone },
          { $setOnInsert: { phone } },
          { upsert: true, new: true }
        );
        console.log(`[SELL] User found/created: ${user._id}`);

        const listingId    = `ADS-${generateId(5)}`;
        const { fee, rate} = calcFee(data.price);
        const expiresAt    = new Date(Date.now() + LISTING_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

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
        console.log(`[SELL] Listing created: ${listingId}`);

        await clearSession(phone);

        return sendMessage(phone,
          `🎉 *Listing submitted for verification!*\n\n` +
          `Listing ID: *${listingId}*\n` +
          `Type: ${TYPE_LABELS[data.type]}\n` +
          `Price: ₦${data.price.toLocaleString()}\n\n` +
          `💡 *No upfront cost.* AdSwap charges *${rate}% (₦${fee.toLocaleString()})* only when your account is successfully sold.\n\n` +
          `Admin reviews your listing within 24 hours.\n` +
          `You'll be notified once it goes live.\n\n` +
          `Questions? Type *HELP*`
        );
      } catch (err) {
        console.error('[SELL] DONE handler error:', err);
        return sendMessage(phone, '❌ Something went wrong saving your listing. Please try again or type *HELP*.');
      }
    }

    return sendMessage(phone, 'Please send a screenshot image, or type *DONE* if finished.');
  }
}