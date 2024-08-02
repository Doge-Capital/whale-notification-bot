import mongoose from "mongoose";

const userStateSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
    },
    groupId: {
      type: Number,
      required: true,
    },
    state: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

const UserState = mongoose.model("UserState", userStateSchema);

export default UserState;
