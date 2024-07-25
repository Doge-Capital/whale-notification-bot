import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { configDotenv } from "dotenv";
import { Telegraf } from "telegraf";
import Token from "./models/token";
import connectToDatabase from "./utils/database";
import callback from "./utils/listenerCallback";
configDotenv();

export const bot = new Telegraf(process.env.BOT_TOKEN!);
export const connection = new Connection(process.env.BACKEND_RPC!);

export const subcriptionIds: Record<string, number> = {};

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

    if (subcriptionIds[tokenMint] != null)
      subcriptionIds[tokenMint] = connection.onLogs(
        new PublicKey(tokenMint),
        callback
      );

    console.log(subcriptionIds);

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

    const token = await Token.findOne({ tokenMint });
    if (!token) connection.removeOnLogsListener(subcriptionIds[tokenMint]);

    console.log(subcriptionIds);
  } catch (err: any) {
    await ctx.reply("An error occurred while unregistering the token.");
  }
});

const listener = async () => {
  await connectToDatabase();

  const listenedTokens = await Token.find().distinct("tokenMint");

  console.log("Listening to tokens: ", listenedTokens);
  for (let i = 0; i < listenedTokens.length; i++) {
    const tokenMint = listenedTokens[i];
    subcriptionIds[tokenMint] = connection.onLogs(
      new PublicKey(tokenMint),
      callback
    );
  }
};

listener();

bot.catch((err) => {
  console.error("Error occurred", err);
});

bot.launch().then(() => console.log("Bot started!"));
