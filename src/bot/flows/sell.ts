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
import { track } from "../../services/analytics";

// ─── Fee calculation ──────────────────────────────────────────────────────────
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

// ─── Reseller summary ─────────────────────────────────────────────────────────
// Fee is calculated on the total listed price (basePrice + commission) since
// that is what goes into Listing.price and what the buyer actually pays.
// The reseller keeps their commission; Swappa's cut comes out of the base.
function buildResellerSummary(
  basePrice: number,
  commission: number,
): string {
  const totalPrice = basePrice + commission;
  const { fee, rate } = calcFee(totalPrice);
  const resellerReceives = totalPrice - fee; // what escrow releases to the "seller" (reseller)
  return (
    `💰 Owner's asking price:  ₦${basePrice.toLocaleString()}\n` +
    `➕ Your commission:       ₦${commission.toLocaleString()}\n` +
    `━━━━━━━━━━━━━━━━━━━\n` +
    `💳 Buyer pays:            ₦${totalPrice.toLocaleString()}\n` +
    `✂️  Swappa fee (${rate}%):   ₦${fee.toLocaleString()}\n` +
    `💸 You receive:           ₦${resellerReceives.toLocaleString()}\n` +
    `🤝 Your commission earn:  ₦${commission.toLocaleString()}`
  );
}

// ─── Escrow provider labels ───────────────────────────────────────────────────
const ESCROW_LABELS: Record<string, string> = {
  koji_agudah:      "Koji Agudah",
  nauman_chaudhary: "Nauman Chaudhary",
  swappa_native:    "Swappa Native Escrow",
};

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
          prompt: `*Step 1 of 8 — Account Age* 📅\n\nHow long has this Google Ads account been active?\n\nExamples: _3 months_, _1 year_, _4 years_\n\nType your answer:`,
        },
        {
          step: "sell_q_gads_spend",
          prompt: `*Step 2 of 8 — Total Spend* 💸\n\nHow much money has been spent running ads on this account in total, from when it was created until now?\n\nExamples: _$500_, _$10,000_, _$50,000+_\n\nType your answer:`,
        },
        {
          step: "sell_q_gads_currency",
          prompt: `*Step 3 of 8 — Billing Currency* 💱\n\nWhat currency is this account billed in?\n\nExamples: _USD_, _GBP_, _NGN_, _EUR_\n\nType your answer:`,
        },
        {
          step: "sell_q_gads_niche",
          prompt: `*Step 4 of 8 — Account Niche* 🏷️\n\nWhat niche or industry were ads running in?\n\nExamples: _E-commerce_, _Finance_, _Real Estate_, _Health_\n\nType your answer:`,
        },
        {
          step: "sell_q_gads_verified",
          prompt: `*Step 5 of 8 — Advertiser Verification* 🪪\n\nHas this account completed Google's advertiser identity verification?`,
          buttons: [
            { id: "GADS_VER_YES", title: "✅ Yes — verified" },
            { id: "GADS_VER_NO",  title: "❌ Not verified" },
          ],
        },
        {
          step: "sell_q_gads_campaigns",
          prompt: `*Step 6 of 8 — Active Campaigns* 📢\n\nDoes this account have any active or recently running campaigns?`,
          buttons: [
            { id: "GADS_CAMP_YES", title: "✅ Yes — has campaigns" },
            { id: "GADS_CAMP_NO",  title: "❌ No active campaigns" },
          ],
        },
        {
          step: "sell_q_gads_suspended",
          prompt: `*Step 7 of 8 — Account Status* ⚠️\n\nHas this account ever been suspended or restricted?`,
          buttons: [
            { id: "GADS_SUSP_NO",  title: "✅ No issues" },
            { id: "GADS_SUSP_YES", title: "⚠️ Was suspended" },
          ],
        },
        {
          ...COUNTRY_QUESTION,
          prompt: COUNTRY_QUESTION.prompt.replace("Final Step", "Step 8 of 8"),
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
            { id: "META_BM_NO",  title: "❌ No — personal" },
          ],
        },
        {
          step: "sell_q_meta_pixel",
          prompt: `*Step 4 of 6 — Facebook Pixel* 📊\n\nIs a Facebook Pixel attached to this account?`,
          buttons: [
            { id: "META_PIX_YES", title: "✅ Yes" },
            { id: "META_PIX_NO",  title: "❌ No pixel" },
          ],
        },
        {
          step: "sell_q_meta_restricted",
          prompt: `*Step 5 of 6 — Restrictions* ⚠️\n\nDoes this account have any restrictions or policy violations?`,
          buttons: [
            { id: "META_RES_NO",  title: "✅ Clean account" },
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
            { id: "TW_MON_NO",  title: "❌ Not monetized" },
          ],
        },
        {
          step: "sell_q_tw_suspended",
          prompt: `*Step 5 of 6 — Account Status* ⚠️\n\nHas this account ever been suspended or restricted?`,
          buttons: [
            { id: "TW_SUSP_NO",  title: "✅ Never suspended" },
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
            { id: "IG_MON_NO",  title: "❌ Not monetized" },
          ],
        },
        {
          step: "sell_q_ig_restricted",
          prompt: `*Step 5 of 6 — Account Status* ⚠️\n\nDoes this account have any restrictions or policy strikes?`,
          buttons: [
            { id: "IG_RES_NO",  title: "✅ Clean account" },
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
            { id: "TT_MON_NO",  title: "❌ Not monetized" },
          ],
        },
        {
          step: "sell_q_tt_lives",
          prompt: `*Step 5 of 6 — LIVE Access* 🔴\n\nDoes this account have TikTok LIVE enabled?`,
          buttons: [
            { id: "TT_LIVE_YES", title: "✅ LIVE enabled" },
            { id: "TT_LIVE_NO",  title: "❌ No LIVE access" },
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
          prompt: `*Step 1 of 8 — Account Age* 📅\n\nHow old is this AdSense account?\n\nExamples: _1 year_, _3 years_\n\nType your answer:`,
        },
        {
          step: "sell_q_ads_payment",
          prompt: `*Step 2 of 8 — Payment History* 💵\n\nHas AdSense ever made a payment to this account?`,
          buttons: [
            { id: "ADS_PAY_YES",    title: "✅ Yes — received payment" },
            { id: "ADS_PAY_THRESH", title: "⏳ At threshold, not paid" },
            { id: "ADS_PAY_NO",     title: "❌ No payments yet" },
          ],
        },
        {
          step: "sell_q_ads_earnings",
          prompt: `*Step 3 of 8 — Monthly Earnings* 💰\n\nApproximate monthly earnings?\n\nEnter numbers only.\nExamples: _20_, _200_, _500_\n\nType your answer:`,
        },
        {
          step: "sell_q_ads_url",
          prompt: `*Step 4 of 8 — Website URL* 🌐\n\nWhat is the URL of the site attached to this AdSense account?\n\nExample: _myblog.com_\n\nType your answer (or type *NONE*):`,
        },
        {
          step: "sell_q_ads_domain",
          prompt: `*Step 5 of 8 — Domain Included* 🔗\n\nIs the domain/website included in this sale?`,
          buttons: [
            { id: "ADS_DOM_YES", title: "✅ Yes — domain included" },
            { id: "ADS_DOM_NO",  title: "❌ No — AdSense only" },
          ],
        },
        {
          step: "sell_q_ads_verified",
          prompt: `*Step 6 of 8 — Identity Verified* 🪪\n\nIs this AdSense account identity-verified with Google?`,
          buttons: [
            { id: "ADS_VER_YES", title: "✅ Yes — fully verified" },
            { id: "ADS_VER_NO",  title: "❌ Not verified" },
          ],
        },
        {
          step: "sell_q_ads_violations",
          prompt: `*Step 7 of 8 — Policy Violations* ⚠️\n\nDoes this AdSense account have any policy violations?`,
          buttons: [
            { id: "ADS_VIO_NO",  title: "✅ No violations" },
            { id: "ADS_VIO_YES", title: "⚠️ Has violations" },
          ],
        },
        {
          ...COUNTRY_QUESTION,
          prompt: COUNTRY_QUESTION.prompt.replace("Final Step", "Step 8 of 8"),
        },
      ];

    case "play_console":
      return [
        {
          step: "sell_q_play_age",
          prompt: `*Step 1 of 11 — Account Age* 📅\n\nHow old is this Play Console account?\n\nExamples: _1 year_, _5 years_\n\nType your answer:`,
        },
        {
          step: "sell_q_play_account_type",
          prompt: `*Step 2 of 11 — Account Type* 🏢\n\nIs this a personal or organization account?`,
          buttons: [
            { id: "PLAY_TYPE_PERSONAL", title: "👤 Personal" },
            { id: "PLAY_TYPE_ORG",      title: "🏢 Organization" },
          ],
        },
        {
          step: "sell_q_play_account_status",
          prompt: `*Step 3 of 11 — Account Status* 🔒\n\nWhat is the current status of this account?`,
          buttons: [
            { id: "PLAY_STATUS_ACTIVE", title: "✅ Active" },
            { id: "PLAY_STATUS_CLOSED", title: "❌ Closed" },
          ],
        },
        {
          step: "sell_q_play_apps",
          prompt: `*Step 4 of 11 — Published Apps* 📱\n\nHow many apps are published and what are their names?\n\nExamples: _2 apps — CleanMaster, VPN Pro_\n\nType your answer:`,
        },
        {
          step: "sell_q_play_revenue",
          prompt: `*Step 5 of 11 — Monthly Revenue* 💵\n\nApproximate monthly revenue from all apps combined?\n\nEnter numbers only or type *NONE*.\n\nType your answer:`,
        },
        {
          step: "sell_q_play_suspended",
          prompt: `*Step 6 of 11 — Account Status* ⚠️\n\nHas this Play Console account ever been suspended?`,
          buttons: [
            { id: "PLAY_SUSP_NO",  title: "✅ Never suspended" },
            { id: "PLAY_SUSP_YES", title: "⚠️ Was suspended" },
          ],
        },
        {
          step: "sell_q_play_suspended_apps",
          prompt: `*Step 7 of 11 — Suspended Apps* ⚠️\n\nAre any apps currently suspended on this account?`,
          buttons: [
            { id: "PLAY_SUSP_APPS_NO",  title: "✅ No suspended apps" },
            { id: "PLAY_SUSP_APPS_YES", title: "⚠️ Has suspended apps" },
          ],
        },
        {
          step: "sell_q_play_removed_apps",
          prompt: `*Step 8 of 11 — Removed Apps* 🗑️\n\nHave any apps been removed or taken down from this account?`,
          buttons: [
            { id: "PLAY_REM_APPS_NO",  title: "✅ No removed apps" },
            { id: "PLAY_REM_APPS_YES", title: "⚠️ Has removed apps" },
          ],
        },
        {
          step: "sell_q_play_transferred_apps",
          prompt: `*Step 9 of 11 — Transferred Apps* 🔄\n\nHave any apps been transferred into this account from another developer?`,
          buttons: [
            { id: "PLAY_TRANS_NO",  title: "✅ No transferred apps" },
            { id: "PLAY_TRANS_YES", title: "🔄 Has transferred apps" },
          ],
        },
        {
          step: "sell_q_play_keystore",
          prompt: `*Step 10 of 11 — Keystore Availability* 🔑\n\nIs the keystore file available for the apps on this account?`,
          buttons: [
            { id: "PLAY_KEY_YES", title: "✅ Keystore available" },
            { id: "PLAY_KEY_NO",  title: "❌ Not available" },
          ],
        },
        {
          step: "sell_q_play_keystore_reset",
          prompt: `*Step 11 of 11 — Keystore Reset* 🔄\n\nIs a keystore reset possible on this account? (Google Play allows this under certain conditions)`,
          buttons: [
            { id: "PLAY_KEY_RST_YES", title: "✅ Reset possible" },
            { id: "PLAY_KEY_RST_NO",  title: "❌ Not possible" },
            { id: "PLAY_KEY_RST_UNK", title: "❓ Not sure" },
          ],
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
          `Verified: ${data.sell_q_gads_verified === "GADS_VER_YES" ? "Yes" : "No"}`,
          `Active campaigns: ${data.sell_q_gads_campaigns === "GADS_CAMP_YES" ? "Yes" : "No"}`,
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
          `Domain included: ${data.sell_q_ads_domain === "ADS_DOM_YES" ? "Yes" : "No"}`,
          `Verified: ${data.sell_q_ads_verified === "ADS_VER_YES" ? "Yes" : "No"}`,
          `Violations: ${yesNo(data.sell_q_ads_violations, "ADS_VIO_YES")}`,
        ].join(" | ") + country
      );

    case "play_console":
      return [
        `Age: ${data.sell_q_play_age}`,
        `Type: ${data.sell_q_play_account_type === "PLAY_TYPE_ORG" ? "Organization" : "Personal"}`,
        `Status: ${data.sell_q_play_account_status === "PLAY_STATUS_ACTIVE" ? "Active" : "Closed"}`,
        `Apps: ${data.sell_q_play_apps}`,
        `Monthly revenue: ${data.sell_q_play_revenue?.toUpperCase() === "NONE" ? "No revenue" : `$${data.sell_q_play_revenue}/mo`}`,
        `Suspended: ${yesNo(data.sell_q_play_suspended, "PLAY_SUSP_YES")}`,
        `Suspended apps: ${yesNo(data.sell_q_play_suspended_apps, "PLAY_SUSP_APPS_YES")}`,
        `Removed apps: ${yesNo(data.sell_q_play_removed_apps, "PLAY_REM_APPS_YES")}`,
        `Transferred apps: ${yesNo(data.sell_q_play_transferred_apps, "PLAY_TRANS_YES")}`,
        `Keystore available: ${yesNo(data.sell_q_play_keystore, "PLAY_KEY_YES")}`,
        `Keystore reset: ${data.sell_q_play_keystore_reset === "PLAY_KEY_RST_YES" ? "Possible" : data.sell_q_play_keystore_reset === "PLAY_KEY_RST_NO" ? "Not possible" : "Unsure"}`,
      ].join(" | ");

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
        googleAdsAccountAge:      data.sell_q_gads_age,
        googleAdsSpend:           data.sell_q_gads_spend,
        googleAdsCurrency:        data.sell_q_gads_currency,
        googleAdsNiche:           data.sell_q_gads_niche,
        googleAdsVerified:        data.sell_q_gads_verified === "GADS_VER_YES",
        googleAdsActiveCampaigns: data.sell_q_gads_campaigns === "GADS_CAMP_YES",
        googleAdsSuspended:       data.sell_q_gads_suspended === "GADS_SUSP_YES",
      };

    case "facebook_ad_account":
      return {
        ...country,
        metaAccountAge:      data.sell_q_meta_age,
        metaSpendLimit:      data.sell_q_meta_limit,
        metaBusinessManager: data.sell_q_meta_bm === "META_BM_YES",
        metaPixelAttached:   data.sell_q_meta_pixel === "META_PIX_YES",
        metaRestricted:      data.sell_q_meta_restricted === "META_RES_YES",
      };

    case "twitter_account":
      return {
        ...country,
        twitterFollowers: data.sell_q_tw_followers,
        twitterAge:       data.sell_q_tw_age,
        twitterNiche:     data.sell_q_tw_niche,
        twitterMonetized: data.sell_q_tw_monetized === "TW_MON_YES",
        twitterSuspended: data.sell_q_tw_suspended === "TW_SUSP_YES",
      };

    case "instagram_account":
      return {
        ...country,
        instagramFollowers:  data.sell_q_ig_followers,
        instagramAge:        data.sell_q_ig_age,
        instagramNiche:      data.sell_q_ig_niche,
        instagramMonetized:  data.sell_q_ig_monetized === "IG_MON_YES",
        instagramRestricted: data.sell_q_ig_restricted === "IG_RES_YES",
      };

    case "tiktok_account":
      return {
        ...country,
        tiktokFollowers: data.sell_q_tt_followers,
        tiktokAge:       data.sell_q_tt_age,
        tiktokNiche:     data.sell_q_tt_niche,
        tiktokMonetized: data.sell_q_tt_monetized === "TT_MON_YES",
        tiktokLives:     data.sell_q_tt_lives === "TT_LIVE_YES",
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
        adsenseDomainIncluded: data.sell_q_ads_domain === "ADS_DOM_YES",
        adsenseVerified:       data.sell_q_ads_verified === "ADS_VER_YES",
        adsenseViolations:     data.sell_q_ads_violations === "ADS_VIO_YES",
      };

    case "play_console":
      return {
        ...country,
        playConsoleAge: data.sell_q_play_age,
        playConsoleAccountType:
          data.sell_q_play_account_type === "PLAY_TYPE_ORG"
            ? "organization"
            : "personal",
        playConsoleAccountStatus:
          data.sell_q_play_account_status === "PLAY_STATUS_ACTIVE"
            ? "active"
            : "closed",
        playConsoleApps:             data.sell_q_play_apps,
        playConsoleRevenue:          data.sell_q_play_revenue,
        playConsoleSuspended:        data.sell_q_play_suspended === "PLAY_SUSP_YES",
        playConsoleSuspendedApps:    data.sell_q_play_suspended_apps === "PLAY_SUSP_APPS_YES",
        playConsoleRemovedApps:      data.sell_q_play_removed_apps === "PLAY_REM_APPS_YES",
        playConsoleTransferredApps:  data.sell_q_play_transferred_apps === "PLAY_TRANS_YES",
        playConsoleKeystoreAvailable: data.sell_q_play_keystore === "PLAY_KEY_YES",
        playConsoleKeystoreReset:    data.sell_q_play_keystore_reset === "PLAY_KEY_RST_YES",
      };

    case "gift_card":
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
      return `📸 *Required screenshots:*\n1. Play Console dashboard showing published apps\n2. Revenue or stats overview\n3. Account email visible\n4. App status page (showing any suspensions or removals if applicable)`;
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
  escrowProvider: string,
  isReseller: boolean,
  resellerCommission: number,
): string {
  const typeLabel   = TYPE_LABELS[data.type] ?? data.type;
  const escrowLabel = ESCROW_LABELS[escrowProvider] ?? escrowProvider;

  let details = "";
  switch (data.type) {
    case "google_ad_account":
      details = [
        extra.googleAdsAccountAge   && `📅 Age: ${extra.googleAdsAccountAge}`,
        extra.googleAdsSpend        && `💸 Spend: ${extra.googleAdsSpend}`,
        extra.googleAdsCurrency     && `💱 Currency: ${extra.googleAdsCurrency}`,
        extra.googleAdsNiche        && `🏷️ Niche: ${extra.googleAdsNiche}`,
        `🪪 Verified: ${extra.googleAdsVerified ? "Yes" : "No"}`,
        `📢 Active campaigns: ${extra.googleAdsActiveCampaigns ? "Yes" : "No"}`,
        extra.accountCountry        && `🌍 Country: ${extra.accountCountry}`,
        `⚠️ Suspended: ${extra.googleAdsSuspended ? "Yes" : "No"}`,
      ].filter(Boolean).join("\n");
      break;
    case "facebook_ad_account":
      details = [
        extra.metaAccountAge   && `📅 Age: ${extra.metaAccountAge}`,
        extra.metaSpendLimit   && `💳 Limit: ${extra.metaSpendLimit}`,
        `🏢 BM: ${extra.metaBusinessManager ? "Yes" : "No"}`,
        `📊 Pixel: ${extra.metaPixelAttached ? "Yes" : "No"}`,
        extra.accountCountry   && `🌍 Country: ${extra.accountCountry}`,
        `⚠️ Restricted: ${extra.metaRestricted ? "Yes" : "No"}`,
      ].filter(Boolean).join("\n");
      break;
    case "twitter_account":
      details = [
        extra.twitterFollowers && `👥 Followers: ${extra.twitterFollowers}`,
        extra.twitterAge       && `📅 Age: ${extra.twitterAge}`,
        extra.twitterNiche     && `🏷️ Niche: ${extra.twitterNiche}`,
        extra.accountCountry   && `🌍 Country: ${extra.accountCountry}`,
        `💰 Monetized: ${extra.twitterMonetized ? "Yes" : "No"}`,
        `⚠️ Suspended: ${extra.twitterSuspended ? "Yes" : "No"}`,
      ].filter(Boolean).join("\n");
      break;
    case "instagram_account":
      details = [
        extra.instagramFollowers && `👥 Followers: ${extra.instagramFollowers}`,
        extra.instagramAge       && `📅 Age: ${extra.instagramAge}`,
        extra.instagramNiche     && `🏷️ Niche: ${extra.instagramNiche}`,
        extra.accountCountry     && `🌍 Country: ${extra.accountCountry}`,
        `💰 Monetized: ${extra.instagramMonetized ? "Yes" : "No"}`,
        `⚠️ Restricted: ${extra.instagramRestricted ? "Yes" : "No"}`,
      ].filter(Boolean).join("\n");
      break;
    case "tiktok_account":
      details = [
        extra.tiktokFollowers && `👥 Followers: ${extra.tiktokFollowers}`,
        extra.tiktokAge       && `📅 Age: ${extra.tiktokAge}`,
        extra.tiktokNiche     && `🏷️ Niche: ${extra.tiktokNiche}`,
        extra.accountCountry  && `🌍 Country: ${extra.accountCountry}`,
        `💰 Monetized: ${extra.tiktokMonetized ? "Yes" : "No"}`,
        `🔴 LIVE access: ${extra.tiktokLives ? "Yes" : "No"}`,
      ].filter(Boolean).join("\n");
      break;
    case "adsense_site":
      details = [
        extra.adsenseAge            && `📅 Age: ${extra.adsenseAge}`,
        extra.adsenseMonthlyEarnings && `💰 Earnings: $${extra.adsenseMonthlyEarnings}/mo`,
        extra.adsensePaymentStatus  && `💵 Payment: ${extra.adsensePaymentStatus}`,
        extra.adsenseSiteUrl        && `🌐 Site: ${extra.adsenseSiteUrl}`,
        `🔗 Domain included: ${extra.adsenseDomainIncluded ? "Yes" : "No"}`,
        `🪪 Verified: ${extra.adsenseVerified ? "Yes" : "No"}`,
        extra.accountCountry        && `🌍 Country: ${extra.accountCountry}`,
        `⚠️ Violations: ${extra.adsenseViolations ? "Yes" : "No"}`,
      ].filter(Boolean).join("\n");
      break;
    case "play_console":
      details = [
        extra.playConsoleAge           && `📅 Age: ${extra.playConsoleAge}`,
        extra.playConsoleAccountType   && `🏢 Type: ${extra.playConsoleAccountType}`,
        extra.playConsoleAccountStatus && `🔒 Status: ${extra.playConsoleAccountStatus}`,
        extra.playConsoleApps          && `📱 Apps: ${extra.playConsoleApps}`,
        extra.playConsoleRevenue       && `💵 Revenue: $${extra.playConsoleRevenue}/mo`,
        extra.accountCountry           && `🌍 Country: ${extra.accountCountry}`,
        `⚠️ Acct suspended: ${extra.playConsoleSuspended ? "Yes" : "No"}`,
        `⚠️ Suspended apps: ${extra.playConsoleSuspendedApps ? "Yes" : "No"}`,
        `🗑️ Removed apps: ${extra.playConsoleRemovedApps ? "Yes" : "No"}`,
        `🔄 Transferred apps: ${extra.playConsoleTransferredApps ? "Yes" : "No"}`,
        `🔑 Keystore available: ${extra.playConsoleKeystoreAvailable ? "Yes" : "No"}`,
        `🔄 Keystore reset: ${extra.playConsoleKeystoreReset ? "Possible" : "Not possible"}`,
      ].filter(Boolean).join("\n");
      break;
    case "gift_card":
      details = [
        extra.giftCardBrand    && `🎁 Brand: ${extra.giftCardBrand}`,
        extra.giftCardValue    && `💵 Value: ${extra.giftCardValue}`,
        extra.giftCardCurrency && `🌍 Region: ${extra.giftCardCurrency}`,
      ].filter(Boolean).join("\n");
      break;
  }

  // Reseller breakdown for admin visibility
  const resellerLine = isReseller
    ? `\n🤝 *Reseller listing* — commission: ₦${resellerCommission.toLocaleString()} ` +
      `(owner's price: ₦${(buyerPays - resellerCommission).toLocaleString()})`
    : "";

  return (
    `🔔 *New Listing — Review Required*\n\n` +
    `🆔 ${listingId}\n` +
    `📦 ${typeLabel}\n` +
    `💰 Seller asking: ₦${sellerReceives.toLocaleString()}\n` +
    `💳 Buyer pays: ₦${buyerPays.toLocaleString()} _(incl. ₦${fee.toLocaleString()} fee)_\n` +
    `🏦 Escrow: *${escrowLabel}*\n` +
    `📱 Seller: ${phone}\n` +
    `📸 Screenshots: ${screenshots}` +
    resellerLine + `\n\n` +
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
    if (!step || step === "sell_type") {
      track("sell_started", phone);
    }

    if (step === "sell_type" && data.linkedRequestType) {
      const typeKey = data.linkedRequestType;
      track("sell_type_selected", phone, { type: typeKey });
      await setSession(phone, "sell_price", {
        type: typeKey,
        linkedRequestId:   data.linkedRequestId,
        linkedRequestType: data.linkedRequestType,
      });
      return sendMessage(
        phone,
        `✅ *${TYPE_LABELS[typeKey]}* selected.\n\n` +
          `What is your asking price in Naira (₦)?\n\n` +
          `Enter numbers only — no commas or symbols.\n` +
          `Example: *75000*\n\n` +
          `Minimum: ₦1,000\n\n` +
          `💡 You will receive this *full amount* minus Swappa's service fee.\n\n` +
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
        `🔒 All sales are processed through escrow for your protection.\n\n` +
        `Type *CANCEL* to go back.`,
    );
  }

  // ── Select type ────────────────────────────────────────────────────────────
  if (step === "sell_type") {
    const typeKey = TYPE_MAP[text];
    if (!typeKey)
      return sendMessage(phone, "❌ Please reply with a number from 1 to 8.");

    track("sell_type_selected", phone, { type: typeKey });

    await setSession(phone, "sell_price", {
      type:              typeKey,
      linkedRequestId:   data.linkedRequestId,
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
    track("sell_price_set", phone, { type: data.type, price });

    // ── Ask reseller question before escrow selection ──────────────────────
    await setSession(phone, "sell_reseller", { ...data, price });
    return sendButtons(
      phone,
      `💰 *Price set: ₦${price.toLocaleString()}*\n\n` +
        `─────────────────\n` +
        `*Are you the owner of this asset, or are you listing it on someone else's behalf?*\n\n` +
        `_Choose "Reseller" if you don't own the asset yourself — you'll be able to add your commission on top of the price in the next step._`,
      [
        { id: "RESELLER_NO",  title: "✅ I own this asset"   },
        { id: "RESELLER_YES", title: "🤝 I'm a reseller"     },
      ],
    );
  }

  // ── Reseller check ─────────────────────────────────────────────────────────
  if (step === "sell_reseller") {
    if (text === "RESELLER_YES") {
      await setSession(phone, "sell_commission", { ...data, isReseller: true });
      return sendMessage(
        phone,
        `💼 *Enter Your Commission* (in ₦)\n\n` +
          `This is added on top of the owner's asking price of *₦${Number(data.price).toLocaleString()}*.\n` +
          `The buyer will see one combined price — your commission is built in.\n\n` +
          `⚠️ *Set a realistic commission.* Buyers compare prices across listings — inflated commissions reduce your chances of a sale.\n\n` +
          `Enter numbers only (e.g. _3000_, _10000_):`,
      );
    }

    if (text === "RESELLER_NO") {
      // Not a reseller — proceed directly to escrow selection
      const { fee, rate, sellerReceives } = calcFee(data.price);
      await setSession(phone, "sell_escrow", {
        ...data,
        isReseller:         false,
        resellerCommission: 0,
      });
      return sendButtons(
        phone,
        `✅ *Price confirmed: ₦${Number(data.price).toLocaleString()}*\n\n` +
          `💳 Buyer pays:       *₦${Number(data.price).toLocaleString()}*\n` +
          `✂️  Swappa fee (${rate}%): *₦${fee.toLocaleString()}*\n` +
          `💰 You receive:      *₦${sellerReceives.toLocaleString()}*\n\n` +
          `─────────────────\n` +
          `💡 *Pricing tip*\n` +
          `Listings priced fairly sell faster and get more offers. You can negotiate through offers once your listing is live.\n\n` +
          `─────────────────\n` +
          `Choose your escrow provider to continue, or type *CANCEL* to start over.`,
        [
          { id: "ESCROW_KOJI",   title: "🔒 Koji Agudah"      },
          { id: "ESCROW_NAUMAN", title: "🔒 Nauman Chaudhary"  },
          { id: "ESCROW_SWAPPA", title: "🔒 Swappa Native"     },
        ],
      );
    }

    // Unrecognised input — re-prompt with buttons
    return sendButtons(
      phone,
      `❌ Please choose one of the options below:`,
      [
        { id: "RESELLER_NO",  title: "✅ I own this asset" },
        { id: "RESELLER_YES", title: "🤝 I'm a reseller"   },
      ],
    );
  }

  // ── Commission entry (resellers only) ─────────────────────────────────────
  if (step === "sell_commission") {
    const commission = parseInt(text.replace(/[,₦\s]/g, ""), 10);
    if (isNaN(commission) || commission < 500) {
      return sendMessage(
        phone,
        `❌ *Invalid commission.* Please enter a valid amount of at least ₦500.\n\nEnter numbers only (e.g. _3000_):`,
      );
    }

    const basePrice  = Number(data.price);
    const totalPrice = basePrice + commission;
    const { fee, rate, sellerReceives } = calcFee(totalPrice);
    const summary = buildResellerSummary(basePrice, commission);

    // Overwrite price with the combined total — this is what gets listed
    await setSession(phone, "sell_escrow", {
      ...data,
      price:              totalPrice,  // listed price buyers see
      basePrice,                       // owner's original price, kept for records
      resellerCommission: commission,
      isReseller:         true,
    });

    return sendButtons(
      phone,
      `✅ *Commission added!*\n\n` +
        `${summary}\n\n` +
        `─────────────────\n` +
        `Buyers will see *₦${totalPrice.toLocaleString()}* as the listing price.\n\n` +
        `💡 *Pricing tip*\n` +
        `Make sure the combined price is competitive. Buyers browse multiple listings — a fair total price gets deals done faster.\n\n` +
        `─────────────────\n` +
        `Choose your escrow provider to continue, or type *CANCEL* to start over.`,
      [
        { id: "ESCROW_KOJI",   title: "🔒 Koji Agudah"      },
        { id: "ESCROW_NAUMAN", title: "🔒 Nauman Chaudhary"  },
        { id: "ESCROW_SWAPPA", title: "🔒 Swappa Native"     },
      ],
    );
  }

  // ── Select escrow ──────────────────────────────────────────────────────────
  if (step === "sell_escrow") {
    const escrowMap: Record<string, string> = {
      ESCROW_KOJI:   "koji_agudah",
      ESCROW_NAUMAN: "nauman_chaudhary",
      ESCROW_SWAPPA: "swappa_native",
    };
    const escrowProvider = escrowMap[text];
    track("sell_escrow_selected", phone, { type: data.type, escrowProvider });
    if (!escrowProvider) {
      return sendButtons(
        phone,
        `❌ Please choose an escrow provider:`,
        [
          { id: "ESCROW_KOJI",   title: "🔒 Koji Agudah"      },
          { id: "ESCROW_NAUMAN", title: "🔒 Nauman Chaudhary"  },
          { id: "ESCROW_SWAPPA", title: "🔒 Swappa Native"     },
        ],
      );
    }

    const updatedData = { ...data, escrowProvider };
    const questions   = getQuestions(data.type);
    const firstQ      = questions[0];

    if (!firstQ) {
      // No questions for this type — go straight to screenshots
      await setSession(phone, "sell_screenshots", {
        ...updatedData,
        description: "",
        screenshots:  [],
      });
      await sendMessage(
        phone,
        `✅ *${ESCROW_LABELS[escrowProvider]}* will hold the buyer's payment securely until you both confirm the deal.\n\n` +
          `Now let's verify your listing. 📸\n\n` +
          `${screenshotGuide(data.type)}\n\nSend images one by one. Type *DONE* when finished.`,
      );
      return;
    }

    await setSession(phone, firstQ.step, updatedData);

    await sendMessage(
      phone,
      `✅ *${ESCROW_LABELS[escrowProvider]}* will hold the buyer's payment securely until you both confirm the deal.\n\n` +
        `Now a few quick questions to help buyers trust your listing — shouldn't take long.\n\n`,
    );

    return firstQ.buttons
      ? sendButtons(phone, firstQ.prompt, firstQ.buttons)
      : sendMessage(phone, firstQ.prompt);
  }

  // ── Start questionnaire (external entry point, kept for compatibility) ─────
  if (step === "sell_questions") {
    const questions = getQuestions(data.type);
    const firstQ    = questions[0];
    if (!firstQ) {
      await setSession(phone, "sell_screenshots", {
        ...data,
        description: "",
        screenshots:  [],
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
    const questions   = getQuestions(data.type);
    track("sell_question_answered", phone, { step, type: data.type });
    const currentIdx  = questions.findIndex((q) => q.step === step);
    if (currentIdx === -1) {
      await clearSession(phone);
      return sendMessage(
        phone,
        "❌ Something went wrong. Type *SELL* to start again.",
      );
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
        const url         = await uploadScreenshot(mediaId, `listings/${phone}`);
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

        const listingId         = `ADS-${generateId(5)}`;
        const isReseller        = data.isReseller ?? false;
        const resellerCommission = isReseller ? (data.resellerCommission ?? 0) : 0;
        // data.price is already the total (base + commission) for resellers,
        // or just the seller's asking price for owners.
        const { fee, rate, sellerReceives } = calcFee(data.price);
        const expiresAt         = new Date(Date.now() + LISTING_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        const extraFields       = buildListingFields(data.type, data);
        const buyerPays         = data.price;
        const escrowProvider    = data.escrowProvider ?? "koji_agudah";

        await Listing.create({
          listingId,
          seller: user._id,
          type:   data.type,
          price:  data.price,
          platformFee:     fee,
          buyerPays,
          sellerReceives,
          escrowProvider,
          description:     data.description,
          screenshotUrls:  screenshots,
          status:          "pending_verification",
          expiresAt,
          isReseller,
          resellerCommission,
          ...extraFields,
        });

        track("sell_listing_created", phone, {
          listingId,
          type:            data.type,
          price:           data.price,
          escrowProvider,
          screenshotCount: screenshots.length,
          isReseller,
          resellerCommission,
        });

        const linkedRequestId = data.linkedRequestId;
        if (linkedRequestId) {
          const req = await Request.findOne({
            requestId: linkedRequestId,
            status:    "open",
          });
          if (req) {
            await Request.updateOne(
              { _id: req._id },
              { $addToSet: { respondents: user._id } },
            );
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
            escrowProvider,
            isReseller,
            resellerCommission,
          ),
        ).catch((err) => console.error("[SELL] Admin notify error:", err));

        await clearSession(phone);

        // ── Seller confirmation message ──────────────────────────────────
        // For resellers: show the full breakdown so they know exactly what
        // they earn. For owners: show the standard breakdown.
        const confirmationBody = isReseller
          ? `💰 Owner's price:   ₦${Number(data.basePrice ?? (data.price - resellerCommission)).toLocaleString()}\n` +
            `➕ Your commission: ₦${resellerCommission.toLocaleString()}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💳 Buyer pays:      ₦${buyerPays.toLocaleString()}\n` +
            `✂️  Swappa fee:      ₦${fee.toLocaleString()}\n` +
            `💸 You receive:     ₦${sellerReceives.toLocaleString()}\n`
          : `Buyer pays: ₦${buyerPays.toLocaleString()}\n` +
            `You receive: ₦${sellerReceives.toLocaleString()} _(after ₦${fee.toLocaleString()} Swappa fee)_\n`;

        return sendMessage(
          phone,
          `🎉 *Listing submitted!*\n\n` +
            `Listing ID: *${listingId}*\n` +
            `Type: ${TYPE_LABELS[data.type]}\n\n` +
            `${confirmationBody}\n` +
            `Escrow: *${ESCROW_LABELS[escrowProvider]}*\n\n` +
            `⏳ Admin will review your listing within *24 hours*.\n` +
            `You'll get a WhatsApp notification once it goes live.\n\n` +
            `🔒 When a buyer is ready, payment will be handled through *${ESCROW_LABELS[escrowProvider]}* — your funds are protected until the deal is confirmed.\n\n` +
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