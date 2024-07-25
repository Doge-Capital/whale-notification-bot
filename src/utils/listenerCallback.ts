import { Context, Logs } from "@solana/web3.js";
import { bot, connection } from "..";
import Token from "../models/token";
import TxnSignature from "../models/txnSignature";

const callback = async (logs: Logs, context: Context) => {
  try {
    if (logs.err) return;

    const txnSignature = logs.signature;

    try {
      await TxnSignature.create({ txnSignature });
    } catch (error) {
      return;
    }

    const info = await connection.getParsedTransaction(txnSignature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!info || !info.meta) return;

    const preTokenBalances = info.meta.preTokenBalances;
    const postTokenBalances = info.meta.postTokenBalances;

    if (!preTokenBalances || !postTokenBalances) return;

    const signer = info.transaction.message.accountKeys
      .find((key) => key.signer)
      ?.pubkey.toBase58();

    const tokenChanges: Record<string, number> = {};

    for (let i = 0; i < preTokenBalances.length; i++) {
      const preTokenBalance = preTokenBalances[i];
      const postTokenBalance = postTokenBalances[i];

      if (!preTokenBalance || !postTokenBalance) continue;

      if (preTokenBalance.owner !== signer) continue;

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
