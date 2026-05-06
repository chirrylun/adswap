import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'MODERATOR';

export interface IAdmin extends Document {
  name:         string;
  email:        string;
  passwordHash: string;
  adminRole:    AdminRole;
  lastLoginAt?: Date;
  comparePassword(plain: string): Promise<boolean>;
}

const AdminSchema = new Schema<IAdmin>({
  name:         { type: String, required: true, trim: true },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  adminRole:    { type: String, enum: ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'], default: 'ADMIN' },
  lastLoginAt:  { type: Date },
}, { timestamps: true });

AdminSchema.methods.comparePassword = function (plain: string): Promise<boolean> {
  return bcrypt.compare(plain, this.passwordHash);
};

export default mongoose.model<IAdmin>('Admin', AdminSchema);