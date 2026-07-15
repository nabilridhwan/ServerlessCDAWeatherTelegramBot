# CDA ARMS Weather Bot Serverless

A Cloudflare Workers monorepo for a Telegram bot that sends Singapore weather and activity restriction updates to subscribed chats.

## Services

- `telegram-bot-worker`: Telegram webhook, bot commands, D1 subscription state, and scheduled broadcasts.
- `weather-wbgt-service`: Fetches WBGT weather data and caches it in Cloudflare KV.
- `weather-cat-service`: Fetches CAT status data and caches it in Cloudflare KV.

The Telegram worker calls the weather workers through Cloudflare service bindings.

## Requirements

- Node.js
- pnpm
- A Cloudflare account with Wrangler access
- A Telegram bot token
- A data.gov.sg API key for WBGT data

## Install

```bash
pnpm install
```

## Environment Variables and Secrets

Local `.env` and `.dev.vars` files are used for local development and tooling. Deployed Worker secrets are stored in Cloudflare with `wrangler secret put`.

Do not store sensitive values in `wrangler.jsonc`. Use Wrangler secrets for deployed Workers and keep local secret files out of git.

### `telegram-bot-worker`

Create `telegram-bot-worker/.env` from `telegram-bot-worker/.env.example` for Drizzle D1 commands:

```bash
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_DATABASE_ID=
CLOUDFLARE_D1_TOKEN=
```

Create `telegram-bot-worker/.dev.vars` for local bot development:

```bash
BOT_TOKEN=
```

Store the development/default Worker Telegram bot token in Cloudflare with Wrangler:

```bash
cd telegram-bot-worker
wrangler secret put BOT_TOKEN
```

Store the production Telegram bot token in the `production` environment:

```bash
cd telegram-bot-worker
wrangler secret put BOT_TOKEN --env production
```

Wrangler prompts for the secret value. Do not pass the token directly in the command.

`BOT_INFO` is a non-secret Worker variable stored in `telegram-bot-worker/wrangler.jsonc`.

### `weather-wbgt-service`

Create `weather-wbgt-service/.dev.vars` or `weather-wbgt-service/.env` from `weather-wbgt-service/.env.example` for local development:

```bash
DATA_GOV_API_KEY=
```

Store the deployed WBGT API key in Cloudflare with Wrangler:

```bash
cd weather-wbgt-service
wrangler secret put DATA_GOV_API_KEY
```

If a `production` environment is added to `weather-wbgt-service/wrangler.jsonc`, set its production secret with:

```bash
cd weather-wbgt-service
wrangler secret put DATA_GOV_API_KEY --env production
```

Wrangler prompts for the secret value. Do not pass the API key directly in the command.

### `weather-cat-service`

No secret environment variables are currently required.

### Cloudflare Bindings

These bindings are configured in each service's `wrangler.jsonc` file:

- `TELEGRAM_BOT_STATE`: D1 database binding for bot subscription state.
- `WEATHER_CACHE`: KV namespace binding for cached weather responses.
- `WEATHER_WBGT_SERVICE`: service binding from the Telegram worker to the WBGT worker.
- `WEATHER_CAT_SERVICE`: service binding from the Telegram worker to the CAT worker.

## Run Locally

Run the Telegram worker:

```bash
cd telegram-bot-worker
pnpm run dev
```

Wrangler will also start the bound weather services locally.

Send a test Telegram webhook payload to:

```bash
http://localhost:8787/
```

Trigger the scheduled handler locally:

```bash
curl "http://localhost:8787/__scheduled?cron=*"
```

## Tests

Run tests for a service from that service directory:

```bash
pnpm run test
```

## Type Generation

After changing any Wrangler bindings or configuration, regenerate Worker types:

```bash
pnpm run cf-typegen
```

## Deploy

Deploy each service from its directory:

```bash
cd weather-cat-service
pnpm run deploy

cd ../weather-wbgt-service
pnpm run deploy

cd ../telegram-bot-worker
pnpm run deploy
```

Deploy the weather services before the Telegram worker so the service bindings are available.

## Telegram Webhook

After deploying `telegram-bot-worker`, tell Telegram where to send updates.

The default production webhook URL is:

```bash
https://telegram-bot-worker.nabridhwan.workers.dev/
```

Set the webhook with:

```bash
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://telegram-bot-worker.nabridhwan.workers.dev/
```

Replace `<BOT_TOKEN>` with the production Telegram bot token. Do not commit the token to the repository.

To check the bot identity before setting the webhook:

```bash
https://api.telegram.org/bot<BOT_TOKEN>/getMe
```

For local development, put local-only secrets in `telegram-bot-worker/.dev.vars`:

```bash
BOT_TOKEN=
```

If you delete the webhook to test with `getUpdates`, set it back to the production URL after deploying.
