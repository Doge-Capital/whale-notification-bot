import { configDotenv } from "dotenv";
import { Telegraf } from "telegraf";
import connectToDatabase from "./utils/database";
import Token from "./models/token";
configDotenv();

const bot = new Telegraf(process.env.BOT_TOKEN!);

// Respond to /start command
bot.start((ctx) => {
  if (ctx.chat.type === "private") {
    ctx.reply("Welcome to Whale Notifier Bot!");
  } else if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    ctx.reply("Whale Notifier Bot has been added to this group!");
  }
});

bot.command("gm", (ctx) => {
  if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
    ctx.reply("Good Morning!");
  }
});

bot.command("register", async (ctx) => {
  const messageText = ctx.message.text;
  const params = messageText.split(" ");

  if (params.length !== 3) {
    await ctx.reply("Usage: /register <token> <min_value>");
    return;
  }

  const [command, token, minValueStr] = params;
  const minValue = Number(minValueStr);

  if (isNaN(minValue)) {
    await ctx.reply("Please provide a valid number for the minimum value.");
    return;
  }

  await connectToDatabase();

  const groupId = ctx.chat.id;

  try {
    await Token.create({
      groupId,
      tokenMint: token,
      minValue,
    });
    await ctx.reply(
      `Registered token: ${token}, with minimum value: ${minValue} in group: ${groupId}`
    );
  } catch (err: any) {
    if (err.code === 11000) {
      await ctx.reply(
        `Token: ${token} has already been registered for this group.`
      );
    } else {
      await ctx.reply("An error occurred while registering the token.");
    }
    return;
  }
});

// Error handling
bot.catch((err) => {
  console.error("Error occurred", err);
});

// Start the bot
bot.launch().then(() => console.log("Bot started!"));
