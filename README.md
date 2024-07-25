# Whale Notification Bot
A telegram bot which watches and sends message to the group when a swap above threshold amount takes place for the solana SPL-TOKEN.

## Environment variables

```.env
BOT_TOKEN=
DB_URI=
BACKEND_RPC=
```

## Commands
- list - Get the list of tokens and the min. amount registered. Usage : /list
- register - Register the token with min. amount. Usage : /register <token_mint> <min_value>
- unregister - Unregister a token. Usage : /unregister <token_mint>