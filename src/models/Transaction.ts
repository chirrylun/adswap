import mongoose, { Schema, Document } from 'mongoose';

export type TransactionStatus =
  | 'awaiting_payment'
  | 'payment_confirmed'
  | 'transfer_in_progress'
  | 'buyer_confirming'
  | 'completed'
  | 'disputed'
  | 'refunded'
  | 'expired';

export interface ITransaction extends Document {
  transactionId:      string;
  listing:            mongoose.Types.ObjectId;
  buyer:              mongoose.Types.ObjectId;
  seller:             mongoose.Types.ObjectId;
  amount:             number;
  platformFee:        number;
  sellerReceives:     number;
  paystackReference?: string;
  escrowHeld:         boolean;
  status:             TransactionStatus;
  transferStartedAt?: Date;
  sellerReadyAt?:     Date;
  buyerConfirmedAt?:  Date;
  completedAt?:       Date;
  disputeRaisedAt?:   Date;
  escrowReleasedAt?:  Date;
  refundedAt?:        Date;
  buyerRating?:       number;
  buyerReview?:       string;
  createdAt:          Date;
  updatedAt:          Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    transactionId:     { type: String, required: true, unique: true, index: true },
    listing:           { type: Schema.Types.ObjectId, ref: 'Listing', required: true },
    buyer:             { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    seller:            { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount:            { type: Number, required: true },
    platformFee:       { type: Number, required: true },
    sellerReceives:    { type: Number, required: true },
    paystackReference: { type: String, index: true },
    escrowHeld:        { type: Boolean, default: false },
    status:            { type: String, default: 'awaiting_payment', index: true },
    transferStartedAt: { type: Date },
    sellerReadyAt:     { type: Date },
    buyerConfirmedAt:  { type: Date },
    completedAt:       { type: Date },
    disputeRaisedAt:   { type: Date },
    escrowReleasedAt:  { type: Date },
    refundedAt:        { type: Date },
    buyerRating:       { type: Number, min: 1, max: 5 },
    buyerReview:       { type: String, maxlength: 200 },
  },
  { timestamps: true }
);

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);