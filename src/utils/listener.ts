import connectToDatabase from "./database";
import Token from "../models/token";
import { Connection, Context, Logs, PublicKey } from "@solana/web3.js";
import TxnSignature from "../models/txnSignature";
import { bot } from "..";

const connection = new Connection(process.env.BACKEND_RPC!);

const listener = async () => {
  let send = true;
  const callback = async (logs: Logs, context: Context) => {
    if (logs.err) return;

    await connectToDatabase();

    await TxnSignature.create({ txnSignature: logs.signature }).catch(() => {
      return;
    });

    const info = await connection.getParsedTransaction(logs.signature, {
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
        `Token: ${tokenMint} has changed by ${(tokenChange).toFixed(2)}`
      );
    }
  };

  connection.onLogs(
    new PublicKey("9fPxdcLmaq11b4rd84NoXWcSgxTEvjb1vVpBpdDH7hWZ"),
    callback
  );

  // connection.onLogs(
  //   new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
  //   callback
  // );

  // connection.onLogs(
  //   new PublicKey("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
  //   callback
  // );

  // connection.onLogs(
  //   new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
  //   callback
  // );

  // connection.onLogs(
  //   new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
  //   callback
  // );
};

export default listener;
