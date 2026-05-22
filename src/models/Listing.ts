import mongoose, { Schema, Document } from "mongoose";

export type ListingType =
  | "google_ad_account"
  | "facebook_ad_account"
  | "adsense_site"
  | "play_console"
  | "gift_card"
  | "twitter_account"
  | "instagram_account"
  | "tiktok_account";

export type ListingStatus =
  | "pending_verification"
  | "active"
  | "sold"
  | "expired"
  | "rejected";

export type EscrowProvider =
  | "koji_agudah"
  | "nauman_chaudhary"
  | "swappa_native";

export interface IListing extends Document {
  listingId: string;
  seller: mongoose.Types.ObjectId;
  type: ListingType;

  // ── Pricing ────────────────────────────────────────────────────────────────
  price: number;
  platformFee: number;
  buyerPays: number;
  sellerReceives: number;
  isReseller?: boolean;
  resellerCommission?: number;

  description: string;
  niche?: string;

  // ── Escrow ─────────────────────────────────────────────────────────────────
  escrowProvider: EscrowProvider;

  // ── Shared ─────────────────────────────────────────────────────────────────
  accountCountry?: string;

  // ── Google Ads specific ────────────────────────────────────────────────────
  googleAdsSpend?: string;
  googleAdsCurrency?: string;
  googleAdsAccountAge?: string;
  googleAdsNiche?: string;
  googleAdsSuspended?: boolean;
  googleAdsVerified?: boolean;
  googleAdsActiveCampaigns?: boolean;

  // ── Facebook Ads specific ──────────────────────────────────────────────────
  metaSpendLimit?: string;
  metaAccountAge?: string;
  metaPixelAttached?: boolean;
  metaRestricted?: boolean;
  metaBusinessManager?: boolean;

  // ── Twitter specific ───────────────────────────────────────────────────────
  twitterFollowers?: string;
  twitterNiche?: string;
  twitterAge?: string;
  twitterMonetized?: boolean;
  twitterSuspended?: boolean;

  // ── Instagram specific ─────────────────────────────────────────────────────
  instagramFollowers?: string;
  instagramNiche?: string;
  instagramAge?: string;
  instagramMonetized?: boolean;
  instagramRestricted?: boolean;

  // ── TikTok specific ────────────────────────────────────────────────────────
  tiktokFollowers?: string;
  tiktokNiche?: string;
  tiktokAge?: string;
  tiktokMonetized?: boolean;
  tiktokLives?: boolean;
  tiktokBanned?: boolean;

  // ── AdSense site specific ──────────────────────────────────────────────────
  adsenseMonthlyEarnings?: string;
  adsensePaymentStatus?: string;
  adsenseSiteUrl?: string;
  adsenseNiche?: string;
  adsenseAge?: string;
  adsenseViolations?: boolean;
  adsenseDomainIncluded?: boolean;
  adsenseVerified?: boolean;

  // ── Play Console specific ──────────────────────────────────────────────────
  playConsoleApps?: string;
  playConsoleRevenue?: string;
  playConsoleSuspended?: boolean;
  playConsoleAge?: string;
  playConsoleAccountType?: string; // 'personal' | 'organization'
  playConsoleAccountStatus?: string; // 'active' | 'closed'
  playConsoleSuspendedApps?: boolean;
  playConsoleRemovedApps?: boolean;
  playConsoleTransferredApps?: boolean;
  playConsoleKeystoreAvailable?: boolean;
  playConsoleKeystoreReset?: boolean;

  // ── Gift Card specific ─────────────────────────────────────────────────────
  giftCardBrand?: string;
  giftCardValue?: string;
  giftCardCurrency?: string;
  giftCardCode?: string;

  screenshotUrls: string[];
  status: ListingStatus;
  isFeatured: boolean;
  rejectionReason?: string;
  viewCount: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ListingSchema = new Schema<IListing>(
  {
    listingId: { type: String, required: true, unique: true, index: true },
    seller: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "google_ad_account",
        "facebook_ad_account",
        "adsense_site",
        "play_console",
        "gift_card",
        "twitter_account",
        "instagram_account",
        "tiktok_account",
      ],
    },

    // Pricing
    price: { type: Number, required: true, min: 1000 },
    platformFee: { type: Number, required: true },
    buyerPays: { type: Number, required: true },
    sellerReceives: { type: Number, required: true },
    isReseller: { type: Boolean, default: false },
    resellerCommission: { type: Number, default: 0 },

    description: { type: String, required: true, maxlength: 600 },
    niche: { type: String, maxlength: 100 },

    // Escrow
    escrowProvider: {
      type: String,
      required: true,
      enum: ["koji_agudah", "nauman_chaudhary", "swappa_native"],
      default: "koji_agudah",
    },

    // Shared
    accountCountry: { type: String },

    // Google Ads
    googleAdsSpend: { type: String },
    googleAdsCurrency: { type: String },
    googleAdsAccountAge: { type: String },
    googleAdsNiche: { type: String },
    googleAdsSuspended: { type: Boolean },
    googleAdsVerified: { type: Boolean },
    googleAdsActiveCampaigns: { type: Boolean },

    // Facebook Ads
    metaSpendLimit: { type: String },
    metaAccountAge: { type: String },
    metaPixelAttached: { type: Boolean },
    metaRestricted: { type: Boolean },
    metaBusinessManager: { type: Boolean },

    // Twitter
    twitterFollowers: { type: String },
    twitterNiche: { type: String },
    twitterAge: { type: String },
    twitterMonetized: { type: Boolean },
    twitterSuspended: { type: Boolean },

    // Instagram
    instagramFollowers: { type: String },
    instagramNiche: { type: String },
    instagramAge: { type: String },
    instagramMonetized: { type: Boolean },
    instagramRestricted: { type: Boolean },

    // TikTok
    tiktokFollowers: { type: String },
    tiktokNiche: { type: String },
    tiktokAge: { type: String },
    tiktokMonetized: { type: Boolean },
    tiktokLives: { type: Boolean },
    tiktokBanned: { type: Boolean },

    // AdSense
    adsenseMonthlyEarnings: { type: String },
    adsensePaymentStatus: { type: String },
    adsenseSiteUrl: { type: String },
    adsenseNiche: { type: String },
    adsenseAge: { type: String },
    adsenseViolations: { type: Boolean },
    adsenseDomainIncluded: { type: Boolean },
    adsenseVerified: { type: Boolean },

    // Play Console
    playConsoleApps: { type: String },
    playConsoleRevenue: { type: String },
    playConsoleSuspended: { type: Boolean },
    playConsoleAge: { type: String },
    playConsoleAccountType: { type: String },
    playConsoleAccountStatus: { type: String },
    playConsoleSuspendedApps: { type: Boolean },
    playConsoleRemovedApps: { type: Boolean },
    playConsoleTransferredApps: { type: Boolean },
    playConsoleKeystoreAvailable: { type: Boolean },
    playConsoleKeystoreReset: { type: Boolean },

    // Gift Card
    giftCardBrand: { type: String },
    giftCardValue: { type: String },
    giftCardCurrency: { type: String },
    giftCardCode: { type: String },

    screenshotUrls: [{ type: String }],
    status: { type: String, default: "pending_verification", index: true },
    isFeatured: { type: Boolean, default: false },
    rejectionReason: { type: String },
    viewCount: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

ListingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IListing>("Listing", ListingSchema);
