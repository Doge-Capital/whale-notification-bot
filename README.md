# Whale Notification Bot
A telegram bot which watches and sends message to the group when a swap above threshold amount takes place for the solana SPL-TOKEN on meteora pools. Currently, the bot is limited to 4 tokens per group (this can be modified in the by changing _maxTokensPerGroup_).

## Executing on local

### Environment variables
Create an .env file and add the following variables.
```.env
BOT_TOKEN=
DB_URI=
HELIUS_API_KEY=
BACKEND_RPC=
BIRDSEYE_API_KEY=
```
### Running the bot
```bash
yarn install
yarn start
```

## Telegram Bot Commands
- config - Configure the bot; add/remove tokens to watch and modify their settings.
- setup - Setup the portal, add the bot to the group.