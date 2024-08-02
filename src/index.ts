import { Metaplex } from "@metaplex-foundation/js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { configDotenv } from "dotenv";
import { Telegraf, Markup } from "telegraf";
import WebSocket from "ws";
import Token from "./models/token";
import connectToDatabase from "./utils/database";
import callback from "./utils/listenerCallback";
import emojiRegex from "emoji-regex";
import UserState from "./models/userState";

configDotenv();

const bot = new Telegraf(process.env.BOT_TOKEN!);

const apiKey = process.env.HELIUS_API_KEY;

function initializeWebSocket() {
  let lastMessageDate = new Date();
  let ws: WebSocket;
  let statusCheckInterval: any;
  let pingInterval: any;
  let pongTimeout: any;

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
          console.log("Pong not received in time, closing connection");
          ws.terminate();
        }, 5000);
      }
    }, 30000);
  }

  function statusCheck() {
    statusCheckInterval = setInterval(() => {
      if (lastMessageDate.getTime() < Date.now() - 20000) {
        console.log(
          "No messages received in the last 20 seconds, closing connection"
        );
        ws.terminate();
      }
    }, 20000);
  }

  ws.on("open", function open() {
    console.log("WebSocket is open");
    sendRequest();
    startPing();
    statusCheck();
  });

  ws.on("message", async function incoming(data) {
    // console.log("Received message");
    const messageStr = data.toString("utf8");
    try {
      const messageObj = JSON.parse(messageStr);

      if (messageObj?.params?.result?.transaction) {
        lastMessageDate = new Date();
        await callback(messageObj.params.result);
      } else {
        console.log("Received message:", messageObj);
        if (messageObj?.params?.error) {
          ws.terminate();
        }
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
    clearInterval(statusCheckInterval);
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
      console.log(`Failed to send message to group ${groupId}:`, error);
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

bot.start(async (ctx) => {
  const [command, groupId] = ctx.payload.split("_");

  if (command === "config" && groupId) {
    await connectToDatabase();
    const tokens = await Token.find({ groupId });

    const inline_keyboard = [
      ...tokens.map((token) => {
        return [
          {
            text: token.name.toUpperCase(),
            callback_data: `tokenSettings_${token._id}`,
          },
        ];
      }),
    ];

    if (tokens.length < 4)
      inline_keyboard.push([
        { text: "➕ Add New Token", callback_data: `add_${groupId}` },
      ]);

    await ctx.reply(
      "*Active Tokens*\n\nTrack upto 4 tokens at once with @MeteoraWhaleBot",
      {
        reply_markup: {
          inline_keyboard,
        },
        parse_mode: "Markdown",
      }
    );
  } else {
    await ctx.reply("*Welcome to Whale Notifier Bot!*", {
      parse_mode: "Markdown",
    });
  }
  return;
});

bot.action(/tokenSettings_/, async (ctx) => {
  const [command, id] = ctx.match.input.split("_");

  await connectToDatabase();
  const token = await Token.findById(id);

  if (!token) {
    await ctx.reply("*Token not found.*", { parse_mode: "Markdown" });
    return;
  }

  await ctx.editMessageText(
    `Token Settings: [${token.name}](https://solscan.io/token/${token.tokenMint})`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `Set Emoji ${token.minValueEmojis}`,
              callback_data: `setEmoji_${id}`,
            },
            {
              text: `💸 Buy Amount $${token.minValue}`,
              callback_data: `buyAmount_${id}`,
            },
          ],
          [
            {
              text: "🚮 Delete Token",
              callback_data: `delete_${id}`,
            },
          ],
        ],
      },
      parse_mode: "Markdown",
      link_preview_options: { is_disabled: true },
    }
  );
  return;
});

bot.action(/setEmoji_/, async (ctx) => {
  const [command, id] = ctx.match.input.split("_");

  await connectToDatabase();
  await UserState.findOneAndUpdate(
    { userId: ctx.from.id },
    {
      $set: {
        state: `setEmoji_${id}`,
      },
    },
    { upsert: true }
  );
  await ctx.reply("*⚙️ Send emoji to appear on buys*", {
    parse_mode: "Markdown",
  });
});

bot.action(/buyAmount/, async (ctx) => {
  const [command, id] = ctx.match.input.split("_");

  await connectToDatabase();
  await UserState.findOneAndUpdate(
    { userId: ctx.from.id },
    {
      $set: {
        state: `buyAmount_${id}`,
      },
    },
    { upsert: true }
  );
  await ctx.reply("*⚙️ Send new minimum buy amount*", {
    parse_mode: "Markdown",
  });
});

bot.action(/delete_/, async (ctx) => {
  const [command, id] = ctx.match.input.split("_");

  await connectToDatabase();
  const result = await Token.findByIdAndDelete(id);

  if (result) {
    await ctx.reply("*Token deleted successfully*", {
      parse_mode: "Markdown",
    });
  }
  return;
});

bot.action(/add_/, async (ctx) => {
  const groupId = ctx.match.input.split("_")[1];
  await connectToDatabase();
  await UserState.findOneAndUpdate(
    { userId: ctx.from.id },
    { groupId, state: "addToken" },
    { upsert: true }
  );

  await ctx.reply(`*⚙️ Send the token address to track*`, {
    parse_mode: "Markdown",
  });
});

bot.hears(/^(?!\/).*/, async (ctx) => {
  try {
    // if not a private message return
    if (ctx.chat.type !== "private") {
      return;
    }

    let message = ctx.message.text;
    if (message.startsWith("/")) {
      return;
    }

    await connectToDatabase();
    const userState = await UserState.findOne({ userId: ctx.from.id });
    if (!userState) {
      return;
    }

    const [state, id] = userState.state.split("_");

    if (state === "addToken") {
      //check if token mint is valid
      let tokenMint = message.replace(/[^a-zA-Z0-9]/g, "");

      const mintAddress = new PublicKey(tokenMint);

      const connection = new Connection(process.env.BACKEND_RPC!);
      const metaplex = Metaplex.make(connection);

      const accInfo = await connection.getAccountInfo(mintAddress);
      if (!accInfo?.owner.equals(TOKEN_PROGRAM_ID)) {
        await ctx.reply("*Please provide a valid token mint address*", {
          parse_mode: "Markdown",
        });
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
        await ctx.reply("*Metadata account info not found*", {
          parse_mode: "Markdown",
        });
        return;
      }

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
        await ctx.reply("*No meteora pool found for this token*", {
          parse_mode: "Markdown",
        });
        return;
      }
      //get pool with highest liquidity
      const pool = tokenPools.reduce((prev: any, current: any) => {
        return prev.liquidity > current.liquidity ? prev : current;
      });

      if (!pool) {
        await ctx.reply("*No pool found for this token*", {
          parse_mode: "Markdown",
        });
        return;
      }

      const minValue = 20;
      const minValueEmojis = "🟢🟢";

      try {
        await Token.create({
          groupId: userState.groupId,
          tokenMint,
          name,
          symbol,
          image,
          minValue,
          minValueEmojis,
          poolAddress: pool.address,
        });
      } catch (err: any) {
        if (err.code === 11000) {
          await ctx.reply(
            `*Token: ${tokenMint} is already registered for this group*`,
            { parse_mode: "Markdown" }
          );
        } else {
          await ctx.reply(err.message);
        }
        return;
      }

      const tokenUrl = `https://solscan.io/token/${tokenMint}`;

      await ctx.reply(
        `Registered Token\nName: *${name}*\nSymbol: *${symbol}*\nMinimum Value: *$${minValue}*\nEmoji ${minValueEmojis}\n[Mint Address](${tokenUrl})`,
        { parse_mode: "Markdown", link_preview_options: { is_disabled: true } }
      );

      await UserState.deleteOne({ userId: ctx.from.id });
    } else if (state === "setEmoji") {
      function containsOnlyEmojis(input: string): boolean {
        const regex = emojiRegex();
        const matches = input.match(regex);

        return matches !== null && matches.join("") === input;
      }

      if (!containsOnlyEmojis(message)) {
        await ctx.reply("*Please provide valid emojis*", {
          parse_mode: "Markdown",
        });
        return;
      }

      const result = await Token.findByIdAndUpdate(id, {
        $set: {
          minValueEmojis: message,
        },
      });

      if (result) {
        await ctx.reply(`*Set Emojis: ${message} for Token: ${result.name}*`, {
          parse_mode: "Markdown",
        });
      } else {
        await ctx.reply(`*Token not found*`, { parse_mode: "Markdown" });
      }
    } else if (state === "buyAmount") {
      const minValue = Number(message);
      if (isNaN(minValue)) {
        await ctx.reply(
          "*Please provide a valid number for the minimum value*",
          { parse_mode: "Markdown" }
        );
        return;
      }

      const result = await Token.findByIdAndUpdate(id, {
        $set: {
          minValue,
        },
      });

      if (result) {
        await ctx.reply(`*Buy Amount: ${minValue} for Token: ${result.name}*`, {
          parse_mode: "Markdown",
        });
      } else {
        await ctx.reply(`*Token not found*`, { parse_mode: "Markdown" });
      }
    }
  } catch (error: any) {
    console.log(error.message);
    await ctx.reply(error.message);
  }
});

bot.command("config", async (ctx) => {
  if (ctx.chat.type === "private") {
    await ctx.reply("*This command can only be used in groups*", {
      parse_mode: "Markdown",
    });
    return;
  }
  const groupId = ctx.chat.id;

  await ctx.reply("*Click the button below to configure the bot*", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Configure Bot 🤖",
            url: `https://t.me/${ctx.botInfo.username}?start=config_${groupId}`,
          },
        ],
      ],
    },
    parse_mode: "Markdown",
  });
});

bot.catch((err) => {
  console.log("Error occurred", err);
});

bot.launch().then(() => console.log("Bot started!"));

bot.command("setup", async (ctx) => {
  //if not a private message return
  if (ctx.chat.type !== "private") {
    await ctx.reply("*This command can only be used in private messages*", {
      parse_mode: "Markdown",
    });
    return;
  }

  ctx.reply(
    "*💫 Fast Setup*\nTo begin, click below and select the group you want to attach your portal to\n\n_(The bot will be automatically added as admin)_",
    {
      parse_mode: "Markdown",
      ...Markup.keyboard([
        [
          {
            text: "➡️ Select a group",
            request_chat: {
              request_id: 1,
              chat_is_channel: false, // Only groups, not channels
              user_administrator_rights: {
                is_anonymous: false,
                can_manage_chat: true,
                can_delete_messages: true,
                can_manage_video_chats: true,
                can_restrict_members: true,
                can_promote_members: true,
                can_change_info: true,
                can_invite_users: true,
              },
              bot_administrator_rights: {
                is_anonymous: false,
                can_manage_chat: true,
                can_delete_messages: true,
                can_manage_video_chats: false,
                can_restrict_members: true,
                can_promote_members: true,
                can_change_info: true,
                can_invite_users: true,
              },
            },
          },
        ],
      ])
        .oneTime()
        .resize(),
    }
  );
});
