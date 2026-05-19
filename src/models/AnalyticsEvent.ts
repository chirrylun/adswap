// src/models/AnalyticsEvent.ts
import mongoose, { Schema, Document } from 'mongoose';

export interface IAnalyticsEvent extends Document {
  event:     string;           // e.g. 'listing_viewed'
  phone:     string;           // hashed or raw depending on your privacy stance
  sessionStep?: string;        // what step they were on when it fired
  meta?:     Record<string, any>; // e.g. { listingId, type, category }
  createdAt: Date;
}

const AnalyticsEventSchema = new Schema<IAnalyticsEvent>({
  event:       { type: String, required: true, index: true },
  phone:       { type: String, required: true, index: true },
  sessionStep: { type: String },
  meta:        { type: Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } });

AnalyticsEventSchema.index({ event: 1, createdAt: -1 });
AnalyticsEventSchema.index({ phone: 1, createdAt: -1 });

export default mongoose.model<IAnalyticsEvent>('AnalyticsEvent', AnalyticsEventSchema);