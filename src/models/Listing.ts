import mongoose, { Schema, Document } from 'mongoose';

export type ListingType =
  | 'verified_adsense'
  | 'payment_received_adsense'
  | 'website_bundle'
  | 'youtube_channel';

export type ListingStatus =
  | 'pending_verification'
  | 'pending_payment'
  | 'active'
  | 'sold'
  | 'expired'
  | 'rejected';

export interface IListing extends Document {
  listingId:         string;
  seller:            mongoose.Types.ObjectId;
  type:              ListingType;
  price:             number;
  description:       string;
  niche?:            string;
  accountAge?:       string;
  paymentsReceived?: number;
  totalEarned?:      number;
  trafficMonthly?:   number;
  screenshotUrls:    string[];
  status:            ListingStatus;
  isFeatured:        boolean;
  listingFee:        number;
  feePaid:           boolean;
  feePaidAt?:        Date;
  rejectionReason?:  string;
  viewCount:         number;
  expiresAt:         Date;
  createdAt:         Date;
  updatedAt:         Date;
}

const ListingSchema = new Schema<IListing>(
  {
    listingId:         { type: String, required: true, unique: true, index: true },
    seller:            { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type:              { type: String, required: true, enum: ['verified_adsense','payment_received_adsense','website_bundle','youtube_channel'] },
    price:             { type: Number, required: true, min: 10000 },
    description:       { type: String, required: true, maxlength: 500 },
    niche:             { type: String, maxlength: 100 },
    accountAge:        { type: String },
    paymentsReceived:  { type: Number },
    totalEarned:       { type: Number },
    trafficMonthly:    { type: Number },
    screenshotUrls:    [{ type: String }],
    status:            { type: String, default: 'pending_verification', index: true },
    isFeatured:        { type: Boolean, default: false },
    listingFee:        { type: Number, required: true },
    feePaid:           { type: Boolean, default: false },
    feePaidAt:         { type: Date },
    rejectionReason:   { type: String },
    viewCount:         { type: Number, default: 0 },
    expiresAt:         { type: Date, required: true },
  },
  { timestamps: true }
);

// Auto-expire listings
ListingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IListing>('Listing', ListingSchema);