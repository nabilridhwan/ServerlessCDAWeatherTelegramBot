# CDA ARMS Weather Bot Serverless - AI Agent Guide

Cloudflare Workers + Telegram Bot API + Singapore weather data monorepo. Read this guide before editing the project, and read current Cloudflare Workers docs from the skill library before Workers, KV, D1, service binding, or Wrangler tasks.

## Current State

Three independent Workers are deployed together:

| Service | Role | Runtime bindings | Secrets |
|---------|------|------------------|---------|
| `telegram-bot-worker` | Telegram webhook, bot commands, D1 subscription state, and scheduled broadcasts | `telegram_bot_state` D1, `WEATHER_WBGT_SERVICE`, `WEATHER_CAT_SERVICE`, `CF_VERSION_METADATA`, `BOT_INFO` var | `BOT_TOKEN` |
| `weather-wbgt-service` | Fetches WBGT and air temperature from data.gov.sg, then caches results | `WEATHER_CACHE` KV | `DATA_GOV_API_KEY` |
| `weather-cat-service` | Fetches CAT/activity restriction data, then caches results | `WEATHER_CACHE` KV | None currently |

The Telegram worker calls the weather workers through Cloudflare service bindings. The weather workers are not intended to be public user-facing APIs.

The current scheduled broadcast cron is `50 1,3,5,7 * * 1-5`, configured in `telegram-bot-worker/wrangler.jsonc`.

## Project Layout

```text
telegram-bot-worker/
  src/index.ts                  # fetch + scheduled handlers; Env response types
  src/bot.ts                    # grammY commands and callbacks
  src/messageSender.ts          # WorkerMessageSender rate limiting + retries
  src/db/schema.ts              # Drizzle rota table
  src/db/rota.ts                # Rota queries and upserts
  src/bot/replies.ts            # HTML reply templates and formatters
  src/getRotaNumberForDate.ts   # 3-day rota calculation
  drizzle.config.ts             # D1 HTTP config, reads .env
  wrangler.jsonc                # D1, service bindings, cron, production env
  .env.example                  # Drizzle + local BOT_TOKEN template

weather-wbgt-service/
  src/index.ts                  # cache check, API fetch, response shaping
  src/weather.api.ts            # data.gov.sg API mapping
  src/getNextTTLForCurrentQuarterHour.ts
  wrangler.jsonc                # KV binding + DATA_GOV_API_KEY requirement
  .env.example                  # DATA_GOV_API_KEY template

weather-cat-service/
  src/index.ts                  # cache check, CAT API fetch, response shaping
  src/catStatus.api.ts          # CAT API mapping and status parsing
  wrangler.jsonc                # KV binding
  .env.example                  # Placeholder; no secrets currently required
```

## Data Flow

```text
Telegram command (/weather, /catstatus, /about, /settings)
    -> telegram-bot-worker
    -> optional service binding call to weather worker
    -> formatted Telegram HTML reply

Scheduled cron
    -> telegram-bot-worker scheduled handler
    -> D1 lookup for chats subscribed for today's rota
    -> weather-wbgt-service fetch through service binding
    -> WorkerMessageSender sends staggered Telegram messages
```

Note: `/catstatus` is currently disabled in `telegram-bot-worker/src/bot.ts` and replies that CAT status is unavailable as of 16 July 2026. The CAT service still exists and can fetch/cache CAT data.

## Commands

Use `pnpm`.

```bash
pnpm install
```

Run a service locally:

```bash
cd telegram-bot-worker
pnpm run dev
```

Wrangler starts service-bound workers locally when running the Telegram worker. Test the webhook at `http://localhost:8787/` and trigger scheduled jobs with:

```bash
curl "http://localhost:8787/__scheduled?cron=*"
```

Run tests from a service directory that has a `test` script:

```bash
pnpm run test
```

`telegram-bot-worker` and `weather-cat-service` currently have Vitest scripts; `weather-wbgt-service` does not.

Regenerate Worker types after any `wrangler.jsonc` binding/config change:

```bash
pnpm run cf-typegen
```

Deploy services in dependency order:

```bash
cd weather-cat-service
pnpm run deploy

cd ../weather-wbgt-service
pnpm run deploy

cd ../telegram-bot-worker
pnpm run deploy
```

`telegram-bot-worker` deploys with `wrangler deploy -e production`; the weather services deploy their default environments.

## Environment And Secrets

Every service has a `.env.example`.

- `telegram-bot-worker/.env.example`: includes `BOT_TOKEN` for local `.dev.vars`, plus `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, and `CLOUDFLARE_D1_TOKEN` for Drizzle D1 commands.
- `weather-wbgt-service/.env.example`: includes `DATA_GOV_API_KEY`.
- `weather-cat-service/.env.example`: placeholder because no local secrets are currently required.

Local runtime secrets belong in `.dev.vars`. Drizzle reads `telegram-bot-worker/.env`. Deployed secrets are per service and per environment:

```bash
cd telegram-bot-worker
wrangler secret put BOT_TOKEN
wrangler secret put BOT_TOKEN --env production

cd ../weather-wbgt-service
wrangler secret put DATA_GOV_API_KEY
```

Wrangler prompts for secret values. Do not put secrets in commands, `wrangler.jsonc`, or committed files.

## Important Patterns

- Telegram replies use `parse_mode: 'HTML'`; keep generated text valid for Telegram's HTML subset.
- Scheduled messages use `WorkerMessageSender`, which staggers sends and retries transient Telegram/network failures.
- Rota subscriptions are stored in D1 in `rotaTable`; one Telegram chat ID maps to one rota value: `1`, `2`, `3`, or `OFFICE_HOURS`.
- The rota reference date is in `telegram-bot-worker/src/getRotaNumberForDate.ts`; update it if the operational rota changes.
- User-facing dates are formatted for `Asia/Singapore`.
- WBGT cache key is currently `WGBT_DATA` in code, with a TTL based on the next quarter-hour plus buffer. CAT cache key is `CAT_DATA`, TTL 5 minutes.
- `BOT_INFO` is a non-secret Wrangler variable. Development and production values differ in `telegram-bot-worker/wrangler.jsonc`.

## Handover

Use this checklist when moving production to a new Cloudflare account while keeping the same Telegram bot.

1. Create a Cloudflare account for the new owner or operations team.
2. From the Cloudflare dashboard, create the D1 database and Workers KV namespace using the names and bindings found in each service's `wrangler.jsonc` file.
3. Update the new D1 `database_id` in `telegram-bot-worker/wrangler.jsonc`.
4. Update the new KV namespace `id` in `weather-wbgt-service/wrangler.jsonc` and `weather-cat-service/wrangler.jsonc`.
5. Fill in each `.env.example` file and copy it to the appropriate ignored local file: `.env` for Drizzle/tooling, `.dev.vars` for local Wrangler runtime secrets.
6. Use Drizzle Kit with Cloudflare D1 HTTP integration to push the database schema before migrating production data. See https://orm.drizzle.team/docs/guides/d1-http-with-drizzle-kit.

Export from the old Cloudflare account:

```bash
cd telegram-bot-worker
pnpm wrangler d1 export telegram-bot-state --remote --output ../telegram-bot-state-export.sql
```

Log in to the new Cloudflare account:

```bash
pnpm wrangler login
```

After the new D1 database exists, import the exported SQL:

```bash
cd telegram-bot-worker
pnpm wrangler d1 execute telegram-bot-state --remote --file ../telegram-bot-state-export.sql
```

Use a short maintenance window for export/import so subscription changes do not land in the old database after export. After cutover, disable the old Cloudflare Worker cron or deployment so the old Worker cannot send scheduled Telegram messages.

Deploy all three services in the order shown above. Wrangler may prompt that required secrets are missing; set them, then deploy again in the same order.

Set the Telegram webhook to the production Worker URL:

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://telegram-bot-worker-production.opsroomcda.workers.dev/
```

Test the Telegram bot by running `/about`. The reply should show the latest deployment ID from `CF_VERSION_METADATA`.

## Observability

- Use `wrangler tail` or the Cloudflare dashboard for Worker logs.
- Watch for `"Scheduled job triggered"` and `"Failed to send message"` in Telegram worker logs.
- Monitor KV and D1 from the Cloudflare dashboard.
- Consider alerts for high scheduled-send failure rates, D1 query timeouts, and cron silence for more than 4 hours.

## References

- Cloudflare Workers: https://developers.cloudflare.com/workers/
- D1: https://developers.cloudflare.com/d1/
- KV: https://developers.cloudflare.com/kv/
- Service bindings: https://developers.cloudflare.com/workers/runtime-apis/service-bindings/
- grammY: https://grammy.dev/
- Drizzle ORM: https://orm.drizzle.team/
- Cron expressions: https://crontab.guru/
