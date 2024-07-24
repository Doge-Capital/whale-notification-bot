import mongoose from "mongoose";
import { configDotenv } from "dotenv";
configDotenv();

declare global {
  var mongoose: any; // This must be a `var` and not a `let / const`
}

const DB_URI = process.env.DB_URI!;

if (!DB_URI) {
  throw new Error(
    "Please define the DB_URI environment variable inside .env.local"
  );
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectToDatabase() {
  if (cached.conn) {
    return cached.conn;
  }
  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
    };
    cached.promise = mongoose.connect(DB_URI, opts).then((mongoose) => {
      return mongoose;
    });
  }
  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

export default connectToDatabase;
