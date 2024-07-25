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

    const tokenChanges: Record<
      string,
      { isNewHolder: boolean; amount: number; buyOrSell: string }
    > = {};

    for (let i = 0; i < data.tokenTransfers.length; i++) {
      const fromUser = data.tokenTransfers[i].fromUserAccount;
      const toUser = data.tokenTransfers[i].toUserAccount;

      const mint = data.tokenTransfers[i].mint;

      if (fromUser !== signer && toUser !== signer) continue;

      const buyOrSell = toUser === signer ? "BUY" : "SELL";

      const ata =
        fromUser === signer
          ? data.tokenTransfers[i].fromTokenAccount
          : data.tokenTransfers[i].toTokenAccount;

      const isNewHolder = data.nativeTransfers.some(
        (transfer: any) => transfer.toUserAccount === ata && transfer.amount > 0
      );

      tokenChanges[mint] = {
        isNewHolder,
        amount: Math.abs(data.tokenTransfers[i].tokenAmount),
        buyOrSell,
      };
    }
    // console.log("Token changes:", tokenChanges, txnSignature);

    const listeningGroups = await Token.find({
      tokenMint: { $in: Object.keys(tokenChanges) },
    }).lean();

    for (let i = 0; i < listeningGroups.length; i++) {
      const listeningGroup = listeningGroups[i];
      const tokenMint = listeningGroup.tokenMint;
      const tokenChange = tokenChanges[tokenMint];

      if (tokenChange.amount < listeningGroup.minValue) {
        continue;
      }

      const { groupId, image, name, symbol } = listeningGroup;

      await bot.telegram.sendPhoto(groupId, image, {
        caption: `*${name} ${
          tokenChange.buyOrSell
        }!*\nGot: *${tokenChange.amount.toFixed(2)} ${symbol}*\n${
          tokenChange.isNewHolder ? "New Holder" : "Existing Holder"
        }\n[Buyer](${buyerUrl}${signer}) / [Txn](${txnUrl}${txnSignature})\n\n[Buy](${jupiterUrl}${txnSignature}) | [Dexscreener](${dexscreenerUrl}${txnSignature})`,
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
