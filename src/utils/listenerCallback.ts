import { bot } from "..";
import Token from "../models/token";
import TxnSignature from "../models/txnSignature";
import connectToDatabase from "./database";
import fs from "fs";

const dexscreenerUrl = "https://dexscreener.com/solana/";
const jupiterUrl = "https://jup.ag/swap/USDC-";
const txnUrl = "https://solscan.io/tx/";
const buyerUrl = "https://solscan.io/account/";

const callback = async (data: any) => {
  try {
    const txnSignature = data.signature;
    //append txnSignature to a file
    // fs.appendFileSync("txnSignatures.txt", txnSignature + "\n");

    await connectToDatabase();
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

      const { groupId, image, name, symbol } = listeningGroup;

      await bot.telegram.sendPhoto(groupId, image, {
        caption: `*${name} BUY!*\nGot: *${tokenChange.toFixed(
          2
        )} ${symbol}*\n[Buyer](${buyerUrl}${signer}) / [Txn](${txnUrl}${txnSignature})\n\n[BUY](${jupiterUrl}${txnSignature}) | [Dexscreener](${dexscreenerUrl}${txnSignature})`,
        parse_mode: "Markdown",
      });
    }
    return;
  } catch (error: any) {
    console.error(error.message);
    return;
  }
};

export default callback;
