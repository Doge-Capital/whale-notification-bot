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
### DM Commands
- setup - Setup the portal, add the bot to the group.
### Group Commands
- config - Configure the bot; add/remove tokens to watch and modify their settings.

## Example of the bot in action 
### Watch for swaps of $BUTT
1. Open chat with [@MeteoraWhaleBot](https://t.me/MeteoraWhaleBot)
2. Enter command `/setup`.
3. Select the group you want to add the bot to.
4. From the group chat, enter command `/config`.
5. Click on `Configure Bot` button, this redirects you to the bot DM.
6. Click on `Start` followed by `Add New Token` button.
7. Enter the token CA (eg. 3dCCbYca3jSgRdDiMEeV5e3YKNzsZAp3ZVfzUsbb4be4 for $BUTT).
8. Congrats! The bot is now watching for swaps of $BUTT in the group.

### Change the minimum buy amount for a token
1. From the group chat, enter command `/config`.
2. Click on `Configure Bot` button, this redirects you to the bot DM.
3. Click on `Start` followed by token you want to modify.
4. Click on `Buy Amount` and enter the new minimum buy amount.
5. Done! The bot will now only notify you if the swap amount is above the new minimum buy amount.

## Database Migrations
To create a new migration, run the following command:
```bash
npx migrate-mongo create <migration-name>
```
This will create a new migration file in the `migrations` folder, where required changes are to be specified. To run the migrations, use the following command:
```bash
npx migrate-mongo up
```
To rollback the migrations, use the following command:
```bash
npx migrate-mongo down
```


