// src/models/Broadcast.ts
import mongoose, { Schema, Document } from 'mongoose';

export type BroadcastType   = 'announcement' | 'ad';
export type BroadcastStatus = 'draft' | 'sending' | 'sent' | 'failed';

export interface IBroadcast extends Document {
  broadcastId:    string;
  type:           BroadcastType;
  title:          string;
  body:           string;
  imageUrl?:      string;
  imageCaption?:  string;
  status:         BroadcastStatus;
  sentBy:         string;
  recipientCount: number;
  sentCount:      number;
  createdAt:      Date;
  sentAt?:        Date;
  errorMessage?:  string;
}

const BroadcastSchema = new Schema<IBroadcast>(
  {
    broadcastId:    { type: String, required: true, unique: true, index: true },
    type:           { type: String, required: true, enum: ['announcement', 'ad'] },
    title:          { type: String, required: true },
    body:           { type: String, required: true },
    imageUrl:       { type: String },
    imageCaption:   { type: String },
    status:         { type: String, default: 'draft', index: true },
    sentBy:         { type: String, default: 'admin' },
    recipientCount: { type: Number, default: 0 },
    sentCount:      { type: Number, default: 0 },
    sentAt:         { type: Date },
    errorMessage:   { type: String },
  },
  { timestamps: true },
);

// No callback parameter — returning the promise is enough for Mongoose
// to await it. Mixing async + done() causes the TS "not callable" error.
BroadcastSchema.pre('validate', async function () {
  if (this.broadcastId) return;

  const last = await mongoose
    .model('Broadcast')
    .findOne({}, { broadcastId: 1 })
    .sort({ createdAt: -1 })
    .lean() as { broadcastId?: string } | null;

  let seq = 1;
  if (last?.broadcastId) {
    const match = last.broadcastId.match(/BC-(\d+)/);
    if (match) seq = parseInt(match[1], 10) + 1;
  }
  this.broadcastId = `BC-${String(seq).padStart(4, '0')}`;
});

export default mongoose.model<IBroadcast>('Broadcast', BroadcastSchema);