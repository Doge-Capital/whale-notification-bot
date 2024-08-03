import mongoose from "mongoose";

const txnSignatureSchema = new mongoose.Schema(
  {
    txnSignature: {
      type: String,
      required: true,
      unique: true,
    },
  },
  { timestamps: true }
);

txnSignatureSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

const TxnSignature = mongoose.model("TxnSignature", txnSignatureSchema);
export default TxnSignature;
