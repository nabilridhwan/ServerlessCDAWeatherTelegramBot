# Cloudflare Workers Cron + Message Sending Setup
ka

## What Changed

### 1. **Added Cron Trigger** (`wrangler.jsonc`)
```jsonc
"triggers": {
  "crons": ["0 */2 * * *"]  // Every 2 hours
}
```

Adjust the cron expression as needed:
- `0 0 * * *` = Daily at midnight
- `0 */6 * * *` = Every 6 hours
- `0 8,14 * * *` = At 8 AM and 2 PM

### 2. **New `WorkerMessageSender` Class** (`src/messageSender.ts`)
Replaces `p-queue` with Workers-native implementation:
- ✅ Rate limiting (100ms between sends)
- ✅ Exponential backoff retries (3 attempts)
- ✅ Telegram error detection (429, 5xx, network errors)
- ✅ No external dependencies
- ✅ No state persistence issues

### 3. **Refactored `scheduled()` Handler** (`src/index.ts`)
**Old pattern (broken on Workers):**
```typescript
// p-queue in-memory queue
await Promise.all(
  chatIds.map((chatId) =>
    sendQueue.add(() => sendMessage(chatId, msg))
  )
);
```

**New pattern (Workers-native):**
```typescript
// Fetch data ONCE
const readings = await Weather.retrieveWeatherDataForBot(env.BOT_ID);

// Build message ONCE
const message = buildWeatherReply(cda, httc, { jobDate, isCached: false });

// Send with rate limiting
const sender = new WorkerMessageSender(bot);
await sender.sendToMultiple(chatIds, message);
```

---

## Key Benefits

| Aspect | Before (p-queue) | After (WorkerMessageSender) |
|--------|------------------|---------------------------|
| **Stateless** | ❌ In-memory queue lost on timeout | ✅ No state to lose |
| **Cloudflare Native** | ❌ Workaround for Node.js lib | ✅ Native Workers API |
| **Rate Limiting** | ⚠️ Inconsistent | ✅ Predictable 100ms stagger |
| **Retries** | ⚠️ Lost if Worker times out | ✅ Per-message retry logic |
| **Dependencies** | ❌ Adds p-queue | ✅ Zero new deps |

---

## Usage

### Local Testing

```bash
cd serverless/telegram-bot-worker

# Start dev server
npm run dev

# Trigger scheduled event
curl "http://localhost:8787/__scheduled?cron=*"
```

### Check Logs

```bash
# Real-time logs during dev
npm run dev

# Production logs
wrangler tail
```

### Deploy

```bash
npm run deploy
```

---

## Rate Limiting Details

The `WorkerMessageSender` sends messages like this:

```
Chat 1: send at 0ms
Chat 2: send at 100ms
Chat 3: send at 200ms
Chat 4: send at 300ms
...
```

This respects Telegram's rate limits (~30-40 msgs/sec per bot token).

### If You Need Faster Sends

Adjust in `messageSender.ts`:
```typescript
private readonly RATE_LIMIT_MS = 50; // Faster (risky)
```

### If Telegram Rate-Limits You (429)

The sender will:
1. Catch the 429 error
2. Read `retry_after` header
3. Wait that duration
4. Retry automatically

---

## Monitoring

### Key Metrics to Track

1. **Message Success Rate**
   ```
   grep "Message sent to chat" logs/*.log | wc -l
   ```

2. **Retry Count**
   ```
   grep "Retrying send" logs/*.log | wc -l
   ```

3. **Failure Reasons**
   ```
   grep "Failed to send message" logs/*.log
   ```

### Alerts to Set Up

- Failure rate > 10% in a cron run
- Consecutive timeouts (cron not starting)
- Rate limit errors (429) recurring

---

## Optional: Next Steps

### Option A: Add Caching (10-minute cache)

Uncomment in `weather.api.ts`:
```typescript
export async function getCachedOrFetchWeatherDataForBot() {
  // Uses KV or in-memory cache
}
```

Then update `index.ts`:
```typescript
const { data: readings, isCached } = await Weather.getCachedOrFetchWeatherDataForBot();
```

### Option B: Migrate to Cloudflare Queues (later)

If you scale to 100k+ users, see `QUEUE_STRATEGY.md`.

### Option C: Add Error Notifications

Send yourself a Telegram alert if sends fail:
```typescript
if (results.some(r => r.status === 'rejected')) {
  await bot.telegram.sendMessage(YOUR_ADMIN_CHAT_ID,
    'Weather broadcast failed. Check logs.'
  );
}
```

---

## Troubleshooting

### "Message sent to chat" logs show 0

1. Check `getChatIDsForToday()` returns data
2. Verify `BOT_ID` secret is set
3. Check Telegram API key validity

### Cron not triggering

1. Verify `wrangler.jsonc` has `triggers` section
2. Redeploy: `npm run deploy`
3. Check `wrangler tail` for errors

### Some messages fail silently

Check logs for "Failed to send message" — WorkerMessageSender logs all failures.

---

## File Summary

- ✅ **`src/messageSender.ts`** – New sender class (replace p-queue)
- ✅ **`src/index.ts`** – Refactored cron handler
- ✅ **`wrangler.jsonc`** – Added cron triggers
- 🗑️ **`src/sendWeatherMessages.ts`** – Can be removed (logic moved to index.ts)
- ✅ **`utils/bot/messageQueue.ts`** – Keep for reference (has good retry logic patterns)

---

**Ready to deploy!** 🚀

