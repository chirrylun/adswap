// src/config/db.ts
import mongoose from 'mongoose';

export async function connectDB(): Promise<void> {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI!, {
      maxPoolSize:       10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS:   45000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected. Attempting reconnect...');
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB error:', err);
  });
}