import mongoose, { Schema, Document } from 'mongoose';

export type ListingType =
  | 'google_ad_account'
  | 'facebook_ad_account'
  | 'adsense_site'
  | 'play_console'
  | 'gift_card'
  | 'twitter_account'
  | 'instagram_account'
  | 'tiktok_account';

export type ListingStatus =
  | 'pending_verification'
  | 'active'
  | 'sold'
  | 'expired'
  | 'rejected';

export interface IListing extends Document {
  listingId:        string;
  seller:           mongoose.Types.ObjectId;
  type:             ListingType;
  price:            number;
  description:      string;
  niche?:           string;

  // ── Google Ads specific ────────────────────────────────────────────────────
  googleAdsSpend?:       string; // lifetime or monthly spend
  googleAdsCurrency?:    string; // account currency
  googleAdsAccountAge?:  string;
  googleAdsNiche?:       string;
  googleAdsSuspended?:   boolean;

  // ── Facebook Ads specific ──────────────────────────────────────────────────
  metaSpendLimit?:       string; // current spend limit
  metaAccountAge?:       string;
  metaPixelAttached?:    boolean;
  metaRestricted?:       boolean;
  metaBusinessManager?:  boolean; // is it a BM account

  // ── Twitter specific ───────────────────────────────────────────────────────
  twitterFollowers?:    string;
  twitterNiche?:        string;
  twitterAge?:          string;
  twitterMonetized?:    boolean;
  twitterSuspended?:    boolean;

  // ── Instagram specific ─────────────────────────────────────────────────────
  instagramFollowers?:  string;
  instagramNiche?:      string;
  instagramAge?:        string;
  instagramMonetized?:  boolean;
  instagramRestricted?: boolean;

  // ── TikTok specific ────────────────────────────────────────────────────────
  tiktokFollowers?:     string;
  tiktokNiche?:         string;
  tiktokAge?:           string;
  tiktokMonetized?:     boolean;
  tiktokLives?:         boolean; // has LIVE access
  tiktokBanned?:        boolean;

  // ── AdSense site specific ──────────────────────────────────────────────────
  adsenseMonthlyEarnings?: string;
  adsensePaymentStatus?:   string; // 'received' | 'threshold' | 'none'
  adsenseSiteUrl?:         string;
  adsenseNiche?:           string;
  adsenseAge?:             string;
  adsenseViolations?:      boolean;

  // ── Play Console specific ──────────────────────────────────────────────────
  playConsoleApps?:        string; // number of apps
  playConsoleRevenue?:     string; // monthly revenue
  playConsoleSuspended?:   boolean;
  playConsoleAge?:         string;

  // ── Gift Card specific ─────────────────────────────────────────────────────
  giftCardBrand?:    string; // Amazon, iTunes, Steam, etc.
  giftCardValue?:    string; // face value e.g. "$100"
  giftCardCurrency?: string;
  giftCardCode?:     string; // revealed only after confirmed purchase

  paymentLink?: string;
  screenshotUrls:   string[];
  status:           ListingStatus;
  isFeatured:       boolean;
  rejectionReason?: string;
  viewCount:        number;
  expiresAt:        Date;
  createdAt:        Date;
  updatedAt:        Date;
}

const ListingSchema = new Schema<IListing>(
  {
    listingId:  { type: String, required: true, unique: true, index: true },
    seller:     { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
  type:     String,
  required: true,
  enum:     [
    'google_ad_account','facebook_ad_account','adsense_site',
    'play_console','gift_card',
    'twitter_account','instagram_account','tiktok_account',
  ],
},
    price:       { type: Number, required: true, min: 1000 },
    description: { type: String, required: true, maxlength: 600 },
    niche:       { type: String, maxlength: 100 },

    // Google Ads
    googleAdsSpend:      { type: String },
    googleAdsCurrency:   { type: String },
    googleAdsAccountAge: { type: String },
    googleAdsNiche:      { type: String },
    googleAdsSuspended:  { type: Boolean },

    // Facebook Ads
    metaSpendLimit:      { type: String },
    metaAccountAge:      { type: String },
    metaPixelAttached:   { type: Boolean },
    metaRestricted:      { type: Boolean },
    metaBusinessManager: { type: Boolean },

    // Twitter
twitterFollowers:    { type: String },
twitterNiche:        { type: String },
twitterAge:          { type: String },
twitterMonetized:    { type: Boolean },
twitterSuspended:    { type: Boolean },

// Instagram
instagramFollowers:  { type: String },
instagramNiche:      { type: String },
instagramAge:        { type: String },
instagramMonetized:  { type: Boolean },
instagramRestricted: { type: Boolean },

// TikTok
tiktokFollowers:     { type: String },
tiktokNiche:         { type: String },
tiktokAge:           { type: String },
tiktokMonetized:     { type: Boolean },
tiktokLives:         { type: Boolean },
tiktokBanned:        { type: Boolean },

    // AdSense
    adsenseMonthlyEarnings: { type: String },
    adsensePaymentStatus:   { type: String },
    adsenseSiteUrl:         { type: String },
    adsenseNiche:           { type: String },
    adsenseAge:             { type: String },
    adsenseViolations:      { type: Boolean },

    // Play Console
    playConsoleApps:      { type: String },
    playConsoleRevenue:   { type: String },
    playConsoleSuspended: { type: Boolean },
    playConsoleAge:       { type: String },

    // Gift Card
    giftCardBrand:    { type: String },
    giftCardValue:    { type: String },
    giftCardCurrency: { type: String },
    giftCardCode:     { type: String },  // stored encrypted, revealed post-purchase

    paymentLink: { type: String },
    screenshotUrls:  [{ type: String }],
    status:          { type: String, default: 'pending_verification', index: true },
    isFeatured:      { type: Boolean, default: false },
    rejectionReason: { type: String },
    viewCount:       { type: Number, default: 0 },
    expiresAt:       { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL index — MongoDB auto-deletes expired listings
ListingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IListing>('Listing', ListingSchema);