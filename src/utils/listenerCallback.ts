import { Connection, PublicKey } from "@solana/web3.js";
import { configDotenv } from "dotenv";
import { messageQueues, messageTimestamps } from "..";
import Token from "../models/token";
import TxnSignature from "../models/txnSignature";
import connectToDatabase from "./database";
configDotenv();

const dexscreenerUrl = "https://dexscreener.com/solana/";
const jupiterUrl = "https://jup.ag/swap/USDC-";
const txnUrl = "https://solscan.io/tx/";
const buyerUrl = "https://solscan.io/account/";

const getMarketCap = async (tokenMint: string) => {
  const connection = new Connection(process.env.BACKEND_RPC!);

  const accountInfoPromise = connection.getParsedAccountInfo(
    new PublicKey(tokenMint)
  );
  const tokenPricePromise = fetch(
    `https://price.jup.ag/v6/price?ids=${tokenMint}`
  ).then((res) => res.json());

  const [accountInfoResult, tokenPriceResult] = await Promise.allSettled([
    accountInfoPromise,
    tokenPricePromise,
  ]);

  if (
    accountInfoResult.status !== "fulfilled" ||
    !accountInfoResult.value.value
  ) {
    throw new Error("Account info not found");
  }

  const accountInfo = (accountInfoResult.value.value?.data as any).parsed.info;
  const decimals = accountInfo.decimals;
  const totalSupply = parseInt(accountInfo.supply) / 10 ** decimals;

  if (
    tokenPriceResult.status !== "fulfilled" ||
    !tokenPriceResult.value.data[tokenMint]
  ) {
    throw new Error("Token price not found");
  }

  const tokenPrice = tokenPriceResult.value.data[tokenMint].price;

  if (!totalSupply) throw new Error("Total supply not found");
  const marketCap = totalSupply * tokenPrice;

  return marketCap;
};

const callback = async (data: any) => {
  try {
    if (data.meta.err) return;

    const txnSignature = data.signature;

    await connectToDatabase();
    try {
      await TxnSignature.create({ txnSignature });
    } catch (error: any) {
      if (error.code !== 11000) console.log(txnSignature, error.message);
      return;
    }

    const signer = data.transaction.message.accountKeys.find(
      (acc: any) => acc.signer
    ).pubkey;
    console.log("Signer:", signer);

    const tokenChanges: Record<
      string,
      { isNewHolder: boolean; amount: number; positionIncrease: number }
    > = {};

    const preTokenBalances = data.transaction.meta.preTokenBalances;
    const postTokenBalances = data.transaction.meta.postTokenBalances;

    for (let i = 0; i < preTokenBalances.length; i++) {
      const preTokenBalance = preTokenBalances[i];
      const postTokenBalance = postTokenBalances[i];

      if (preTokenBalance.owner !== signer) continue;

      const mint = preTokenBalance.mint;

      const preTokenAmount = preTokenBalance.uiTokenAmount.uiAmount;
      const postTokenAmount = postTokenBalance.uiTokenAmount.uiAmount;

      if (postTokenAmount === preTokenAmount) continue;

      const isNewHolder = preTokenAmount === 0;
      const amount = Math.abs(postTokenAmount - preTokenAmount);
      const positionIncrease = (amount * 100) / preTokenAmount;

      tokenChanges[mint] = {
        isNewHolder,
        amount,
        positionIncrease,
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

      const marketCap = await getMarketCap(tokenMint);
      const { groupId, image, name, symbol } = listeningGroup;

      const amount = tokenChange.amount.toFixed(2);
      const positionIncrease = tokenChange.positionIncrease.toFixed(2);

      const caption =
        `*${name} Buy!*\n` +
        `Got *${amount} ${symbol}*\n` +
        `*${
          tokenChange.isNewHolder
            ? "New Holder"
            : `Position +${positionIncrease}%`
        }*\n` +
        `[Buyer](${buyerUrl}${signer}) / [Txn](${txnUrl}${txnSignature})\n` +
        `Market Cap *$${marketCap}*\n\n` +
        `[Buy](${jupiterUrl}${txnSignature}) | [Dexscreener](${dexscreenerUrl}${txnSignature})`;

      if (!messageQueues[groupId]) {
        messageQueues[groupId] = [];
      }

      if (!messageTimestamps[groupId]) {
        messageTimestamps[groupId] = [];
      }

      messageQueues[groupId].push({
        image,
        caption,
      });
    }
    return;
  } catch (error: any) {
    console.error(error.message);
    return;
  }
};

export default callback;
