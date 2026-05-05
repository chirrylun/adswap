import mongoose, { Schema, Document } from 'mongoose';

export type DisputeStatus = 'open' | 'under_review' | 'resolved_buyer' | 'resolved_seller' | 'closed';
export type DisputeReason =
  | 'account_not_accessible'
  | 'account_suspended'
  | 'details_mismatch'
  | 'seller_unresponsive'
  | 'other';

export interface IDispute extends Document {
  disputeId:     string;
  transaction:   mongoose.Types.ObjectId;
  raisedBy:      mongoose.Types.ObjectId;
  reason:        DisputeReason;
  description:   string;
  evidenceUrls:  string[];
  status:        DisputeStatus;
  adminNotes?:   string;
  resolution?:   string;
  resolvedAt?:   Date;
  createdAt:     Date;
  updatedAt:     Date;
}

const DisputeSchema = new Schema<IDispute>(
  {
    disputeId:    { type: String, required: true, unique: true, index: true },
    transaction:  { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
    raisedBy:     { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason:       { type: String, required: true, enum: ['account_not_accessible','account_suspended','details_mismatch','seller_unresponsive','other'] },
    description:  { type: String, required: true, maxlength: 1000 },
    evidenceUrls: [{ type: String }],
    status:       { type: String, default: 'open', index: true },
    adminNotes:   { type: String },
    resolution:   { type: String },
    resolvedAt:   { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<IDispute>('Dispute', DisputeSchema);