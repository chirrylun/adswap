import mongoose, { Schema, Document } from 'mongoose';

export interface ISession extends Document {
  phone:     string;
  step:      string;
  data:      Record<string, any>;
  updatedAt: Date;
}

const SessionSchema = new Schema<ISession>({
  phone:     { type: String, required: true, unique: true, index: true },
  step:      { type: String, default: 'idle' },
  data:      { type: Schema.Types.Mixed, default: {} },
  updatedAt: { type: Date, default: Date.now },
});

// Auto-delete sessions inactive for 2 hours
SessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7200 });

export default mongoose.model<ISession>('Session', SessionSchema);