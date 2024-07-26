import mongoose from "mongoose";

const tokenSchema = new mongoose.Schema(
  {
    groupId: {
      type: Number,
      required: true,
    },
    tokenMint: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    symbol: {
      type: String,
      required: true,
    },
    image: {
      type: String,
      required: true,
    },
    minValue: {
      type: Number,
      required: true,
    },
    minValueEmojis: {
      type: String,
      required: true,
      default: "🟢🟢🟢",
    },
    poolAddress: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

tokenSchema.index({ groupId: 1, tokenMint: 1 }, { unique: true });

const Token = mongoose.model("Token", tokenSchema);
export default Token;
