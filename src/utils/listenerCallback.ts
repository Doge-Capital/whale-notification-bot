import { bot } from "..";
import Token from "../models/token";
import TxnSignature from "../models/txnSignature";

const callback = async (data: any) => {
  try {
    const txnSignature = data.signature;
    // console.log("Transaction signature:", txnSignature);

    try {
      await TxnSignature.create({ txnSignature });
    } catch (error: any) {
      if (error.code !== 11000) console.log(txnSignature, error.message);
      return;
    }

    const signer = data.feePayer;

    const tokenChanges: Record<string, number> = {};

    for (let i = 0; i < data.tokenTransfers.length; i++) {
      const fromUser = data.tokenTransfers[i].fromUserAccount;
      const toUser = data.tokenTransfers[i].toUserAccount;

      const mint = data.tokenTransfers[i].mint;

      if (fromUser === signer || toUser === signer) {
        tokenChanges[mint] = Math.abs(data.tokenTransfers[i].tokenAmount);
      }
    }
    // console.log("Token changes:", tokenChanges, txnSignature);

    const listeningGroups = await Token.find({
      tokenMint: { $in: Object.keys(tokenChanges) },
    }).lean();

    for (let i = 0; i < listeningGroups.length; i++) {
      const listeningGroup = listeningGroups[i];
      const tokenMint = listeningGroup.tokenMint;
      const tokenChange = tokenChanges[tokenMint];

      if (tokenChange < listeningGroup.minValue) {
        continue;
      }

      await bot.telegram.sendMessage(
        listeningGroup.groupId,
        `Token: ${tokenMint} has changed by ${tokenChange.toFixed(
          2
        )} in transaction: ${txnSignature}`
      );
    }
    return;
  } catch (error: any) {
    console.error(error.message);
    return;
  }
};

export default callback;
