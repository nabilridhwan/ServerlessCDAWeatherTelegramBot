# CDA ARMS Weather Bot Serverless - AI Agent Guide

**Cloudflare Workers** + **Telegram Bot API** + **Weather Data** monorepo. Use this guide to understand architecture, workflows, and project-specific patterns.

> **First read:** Cloudflare Workers documentation is in your skill library - always retrieve current docs before Workers, KV, D1, or service binding tasks.

## Architecture Overview

Three independent Cloudflare Workers deployed together:

| Service | Role | Bindings | Triggers |
|---------|------|----------|----------|
| **telegram-bot-worker** | Main bot; handles user commands, subscriptions, scheduled broadcasts | D1 (rota DB), KV cache, service bindings → weather services | Webhook (Telegram), Cron (2-hourly broadcasts) |
| **weather-wbgt-service** | Fetches heat stress (WBGT) from data.gov.sg API | KV cache, DATA_GOV_API_KEY secret | Only called via service binding |
| **weather-cat-service** | Fetches CAT status (activity restrictions) | KV cache, secrets | Only called via service binding |

### Data Flow

```
User command (/weather, /catstatus)
    ↓
telegram-bot-worker (fetch handler)
    ├→ Calls weather service via binding
    ├→ Parses response
    └→ Sends formatted HTML reply via Telegram API

Scheduled cron (every 2 hours, see wrangler.jsonc)
    ↓
telegram-bot-worker (scheduled handler)
    ├→ Fetches subscribed chat IDs from D1 rota table
    ├→ Calls weather service once (cached by KV)
    ├→ Builds HTML message once
    ├→ WorkerMessageSender rate-limits sends (100ms stagger)
    └→ Logs success/failures to Cloudflare Logs
```

## Project Layout

```
telegram-bot-worker/
  ├─ src/index.ts           # fetch + scheduled handlers; type defs for weather responses
  ├─ src/bot.ts             # grammY command/callback handlers (/start, /weather, /settings, etc.)
  ├─ src/messageSender.ts   # WorkerMessageSender: rate limiting + retry logic (KEY FILE)
  ├─ src/db/               # Drizzle ORM schema + queries
  │  ├─ schema.ts          # rotaTable (chat_id → rota assignment)
  │  └─ rota.ts            # upsertRota, getChatIDsForToday, getRotaForChatId
  ├─ src/bot/replies.ts    # Template strings + HTML formatters
  ├─ src/getRotaNumberForDate.ts  # Calculates which rota (1/2/3) is active today
  ├─ wrangler.jsonc        # D1, KV cache, service bindings, cron triggers
  └─ package.json          # grammY, drizzle-orm, wrangler

weather-{wbgt,cat}-service/
  ├─ src/index.ts          # fetch handler; KV cache check → fetch → serialize → cache
  ├─ src/weather.api.ts    # Calls data.gov.sg API; maps responses
  ├─ src/catStatus.api.ts  # Calls CAT API; parses statuses + emojis
  └─ wrangler.jsonc        # KV binding, secrets, no service bindings (only called)
```

## Critical Workflows & Commands

### Local Development (Any Service)

```bash
cd telegram-bot-worker  # or weather-*-service
npm run dev
```

- **Webhook testing:** POST to `http://localhost:8787/` with Telegram message JSON
- **Cron testing:** `curl "http://localhost:8787/__scheduled?cron=*"`
- **Service bindings work locally** - wrangler automatically starts all workers

### Deployment

```bash
cd telegram-bot-worker
npm run deploy
```

- Deploys **one service** to Cloudflare account
- See `.github/workflows` for multi-service CI/CD (if using)
- **After changing wrangler.jsonc:** Run `npm run cf-typegen` to regenerate `Env` types

### After Wrangler Config Changes

```bash
npm run cf-typegen  # Regenerate Env interface from wrangler.jsonc bindings
```

Required after adding D1 databases, KV namespaces, secrets, service bindings, etc.

### Debugging Scheduled Jobs

```bash
wrangler tail  # Real-time Worker logs (production)
# Local: see terminal output when running `npm run dev`
```

### Secrets Management

```bash
# Set Telegram bot token
wrangler secret put BOT_TOKEN

# Set weather data.gov.sg API key
cd weather-wbgt-service
wrangler secret put DATA_GOV_API_KEY
```

Secrets are **per-service** and **per-environment** (staging/production).

## Project-Specific Patterns

### 1. **Service-to-Service Communication via Bindings**

Workers call each other using Cloudflare service bindings—**no HTTP overhead, same zone.**

```typescript
// telegram-bot-worker calls weather service
const response = await env.WEATHER_WBGT_SERVICE.fetch('https://weather-wbgt-service/');
const data = await response.json() as WeatherServiceResponse;
```

**Key:** Bindings defined in `wrangler.jsonc` under `services`.  
**Why:** Reduces latency, avoids public HTTP roundtrips, keeps traffic within Cloudflare.

### 2. **Rate Limiting & Retries (WorkerMessageSender)**

Custom class in `src/messageSender.ts` replaces external queue libraries (avoids Worker timeouts).

```typescript
const sender = new WorkerMessageSender(bot);
await sender.sendToMultiple(chatIds, message);  // Auto-staggers sends 100ms apart
```

**Features:**
- 100ms stagger between sends (respects Telegram ~30-40 msgs/sec limit)
- Exponential backoff on failures (max 3 retries)
- Handles Telegram 429 (rate limit) + 5xx + network errors
- Logs all failures (grep logs for debugging)

**Customize:** Edit `RATE_LIMIT_MS` and `MAX_RETRIES` in `messageSender.ts`.

### 3. **Subscription Model: Rotas + Office Hours**

Users subscribe to one of **four schedules:**
- **Rota 1, 2, 3:** Rotating 3-day cycles (calculated by `getRotaNumberForDate`)
- **Office Hours:** Fixed daily schedule

D1 `rotaTable` stores one chat ID → one rota mapping.

```typescript
// telegram-bot-worker fires cron every 2 hours
const subscribedChatIds = await getChatIDsForToday({ db });  // Returns chats whose rota matches today
```

**Reference date:** `2025-10-06` (see `getRotaNumberForDate.ts`). If you change rotas, update this date.

### 4. **KV Caching for External APIs**

Both weather services check KV before calling external APIs:

```typescript
const cached = await env.WEATHER_CACHE.get('WBGT_DATA');
if (cached) return Response.json(JSON.parse(cached));

// Otherwise fetch + cache
const data = await Weather.retrieveWeatherDataForBot(apiKey);
await env.WEATHER_CACHE.put('WBGT_DATA', JSON.stringify(data), { expirationTtl: 180 });
```

**Cache keys:** `'WBGT_DATA'` (180s TTL) and `'CAT_DATA'` (300s TTL).  
**Important:** Both services share the same KV namespace (see wrangler.jsonc).

### 5. **Timezone-Aware Operations**

All user-facing dates use Singapore timezone (`Asia/Singapore`):

```typescript
import { tz } from '@date-fns/tz';
const formatted = format(new Date(dateStr), 'd MMMM yyyy HH:mm', { in: tz('Asia/Singapore') });
```

### 6. **Cron Expression for Scheduled Messages**

Defined in `telegram-bot-worker/wrangler.jsonc`:

```jsonc
"triggers": {
  "crons": ["50 1,3,5,7 * * 1-5"]  // 1:50 AM, 3:50 AM, 5:50 AM, 7:50 AM on weekdays
}
```

Change to `"0 */2 * * *"` for every 2 hours, or `"0 8,14 * * *"` for 8 AM + 2 PM.

### 7. **HTML Parsing in Telegram Messages**

All bot replies use `parse_mode: 'HTML'`:

```typescript
await ctx.reply(message, { parse_mode: 'HTML' });
// Supports <b>bold</b>, <i>italic</i>, <code>code</code>, <a href="url">link</a>
```

See `src/bot/replies.ts` for message templates (emojis, colors, status indicators).

### 8. **D1 with Drizzle ORM**

Schema-driven SQLite: define once, generate migrations with `drizzle-kit`.

```typescript
// Define in schema.ts
export const rotaTable = sqliteTable('rota', {
  telegramChatId: int().notNull().unique(),
  rota: text({ enum: ['1', '2', '3', 'OFFICE_HOURS'] }).notNull(),
});

// Query with Drizzle
const db = drizzle(env.telegram_bot_state);
await db.insert(rotaTable).values({ telegramChatId: 123, rota: '1' }).onConflictDoUpdate(...);
```

**Key:** D1 bindings + schema defined in wrangler.jsonc. Run migrations with `wrangler d1 migrations create` (if needed).

## Common Tasks for Agents

### Add a New Bot Command

1. Edit `src/bot.ts` → `registerHandlers()`
2. Add `bot.command('name', async (ctx) => { ... })`
3. Use service bindings to fetch data: `env.WEATHER_WBGT_SERVICE.fetch(...)`
4. Reply with `ctx.reply(message, { parse_mode: 'HTML' })`

### Change Broadcast Schedule

Edit `telegram-bot-worker/wrangler.jsonc` → `triggers.crons`, then `npm run deploy`.

### Debug Cron Executions

```bash
wrangler tail --service telegram-bot-worker  # Filter logs
```

Look for `"Scheduled job triggered"` logs or `"Failed to send message"` errors.

### Scale to Millions of Users

Current `WorkerMessageSender` staggers sends via 100ms delays. For 1M+ chats:
- Migrate to **Cloudflare Queues** (see SETUP.md "Option B")
- Create a consumer Worker that drains the queue
- Reduces cron handler CPU time (fire-and-forget queueing)

## Testing

```bash
npm run test  # Runs vitest with Cloudflare pool
```

Tests use `@cloudflare/vitest-pool-workers` to simulate Worker environment locally.

## External APIs & Secrets

| Service | API | Endpoint | Caching |
|---------|-----|----------|---------|
| Weather (WBGT) | data.gov.sg | `https://api.data.gov.sg/...` | 180s KV |
| CAT Status | Internal | Varies | 300s KV |
| Telegram | grammY wrapper | `https://api.telegram.org` | None (via grammY) |

All external calls use **exponential backoff + timeouts** in `WorkerMessageSender`.

## Observability

- **Logs:** `wrangler tail` or Cloudflare dashboard
- **KV metrics:** Dashboard → Workers → your worker → Real-time analytics
- **D1 logs:** Dashboard → D1 → Logs tab
- **Errors:** https://developers.cloudflare.com/workers/observability/errors/

Set up alerts on:
- Message send failure rate > 10% per cron run
- D1 query timeouts (slow subscription lookup)
- Cron not firing for > 4 hours

## References

- **Cloudflare Workers:** https://developers.cloudflare.com/workers/
- **grammY Telegram Bot:** https://grammy.dev/
- **Drizzle ORM:** https://orm.drizzle.team/
- **Cron Expressions:** https://crontab.guru/ (validate schedules here)
- **D1 Docs:** https://developers.cloudflare.com/d1/
- **KV Docs:** https://developers.cloudflare.com/kv/
- **Service Bindings:** https://developers.cloudflare.com/workers/runtime-apis/service-bindings/

