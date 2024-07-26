import { Metaplex } from "@metaplex-foundation/js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { configDotenv } from "dotenv";
import { Telegraf } from "telegraf";
import WebSocket from "ws";
import Token from "./models/token";
import connectToDatabase from "./utils/database";
import callback from "./utils/listenerCallback";

configDotenv();

export const bot = new Telegraf(process.env.BOT_TOKEN!);

const apiKey = process.env.HELIUS_API_KEY;
const ws = new WebSocket(
  `wss://atlas-mainnet.helius-rpc.com/?api-key=${apiKey}`
);

function sendRequest(ws: WebSocket) {
  const request = {
    jsonrpc: "2.0",
    id: 420,
    method: "transactionSubscribe",
    params: [
      {
        accountInclude: [
          "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
          "Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB",
        ],
      },
      {
        vote: false,
        failed: false,
        commitment: "finalized",
        encoding: "jsonParsed",
        transactionDetails: "full",
        maxSupportedTransactionVersion: 0,
      },
    ],
  };
  ws.send(JSON.stringify(request));
}

function startPing(ws: WebSocket) {
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
      console.log("Ping sent");
    }
  }, 30000);
}

ws.on("open", function open() {
  console.log("WebSocket is open");
  sendRequest(ws);
  startPing(ws);
});

ws.on("message", function incoming(data) {
  const messageStr = data.toString("utf8");
  try {
    const messageObj = JSON.parse(messageStr);

    if (messageObj?.params) {
      callback(messageObj.params.result);
    }
  } catch (e) {
    console.error("Failed to parse JSON:", e);
  }
});

ws.on("error", function error(err) {
  console.error("WebSocket error:", err);
});

ws.on("close", function close() {
  console.log("WebSocket is closed");
});

export const messageQueues: {
  [key: number]: Array<{ image: string; caption: string }>;
} = {};
export const messageTimestamps: { [key: number]: Array<number> } = {};

const sendQueuedMessages = async (groupId: number) => {
  const now = Date.now();

  // Remove timestamps older than 1 minute
  messageTimestamps[groupId] = messageTimestamps[groupId].filter(
    (timestamp) => now - timestamp < 60000
  );

  // Check if we can send more messages
  if (messageTimestamps[groupId].length >= 20) {
    console.log(`Rate limit reached for group ${groupId}. Skipping...`);
    setTimeout(() => sendQueuedMessages(groupId), 60000); // Retry after 1 minute
    return;
  }

  const messages = messageQueues[groupId];
  if (messages.length > 0) {
    const message = messages[0];

    try {
      await bot.telegram.sendPhoto(groupId, message.image, {
        caption: message.caption,
        parse_mode: "Markdown",
      });
      messages.shift();
      messageTimestamps[groupId].push(now);
    } catch (error) {
      console.error(`Failed to send message to group ${groupId}:`, error);
      // Retry after 1 minute to avoid spamming retries on persistent errors
      setTimeout(() => sendQueuedMessages(groupId), 60000);
      return;
    }
  }

  // Continue processing messages every second if there are messages left
  if (messages.length > 0) {
    setTimeout(() => sendQueuedMessages(groupId), 1000);
  }
};

const handleQueuedMessages = () => {
  Object.keys(messageQueues).forEach((groupId) => {
    if (messageQueues[groupId].length && !messageTimestamps[groupId].length) {
      sendQueuedMessages(Number(groupId));
    }
  });

  // Continuously check for new messages
  setTimeout(handleQueuedMessages, 5000);
};

handleQueuedMessages();

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

  const mintAddress = new PublicKey(tokenMint);

  const connection = new Connection(process.env.BACKEND_RPC!);
  const metaplex = Metaplex.make(connection);

  try {
    const accInfo = await connection.getAccountInfo(mintAddress);
    if (!accInfo?.owner.equals(TOKEN_PROGRAM_ID)) {
      await ctx.reply("Please provide a valid token mint address.");
      return;
    }

    const metadataAccount = metaplex
      .nfts()
      .pdas()
      .metadata({ mint: mintAddress });

    const metadataAccountInfo = await connection.getAccountInfo(
      metadataAccount
    );
    if (!metadataAccountInfo) {
      await ctx.reply("Metadata account info not found.");
      return;
    }
  } catch (error: any) {
    await ctx.reply(error.message);
    return;
  }

  await connectToDatabase();

  const groupId = ctx.chat.id;

  try {
    const token = await metaplex.nfts().findByMint({ mintAddress });
    const name = token.name;
    const symbol = token.symbol;
    const image = token.json!.image;

    await Token.create({
      groupId,
      tokenMint,
      name,
      symbol,
      image,
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
