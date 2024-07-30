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
const dexTUrl = "https://www.dextools.io/app/en/solana/pair-explorer/";
const solTrendingUrl = "https://t.me/SOLTRENDING";

const getTokenInfo = async (tokenMint: string) => {
  try {
    const connection = new Connection(process.env.BACKEND_RPC!);

    const accountInfoResult: any = await connection.getParsedAccountInfo(
      new PublicKey(tokenMint)
    );

    if (!accountInfoResult.value) {
      console.log("accountInfoResult", accountInfoResult);
      throw new Error("Account info not found");
    }

    async function fetchTokenPrice(tokenMint: string) {
      const url = `https://price.jup.ag/v6/price?ids=${tokenMint},SOL`;
      let attempts = 0;
      const maxAttempts = 7;

      while (attempts < maxAttempts) {
        try {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const tokenPriceResult: any = await fetch(url).then((res) =>
            res.json()
          );
          if (!tokenPriceResult.data[tokenMint]) {
            throw new Error("Token price not found");
          }
          return tokenPriceResult;
        } catch (error: any) {
          attempts++;
          if (attempts >= maxAttempts) {
            throw new Error(
              `Failed to fetch token price after ${maxAttempts} attempts: ${error.message}`
            );
          }
          console.log(`Attempt ${attempts} failed. Retrying...`);
        }
      }
    }

    // Usage
    let tokenPrice: number,
      solPrice: number = 0;
    try {
      const tokenPriceResult = await fetchTokenPrice(tokenMint);
      solPrice = tokenPriceResult.data.SOL.price;

      if (!tokenPriceResult.data[tokenMint])
        throw new Error("SOL price found, token price not found");
      tokenPrice = tokenPriceResult.data[tokenMint].price;
    } catch (error: any) {
      console.log("Fetching token price failed. Trying dexscreener...");
      const data: any = await fetch(
        `https://api.dexscreener.com/latest/dex/pairs/solana/${tokenMint}`
      ).then((res) => res.json());
      tokenPrice = data.pairs[0].priceUsd;

      if (!solPrice) {
        const data: any = await fetch(
          `https://api.dexscreener.com/latest/dex/pairs/solana/So11111111111111111111111111111111111111112`
        ).then((res) => res.json());
        tokenPrice = data.pairs[0].priceUsd;
      }
    }

    const accountInfo = (accountInfoResult.value?.data as any).parsed.info;
    const decimals = accountInfo.decimals;
    const totalSupply = parseInt(accountInfo.supply) / 10 ** decimals;

    if (!totalSupply) throw new Error("Total supply not found");
    const marketCap = Math.floor(totalSupply * tokenPrice).toLocaleString();

    return { marketCap, tokenPrice, solPrice };
  } catch (error: any) {
    console.log("Error in getTokenInfo", error.message);
    return { marketCap: 0, tokenPrice: 0, solPrice: 0 };
  }
};

const callback = async (data: any) => {
  try {
    if (data.transaction.meta.err) return;

    const txnSignature = data.signature;

    await connectToDatabase();
    try {
      await TxnSignature.create({ txnSignature });
    } catch (error: any) {
      if (error.code !== 11000) console.log(txnSignature, error.message);
      return;
    }

    const signer = data.transaction.transaction.message.accountKeys.find(
      (acc: any) => acc.signer
    ).pubkey;

    const tokenChanges: Record<
      string,
      { isNewHolder: boolean; amount: number; positionIncrease: number }
    > = {};

    const preTokenBalances = data.transaction.meta.preTokenBalances;
    const postTokenBalances = data.transaction.meta.postTokenBalances;

    for (let i = 0; i < postTokenBalances.length; i++) {
      const postTokenBalance = postTokenBalances[i];
      const preTokenBalance = preTokenBalances.find(
        (t: any) => t.accountIndex === postTokenBalance.accountIndex
      );

      if (postTokenBalance.owner !== signer) continue;

      const mint = postTokenBalance.mint;

      const preTokenAmount = preTokenBalance?.uiTokenAmount?.uiAmount ?? 0;
      const postTokenAmount = postTokenBalance.uiTokenAmount.uiAmount;

      if (preTokenAmount >= postTokenAmount) continue;

      const isNewHolder = preTokenAmount === 0;
      const amount = Math.abs(postTokenAmount - preTokenAmount);
      const positionIncrease = (amount * 100) / preTokenAmount;

      tokenChanges[mint] = {
        isNewHolder,
        amount,
        positionIncrease,
      };
    }

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

      const { marketCap, tokenPrice, solPrice } = await getTokenInfo(tokenMint);
      let {
        groupId,
        image,
        name,
        symbol,
        minValue,
        minValueEmojis,
        poolAddress,
      } = listeningGroup;

      image =
        image ||
        "https://static.vecteezy.com/system/resources/previews/006/153/238/original/solana-sol-logo-crypto-currency-purple-theme-background-neon-design-vector.jpg";

      const amount = tokenChange.amount.toFixed(2);
      const positionIncrease = tokenChange.positionIncrease.toFixed(2);
      const spentUsd = (tokenChange.amount * tokenPrice).toFixed(2);
      const spentSol = (parseFloat(spentUsd) / solPrice).toFixed(2);

      let caption =
        `*${name.toUpperCase()} Buy!*\n` +
        "__emojis__\n\n" +
        `🔀 Spent *$${spentUsd} (${spentSol} SOL)*\n` +
        `🔀 Got *${amount} ${symbol}*\n` +
        `👤 [Buyer](${buyerUrl}${signer}) / [Txn](${txnUrl}${txnSignature})\n` +
        `🪙 *${
          tokenChange.isNewHolder
            ? "New Holder"
            : `Position +${positionIncrease}%`
        }*\n` +
        `💸 Market Cap *$${marketCap}*\n\n` +
        `[Screener](${dexscreenerUrl}${poolAddress}) |` +
        ` [DexT](${dexTUrl}${poolAddress}) |` +
        ` [Buy](${jupiterUrl}${tokenMint})`;

      let remainingLength = 1024 - caption.length;
      remainingLength -= remainingLength % minValueEmojis.length;

      let emojis = "";
      const times = Math.min(
        Math.floor(tokenChange.amount / minValue),
        remainingLength / minValueEmojis.length
      );
      for (let i = 0; i < times; i++) emojis += minValueEmojis;

      // emojis = emojis.match(/.{1,20}/g)?.join("\n") || "";

      // emojis = emojis.slice(0, remainingLength);
      caption = caption.replace("__emojis__", emojis);

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
