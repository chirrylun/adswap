// src/bot/flows/request.ts

import { sendMessage, sendList, sendButtons } from "../../services/whatsapp";
import { setSession, clearSession, updateSessionData } from "../session";
import { TYPE_LABELS } from "../../config/constants";
import Request from "../../models/Request";
import User from "../../models/User";
import { generateId } from "../../utils/helpers";
import { ISession } from "../../models/Session";

const REQUEST_EXPIRY_DAYS = 7;

const CATEGORY_EMOJI: Record<string, string> = {
  google_ad_account: "🎯",
  facebook_ad_account: "📘",
  adsense_site: "💵",
  play_console: "📱",
  gift_card: "🎁",
  twitter_account: "🐦",
  instagram_account: "📸",
  tiktok_account: "🎵",
};

// ─── Question definitions per type ───────────────────────────────────────────
interface Question {
  step: string;
  prompt: string;
  buttons?: { id: string; title: string }[];
  optional?: boolean; // if true, user can type SKIP
}

function getRequestQuestions(type: string): Question[] {
  switch (type) {
    case "google_ad_account":
      return [
        {
          step: "req_q_gads_currency",
          prompt: `*Step 1 — Billing Currency* 💱\n\nWhat billing currency do you need?\n\nExamples: _USD_, _GBP_, _EUR_, _NGN_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_gads_min_spend",
          prompt: `*Step 2 — How Much Has Been Spent* 💸

How much money do you need this account to have spent on ads in total, from when it was created until now?

Examples: _At least $1,000 spent_, _At least $10,000 spent_, _Doesn't matter_

Type your answer or type *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_gads_niche",
          prompt: `*Step 3 — Niche* 🏷️\n\nDo you need a specific niche or industry?\n\nExamples: _E-commerce_, _Finance_, _Any_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_gads_verified",
          prompt: `*Step 4 — Advertiser Verified* 🪪\n\nDo you require advertiser identity verification?`,
          buttons: [
            { id: "RQGADS_VER_YES", title: "✅ Must be verified" },
            { id: "RQGADS_VER_NO", title: "❌ Not required" },
            { id: "RQGADS_VER_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_gads_suspended",
          prompt: `*Step 5 — Suspension History* ⚠️\n\nAre you okay with accounts that were previously suspended?`,
          buttons: [
            { id: "RQGADS_SUSP_NO", title: "✅ Never suspended only" },
            { id: "RQGADS_SUSP_OK", title: "⚠️ Okay if was suspended" },
            { id: "RQGADS_SUSP_SKIP", title: "➡️ No preference" },
          ],
        },
      ];

    case "facebook_ad_account":
      return [
        {
          step: "req_q_meta_min_limit",
          prompt: `*Step 1 — Minimum Spend Limit* 💳\n\nWhat minimum daily or total spend limit do you need?\n\nExamples: _$50/day_, _$500 total_, _No preference_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_meta_bm",
          prompt: `*Step 2 — Business Manager* 🏢\n\nDo you need the account inside a Business Manager?`,
          buttons: [
            { id: "RQMETA_BM_YES", title: "✅ Must be in BM" },
            { id: "RQMETA_BM_NO", title: "❌ Not required" },
            { id: "RQMETA_BM_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_meta_pixel",
          prompt: `*Step 3 — Facebook Pixel* 📊\n\nDo you need a Pixel attached?`,
          buttons: [
            { id: "RQMETA_PIX_YES", title: "✅ Must have Pixel" },
            { id: "RQMETA_PIX_NO", title: "❌ Not required" },
            { id: "RQMETA_PIX_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_meta_restricted",
          prompt: `*Step 4 — Restrictions* ⚠️\n\nAre you okay with accounts that have restrictions?`,
          buttons: [
            { id: "RQMETA_RES_CLEAN", title: "✅ Clean only" },
            { id: "RQMETA_RES_OK", title: "⚠️ Okay with restrictions" },
            { id: "RQMETA_RES_SKIP", title: "➡️ No preference" },
          ],
        },
      ];

    case "twitter_account":
      return [
        {
          step: "req_q_tw_min_followers",
          prompt: `*Step 1 — Minimum Followers* 👥\n\nWhat's the minimum follower count you need?\n\nExamples: _5,000_, _50K_, _No preference_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_tw_niche",
          prompt: `*Step 2 — Niche* 🏷️\n\nDo you need a specific niche?\n\nExamples: _Finance_, _Football_, _Any_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_tw_monetized",
          prompt: `*Step 3 — Monetization* 💰\n\nDo you need an account enrolled in X monetization?`,
          buttons: [
            { id: "RQTW_MON_YES", title: "✅ Must be monetized" },
            { id: "RQTW_MON_NO", title: "❌ Not required" },
            { id: "RQTW_MON_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_tw_suspended",
          prompt: `*Step 4 — Suspension History* ⚠️\n\nAre you okay with accounts that were previously suspended?`,
          buttons: [
            { id: "RQTW_SUSP_NO", title: "✅ Never suspended only" },
            { id: "RQTW_SUSP_OK", title: "⚠️ Okay if was suspended" },
            { id: "RQTW_SUSP_SKIP", title: "➡️ No preference" },
          ],
        },
      ];

    case "instagram_account":
      return [
        {
          step: "req_q_ig_min_followers",
          prompt: `*Step 1 — Minimum Followers* 👥\n\nWhat's the minimum follower count you need?\n\nExamples: _10,000_, _100K_, _No preference_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_ig_niche",
          prompt: `*Step 2 — Niche* 🏷️\n\nDo you need a specific niche?\n\nExamples: _Fashion_, _Fitness_, _Any_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_ig_monetized",
          prompt: `*Step 3 — Monetization* 💰\n\nDo you need a monetized account?`,
          buttons: [
            { id: "RQIG_MON_YES", title: "✅ Must be monetized" },
            { id: "RQIG_MON_NO", title: "❌ Not required" },
            { id: "RQIG_MON_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_ig_restricted",
          prompt: `*Step 4 — Account Status* ⚠️\n\nDo you need a clean account with no restrictions?`,
          buttons: [
            { id: "RQIG_RES_CLEAN", title: "✅ Clean only" },
            { id: "RQIG_RES_OK", title: "⚠️ Okay with restrictions" },
            { id: "RQIG_RES_SKIP", title: "➡️ No preference" },
          ],
        },
      ];

    case "tiktok_account":
      return [
        {
          step: "req_q_tt_min_followers",
          prompt: `*Step 1 — Minimum Followers* 👥\n\nWhat's the minimum follower count you need?\n\nExamples: _10,000_, _100K_, _No preference_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_tt_niche",
          prompt: `*Step 2 — Niche* 🏷️\n\nDo you need a specific niche?\n\nExamples: _Comedy_, _Finance_, _Any_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_tt_monetized",
          prompt: `*Step 3 — Monetization* 💰\n\nDo you need a monetized account?`,
          buttons: [
            { id: "RQTT_MON_YES", title: "✅ Must be monetized" },
            { id: "RQTT_MON_NO", title: "❌ Not required" },
            { id: "RQTT_MON_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_tt_lives",
          prompt: `*Step 4 — LIVE Access* 🔴\n\nDo you need TikTok LIVE to be enabled?`,
          buttons: [
            { id: "RQTT_LIVE_YES", title: "✅ Must have LIVE" },
            { id: "RQTT_LIVE_NO", title: "❌ Not required" },
            { id: "RQTT_LIVE_SKIP", title: "➡️ No preference" },
          ],
        },
      ];

    case "adsense_site":
      return [
        {
          step: "req_q_ads_min_earnings",
          prompt: `*Step 1 — Minimum Monthly Earnings* 💰\n\nWhat's the minimum monthly earnings you require?\n\nExamples: _$50/mo_, _$200/mo_, _No preference_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_ads_payment",
          prompt: `*Step 2 — Payment History* 💵\n\nDo you need an account that has received payments from Google?`,
          buttons: [
            { id: "RQADS_PAY_YES", title: "✅ Must have received payment" },
            { id: "RQADS_PAY_NO", title: "❌ Not required" },
            { id: "RQADS_PAY_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_ads_domain",
          prompt: `*Step 3 — Domain Included* 🔗\n\nDo you need the domain included in the sale?`,
          buttons: [
            { id: "RQADS_DOM_YES", title: "✅ Must include domain" },
            { id: "RQADS_DOM_NO", title: "❌ AdSense only is fine" },
            { id: "RQADS_DOM_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_ads_violations",
          prompt: `*Step 4 — Policy Violations* ⚠️\n\nAre you okay with accounts that have policy violations?`,
          buttons: [
            { id: "RQADS_VIO_CLEAN", title: "✅ Clean only" },
            { id: "RQADS_VIO_OK", title: "⚠️ Okay with violations" },
            { id: "RQADS_VIO_SKIP", title: "➡️ No preference" },
          ],
        },
      ];

    case "play_console":
      return [
        {
          step: "req_q_play_type",
          prompt: `*Step 1 — Account Type* 🏢\n\nDo you need a specific account type?`,
          buttons: [
            { id: "RQPLAY_TYPE_ORG", title: "🏢 Organization" },
            { id: "RQPLAY_TYPE_PERSONAL", title: "👤 Personal" },
            { id: "RQPLAY_TYPE_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_play_min_apps",
          prompt: `*Step 2 — Minimum Published Apps* 📱\n\nWhat's the minimum number of published apps you need?\n\nExamples: _1_, _5_, _No preference_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_play_revenue",
          prompt: `*Step 3 — Revenue* 💵\n\nDo you need the account to have monthly revenue?`,
          buttons: [
            { id: "RQPLAY_REV_YES", title: "✅ Must have revenue" },
            { id: "RQPLAY_REV_NO", title: "❌ Not required" },
            { id: "RQPLAY_REV_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_play_suspended",
          prompt: `*Step 4 — Suspension History* ⚠️\n\nAre you okay with accounts that were previously suspended?`,
          buttons: [
            { id: "RQPLAY_SUSP_NO", title: "✅ Never suspended only" },
            { id: "RQPLAY_SUSP_OK", title: "⚠️ Okay if was suspended" },
            { id: "RQPLAY_SUSP_SKIP", title: "➡️ No preference" },
          ],
        },
        {
          step: "req_q_play_keystore",
          prompt: `*Step 5 — Keystore File* 🔑\n\nDo you need the keystore file to be available?`,
          buttons: [
            { id: "RQPLAY_KEY_YES", title: "✅ Must have keystore" },
            { id: "RQPLAY_KEY_NO", title: "❌ Not required" },
            { id: "RQPLAY_KEY_SKIP", title: "➡️ No preference" },
          ],
        },
      ];

    case "gift_card":
      return [
        {
          step: "req_q_gc_brand",
          prompt: `*Step 1 — Card Brand* 🎁\n\nWhat brand of gift card do you need?\n\nExamples: _Amazon_, _iTunes_, _Steam_, _Any_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_gc_min_value",
          prompt: `*Step 2 — Minimum Face Value* 💵\n\nWhat's the minimum face value you need?\n\nExamples: _$50_, _$100_, _No preference_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
        {
          step: "req_q_gc_region",
          prompt: `*Step 3 — Card Region* 🌍\n\nWhat region/country should the card be valid for?\n\nExamples: _USA_, _UK_, _Global_, _Any_\n\nType your answer or *SKIP*:`,
          optional: true,
        },
      ];

    default:
      return [];
  }
}

// ─── Build structured requirements summary ────────────────────────────────────
function buildRequestSummary(type: string, data: Record<string, any>): string {
  const lines: string[] = [];

  const pref = (
    val: string,
    yesId: string,
    yesLabel: string,
    noLabel: string,
  ) => {
    if (!val || val.endsWith("_SKIP")) return null;
    return val === yesId ? yesLabel : noLabel;
  };

  switch (type) {
    case "google_ad_account":
      if (
        data.req_q_gads_currency &&
        data.req_q_gads_currency.toUpperCase() !== "SKIP"
      )
        lines.push(`💱 Currency: ${data.req_q_gads_currency}`);
      if (
        data.req_q_gads_min_spend &&
        data.req_q_gads_min_spend.toUpperCase() !== "SKIP"
      )
        lines.push(`💸 Min Spend: ${data.req_q_gads_min_spend}`);
      if (
        data.req_q_gads_niche &&
        data.req_q_gads_niche.toUpperCase() !== "SKIP"
      )
        lines.push(`🏷️ Niche: ${data.req_q_gads_niche}`);
      const gadsVer = pref(
        data.req_q_gads_verified,
        "RQGADS_VER_YES",
        "🪪 Verified: Required",
        "🪪 Verified: Not required",
      );
      if (gadsVer) lines.push(gadsVer);
      const gadsSusp = pref(
        data.req_q_gads_suspended,
        "RQGADS_SUSP_NO",
        "⚠️ Suspension: Never suspended only",
        "⚠️ Suspension: Okay if was suspended",
      );
      if (gadsSusp) lines.push(gadsSusp);
      break;

    case "facebook_ad_account":
      if (
        data.req_q_meta_min_limit &&
        data.req_q_meta_min_limit.toUpperCase() !== "SKIP"
      )
        lines.push(`💳 Min Spend Limit: ${data.req_q_meta_min_limit}`);
      const metaBm = pref(
        data.req_q_meta_bm,
        "RQMETA_BM_YES",
        "🏢 Business Manager: Required",
        "🏢 Business Manager: Not required",
      );
      if (metaBm) lines.push(metaBm);
      const metaPix = pref(
        data.req_q_meta_pixel,
        "RQMETA_PIX_YES",
        "📊 Pixel: Required",
        "📊 Pixel: Not required",
      );
      if (metaPix) lines.push(metaPix);
      const metaRes = pref(
        data.req_q_meta_restricted,
        "RQMETA_RES_CLEAN",
        "⚠️ Status: Clean only",
        "⚠️ Status: Restrictions okay",
      );
      if (metaRes) lines.push(metaRes);
      break;

    case "twitter_account":
      if (
        data.req_q_tw_min_followers &&
        data.req_q_tw_min_followers.toUpperCase() !== "SKIP"
      )
        lines.push(`👥 Min Followers: ${data.req_q_tw_min_followers}`);
      if (data.req_q_tw_niche && data.req_q_tw_niche.toUpperCase() !== "SKIP")
        lines.push(`🏷️ Niche: ${data.req_q_tw_niche}`);
      const twMon = pref(
        data.req_q_tw_monetized,
        "RQTW_MON_YES",
        "💰 Monetized: Required",
        "💰 Monetized: Not required",
      );
      if (twMon) lines.push(twMon);
      const twSusp = pref(
        data.req_q_tw_suspended,
        "RQTW_SUSP_NO",
        "⚠️ Suspension: Never suspended only",
        "⚠️ Suspension: Okay if was suspended",
      );
      if (twSusp) lines.push(twSusp);
      break;

    case "instagram_account":
      if (
        data.req_q_ig_min_followers &&
        data.req_q_ig_min_followers.toUpperCase() !== "SKIP"
      )
        lines.push(`👥 Min Followers: ${data.req_q_ig_min_followers}`);
      if (data.req_q_ig_niche && data.req_q_ig_niche.toUpperCase() !== "SKIP")
        lines.push(`🏷️ Niche: ${data.req_q_ig_niche}`);
      const igMon = pref(
        data.req_q_ig_monetized,
        "RQIG_MON_YES",
        "💰 Monetized: Required",
        "💰 Monetized: Not required",
      );
      if (igMon) lines.push(igMon);
      const igRes = pref(
        data.req_q_ig_restricted,
        "RQIG_RES_CLEAN",
        "⚠️ Status: Clean only",
        "⚠️ Status: Restrictions okay",
      );
      if (igRes) lines.push(igRes);
      break;

    case "tiktok_account":
      if (
        data.req_q_tt_min_followers &&
        data.req_q_tt_min_followers.toUpperCase() !== "SKIP"
      )
        lines.push(`👥 Min Followers: ${data.req_q_tt_min_followers}`);
      if (data.req_q_tt_niche && data.req_q_tt_niche.toUpperCase() !== "SKIP")
        lines.push(`🏷️ Niche: ${data.req_q_tt_niche}`);
      const ttMon = pref(
        data.req_q_tt_monetized,
        "RQTT_MON_YES",
        "💰 Monetized: Required",
        "💰 Monetized: Not required",
      );
      if (ttMon) lines.push(ttMon);
      const ttLive = pref(
        data.req_q_tt_lives,
        "RQTT_LIVE_YES",
        "🔴 LIVE Access: Required",
        "🔴 LIVE Access: Not required",
      );
      if (ttLive) lines.push(ttLive);
      break;

    case "adsense_site":
      if (
        data.req_q_ads_min_earnings &&
        data.req_q_ads_min_earnings.toUpperCase() !== "SKIP"
      )
        lines.push(`💰 Min Earnings: ${data.req_q_ads_min_earnings}`);
      const adsPay = pref(
        data.req_q_ads_payment,
        "RQADS_PAY_YES",
        "💵 Payment History: Required",
        "💵 Payment History: Not required",
      );
      if (adsPay) lines.push(adsPay);
      const adsDom = pref(
        data.req_q_ads_domain,
        "RQADS_DOM_YES",
        "🔗 Domain: Must be included",
        "🔗 Domain: Not required",
      );
      if (adsDom) lines.push(adsDom);
      const adsVio = pref(
        data.req_q_ads_violations,
        "RQADS_VIO_CLEAN",
        "⚠️ Violations: Clean only",
        "⚠️ Violations: Okay",
      );
      if (adsVio) lines.push(adsVio);
      break;

    case "play_console":
      const playType = data.req_q_play_type;
      if (playType && !playType.endsWith("_SKIP"))
        lines.push(
          `🏢 Type: ${playType === "RQPLAY_TYPE_ORG" ? "Organization" : "Personal"}`,
        );
      if (
        data.req_q_play_min_apps &&
        data.req_q_play_min_apps.toUpperCase() !== "SKIP"
      )
        lines.push(`📱 Min Apps: ${data.req_q_play_min_apps}`);
      const playRev = pref(
        data.req_q_play_revenue,
        "RQPLAY_REV_YES",
        "💵 Revenue: Required",
        "💵 Revenue: Not required",
      );
      if (playRev) lines.push(playRev);
      const playSusp = pref(
        data.req_q_play_suspended,
        "RQPLAY_SUSP_NO",
        "⚠️ Suspension: Never suspended only",
        "⚠️ Suspension: Okay if was suspended",
      );
      if (playSusp) lines.push(playSusp);
      const playKey = pref(
        data.req_q_play_keystore,
        "RQPLAY_KEY_YES",
        "🔑 Keystore: Required",
        "🔑 Keystore: Not required",
      );
      if (playKey) lines.push(playKey);
      break;

    case "gift_card":
      if (data.req_q_gc_brand && data.req_q_gc_brand.toUpperCase() !== "SKIP")
        lines.push(`🎁 Brand: ${data.req_q_gc_brand}`);
      if (
        data.req_q_gc_min_value &&
        data.req_q_gc_min_value.toUpperCase() !== "SKIP"
      )
        lines.push(`💵 Min Value: ${data.req_q_gc_min_value}`);
      if (data.req_q_gc_region && data.req_q_gc_region.toUpperCase() !== "SKIP")
        lines.push(`🌍 Region: ${data.req_q_gc_region}`);
      break;
  }

  return lines.join("\n");
}

// ─── Broadcast request to opted-in users ─────────────────────────────────────
async function broadcastRequest(
  req: any,
  requesterPhone: string,
): Promise<void> {
  const users = await User.find({
    isBanned: false,
    phone: { $ne: requesterPhone },
    $or: [
      {
        "notifications.enabled": true,
        "notifications.optedOutTypes": { $nin: [req.type] },
      },
      { "notifications.enabled": { $exists: false } },
    ],
  })
    .select("phone")
    .lean();

  if (!users.length) return;

  const label = TYPE_LABELS[req.type] ?? req.type;
  const emoji = CATEGORY_EMOJI[req.type] ?? "📦";
  const budget = req.budget
    ? `\n💰 *Budget: ₦${Number(req.budget).toLocaleString()}*`
    : "";
  const specs = req.details ? `\n\n📋 *Requirements:*\n${req.details}` : "";
  const notes = req.notes ? `\n\n📝 _"${req.notes}"_` : "";

  const message =
    `📣 *Asset Wanted — ${emoji} ${label}*\n` +
    `▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔` +
    budget +
    specs +
    notes +
    `\n\nIf you have one to sell, reply with:\n` +
    `\`RESPOND ${req.requestId}\`\n\n` +
    `─────────────────\n` +
    `Don't want these alerts?\n` +
    `\`OPTOUT ${req.type}\``;

  const BATCH = 10;
  const DELAY = 1000;
  for (let i = 0; i < users.length; i += BATCH) {
    await Promise.allSettled(
      users.slice(i, i + BATCH).map((u) => sendMessage(u.phone, message)),
    );
    if (i + BATCH < users.length)
      await new Promise((r) => setTimeout(r, DELAY));
  }

  console.log(
    `[REQUEST] Broadcast sent to ${users.length} users for ${req.requestId}`,
  );
}

// ─── Notify admin of new request ─────────────────────────────────────────────
async function notifyAdminOfRequest(
  req: any,
  requesterPhone: string,
  userCount: number,
): Promise<void> {
  const label = TYPE_LABELS[req.type] ?? req.type;
  const emoji = CATEGORY_EMOJI[req.type] ?? "📦";
  const now = new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" });

  await sendMessage(
    process.env.PAYMENT_PHONE!,
    `📣 *New Asset Request*\n\n` +
      `🆔 Ref: *${req.requestId}*\n` +
      `${emoji} Asset: *${label}*\n` +
      `📱 Requester: ${requesterPhone}\n` +
      `💰 Budget: ${req.budget ? `₦${Number(req.budget).toLocaleString()}` : "Not specified"}\n` +
      `🕐 Time: ${now}\n\n` +
      (req.details ? `📋 Requirements:\n${req.details}\n\n` : "") +
      (req.notes ? `📝 Notes: _${req.notes}_\n\n` : "") +
      `👥 Broadcast sent to *${userCount}* user(s)\n` +
      `⏳ Expires in 7 days`,
  );
}

// ─── Notify respondents of cancellation ──────────────────────────────────────
async function notifyRespondentsOfCancellation(req: any): Promise<void> {
  if (!req.respondents?.length) return;

  const users = await User.find({
    _id: { $in: req.respondents },
    isBanned: false,
  })
    .select("phone")
    .lean();

  const label = TYPE_LABELS[req.type] ?? req.type;

  await Promise.allSettled(
    users.map((u) =>
      sendMessage(
        u.phone,
        `ℹ️ *Request Cancelled*\n\n` +
          `The request for a *${label}* (Ref: ${req.requestId}) has been cancelled.\n\n` +
          `You're still welcome to list this asset — type *SELL* anytime.`,
      ),
    ),
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export async function handleRequest(
  phone: string,
  text: string,
  session: ISession,
): Promise<void> {
  const step = session?.step;
  const data = session?.data ?? {};
  const upper = text.trim().toUpperCase();

  // ── Entry ──────────────────────────────────────────────────────────────────
  if (upper === "REQUEST") {
    await setSession(phone, "request_type", {});
    return sendList(
      phone,
      `📣 *Request an Asset*\n\n` +
        `Can't find what you're looking for?\n` +
        `Send a request and sellers with matching assets will be notified.\n\n` +
        `Which type of asset are you looking for?`,
      "Choose Type",
      [
        {
          title: "Asset Types",
          rows: Object.entries(TYPE_LABELS).map(([type, label]) => ({
            id: `REQTYPE_${type}`,
            title: `${CATEGORY_EMOJI[type] ?? "📦"} ${label}`,
            description: "Tap to request this asset type",
          })),
        },
      ],
    );
  }

  // ── Type selected ──────────────────────────────────────────────────────────
  if (upper.startsWith("REQTYPE_")) {
    const type = upper.replace("REQTYPE_", "").trim().toLowerCase();
    const label = TYPE_LABELS[type];
    if (!label) {
      return sendMessage(
        phone,
        `❌ Unknown asset type.\n\nType *REQUEST* to try again.`,
      );
    }

    // Check for existing open request before going further
    const user = await User.findOneAndUpdate(
      { phone },
      { $setOnInsert: { phone } },
      { upsert: true, new: true },
    );
    const existing = await Request.findOne({
      requester: user._id,
      status: "open",
    });
    if (existing) {
      return sendMessage(
        phone,
        `⚠️ You already have an open request (${existing.requestId}).\n\n` +
          `Cancel it first before creating a new one:\n` +
          `\`CANCEL REQUEST ${existing.requestId}\``,
      );
    }

    // Go straight into questionnaire
    const questions = getRequestQuestions(type);
    const firstQ = questions[0];

    if (!firstQ) {
      // No questions — go to budget
      await setSession(phone, "request_budget", { type });
      return sendMessage(
        phone,
        `${CATEGORY_EMOJI[type]} *${label}* selected.\n\n` +
          `*What is your maximum budget in Naira (₦)?*\n\n` +
          `Enter numbers only — example: *50000*\n\n` +
          `Or type *SKIP* if you'd prefer not to specify.`,
      );
    }

    await setSession(phone, firstQ.step, { type });
    await sendMessage(
      phone,
      `${CATEGORY_EMOJI[type]} *${label}* selected.\n\n` +
        `A few quick questions to help match you with the right seller.\n`,
    );

    return firstQ.buttons
      ? sendButtons(phone, firstQ.prompt, firstQ.buttons)
      : sendMessage(phone, firstQ.prompt);
  }

  // ── Questionnaire steps ────────────────────────────────────────────────────
  if (step?.startsWith("req_q_")) {
    const questions = getRequestQuestions(data.type);
    const currentIdx = questions.findIndex((q) => q.step === step);

    if (currentIdx === -1) {
      await clearSession(phone);
      return sendMessage(
        phone,
        "❌ Something went wrong. Type *REQUEST* to start again.",
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

    // All questions answered — go to budget
    await setSession(phone, "request_budget", updatedData);
    return sendMessage(
      phone,
      `✅ *Requirements noted!*\n\n` +
        `*What is your maximum budget in Naira (₦)?*\n\n` +
        `Enter numbers only — example: *50000*\n\n` +
        `Or type *SKIP* if you'd prefer not to specify.`,
    );
  }

  // ── Budget step ────────────────────────────────────────────────────────────
  if (step === "request_budget") {
    let budget: number | undefined;

    if (upper !== "SKIP") {
      const parsed = parseInt(text.replace(/[,₦\s]/g, ""), 10);
      if (isNaN(parsed) || parsed < 1000) {
        return sendMessage(
          phone,
          `❌ Invalid amount. Minimum is ₦1,000.\n\nEnter numbers only — example: *50000*\n\nOr type *SKIP* to continue without a budget.`,
        );
      }
      budget = parsed;
    }

    const updatedData = { ...data, budget };
    await setSession(phone, "request_notes", updatedData);

    return sendMessage(
      phone,
      (budget
        ? `✅ Budget set: *₦${budget.toLocaleString()}*\n\n`
        : `➡️ No budget specified.\n\n`) +
        `*Any additional notes for sellers?*\n\n` +
        `Examples: _"Prefer USD billing"_, _"Need transfer within 24hrs"_\n\n` +
        `Type your note, or *SKIP* to submit now.`,
    );
  }

  // ── Notes / final submission ───────────────────────────────────────────────
  if (step === "request_notes") {
    const notes = upper === "SKIP" ? undefined : text.slice(0, 300);

    const user = await User.findOneAndUpdate(
      { phone },
      { $setOnInsert: { phone } },
      { upsert: true, new: true },
    );

    // Double-check for existing open request
    const existing = await Request.findOne({
      requester: user._id,
      status: "open",
    });
    if (existing) {
      await clearSession(phone);
      return sendMessage(
        phone,
        `⚠️ You already have an open request (${existing.requestId}).\n\n` +
          `Cancel it first:\n\`CANCEL REQUEST ${existing.requestId}\``,
      );
    }

    const requestId = `REQ-${generateId(5)}`;
    const expiresAt = new Date(
      Date.now() + REQUEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    );
    const label = TYPE_LABELS[data.type] ?? data.type;
    const summary = buildRequestSummary(data.type, data);

    const newRequest = await Request.create({
      requestId,
      requester: user._id,
      type: data.type,
      details: summary || undefined, // structured specs
      notes: notes || undefined, // free-text note
      budget: data.budget || undefined,
      status: "open",
      expiresAt,
    });

    await clearSession(phone);

    // Confirm to requester
    await sendMessage(
      phone,
      `✅ *Request Submitted!*\n\n` +
        `Asset: *${label}*\n` +
        `Ref: *${requestId}*\n` +
        (data.budget
          ? `Budget: ₦${Number(data.budget).toLocaleString()}\n`
          : "") +
        (summary ? `\n📋 *Your requirements:*\n${summary}\n` : "") +
        (notes ? `\n📝 _${notes}_\n` : "") +
        `\nSellers who match your criteria will be notified.\n` +
        `You'll get a message when someone responds.\n\n` +
        `Your request expires in *7 days*.\n\n` +
        `To cancel:\n\`CANCEL REQUEST ${requestId}\``,
    );

    // Broadcast + notify admin
    broadcastRequest(newRequest, phone)
      .then(async () => {
        const userCount = await User.countDocuments({
          isBanned: false,
          phone: { $ne: phone },
          $or: [
            {
              "notifications.enabled": true,
              "notifications.optedOutTypes": { $nin: [data.type] },
            },
            { "notifications.enabled": { $exists: false } },
          ],
        });
        return notifyAdminOfRequest(newRequest, phone, userCount);
      })
      .catch((err) => console.error("[REQUEST] Broadcast/notify error:", err));

    return;
  }

  // ── Cancel a request ───────────────────────────────────────────────────────
  if (upper.startsWith("CANCEL REQUEST ")) {
    const requestId = upper.replace("CANCEL REQUEST ", "").trim();

    const user = await User.findOne({ phone });
    if (!user)
      return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

    const req = await Request.findOne({
      requestId,
      requester: user._id,
      status: "open",
    }).populate("respondents");

    if (!req) {
      return sendMessage(
        phone,
        `❌ Request *${requestId}* not found or already closed.\n\n` +
          `Type *MY REQUESTS* to see your active requests.`,
      );
    }

    await Request.updateOne(
      { _id: req._id },
      { $set: { status: "cancelled" } },
    );

    await sendMessage(
      phone,
      `✅ Request *${requestId}* has been cancelled.\n\n` +
        `Any sellers who responded will be notified.\n\n` +
        `Type *REQUEST* to send a new one anytime.`,
    );

    notifyRespondentsOfCancellation(req).catch((err) =>
      console.error("[REQUEST] Cancel notify error:", err),
    );

    return;
  }

  // ── View own requests ──────────────────────────────────────────────────────
  if (upper === "MY REQUESTS") {
    const user = await User.findOne({ phone });
    if (!user)
      return sendMessage(phone, `❌ No account found. Type *MENU* to start.`);

    const requests = await Request.find({ requester: user._id, status: "open" })
      .sort({ createdAt: -1 })
      .limit(5);

    if (!requests.length) {
      return sendMessage(
        phone,
        `📭 You have no open requests.\n\nType *REQUEST* to send one.`,
      );
    }

    const lines = requests.map((r) => {
      const label = TYPE_LABELS[r.type] ?? r.type;
      return (
        `${CATEGORY_EMOJI[r.type] ?? "📦"} *${label}*\n` +
        `Ref: ${r.requestId}\n` +
        (r.budget ? `Budget: ₦${Number(r.budget).toLocaleString()}\n` : "") +
        `Respondents: ${r.respondents.length}\n` +
        (r.details ? `Requirements:\n${r.details}\n` : "") +
        (r.notes ? `Notes: _${r.notes}_\n` : "") +
        `Cancel: \`CANCEL REQUEST ${r.requestId}\``
      );
    });

    return sendMessage(
      phone,
      `📋 *Your Open Requests*\n\n` + lines.join("\n\n"),
    );
  }

  // ── Respond to a request ───────────────────────────────────────────────────
  if (upper.startsWith("RESPOND ")) {
    const requestId = upper.replace("RESPOND ", "").trim();

    const req = await Request.findOne({ requestId, status: "open" });
    if (!req) {
      return sendMessage(
        phone,
        `❌ Request *${requestId}* is no longer available.\n\nType *SELL* to list your asset directly.`,
      );
    }

    const user = await User.findOne({ phone });
    if (user && req.requester.toString() === user._id.toString()) {
      return sendMessage(phone, `❌ You can't respond to your own request.`);
    }

    const label = TYPE_LABELS[req.type] ?? req.type;
    const summary = req.details
      ? `\n📋 *Their requirements:*\n${req.details}`
      : "";
    const notes = req.notes ? `\n📝 _"${req.notes}"_` : "";
    const budget = req.budget
      ? `\n💰 Budget: ₦${Number(req.budget).toLocaleString()}`
      : "";

    await setSession(phone, "sell_type", {
      linkedRequestId: requestId,
      linkedRequestType: req.type,
    });

    return sendMessage(
      phone,
      `✅ *Responding to request ${requestId}*\n\n` +
        `The buyer is looking for a *${label}*.` +
        budget +
        summary +
        notes +
        `\n\nWe'll walk you through listing your asset now.\n` +
        `If approved, the buyer will be notified directly.\n\n` +
        `Type *SELL* to proceed, or *CANCEL* to exit.`,
    );
  }
}
