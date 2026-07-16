import {drizzle} from 'drizzle-orm/d1';
import {getChatIDsForToday} from './db/rota';
import {WorkerMessageSender} from './messageSender';
import {buildWeatherReply} from './bot/replies';
import {registerBotActionHandlers, registerHandlers} from './bot';
import {Bot, webhookCallback} from 'grammy';
import {rotaTable} from './db/schema';
import {count, eq, or} from 'drizzle-orm';
import getRotaNumberForDate from './getRotaNumberForDate';

type WeatherServiceSnapshot = {
	heatStress: string;
	wbgt: string;
	airTemp: number;
	emoji: {
		color: string;
		symbol: string;
	};
	dateTime: string;
};

export type WeatherServiceResponse = {
	cache_expiration: string;
	cda: WeatherServiceSnapshot;
	httc: WeatherServiceSnapshot;
};

export interface WeatherCatResponse {
	cache_expiration: string;
	cda: WeatherCatLocation;
	httc: WeatherCatLocation;
}

export interface WeatherCatLocation {
	PSI: number;
	temperature: string;
	image_name: string;
	CAT: '1' | '2' | '3';
	cat_start_on: string;
	cat_end_on: string;
	update_on: string;
	emoji: '🟢' | '🟡' | '🔴';
	catText: `CAT ${1 | 2 | 3}`;
}

function logInfo(event: string, fields: Record<string, unknown> = {}) {
	console.log(JSON.stringify({ level: 'info', event, ...fields }));
}

function logError(event: string, error: unknown, fields: Record<string, unknown> = {}) {
	console.error(
		JSON.stringify({
			level: 'error',
			event,
			error: error instanceof Error ? error.message : String(error),
			...fields,
		}),
	);
}

/**
 * Cloudflare Worker with scheduled cron for weather updates
 * Structure:
 * - cron trigger (defined in wrangler.jsonc) → scheduled() handler
 * - scheduled() handler fetches chats and builds message once
 * - WorkerMessageSender handles rate limiting and retries
 */

export default {
	async fetch(request, env): Promise<Response> {
		// Because the bot only handles GET (for the home route) or POST (for the telegram bot)
		// Reject other methods
		if (request.method !== 'POST' && request.method !== 'GET') {
			return Response.json(
				{
					error: true,
					status: 405,
					message: 'Method not allowed',
					date: new Date(),
				},
				{
					status: 405,
				},
			);
		}

		// Create a new DB instance
		const db = drizzle(env.telegram_bot_state);

		if (request.method === 'GET') {
			const { tag, id, timestamp } = env.CF_VERSION_METADATA;
			const todayRotaNumber = getRotaNumberForDate(new Date());

			// Get the count for the recipients for today
			const res = await db
				.select({
					count: count(),
				})
				.from(rotaTable)
				.where(or(eq(rotaTable.rota, todayRotaNumber), eq(rotaTable.rota, 0)));

			return Response.json({
				error: false,
				status: 200,
				message: 'Bot health ok',
				count: res[0].count,
				rota: todayRotaNumber,
				deploymentInfo: {
					tag,
					id,
					deploymentDate: timestamp,
				},
				date: new Date(),
			});
		}

		const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO) });

		registerBotActionHandlers(bot, db);
		registerHandlers(bot, db, env);

		return webhookCallback(bot, 'cloudflare-mod')(request);
	},

	async scheduled(controller: ScheduledController, env: Env) {
		logInfo('scheduled_job_received', {
			cron: controller.cron,
			scheduledTime: new Date(controller.scheduledTime).toISOString(),
		});
		const db = drizzle(env.telegram_bot_state);
		const jobDate = new Date();

		try {
			// 1. Get all subscribed chat IDs for today
			const subscribedChatIds = await getChatIDsForToday({ db });

			if (subscribedChatIds.length === 0) {
				logInfo('scheduled_job_no_recipients');
				return;
			}

			logInfo('scheduled_job_started', {
				recipientCount: subscribedChatIds.length,
			});

			// 2. Create bot instance
			const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO) });

			// 3. Fetch weather data ONCE (not per-chat)
			const weatherResponse = await env.WEATHER_WBGT_SERVICE.fetch('https://weather-wbgt-service/');
			if (!weatherResponse.ok) {
				throw new Error(`Weather service request failed with status ${weatherResponse.status}`);
			}
			const readings = (await weatherResponse.json()) as WeatherServiceResponse;

			// 4. Build message ONCE (not per-chat)
			const message = buildWeatherReply(readings.cda, readings.httc, {
				jobDate,
				isCached: new Date() < new Date(readings.cache_expiration),
			});

			// 5. Use WorkerMessageSender to send with rate limiting
			const sender = new WorkerMessageSender(bot);
			await sender.sendToMultiple(subscribedChatIds, message);

			logInfo('scheduled_job_completed', {
				recipientCount: subscribedChatIds.length,
				jobDate: jobDate.toISOString(),
			});
		} catch (error) {
			logError('scheduled_job_failed', error);
		}
	},
} satisfies ExportedHandler<Env>;
