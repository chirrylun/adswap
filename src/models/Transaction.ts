import mongoose, { Schema, Document } from 'mongoose';

export type TransactionStatus =
  | 'awaiting_payment'       // txn created, buyer has payment link, waiting for FW confirmation
  | 'transfer_in_progress'   // payment confirmed + escrowed, seller notified to share credentials
  | 'pending_release'        // buyer confirmed OR 48hr elapsed — awaiting admin payout
  | 'completed'              // payout sent to seller
  | 'disputed'               // buyer raised a dispute within 48hr window
  | 'refunded'               // dispute resolved in buyer's favour
  | 'expired';               // never paid (cleanup job)

export interface ITransaction extends Document {
  transactionId:       string;
  listingId:           string;                    // denormalised for quick webhook lookup
  listing:             mongoose.Types.ObjectId;
  buyer:               mongoose.Types.ObjectId;
  seller:              mongoose.Types.ObjectId;
  amount:              number;
  platformFee:         number;
  sellerReceives:      number;

  // ── Payment ────────────────────────────────────────────────────────────────
  flutterwaveRef?:     string;                    // FW transaction id (data.id from webhook)
  flutterwaveTxRef?:   string;                    // FW tx_ref (e.g. adswap_ADS-XXXXX_timestamp)
  escrowHeld:          boolean;

  // ── Seller bank details (collected during credential flow) ─────────────────
  sellerBankName?:     string;
  sellerBankAccount?:  string;
  sellerAccountName?:  string;

  // ── Status + timeline ─────────────────────────────────────────────────────
  status:              TransactionStatus;
  transferStartedAt?:  Date;                      // FW payment confirmed
  sellerReadyAt?:      Date;                      // seller finished sharing credentials
  confirmedAt?:        Date;                      // buyer sent CONFIRM
  releaseAt?:          Date;                      // when pending_release was triggered
  disputeRaisedAt?:    Date;
  escrowReleasedAt?:   Date;
  completedAt?:        Date;
  refundedAt?:         Date;

  // ── Post-trade ────────────────────────────────────────────────────────────
  buyerRating?:        number;
  buyerReview?:        string;

  createdAt:           Date;
  updatedAt:           Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    transactionId:      { type: String, required: true, unique: true, index: true },
    listingId:          { type: String, required: true, index: true },
    listing:            { type: Schema.Types.ObjectId, ref: 'Listing',  required: true },
    buyer:              { type: Schema.Types.ObjectId, ref: 'User',     required: true, index: true },
    seller:             { type: Schema.Types.ObjectId, ref: 'User',     required: true, index: true },
    amount:             { type: Number, required: true },
    platformFee:        { type: Number, required: true },
    sellerReceives:     { type: Number, required: true },

    // Payment
    flutterwaveRef:     { type: String, index: true },
    flutterwaveTxRef:   { type: String },
    escrowHeld:         { type: Boolean, default: false },

    // Seller bank (written once during credential flow)
    sellerBankName:     { type: String },
    sellerBankAccount:  { type: String },
    sellerAccountName:  { type: String },

    // Status
    status:             { type: String, default: 'awaiting_payment', index: true },

    // Timeline
    transferStartedAt:  { type: Date },
    sellerReadyAt:      { type: Date },
    confirmedAt:        { type: Date },
    releaseAt:          { type: Date },
    disputeRaisedAt:    { type: Date },
    escrowReleasedAt:   { type: Date },
    completedAt:        { type: Date },
    refundedAt:         { type: Date },

    // Post-trade
    buyerRating:        { type: Number, min: 1, max: 5 },
    buyerReview:        { type: String, maxlength: 200 },
  },
  { timestamps: true },

  
);

export default mongoose.model<ITransaction>('Transaction', TransactionSchema);