import mongoose, { Schema, Document } from "mongoose";
import { ListingType } from "./Listing";

export type RequestStatus = "open" | "filled" | "cancelled";

export interface IRequest extends Document {
  requestId: string;
  requester: mongoose.Types.ObjectId;
  type: ListingType;
  budget: number;
  notes: string;
  details?: string;

  status: RequestStatus;
  respondents: mongoose.Types.ObjectId[];
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const RequestSchema = new Schema<IRequest>(
  {
    requestId: { type: String, required: true, unique: true, index: true },
    requester: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "google_ad_account",
        "facebook_ad_account",
        "adsense_site",
        "play_console",
        "gift_card",
        "twitter_account",
        "instagram_account",
        "tiktok_account",
      ],
    },
    budget: { type: Number },
    notes: { type: String, maxlength: 300 },
    details: { type: String, maxlength: 300 },
    status: {
      type: String,
      enum: ["open", "filled", "cancelled"],
      default: "open",
      index: true,
    },
    respondents: [{ type: Schema.Types.ObjectId, ref: "User" }],
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

RequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IRequest>("Request", RequestSchema);
