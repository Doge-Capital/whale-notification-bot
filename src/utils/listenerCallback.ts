import { Context, Logs } from "@solana/web3.js";
import { bot, connection } from "..";
import Token from "../models/token";
import TxnSignature from "../models/txnSignature";

const callback = async (logs: Logs, context: Context) => {
  try {
    if (logs.err) return;

    const txnSignature = logs.signature;
    console.log("Transaction signature:", txnSignature);

    try {
      await TxnSignature.create({ txnSignature });
    } catch (error: any) {
      if (error.code !== 11000) console.log();
      return;
    }

    const info = await connection.getParsedTransaction(txnSignature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });

    if (!info || !info.meta) return;

    const preTokenBalances = info.meta.preTokenBalances;
    const postTokenBalances = info.meta.postTokenBalances;

    if (!preTokenBalances || !postTokenBalances) return;

    const signers = info.transaction.message.accountKeys
      .filter((key) => key.signer)
      .map((key) => key.pubkey.toBase58());

    const tokenChanges: Record<string, number> = {};

    for (let i = 0; i < preTokenBalances.length; i++) {
      const preTokenBalance = preTokenBalances[i];
      const postTokenBalance = postTokenBalances[i];

      if (!preTokenBalance || !postTokenBalance || !preTokenBalance.owner)
        continue;

      if (!signers.includes(preTokenBalance.owner)) continue;

      const mint = preTokenBalance.mint;

      if (
        preTokenBalance.uiTokenAmount.uiAmount !==
        postTokenBalance.uiTokenAmount.uiAmount
      ) {
        tokenChanges[mint] = Math.abs(
          postTokenBalance.uiTokenAmount.uiAmount! -
            preTokenBalance.uiTokenAmount.uiAmount!
        );
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
