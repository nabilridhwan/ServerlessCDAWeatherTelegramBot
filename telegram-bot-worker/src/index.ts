import { drizzle } from 'drizzle-orm/d1';
import { getChatIDsForToday } from './db/rota';
import { WorkerMessageSender } from './messageSender';
import { buildWeatherReply } from './bot/replies';
import { registerBotActionHandlers, registerHandlers } from './bot';
import { Bot, webhookCallback } from 'grammy';
import {getNextUpdateDateForRota} from "./getNextUpdateDateForRota";
import {rule} from "./bot/rule";

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

/**
 * Cloudflare Worker with scheduled cron for weather updates
 * Structure:
 * - cron trigger (defined in wrangler.jsonc) → scheduled() handler
 * - scheduled() handler fetches chats and builds message once
 * - WorkerMessageSender handles rate limiting and retries
 */

export default {
	async fetch(request, env): Promise<Response> {
		if (request.method === 'GET') {
			return Response.json({
				status: 200,
				message: "I'm ALIVE!",
			});
		}

		const db = drizzle(env.TELEGRAM_BOT_STATE);
		const bot = new Bot(env.BOT_TOKEN, { botInfo: JSON.parse(env.BOT_INFO) });

		registerBotActionHandlers(bot, db);
		registerHandlers(bot, db);

		return webhookCallback(bot, 'cloudflare-mod')(request);
	},

	async scheduled(controller: ScheduledController, env: Env) {
		console.log("Scheduled controller");
		const db = drizzle(env.TELEGRAM_BOT_STATE);
		const jobDate = new Date();

		try {
			// 1. Get all subscribed chat IDs for today
			const subscribedChatIds = await getChatIDsForToday({ db });

			console.log(`subscribed chatId: ${subscribedChatIds.length}`);

			if (subscribedChatIds.length === 0) {
				console.info('No subscribed chat IDs found.');
				return;
			}

			console.info(`Scheduled job triggered. Sending to ${subscribedChatIds.length} chats.`);

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
				isCached: new Date() < new Date(readings.cache_expiration)
			});

			// 5. Use WorkerMessageSender to send with rate limiting
			const sender = new WorkerMessageSender(bot);
			await sender.sendToMultiple(subscribedChatIds, message);

			console.info(`Weather reports sent to ${subscribedChatIds.length} chats at ${jobDate.toISOString()}`);
		} catch (error) {
			console.error('Scheduled job failed:', error);
		}
	},
} satisfies ExportedHandler<Env>;
