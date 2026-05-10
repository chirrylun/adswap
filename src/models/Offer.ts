import mongoose, { Schema, Document } from 'mongoose';
import { ListingType } from './Listing';

// ── Status flow ───────────────────────────────────────────────────────────────
// pending        → buyer submitted, awaiting seller response
// countered      → seller replied with a different price, awaiting buyer
// buyer_countered → buyer replied to a counter, awaiting seller again
// accepted       → either party accepted — transaction should be created
// rejected       → either party rejected with no counter
// expired        → TTL / no response within window
// cancelled      → buyer withdrew before any response

export type OfferStatus =
  | 'pending'
  | 'countered'
  | 'buyer_countered'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface IOfferEvent {
  actor:   'buyer' | 'seller';
  action:  'offer' | 'counter' | 'accept' | 'reject' | 'cancel';
  amount?: number;
  at:      Date;
}

export interface IOffer extends Document {
  offerId:    string;
  listingId:  string;
  listing:    mongoose.Types.ObjectId;
  buyer:      mongoose.Types.ObjectId;
  seller:     mongoose.Types.ObjectId;

  // The current active price being negotiated
  amount:     number;

  // Who needs to respond next (drives routing in handler)
  turn:       'buyer' | 'seller';

  status:     OfferStatus;

  // Full negotiation log
  history:    IOfferEvent[];

  expiresAt:  Date;
  createdAt:  Date;
  updatedAt:  Date;
}

const OfferEventSchema = new Schema<IOfferEvent>(
  {
    actor:  { type: String, enum: ['buyer', 'seller'], required: true },
    action: { type: String, enum: ['offer', 'counter', 'accept', 'reject', 'cancel'], required: true },
    amount: { type: Number },
    at:     { type: Date, required: true },
  },
  { _id: false },
);

const OfferSchema = new Schema<IOffer>(
  {
    offerId:   { type: String, required: true, unique: true, index: true },
    listingId: { type: String, required: true, index: true },
    listing:   { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
    buyer:     { type: Schema.Types.ObjectId, ref: 'User',    required: true, index: true },
    seller:    { type: Schema.Types.ObjectId, ref: 'User',    required: true, index: true },

    amount:    { type: Number, required: true },
    turn:      { type: String, enum: ['buyer', 'seller'], required: true },

    status: {
      type:    String,
      enum:    ['pending', 'countered', 'buyer_countered', 'accepted', 'rejected', 'expired', 'cancelled'],
      default: 'pending',
      index:   true,
    },

    history: { type: [OfferEventSchema], default: [] },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// Auto-expire stale offers after 72 hours
OfferSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Fast lookup: all active offers for a listing (for seller dashboard / admin)
OfferSchema.index({ listingId: 1, status: 1 });

// Fast lookup: all offers a buyer has made
OfferSchema.index({ buyer: 1, status: 1 });

export default mongoose.model<IOffer>('Offer', OfferSchema);