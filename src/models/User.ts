import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
  phone:            string;
  name?:            string;
  bankAccountName?:   string;
bankAccountNumber?: string;
bankCode?:          string;
bankName?:          string;
  paystackRecipientCode?: string;
  sellerRating:     number;
  totalRatings:     number;
  totalSales:       number;
  totalPurchases:   number;
  isVerified:       boolean;
  isBanned:         boolean;
  banReason?:       string;
  joinedAt:         Date;
  lastActiveAt:     Date;
}

const UserSchema = new Schema<IUser>({
  phone:            { type: String, required: true, unique: true, index: true },
  name:             { type: String, trim: true },
  bankAccountName:         { type: String },
  bankAccountNumber:      { type: String },
  bankCode:         { type: String },
  paystackRecipientCode: { type: String },
  sellerRating:     { type: Number, default: 0, min: 0, max: 5 },
  totalRatings:     { type: Number, default: 0 },
  totalSales:       { type: Number, default: 0 },
  totalPurchases:   { type: Number, default: 0 },
  isVerified:       { type: Boolean, default: false },
  isBanned:         { type: Boolean, default: false },
  banReason:        { type: String },
  joinedAt:         { type: Date, default: Date.now },
  lastActiveAt:     { type: Date, default: Date.now },
});

UserSchema.methods.getRatingDisplay = function(): string {
  if (this.totalSales === 0) return '🆕 New seller';
  return `⭐ ${this.sellerRating.toFixed(1)} (${this.totalSales} sales)`;
};

export default mongoose.model<IUser>('User', UserSchema);