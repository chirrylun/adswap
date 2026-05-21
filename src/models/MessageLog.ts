// src/models/MessageLog.ts
import mongoose, { Schema, Document } from 'mongoose';

export type MessageCategory =
  | 'new_listing'
  | 'offer'
  | 'transaction'
  | 'dispute'
  | 'system'
  | 'announcement'   // ← new
  | 'ad';            // ← new

export type MessageStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface IMessageLog extends Document {
  wamid:        string;           // Meta message ID — e.g. wamid.xxxx
  to:           string;           // recipient phone
  category:     MessageCategory;  // what kind of broadcast
  refId?:       string;           // listingId, broadcastId, transactionId, etc.
  status:       MessageStatus;
  sentAt:       Date;
  deliveredAt?: Date;
  readAt?:      Date;
  failedAt?:    Date;
}

const MessageLogSchema = new Schema<IMessageLog>(
  {
    wamid:       { type: String, required: true, unique: true, index: true },
    to:          { type: String, required: true, index: true },
    category:    { type: String, required: true, index: true },
    refId:       { type: String, index: true },
    status:      { type: String, default: 'sent', index: true },
    sentAt:      { type: Date,   default: Date.now },
    deliveredAt: { type: Date },
    readAt:      { type: Date },
    failedAt:    { type: Date },
  },
  { timestamps: false },
);

// Compound index — open-rate queries: category + status + date range
MessageLogSchema.index({ category: 1, status: 1, sentAt: -1 });
// Per-listing / per-broadcast open rate
MessageLogSchema.index({ refId: 1, status: 1 });

export default mongoose.model<IMessageLog>('MessageLog', MessageLogSchema);