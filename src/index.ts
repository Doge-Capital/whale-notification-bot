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

const bot = new Telegraf(process.env.BOT_TOKEN!);

const apiKey = process.env.HELIUS_API_KEY;

// Memory usage logging
setInterval(() => {
  const memoryUsage = process.memoryUsage();
  console.log(
    `Memory Usage: RSS=${memoryUsage.rss}, HeapTotal=${memoryUsage.heapTotal}, HeapUsed=${memoryUsage.heapUsed}`
  );
}, 60000); // Log every minute

let ws: WebSocket;
let pingInterval: any;
let pongTimeout: any;

function initializeWebSocket() {
  console.log("Initializing WebSocket...");
  ws = new WebSocket(`wss://atlas-mainnet.helius-rpc.com/?api-key=${apiKey}`);

  function sendRequest() {
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

  function startPing() {
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        console.log("Ping sent");

        pongTimeout = setTimeout(() => {
          console.error("Pong not received in time, closing connection");
          ws.terminate();
        }, 5000);
      }
    }, 30000);
  }

  ws.on("open", function open() {
    console.log("WebSocket is open");
    sendRequest();
    startPing();
  });

  ws.on("message", async function incoming(data) {
    // console.log("Received message");
    const messageStr = data.toString("utf8");
    try {
      const messageObj = JSON.parse(messageStr);

      if (messageObj?.params?.result?.transaction) {
        await callback(messageObj.params.result);
      } else {
        console.log("Received message:", messageObj);
      }
    } catch (e) {
      console.log("Failed to parse JSON:", e);
    }
  });

  ws.on("pong", function pong() {
    console.log("Pong received");
    clearTimeout(pongTimeout);
  });

  ws.on("error", function error(err) {
    console.log("WebSocket error:", err);
  });

  ws.on("close", function close() {
    console.log("WebSocket is closed, attempting to restart...");
    clearInterval(pingInterval);
    clearTimeout(pongTimeout);
    setTimeout(initializeWebSocket, 5000);
  });
}

initializeWebSocket();

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
    setTimeout(() => sendQueuedMessages(groupId), 40000); // Retry after 1 minute
    return;
  }

  const messages = messageQueues[groupId];
  if (messages.length > 0) {
    const message = messages[0];

    try {
      console.log(`Sending message to group ${groupId}`);
      await bot.telegram.sendPhoto(groupId, message.image, {
        caption: message.caption,
        parse_mode: "Markdown",
      });
      messages.shift();
      messageTimestamps[groupId].push(now);
    } catch (error) {
      console.error(`Failed to send message to group ${groupId}:`, error);
      // Retry after 1 minute to avoid spamming retries on persistent errors
      setTimeout(() => sendQueuedMessages(groupId), 40000);
      return;
    }

    // Continue processing messages every second if there are messages left
    setTimeout(() => sendQueuedMessages(groupId), 1000);
  } else {
    delete messageQueues[groupId];
    delete messageTimestamps[groupId];
  }
};

const handleQueuedMessages = () => {
  // console.log("Checking for queued messages...", Object.keys(messageQueues));
  Object.keys(messageQueues).forEach((groupId) => {
    const parsedGroupId = Number(groupId);

    if (
      messageQueues[parsedGroupId].length &&
      !messageTimestamps[parsedGroupId].length
    ) {
      console.log(`Sending queued messages to group ${parsedGroupId}`);
      sendQueuedMessages(parsedGroupId);
    } else {
      console.log(`No queued messages for group ${parsedGroupId}`);
    }
  });

  // Continuously check for new messages
  setTimeout(handleQueuedMessages, 10000);
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

  let message = "*Registered Tokens*";
  let count = 1;
  tokens.forEach((token) => {
    let { tokenMint, name, symbol, minValue, poolAddress } = token;

    const tokenUrl = `https://solscan.io/token/${tokenMint}`;
    const poolUrl = `https://solscan.io/account/${poolAddress}`;

    message +=
      `\n\n${count++}. ${name}` +
      `\nSymbol: *${symbol}*` +
      `\nMinimum Value: *$${minValue}*` +
      `\n[Mint Address](${tokenUrl}) | [Meteora Pool](${poolUrl})`;
  });

  await ctx.reply(message, { parse_mode: "Markdown" });
});

bot.command("register", async (ctx) => {
  try {
    const messageText = ctx.message.text;
    console.log("register message:", messageText);

    const params = messageText.split(" ");

    if (params.length !== 3) {
      await ctx.reply("Usage: /register <token_mint> <min_value>");
      return;
    }

    let [command, tokenMint, minValueStr] = params;

    // Remove non-alphanumeric characters
    tokenMint = tokenMint.replace(/[^a-zA-Z0-9]/g, "");
    minValueStr = minValueStr.replace(/[^a-zA-Z0-9]/g, "");

    const minValue = Number(minValueStr);

    if (isNaN(minValue)) {
      await ctx.reply("Please provide a valid number for the minimum value.");
      return;
    }

    const mintAddress = new PublicKey(tokenMint);

    const connection = new Connection(process.env.BACKEND_RPC!);
    const metaplex = Metaplex.make(connection);

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

    await connectToDatabase();

    const groupId = ctx.chat.id;

    try {
      const token = await metaplex.nfts().findByMint({ mintAddress });
      const name = token.name;
      const symbol = token.symbol;
      const image = token.json?.image;

      const meteoraPools: any = await fetch(
        "https://dlmm-api.meteora.ag/pair/all"
      ).then((res) => res.json());

      const tokenPools = meteoraPools.filter(
        (p: any) => p.mint_x === tokenMint || p.mint_y === tokenMint
      );
      if (tokenPools.length === 0) {
        await ctx.reply("No meteora pool found for this token.");
        return;
      }
      //get pool with highest liquidity
      const pool = tokenPools.reduce((prev: any, current: any) => {
        return prev.liquidity > current.liquidity ? prev : current;
      });

      if (!pool) {
        await ctx.reply("No pool found for this token.");
        return;
      }

      await Token.create({
        groupId,
        tokenMint,
        name,
        symbol,
        image,
        minValue,
        poolAddress: pool.address,
      });

      const tokenUrl = `https://solscan.io/token/${tokenMint}`;
      const poolUrl = `https://solscan.io/account/${pool.address}`;

      await ctx.reply(
        `Registered Token\nName: *${name}*\nSymbol: *${symbol}*\nMinimum Value: *$${minValue}*\n[Mint Address](${tokenUrl}) | [Meteora Pool](${poolUrl})`,
        { parse_mode: "Markdown" }
      );
    } catch (err: any) {
      if (err.code === 11000) {
        await ctx.reply(
          `Token: ${tokenMint} has already been registered for this group.`
        );
      } else {
        await ctx.reply(err.message);
      }
      return;
    }
  } catch (error: any) {
    console.log(error.message);
    await ctx.reply(error.message);
  }
});

bot.command("unregister", async (ctx) => {
  try {
    console.log("unregister message:", ctx.message.text);
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
        await ctx.reply(`Unregistered Token: ${tokenMint}`);
      }
    } catch (err: any) {
      await ctx.reply("An error occurred while unregistering the token.");
    }
  } catch (error: any) {
    console.log(error.message);
    await ctx.reply(error.message);
  }
});

bot.catch((err) => {
  console.error("Error occurred", err);
});

bot.launch().then(() => console.log("Bot started!"));
