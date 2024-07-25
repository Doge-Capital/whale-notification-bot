import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { configDotenv } from "dotenv";
import { Telegraf } from "telegraf";
import Token from "./models/token";
import connectToDatabase from "./utils/database";
import callback from "./utils/listenerCallback";
import express from "express";
configDotenv();

export const bot = new Telegraf(process.env.BOT_TOKEN!);
export const connection = new Connection(process.env.BACKEND_RPC!);

const app = express();

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

app.use(express.json());

app.post("/webhook", async (req, res) => {
  const data = req.body;
  callback(data[0])
});

bot.start((ctx) => {
  if (ctx.chat.type === "private") {
    ctx.reply("Welcome to Whale Notifier Bot!");
  } else if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    ctx.reply("Whale Notifier Bot has been added to this group!");
  }
});

bot.command("list", async (ctx) => {
  await connectToDatabase();

  const tokens = await Token.find({ groupId: ctx.chat.id });

  if (tokens.length === 0) {
    await ctx.reply("No tokens have been registered for this group.");
    return;
  }

  let message = "Registered tokens:\n";
  tokens.forEach((token) => {
    message += `Token: ${token.tokenMint}, Minimum Value: ${token.minValue}\n`;
  });

  await ctx.reply(message);
});

bot.command("register", async (ctx) => {
  const messageText = ctx.message.text;
  const params = messageText.split(" ");

  if (params.length !== 3) {
    await ctx.reply("Usage: /register <token_mint> <min_value>");
    return;
  }

  const [command, tokenMint, minValueStr] = params;
  const minValue = Number(minValueStr);

  if (isNaN(minValue)) {
    await ctx.reply("Please provide a valid number for the minimum value.");
    return;
  }

  try {
    const accInfo = await connection.getAccountInfo(new PublicKey(tokenMint));
    if (!accInfo?.owner.equals(TOKEN_PROGRAM_ID)) {
      await ctx.reply("Please provide a valid token mint address.");
      return;
    }
  } catch (error: any) {
    await ctx.reply(error.message);
    return;
  }

  await connectToDatabase();

  const groupId = ctx.chat.id;

  try {
    await Token.create({
      groupId,
      tokenMint,
      minValue,
    });

    await ctx.reply(
      `Registered token: ${tokenMint}, with minimum value: ${minValue}`
    );
  } catch (err: any) {
    if (err.code === 11000) {
      await ctx.reply(
        `Token: ${tokenMint} has already been registered for this group.`
      );
    } else {
      await ctx.reply("An error occurred while registering the token.");
    }
    return;
  }
});

bot.command("unregister", async (ctx) => {
  const messageText = ctx.message.text;
  const params = messageText.split(" ");

  if (params.length !== 2) {
    await ctx.reply("Usage: /unregister <token_mint>");
    return;
  }

  const [command, tokenMint] = params;

  try {
    await connectToDatabase();
    const result = await Token.deleteOne({
      groupId: ctx.chat.id,
      tokenMint,
    });

    if (result.deletedCount === 0) {
      await ctx.reply(
        `Token: ${tokenMint} has not been registered for this group.`
      );
    } else {
      await ctx.reply(`Unregistered token: ${tokenMint}`);
    }
  } catch (err: any) {
    await ctx.reply("An error occurred while unregistering the token.");
  }
});

bot.catch((err) => {
  console.error("Error occurred", err);
});

bot.launch().then(() => console.log("Bot started!"));
