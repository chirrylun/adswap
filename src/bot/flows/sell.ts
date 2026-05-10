import { sendMessage, sendButtons } from "../../services/whatsapp";
import { setSession, clearSession, updateSessionData } from "../session";
import { uploadScreenshot } from "../../services/cloudinary";
import {
  FEE_TIERS,
  TYPE_MAP,
  TYPE_LABELS,
  LISTING_EXPIRY_DAYS,
} from "../../config/constants";
import Listing from "../../models/Listing";
import Request from "../../models/Request";
import User from "../../models/User";
import { generateId } from "../../utils/helpers";
import { ISession } from "../../models/Session";

// ─── Fee calculation ──────────────────────────────────────────────────────────
// Fee is DEDUCTED from the seller's price.
function calcFee(price: number): {
  fee: number;
  rate: number;
  sellerReceives: number;
} {
  const tier =
    FEE_TIERS.find((t) => price <= t.max) ?? FEE_TIERS[FEE_TIERS.length - 1];
  const fee = Math.round(price * tier.rate);
  return { fee, rate: tier.rate * 100, sellerReceives: price - fee };
}

// ─── Question definitions per asset type ─────────────────────────────────────
interface Question {
  step: string;
  prompt: string;
  buttons?: { id: string; title: string }[];
}

const COUNTRY_QUESTION: Question = {
  step: "sell_q_country",
  prompt: `*Final Step — Account Country* 🌍\n\nWhat country is this account registered in or primarily used from?\n\nExamples: _Nigeria_, _United States_, _United Kingdom_, _Ghana_\n\nType your answer:`,
};

function getQuestions(type: string): Question[] {
  switch (type) {
    case "google_ad_account":
      return [
        {
          step: "sell_q_gads_age",
          prompt: `*Step 1 of 6 — Account Age* 📅\n\nHow long has this Google Ads account been active?\n\nExamples: _3 months_, _1 year_, _4 years_\n\nType your answer:`,
        },
        {
          step: "sell_q_gads_spend",
          prompt: `*Step 2 of 6 — Total Spend* 💸\n\nWhat is the total lifetime spend on this account?\n\nExamples: _$500_, _$10,000_, _$50,000+_\n\nType your answer:`,
        },
        {
          step: "sell_q_gads_currency",
          prompt: `*Step 3 of 6 — Billing Currency* 💱\n\nWhat currency is this account billed in?\n\nExamples: _USD_, _GBP_, _NGN_, _EUR_\n\nType your answer:`,
        },
        {
          step: "sell_q_gads_niche",
          prompt: `*Step 4 of 6 — Account Niche* 🏷️\n\nWhat niche or industry were ads running in?\n\nExamples: _E-commerce_, _Finance_, _Real Estate_, _Health_\n\nType your answer:`,
        },
        {
          step: "sell_q_gads_suspended",
          prompt: `*Step 5 of 6 — Account Status* ⚠️\n\nHas this account ever been suspended or restricted?`,
          buttons: [
            { id: "GADS_SUSP_NO", title: "✅ No issues" },
            { id: "GADS_SUSP_YES", title: "⚠️ Was suspended" },
          ],
        },
        {
          ...COUNTRY_QUESTION,
          prompt: COUNTRY_QUESTION.prompt.replace("Final Step", "Step 6 of 6"),
        },
      ];

    case "facebook_ad_account":
      return [
        {
          step: "sell_q_meta_age",
          prompt: `*Step 1 of 6 — Account Age* 📅\n\nHow old is this Facebook/Meta Ads account?\n\nExamples: _6 months_, _2 years_\n\nType your answer:`,
        },
        {
          step: "sell_q_meta_limit",
          prompt: `*Step 2 of 6 — Spend Limit* 💳\n\nWhat is the current daily or total spend limit?\n\nExamples: _$50/day_, _$500 total_, _No limit_\n\nType your answer:`,
        },
        {
          step: "sell_q_meta_bm",
          prompt: `*Step 3 of 6 — Business Manager* 🏢\n\nIs this account inside a Business Manager (BM)?`,
          buttons: [
            { id: "META_BM_YES", title: "✅ Yes — inside BM" },
            { id: "META_BM_NO", title: "❌ No — personal" },
          ],
        },
        {
          step: "sell_q_meta_pixel",
          prompt: `*Step 4 of 6 — Facebook Pixel* 📊\n\nIs a Facebook Pixel attached to this account?`,
          buttons: [
            { id: "META_PIX_YES", title: "✅ Yes" },
            { id: "META_PIX_NO", title: "❌ No pixel" },
          ],
        },
        {
          step: "sell_q_meta_restricted",
          prompt: `*Step 5 of 6 — Restrictions* ⚠️\n\nDoes this account have any restrictions or policy violations?`,
          buttons: [
            { id: "META_RES_NO", title: "✅ Clean account" },
            { id: "META_RES_YES", title: "⚠️ Has restrictions" },
          ],
        },
        {
          ...COUNTRY_QUESTION,
          prompt: COUNTRY_QUESTION.prompt.replace("Final Step", "Step 6 of 6"),
        },
      ];

    case "twitter_account":
      return [
        {
          step: "sell_q_tw_followers",
          prompt: `*Step 1 of 6 — Followers* 👥\n\nHow many followers does this Twitter/X account have?\n\nExamples: _5,000_, _50K_, _200K_\n\nType your answer:`,
        },
        {
          step: "sell_q_tw_age",
          prompt: `*Step 2 of 6 — Account Age* 📅\n\nHow old is this Twitter/X account?\n\nExamples: _2 years_, _5 years_\n\nType your answer:`,
        },
        {
          step: "sell_q_tw_niche",
          prompt: `*Step 3 of 6 — Niche* 🏷️\n\nWhat niche or topic does this account post about?\n\nExamples: _Finance_, _Football_, _Tech_, _Comedy_\n\nType your answer:`,
        },
        {
          step: "sell_q_tw_monetized",
          prompt: `*Step 4 of 6 — Monetization* 💰\n\nIs this account enrolled in X (Twitter) monetization or Creator program?`,
          buttons: [
            { id: "TW_MON_YES", title: "✅ Yes — monetized" },
            { id: "TW_MON_NO", title: "❌ Not monetized" },
          ],
        },
        {
          step: "sell_q_tw_suspended",
          prompt: `*Step 5 of 6 — Account Status* ⚠️\n\nHas this account ever been suspended or restricted?`,
          buttons: [
            { id: "TW_SUSP_NO", title: "✅ Never suspended" },
            { id: "TW_SUSP_YES", title: "⚠️ Was suspended" },
          ],
        },
        {
          ...COUNTRY_QUESTION,
          prompt: COUNTRY_QUESTION.prompt.replace("Final Step", "Step 6 of 6"),
        },
      ];

    case "instagram_account":
      return [
        {
          step: "sell_q_ig_followers",
          prompt: `*Step 1 of 6 — Followers* 👥\n\nHow many followers does this Instagram account have?\n\nExamples: _10,000_, _100K_, _500K_\n\nType your answer:`,
        },
        {
          step: "sell_q_ig_age",
          prompt: `*Step 2 of 6 — Account Age* 📅\n\nHow old is this Instagram account?\n\nExamples: _1 year_, _4 years_\n\nType your answer:`,
        },
        {
          step: "sell_q_ig_niche",
          prompt: `*Step 3 of 6 — Niche* 🏷️\n\nWhat niche does this account focus on?\n\nExamples: _Fashion_, _Fitness_, _Food_, _Travel_, _Memes_\n\nType your answer:`,
        },
        {
          step: "sell_q_ig_monetized",
          prompt: `*Step 4 of 6 — Monetization* 💰\n\nIs this account eligible for or enrolled in Instagram's Creator monetization?`,
          buttons: [
            { id: "IG_MON_YES", title: "✅ Yes — monetized" },
            { id: "IG_MON_NO", title: "❌ Not monetized" },
          ],
        },
        {
          step: "sell_q_ig_restricted",
          prompt: `*Step 5 of 6 — Account Status* ⚠️\n\nDoes this account have any restrictions or policy strikes?`,
          buttons: [
            { id: "IG_RES_NO", title: "✅ Clean account" },
            { id: "IG_RES_YES", title: "⚠️ Has restrictions" },
          ],
        },
        {
          ...COUNTRY_QUESTION,
          prompt: COUNTRY_QUESTION.prompt.replace("Final Step", "Step 6 of 6"),
        },
      ];

    case "tiktok_account":
      return [
        {
          step: "sell_q_tt_followers",
          prompt: `*Step 1 of 6 — Followers* 👥\n\nHow many followers does this TikTok account have?\n\nExamples: _10,000_, _100K_, _1M_\n\nType your answer:`,
        },
        {
          step: "sell_q_tt_age",
          prompt: `*Step 2 of 6 — Account Age* 📅\n\nHow old is this TikTok account?\n\nExamples: _1 year_, _3 years_\n\nType your answer:`,
        },
        {
          step: "sell_q_tt_niche",
          prompt: `*Step 3 of 6 — Niche* 🏷️\n\nWhat niche or content type does this account post?\n\nExamples: _Comedy_, _Dance_, _Finance_, _Lifestyle_\n\nType your answer:`,
        },
        {
          step: "sell_q_tt_monetized",
          prompt: `*Step 4 of 6 — Monetization* 💰\n\nIs this account in the TikTok Creator Fund, LIVE Gifts, or Series program?`,
          buttons: [
            { id: "TT_MON_YES", title: "✅ Yes — monetized" },
            { id: "TT_MON_NO", title: "❌ Not monetized" },
          ],
        },
        {
          step: "sell_q_tt_lives",
          prompt: `*Step 5 of 6 — LIVE Access* 🔴\n\nDoes this account have TikTok LIVE enabled?`,
          buttons: [
            { id: "TT_LIVE_YES", title: "✅ LIVE enabled" },
            { id: "TT_LIVE_NO", title: "❌ No LIVE access" },
          ],
        },
        {
          ...COUNTRY_QUESTION,
          prompt: COUNTRY_QUESTION.prompt.replace("Final Step", "Step 6 of 6"),
        },
      ];

    case "adsense_site":
      return [
        {
          step: "sell_q_ads_age",
          prompt: `*Step 1 of 6 — Account Age* 📅\n\nHow old is this AdSense account?\n\nExamples: _1 year_, _3 years_\n\nType your answer:`,
        },
        {
          step: "sell_q_ads_payment",
          prompt: `*Step 2 of 6 — Payment History* 💵\n\nHas AdSense ever made a payment to this account?`,
          buttons: [
            { id: "ADS_PAY_YES", title: "✅ Yes — received payment" },
            { id: "ADS_PAY_THRESH", title: "⏳ At threshold, not paid" },
            { id: "ADS_PAY_NO", title: "❌ No payments yet" },
          ],
        },
        {
          step: "sell_q_ads_earnings",
          prompt: `*Step 3 of 6 — Monthly Earnings* 💰\n\nApproximate monthly earnings?\n\nEnter numbers only.\nExamples: _20_, _200_, _500_\n\nType your answer:`,
        },
        {
          step: "sell_q_ads_url",
          prompt: `*Step 4 of 6 — Website URL* 🌐\n\nWhat is the URL of the site attached to this AdSense account?\n\nExample: _myblog.com_\n\nType your answer (or type *NONE*):`,
        },
        {
          step: "sell_q_ads_violations",
          prompt: `*Step 5 of 6 — Policy Violations* ⚠️\n\nDoes this AdSense account have any policy violations?`,
          buttons: [
            { id: "ADS_VIO_NO", title: "✅ No violations" },
            { id: "ADS_VIO_YES", title: "⚠️ Has violations" },
          ],
        },
        {
          ...COUNTRY_QUESTION,
          prompt: COUNTRY_QUESTION.prompt.replace("Final Step", "Step 6 of 6"),
        },
      ];

    case "play_console":
      return [
        {
          step: "sell_q_play_age",
          prompt: `*Step 1 of 5 — Account Age* 📅\n\nHow old is this Play Console account?\n\nExamples: _1 year_, _5 years_\n\nType your answer:`,
        },
        {
          step: "sell_q_play_apps",
          prompt: `*Step 2 of 5 — Published Apps* 📱\n\nHow many apps are published and what are their names?\n\nExamples: _2 apps — CleanMaster, VPN Pro_\n\nType your answer:`,
        },
        {
          step: "sell_q_play_revenue",
          prompt: `*Step 3 of 5 — Monthly Revenue* 💵\n\nApproximate monthly revenue from all apps combined?\n\nEnter numbers only or type *NONE*.\n\nType your answer:`,
        },
        {
          step: "sell_q_play_suspended",
          prompt: `*Step 4 of 5 — Account Status* ⚠️\n\nHas this Play Console account ever been suspended or had apps removed?`,
          buttons: [
            { id: "PLAY_SUSP_NO", title: "✅ Clean account" },
            { id: "PLAY_SUSP_YES", title: "⚠️ Had issues" },
          ],
        },
        {
          ...COUNTRY_QUESTION,
          prompt: COUNTRY_QUESTION.prompt.replace("Final Step", "Step 5 of 5"),
        },
      ];

    case "gift_card":
      return [
        {
          step: "sell_q_gc_brand",
          prompt: `*Step 1 of 3 — Card Brand* 🎁\n\nWhat brand is this gift card?\n\nExamples: _Amazon_, _iTunes/Apple_, _Steam_, _Google Play_, _Visa_\n\nType your answer:`,
        },
        {
          step: "sell_q_gc_value",
          prompt: `*Step 2 of 3 — Card Value* 💵\n\nWhat is the face value of this card?\n\nExamples: _$50_, _$100_, _£25_\n\nType your answer:`,
        },
        {
          step: "sell_q_gc_currency",
          prompt: `*Step 3 of 3 — Card Region* 🌍\n\nWhat region/country is this card valid for?\n\nExamples: _USA_, _UK_, _Global_\n\nType your answer:`,
        },
      ];

    default:
      return [];
  }
}

// ─── Build description from answers ──────────────────────────────────────────
function buildDescription(type: string, data: Record<string, any>): string {
  const yesNo = (val: string, yesId: string) => (val === yesId ? "Yes" : "No");
  const country = data.sell_q_country
    ? ` | Country: ${data.sell_q_country}`
    : "";

  switch (type) {
    case "google_ad_account":
      return (
        [
          `Age: ${data.sell_q_gads_age}`,
          `Total spend: ${data.sell_q_gads_spend}`,
          `Currency: ${data.sell_q_gads_currency}`,
          `Niche: ${data.sell_q_gads_niche}`,
          `Suspended: ${yesNo(data.sell_q_gads_suspended, "GADS_SUSP_YES")}`,
        ].join(" | ") + country
      );

    case "facebook_ad_account":
      return (
        [
          `Age: ${data.sell_q_meta_age}`,
          `Spend limit: ${data.sell_q_meta_limit}`,
          `Business Manager: ${yesNo(data.sell_q_meta_bm, "META_BM_YES")}`,
          `Pixel attached: ${yesNo(data.sell_q_meta_pixel, "META_PIX_YES")}`,
          `Restrictions: ${yesNo(data.sell_q_meta_restricted, "META_RES_YES")}`,
        ].join(" | ") + country
      );

    case "twitter_account":
      return (
        [
          `Followers: ${data.sell_q_tw_followers}`,
          `Age: ${data.sell_q_tw_age}`,
          `Niche: ${data.sell_q_tw_niche}`,
          `Monetized: ${yesNo(data.sell_q_tw_monetized, "TW_MON_YES")}`,
          `Suspended: ${yesNo(data.sell_q_tw_suspended, "TW_SUSP_YES")}`,
        ].join(" | ") + country
      );

    case "instagram_account":
      return (
        [
          `Followers: ${data.sell_q_ig_followers}`,
          `Age: ${data.sell_q_ig_age}`,
          `Niche: ${data.sell_q_ig_niche}`,
          `Monetized: ${yesNo(data.sell_q_ig_monetized, "IG_MON_YES")}`,
          `Restricted: ${yesNo(data.sell_q_ig_restricted, "IG_RES_YES")}`,
        ].join(" | ") + country
      );

    case "tiktok_account":
      return (
        [
          `Followers: ${data.sell_q_tt_followers}`,
          `Age: ${data.sell_q_tt_age}`,
          `Niche: ${data.sell_q_tt_niche}`,
          `Monetized: ${yesNo(data.sell_q_tt_monetized, "TT_MON_YES")}`,
          `LIVE access: ${yesNo(data.sell_q_tt_lives, "TT_LIVE_YES")}`,
        ].join(" | ") + country
      );

    case "adsense_site":
      return (
        [
          `Age: ${data.sell_q_ads_age}`,
          `Payment: ${data.sell_q_ads_payment === "ADS_PAY_YES" ? "Received" : data.sell_q_ads_payment === "ADS_PAY_THRESH" ? "At threshold" : "None yet"}`,
          `Monthly earnings: $${data.sell_q_ads_earnings}/mo`,
          `Site: ${data.sell_q_ads_url?.toUpperCase() === "NONE" ? "Not included" : data.sell_q_ads_url}`,
          `Violations: ${yesNo(data.sell_q_ads_violations, "ADS_VIO_YES")}`,
        ].join(" | ") + country
      );

    case "play_console":
      return (
        [
          `Age: ${data.sell_q_play_age}`,
          `Apps: ${data.sell_q_play_apps}`,
          `Monthly revenue: ${data.sell_q_play_revenue?.toUpperCase() === "NONE" ? "No revenue" : `$${data.sell_q_play_revenue}/mo`}`,
          `Suspended: ${yesNo(data.sell_q_play_suspended, "PLAY_SUSP_YES")}`,
        ].join(" | ") + country
      );

    case "gift_card":
      return [
        `Brand: ${data.sell_q_gc_brand}`,
        `Value: ${data.sell_q_gc_value}`,
        `Region: ${data.sell_q_gc_currency}`,
      ].join(" | ");

    default:
      return "";
  }
}

// ─── Map question answers to Listing model fields ─────────────────────────────
// Only includes fields that exist on the IListing interface.
function buildListingFields(
  type: string,
  data: Record<string, any>,
): Record<string, any> {
  const country =
    type !== "gift_card" && data.sell_q_country
      ? { accountCountry: data.sell_q_country }
      : {};

  switch (type) {
    case "google_ad_account":
      return {
        ...country,
        googleAdsAccountAge: data.sell_q_gads_age,
        googleAdsSpend: data.sell_q_gads_spend,
        googleAdsCurrency: data.sell_q_gads_currency,
        googleAdsNiche: data.sell_q_gads_niche,
        googleAdsSuspended: data.sell_q_gads_suspended === "GADS_SUSP_YES",
      };

    case "facebook_ad_account":
      return {
        ...country,
        metaAccountAge: data.sell_q_meta_age,
        metaSpendLimit: data.sell_q_meta_limit,
        metaBusinessManager: data.sell_q_meta_bm === "META_BM_YES",
        metaPixelAttached: data.sell_q_meta_pixel === "META_PIX_YES",
        metaRestricted: data.sell_q_meta_restricted === "META_RES_YES",
      };

    case "twitter_account":
      return {
        ...country,
        twitterFollowers: data.sell_q_tw_followers,
        twitterAge: data.sell_q_tw_age,
        twitterNiche: data.sell_q_tw_niche,
        twitterMonetized: data.sell_q_tw_monetized === "TW_MON_YES",
        twitterSuspended: data.sell_q_tw_suspended === "TW_SUSP_YES",
      };

    case "instagram_account":
      return {
        ...country,
        instagramFollowers: data.sell_q_ig_followers,
        instagramAge: data.sell_q_ig_age,
        instagramNiche: data.sell_q_ig_niche,
        instagramMonetized: data.sell_q_ig_monetized === "IG_MON_YES",
        instagramRestricted: data.sell_q_ig_restricted === "IG_RES_YES",
      };

    case "tiktok_account":
      return {
        ...country,
        tiktokFollowers: data.sell_q_tt_followers,
        tiktokAge: data.sell_q_tt_age,
        tiktokNiche: data.sell_q_tt_niche,
        tiktokMonetized: data.sell_q_tt_monetized === "TT_MON_YES",
        tiktokLives: data.sell_q_tt_lives === "TT_LIVE_YES",
      };

    case "adsense_site":
      return {
        ...country,
        adsenseAge: data.sell_q_ads_age,
        adsensePaymentStatus:
          data.sell_q_ads_payment === "ADS_PAY_YES"
            ? "received"
            : data.sell_q_ads_payment === "ADS_PAY_THRESH"
              ? "threshold"
              : "none",
        adsenseMonthlyEarnings: data.sell_q_ads_earnings,
        adsenseSiteUrl:
          data.sell_q_ads_url?.toUpperCase() === "NONE"
            ? undefined
            : data.sell_q_ads_url,
        adsenseViolations: data.sell_q_ads_violations === "ADS_VIO_YES",
      };

    case "play_console":
      return {
        ...country,
        playConsoleAge: data.sell_q_play_age,
        playConsoleApps: data.sell_q_play_apps,
        playConsoleRevenue: data.sell_q_play_revenue,
        playConsoleSuspended: data.sell_q_play_suspended === "PLAY_SUSP_YES",
      };

    case "gift_card":
      return {
        giftCardBrand: data.sell_q_gc_brand,
        giftCardValue: data.sell_q_gc_value,
        giftCardCurrency: data.sell_q_gc_currency,
      };

    default:
      return {};
  }
}

// ─── Screenshot requirements per type ────────────────────────────────────────
function screenshotGuide(type: string): string {
  switch (type) {
    case "google_ad_account":
      return `📸 *Required screenshots:*\n1. Google Ads dashboard (account overview visible)\n2. Billing summary showing spend history\n3. Account email address visible`;
    case "facebook_ad_account":
      return `📸 *Required screenshots:*\n1. Facebook Ads Manager overview\n2. Billing or payment history\n3. Account email and spend limit visible`;
    case "twitter_account":
      return `📸 *Required screenshots:*\n1. Profile page showing follower count and handle\n2. Account analytics or post engagement\n3. Account email visible in settings`;
    case "instagram_account":
      return `📸 *Required screenshots:*\n1. Profile page showing follower count and username\n2. Account insights or post reach\n3. Account email visible in settings`;
    case "tiktok_account":
      return `📸 *Required screenshots:*\n1. Profile page showing follower count and username\n2. Creator dashboard or analytics\n3. Account email visible in settings`;
    case "adsense_site":
      return `📸 *Required screenshots:*\n1. AdSense dashboard (account status visible)\n2. Payment history page\n3. Account email visible`;
    case "play_console":
      return `📸 *Required screenshots:*\n1. Play Console dashboard showing published apps\n2. Revenue or stats overview\n3. Account email visible`;
    case "gift_card":
      return `📸 *Required screenshots:*\n1. Front of the gift card (with code hidden/blurred)\n2. Balance check screenshot if available\n3. Receipt or purchase proof`;
    default:
      return `📸 Send screenshots that clearly show the account details.`;
  }
}

// ─── Admin alert ──────────────────────────────────────────────────────────────
function buildAdminAlert(
  listingId: string,
  phone: string,
  data: Record<string, any>,
  extra: Record<string, any>,
  screenshots: number,
  sellerReceives: number,
  buyerPays: number,
  fee: number,
): string {
  const typeLabel = TYPE_LABELS[data.type] ?? data.type;

  let details = "";
  switch (data.type) {
    case "google_ad_account":
      details = [
        extra.googleAdsAccountAge && `📅 Age: ${extra.googleAdsAccountAge}`,
        extra.googleAdsSpend && `💸 Spend: ${extra.googleAdsSpend}`,
        extra.googleAdsCurrency && `💱 Currency: ${extra.googleAdsCurrency}`,
        extra.googleAdsNiche && `🏷️ Niche: ${extra.googleAdsNiche}`,
        extra.accountCountry && `🌍 Country: ${extra.accountCountry}`,
        `⚠️ Suspended: ${extra.googleAdsSuspended ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("\n");
      break;
    case "facebook_ad_account":
      details = [
        extra.metaAccountAge && `📅 Age: ${extra.metaAccountAge}`,
        extra.metaSpendLimit && `💳 Limit: ${extra.metaSpendLimit}`,
        `🏢 BM: ${extra.metaBusinessManager ? "Yes" : "No"}`,
        `📊 Pixel: ${extra.metaPixelAttached ? "Yes" : "No"}`,
        extra.accountCountry && `🌍 Country: ${extra.accountCountry}`,
        `⚠️ Restricted: ${extra.metaRestricted ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("\n");
      break;
    case "twitter_account":
      details = [
        extra.twitterFollowers && `👥 Followers: ${extra.twitterFollowers}`,
        extra.twitterAge && `📅 Age: ${extra.twitterAge}`,
        extra.twitterNiche && `🏷️ Niche: ${extra.twitterNiche}`,
        extra.accountCountry && `🌍 Country: ${extra.accountCountry}`,
        `💰 Monetized: ${extra.twitterMonetized ? "Yes" : "No"}`,
        `⚠️ Suspended: ${extra.twitterSuspended ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("\n");
      break;
    case "instagram_account":
      details = [
        extra.instagramFollowers && `👥 Followers: ${extra.instagramFollowers}`,
        extra.instagramAge && `📅 Age: ${extra.instagramAge}`,
        extra.instagramNiche && `🏷️ Niche: ${extra.instagramNiche}`,
        extra.accountCountry && `🌍 Country: ${extra.accountCountry}`,
        `💰 Monetized: ${extra.instagramMonetized ? "Yes" : "No"}`,
        `⚠️ Restricted: ${extra.instagramRestricted ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("\n");
      break;
    case "tiktok_account":
      details = [
        extra.tiktokFollowers && `👥 Followers: ${extra.tiktokFollowers}`,
        extra.tiktokAge && `📅 Age: ${extra.tiktokAge}`,
        extra.tiktokNiche && `🏷️ Niche: ${extra.tiktokNiche}`,
        extra.accountCountry && `🌍 Country: ${extra.accountCountry}`,
        `💰 Monetized: ${extra.tiktokMonetized ? "Yes" : "No"}`,
        `🔴 LIVE access: ${extra.tiktokLives ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("\n");
      break;
    case "adsense_site":
      details = [
        extra.adsenseAge && `📅 Age: ${extra.adsenseAge}`,
        extra.adsenseMonthlyEarnings &&
          `💰 Earnings: $${extra.adsenseMonthlyEarnings}/mo`,
        extra.adsensePaymentStatus &&
          `💵 Payment: ${extra.adsensePaymentStatus}`,
        extra.adsenseSiteUrl && `🌐 Site: ${extra.adsenseSiteUrl}`,
        extra.accountCountry && `🌍 Country: ${extra.accountCountry}`,
        `⚠️ Violations: ${extra.adsenseViolations ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("\n");
      break;
    case "play_console":
      details = [
        extra.playConsoleAge && `📅 Age: ${extra.playConsoleAge}`,
        extra.playConsoleApps && `📱 Apps: ${extra.playConsoleApps}`,
        extra.playConsoleRevenue &&
          `💵 Revenue: $${extra.playConsoleRevenue}/mo`,
        extra.accountCountry && `🌍 Country: ${extra.accountCountry}`,
        `⚠️ Suspended: ${extra.playConsoleSuspended ? "Yes" : "No"}`,
      ]
        .filter(Boolean)
        .join("\n");
      break;
    case "gift_card":
      details = [
        extra.giftCardBrand && `🎁 Brand: ${extra.giftCardBrand}`,
        extra.giftCardValue && `💵 Value: ${extra.giftCardValue}`,
        extra.giftCardCurrency && `🌍 Region: ${extra.giftCardCurrency}`,
      ]
        .filter(Boolean)
        .join("\n");
      break;
  }

  return (
    `🔔 *New Listing — Review Required*\n\n` +
    `🆔 ${listingId}\n` +
    `📦 ${typeLabel}\n` +
    `💰 Seller asking: ₦${sellerReceives.toLocaleString()}\n` +
    `💳 Buyer pays: ₦${buyerPays.toLocaleString()} _(incl. ₦${fee.toLocaleString()} fee)_\n` +
    `📱 Seller: ${phone}\n` +
    `📸 Screenshots: ${screenshots}\n\n` +
    `${details}\n\n` +
    `─────────────────\n` +
    `Approve or reject on the dashboard.`
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function handleSell(
  phone: string,
  text: string,
  session: ISession,
  mediaId?: string,
): Promise<void> {
  const step = session.step;
  const data = session.data;

  // ── Entry ──────────────────────────────────────────────────────────────────
  if (text === "SELL") {
    if (step === 'sell_type' && data.linkedRequestType) {
  const typeKey = data.linkedRequestType;
  await setSession(phone, 'sell_price', {
    type:              typeKey,
    linkedRequestId:   data.linkedRequestId,
    linkedRequestType: data.linkedRequestType,
  });
  return sendMessage(phone,
    `✅ *${TYPE_LABELS[typeKey]}* selected.\n\n` +
    `What is your asking price in Naira (₦)?\n\n` +
    `Enter numbers only — no commas or symbols.\n` +
    `Example: *75000*\n\n` +
    `Minimum: ₦1,000\n\n` +
    `💡 You will receive this *full amount* minus AdSwap's service fee.\n\n` +
    `Type *CANCEL* to exit.`,
  );
}
    await setSession(phone, "sell_type", {});
    return sendMessage(
      phone,
      `💰 *List an Account or Asset for Sale*\n\n` +
        `What are you selling?\n\n` +
        `1️⃣  Google Ads Account\n` +
        `2️⃣  Facebook/Meta Ads Account\n` +
        `3️⃣  AdSense Monetised Site\n` +
        `4️⃣  Google Play Console Account\n` +
        `5️⃣  Gift Card\n` +
        `6️⃣  Twitter / X Account\n` +
        `7️⃣  Instagram Account\n` +
        `8️⃣  TikTok Account\n\n` +
        `Reply with a number (1–8)\n\n` +
        `💡 *Listing is free.* Swappa adds a small service fee to the buyer's price — you receive your full asking amount.\n\n` +
        `🔒 All sales are processed through *Koji Agudah escrow* for your protection.\n\n` +
        `Type *CANCEL* to go back.`,
    );
  }

  // ── Select type ────────────────────────────────────────────────────────────
  if (step === "sell_type") {
    const typeKey = TYPE_MAP[text];
    if (!typeKey)
      return sendMessage(phone, "❌ Please reply with a number from 1 to 8.");
    await setSession(phone, "sell_price", {
      type: typeKey,
      linkedRequestId: data.linkedRequestId,
      linkedRequestType: data.linkedRequestType,
    });
    return sendMessage(
      phone,
      `✅ *${TYPE_LABELS[typeKey]}* selected.\n\n` +
        `What is your asking price in Naira (₦)?\n\n` +
        `Enter numbers only — no commas or symbols.\n` +
        `Example: *75000*\n\n` +
        `Minimum: ₦1,000\n\n` +
        `💡 You will receive this *full amount*. Swappa's service fee is added on top for the buyer.\n\n` +
        `Type *CANCEL* to exit.`,
    );
  }

  // ── Set price ──────────────────────────────────────────────────────────────
  if (step === "sell_price") {
    const price = parseInt(text.replace(/[,₦\s]/g, ""), 10);
    if (isNaN(price) || price < 1000) {
      return sendMessage(
        phone,
        "❌ Invalid price. Minimum is ₦1,000.\n\nEnter numbers only — example: 75000",
      );
    }
    const { fee, rate, sellerReceives } = calcFee(price);
    await setSession(phone, "sell_questions", { type: data.type, price });
    return sendMessage(
      phone,
      `✅ *Price set: ₦${price.toLocaleString()}*\n\n` +
        `Buyer pays: *₦${price.toLocaleString()}*\n` +
        `Swappa fee (${rate}%): *₦${fee.toLocaleString()}* — deducted from your payout\n` +
        `You receive: *₦${sellerReceives.toLocaleString()}* after fee\n\n` +
        `🔒 Payment is handled via *Koji Agudah escrow* — funds are held securely until the buyer confirms access.\n\n` +
        `Now I'll ask a few quick questions about the account.\n` +
        `This helps buyers trust your listing.\n\n` +
        `Type *CANCEL* at any time to exit.`,
    );
  }

  // ── Start questionnaire ────────────────────────────────────────────────────
  if (step === "sell_questions") {
    const questions = getQuestions(data.type);
    const firstQ = questions[0];
    if (!firstQ) {
      await setSession(phone, "sell_screenshots", {
        ...data,
        description: "",
        screenshots: [],
      });
      return sendMessage(
        phone,
        `${screenshotGuide(data.type)}\n\nSend images one by one.\nType *DONE* when finished.`,
      );
    }
    await setSession(phone, firstQ.step, { ...data });
    return firstQ.buttons
      ? sendButtons(phone, firstQ.prompt, firstQ.buttons)
      : sendMessage(phone, firstQ.prompt);
  }

  // ── Questionnaire steps ────────────────────────────────────────────────────
  if (step.startsWith("sell_q_")) {
    const questions = getQuestions(data.type);
    const currentIdx = questions.findIndex((q) => q.step === step);
    if (currentIdx === -1) {
      await clearSession(phone);
      return sendMessage(
        phone,
        "❌ Something went wrong. Type *SELL* to start again.",
      );
    }

    const updatedData = { ...data, [step]: text };
    const nextQ = questions[currentIdx + 1];

    if (nextQ) {
      await setSession(phone, nextQ.step, updatedData);
      return nextQ.buttons
        ? sendButtons(phone, nextQ.prompt, nextQ.buttons)
        : sendMessage(phone, nextQ.prompt);
    }

    // All questions answered — move to screenshots
    const description = buildDescription(data.type, updatedData);
    await setSession(phone, "sell_screenshots", {
      ...updatedData,
      description,
      screenshots: [],
    });

    return sendMessage(
      phone,
      `✅ *Details confirmed!*\n\n` +
        `*${TYPE_LABELS[updatedData.type]}*\n` +
        `Your price: ₦${Number(updatedData.price).toLocaleString()}\n\n` +
        `Now send your verification screenshots. 📸\n\n` +
        `${screenshotGuide(data.type)}\n\n` +
        `Send images one by one.\n` +
        `Type *DONE* when finished.`,
    );
  }

  // ── Collect screenshots ────────────────────────────────────────────────────
  if (step === "sell_screenshots") {
    if (mediaId) {
      await sendMessage(phone, `⏳ Uploading screenshot...`);
      try {
        const url = await uploadScreenshot(mediaId, `listings/${phone}`);
        const screenshots = [...(data.screenshots || []), url];
        await updateSessionData(phone, { screenshots });
        return sendMessage(
          phone,
          `✅ Screenshot ${screenshots.length} saved.\n\nSend more or type *DONE* when finished.`,
        );
      } catch (err) {
        console.error("[SELL] Screenshot upload error:", err);
        return sendMessage(
          phone,
          "❌ Upload failed. Please try sending the image again.",
        );
      }
    }

    if (text === "DONE") {
      const screenshots = data.screenshots || [];
      if (screenshots.length < 1) {
        return sendMessage(
          phone,
          "❌ Please send at least 1 screenshot before typing DONE.",
        );
      }

      try {
        const user = await User.findOneAndUpdate(
          { phone },
          { $setOnInsert: { phone } },
          { upsert: true, new: true },
        );

        const listingId = `ADS-${generateId(5)}`;
        const { fee, rate, sellerReceives } = calcFee(data.price);
        const expiresAt = new Date(
          Date.now() + LISTING_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        );
        const extraFields = buildListingFields(data.type, data);
        const buyerPays = data.price;

        // All fields mapped to exact IListing schema properties
        await Listing.create({
          listingId,
          seller: user._id,
          type: data.type,
          price: data.price, // what buyer pays (the listed price)
          platformFee: fee, // Swappa cut deducted from seller
          buyerPays: buyerPays, // buyer pays the listed price exactly
          sellerReceives,
          description: data.description,
          screenshotUrls: screenshots,
          status: "pending_verification",
          expiresAt,
          ...extraFields, // type-specific fields from buildListingFields
        });

        const linkedRequestId = data.linkedRequestId;
        if (linkedRequestId) {
          const req = await Request.findOne({
            requestId: linkedRequestId,
            status: "open",
          }).populate<{ requester: any }>("requester");

          if (req) {
            // Track respondent
            await Request.updateOne(
              { _id: req._id },
              { $addToSet: { respondents: user._id } },
            );

            // Notify the requester
            const label = TYPE_LABELS[req.type] ?? req.type;
            await sendMessage(
              req.requester.phone,
              `🔔 *Someone responded to your request!*\n\n` +
                `You requested a *${label}* (Ref: ${linkedRequestId}).\n\n` +
                `A seller has listed a matching asset:\n` +
                `\`VIEW ${listingId}\`\n\n` +
                `The listing is pending verification — you'll be notified again once it goes live.\n\n` +
                `🔒 All purchases are protected by *Koji Agudah escrow*.`,
            ).catch(() => {});
          }
        }

        await sendMessage(
          process.env.SUPPORT_PHONE!,
          buildAdminAlert(
            listingId,
            phone,
            data,
            extraFields,
            screenshots.length,
            sellerReceives,
            buyerPays,
            fee,
          ),
        ).catch((err) => console.error("[SELL] Admin notify error:", err));

        await clearSession(phone);

        return sendMessage(
          phone,
          `🎉 *Listing submitted!*\n\n` +
            `Listing ID: *${listingId}*\n` +
            `Type: ${TYPE_LABELS[data.type]}\n` +
            `Your asking price: ₦${data.price.toLocaleString()}\n` +
            `Buyer pays: ₦${data.price.toLocaleString()}\n` +
            `You receive: ₦${sellerReceives.toLocaleString()} _(after ₦${fee.toLocaleString()} Swappa fee)_\n\n` +
            `⏳ Admin will review your listing within *24 hours*.\n` +
            `You'll get a WhatsApp notification once it goes live.\n\n` +
            `🔒 When a buyer is ready, payment will be handled through *Koji Agudah escrow* — your funds are protected until the deal is confirmed.\n\n` +
            `Questions? Type *HELP*`,
        );
      } catch (err) {
        console.error("[SELL] DONE handler error:", err);
        return sendMessage(
          phone,
          "❌ Something went wrong saving your listing. Please try again or type *HELP*.",
        );
      }
    }

    return sendMessage(
      phone,
      "Please send a screenshot image, or type *DONE* when finished.",
    );
  }
}
