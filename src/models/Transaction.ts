import mongoose, { Schema, Document } from 'mongoose';

// Simplified status — managed manually via admin dashboard.
// pending:   Transaction created, escrow payment being arranged
// completed: Deal confirmed, payout sent to seller
// cancelled: Deal fell through or was abandoned
export type TransactionStatus = 'pending' | 'completed' | 'cancelled';

export interface ITransaction extends Document {
  transactionId:   string;
  listingId:       string;
  listing:         mongoose.Types.ObjectId;
  buyer:           mongoose.Types.ObjectId;
  seller:          mongoose.Types.ObjectId;

  // ── Amounts ───────────────────────────────────────────────────────────────
  amount:          number;   // what the buyer pays (seller price + fee)
  platformFee:     number;   // AdSwap's cut (added on top, not deducted)
  sellerReceives:  number;   // seller's full asking price

  // ── Status ────────────────────────────────────────────────────────────────
  status:          TransactionStatus;

  // ── Admin notes (optional — for dashboard context) ────────────────────────
  adminNote?:      string;

  // ── Post-trade ────────────────────────────────────────────────────────────
  buyerRating?:    number;
  buyerReview?:    string;
  completedAt?:    Date;
  cancelledAt?:    Date;

  createdAt:       Date;
  updatedAt:       Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    transactionId:  { type: String, required: true, unique: true, index: true },
    listingId:      { type: String, required: true, index: true },
    listing:        { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
    buyer:          { type: Schema.Types.ObjectId, ref: 'User',    required: true, index: true },
    seller:         { type: Schema.Types.ObjectId, ref: 'User',    required: true, index: true },

    amount:         { type: Number, required: true },   // buyer's total payment
    platformFee:    { type: Number, required: true },   // AdSwap fee
    sellerReceives: { type: Number, required: true },   // seller's payout amount

    status:         { type: String, enum: ['pending', 'completed', 'cancelled'], default: 'pending', index: true },
    adminNote:      { type: String },

    // Post-trade
    buyerRating:    { type: Number, min: 1, max: 5 },
    buyerReview:    { type: String, maxlength: 200 },
    completedAt:    { type: Date },
    cancelledAt:    { type: Date },
  },
  { timestamps: true },
);

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);