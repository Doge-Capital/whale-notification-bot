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
    image: String,
    minValue: {
      type: Number,
      required: true,
    },
    emojis: {
      type: String,
      required: true,
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
