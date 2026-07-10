import { Markup, Telegraf } from 'telegraf';
import {
	buildAlreadySubscribedMessage,
	buildRotaSetSuccessMessage,
	buildSettingsMessages,
	buildWeatherReply,
	HELP_MESSAGE,
	LOADING_MESSAGE,
	STOP_SUCCESS_MESSAGE,
	WELCOME_SUBSCRIBED_MESSAGE,
} from './bot/replies';
import { rule } from './bot/rule';
import { Db, getRotaForChatId, removeSubscription, upsertRota } from './db/rota';
import { getNextUpdateDateForRota } from './getNextUpdateDateForRota';
import { Api, Bot, Context, InlineKeyboard, RawApi } from 'grammy';
import { env } from 'cloudflare:workers';
import { WeatherCatResponse, WeatherServiceResponse } from './index';
import { format } from 'date-fns/format';
import { tz } from '@date-fns/tz';

function formatDate(date: Date | string): string {
	return format(new Date(date), 'd MMMM yyyy HH:mm', {
		in: tz('Asia/Singapore'),
	});
}

export function registerBotActionHandlers(bot: Bot<Context, Api<RawApi>>, db: Db) {
	// ==============================
	// #region Callback query handlers for setting rota subscriptions
	// ==============================

	// Set rota 1
	bot.callbackQuery('set_rota_1', async (ctx: Context) => {
		if (!ctx.chat) {
			return;
		}

		await upsertRota({
			chatId: ctx.chat.id,
			rota: '1',
			db,
		});

		const nextUpdate = getNextUpdateDateForRota('1') || rule.nextInvocationDate(new Date());
		await ctx.editMessageText(buildRotaSetSuccessMessage(1, nextUpdate), {
			parse_mode: 'HTML',
		});
		await ctx.answerCallbackQuery({ text: 'Setting rota...' }); // Acknowledge the callback query to remove the loading state
	});

	// Set rota 2
	bot.callbackQuery('set_rota_2', async (ctx) => {
		if (!ctx.chat) {
			return;
		}

		await upsertRota({
			chatId: ctx.chat.id,
			rota: '2',
			db,
		});

		const nextUpdate = getNextUpdateDateForRota('2') || rule.nextInvocationDate(new Date());
		await ctx.editMessageText(buildRotaSetSuccessMessage(2, nextUpdate), {
			parse_mode: 'HTML',
		});
		await ctx.answerCallbackQuery({ text: 'Setting rota...' }); // Acknowledge the callback query to remove the loading state
	});

	// Set rota 3
	bot.callbackQuery('set_rota_3', async (ctx) => {
		if (!ctx.chat) {
			return;
		}

		await upsertRota({
			chatId: ctx.chat.id,
			rota: '3',
			db,
		});

		const nextUpdate = getNextUpdateDateForRota('3') || rule.nextInvocationDate(new Date());
		await ctx.editMessageText(buildRotaSetSuccessMessage(3, nextUpdate), {
			parse_mode: 'HTML',
		});
		await ctx.answerCallbackQuery({ text: 'Setting rota...' }); // Acknowledge the callback query to remove the loading state
	});

	// Set OH
	bot.callbackQuery('set_office_hours', async (ctx) => {
		if (!ctx.chat) {
			return;
		}

		await upsertRota({
			chatId: ctx.chat.id,
			rota: 'OFFICE_HOURS',
			db,
		});

		const nextUpdate = rule.nextInvocationDate(new Date());
		await ctx.editMessageText(buildRotaSetSuccessMessage('office_hours', nextUpdate), {
			parse_mode: 'HTML',
		});
		await ctx.answerCallbackQuery({ text: 'Setting office hour...' }); // Acknowledge the callback query to remove the loading state
	});

	// Stop updates
	bot.callbackQuery('stop_updates', async (ctx) => {
		if (!ctx.chat) return;
		try {
			await removeSubscription({
				chatId: ctx.chat.id,
				db: db,
			});
		} catch (err) {
			console.error(err);
		}
		await ctx.editMessageText(STOP_SUCCESS_MESSAGE);
		await ctx.answerCallbackQuery({ text: 'Stopping updates...' }); // Acknowledge the callback query to remove the loading state
	});
}

// Registers all bot commands/actions against provided runtime instances.
// Injecting bot here keeps handler setup explicit and decoupled from module import.
export function registerHandlers(bot: Bot<Context, Api<RawApi>>, db: Db) {
	// ==============================
	// #region Bot command and action handlers
	// ==============================

	// Start
	bot.command('start', async (ctx: Context) => {
		if (!ctx.chat) {
			await ctx.reply('Error: Unable to determine chat context. Please try again.');
			return;
		}

		console.log(
			`Start command called by Chat ID: ${ctx.chat.id}. Next update at ${new Date(rule.nextInvocationDate(new Date())).toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })}`,
		);

		const subscriptionRota = await getRotaForChatId({
			chatId: ctx.chat.id,
			db,
		});

		const rotaNumber: '1' | '2' | '3' | 'OFFICE_HOURS' | null = subscriptionRota;
		const hasSubscribedToAnyChat = rotaNumber !== null;

		if (hasSubscribedToAnyChat) {
			const nextUpdateForSubscription = getNextUpdateDateForRota(rotaNumber) ?? new Date(rule.nextInvocationDate(new Date()));

			const msg = buildAlreadySubscribedMessage(rotaNumber, nextUpdateForSubscription);

			await ctx.reply(msg, { parse_mode: 'HTML' });

			console.log('Chat ID: ' + ctx.chat.id + ' is already subscribed. No action taken.');
			return;
		}

		const inlineKeyboard = new InlineKeyboard()
			.text('Rota 1', 'set_rota_1')
			.text('Rota 2', 'set_rota_2')
			.text('Rota 3', 'set_rota_3')
			.text('Office Hours', 'set_office_hours');

		await ctx.reply(WELCOME_SUBSCRIBED_MESSAGE, {
			reply_markup: inlineKeyboard,
			parse_mode: 'HTML',
		});

		// console.log('Added Chat ID: ' + ctx.chat.id + ' to subscribed chat IDs.');
	});

	// Weather command
	bot.command('weather', async (ctx: Context) => {
		if (!ctx.chat) {
			ctx.reply('Error: Unable to determine chat context. Please try again.');
			return;
		}

		console.log('Weather command called by user: ' + ctx.from?.username + ' (ID: ' + ctx.from?.id + ') in chat ID: ' + ctx.chat.id);

		const loadingMessage = await ctx.reply(LOADING_MESSAGE);

		const weatherResponse = await env.WEATHER_WBGT_SERVICE.fetch('https://weather-wbgt-service/');
		if (!weatherResponse.ok) {
			throw new Error(`Weather service request failed with status ${weatherResponse.status}`);
		}
		const readings = (await weatherResponse.json()) as WeatherServiceResponse;

		// 4. Build message ONCE (not per-chat)
		const message = buildWeatherReply(readings.cda, readings.httc, {
			jobDate: new Date(),
			isCached: new Date() < new Date(readings.cache_expiration),
		});

		// await MessageQueue.sendWeatherMessages(bot, [ctx.chat.id], {
		// 	jobDate: new Date(),
		// 	editMessageId: loadingMessage.message_id,
		// });
		// throw new Error('Not implemented');
		await ctx.api.editMessageText(ctx.chat.id, loadingMessage.message_id, message, {
			parse_mode: 'HTML',
		});

		console.log(
			'Processed on-demand weather data for user: ' + ctx.from?.username + ' (ID: ' + ctx.from?.id + ') in chat ID: ' + ctx.chat.id,
		);
	});

	bot.command('catstatus', async (ctx) => {
		console.log('CAT status command called by user: ' + ctx.from?.username + ' (ID: ' + ctx.from?.id + ') in chat ID: ' + ctx.chat.id);

		const loadingMessage = await ctx.reply(LOADING_MESSAGE);

		const weatherCATResponse = await env.WEATHER_CAT_SERVICE.fetch('https://weather-cat-service/');
		if (!weatherCATResponse.ok) {
			throw new Error(`Weather service request failed with status ${weatherCATResponse.status}`);
		}
		const readings = (await weatherCATResponse.json()) as WeatherCatResponse;
		const { cda, httc } = readings;

		try {
			const message = `📍 Civil Defence Academy
CAT Status: ${cda.catText} ${cda.emoji}
CAT Start On: ${formatDate(new Date(cda.cat_start_on)) ?? 'N/A'}
CAT Ends On: ${formatDate(new Date(cda.cat_end_on)) ?? 'N/A'}

📍 Home Team Tactical Centre
CAT Status: ${httc.catText} ${httc.emoji}
CAT Start On: ${formatDate(new Date(httc.cat_start_on)) ?? 'N/A'}
CAT Ends On: ${formatDate(new Date(httc.cat_end_on)) ?? 'N/A'}

Info last updated: ${formatDate(new Date(cda.update_on)) ?? 'N/A'}
⚠️ All info is accurate as of the last updated time.

ℹ️ CAT Status Legend:
🟢 CAT 3: Outdoor activities are allowed.
🟡 CAT 2: Outdoor activities to be decided by conducting structure.
🟠 CAT 1 (Incoming): CAT 1 has been declared and will take effect at the stated time. Prepare to cease outdoor activities.
🔴 CAT 1: Heavy rain and/or lightning risk. Outdoor activities are NOT ALLOWED.`;

			await ctx.api.editMessageText(ctx.chat.id, loadingMessage.message_id, message, {
				parse_mode: 'HTML',
			});
		} catch (error) {
			console.log(error);

			const message = `There was an error getting the CAT Status. Please try again later.

      Error: ${error}`;

			await ctx.api.editMessageText(ctx.chat.id, loadingMessage.message_id, message, {
				parse_mode: 'HTML',
			});
		}
	});

	// Settings
	bot.command('settings', async (ctx) => {
		const rotaNumber = await getRotaForChatId({ chatId: ctx.chat.id, db });

		if (rotaNumber === null) {
			await ctx.reply('You are not currently subscribed to any schedule. Use /start to subscribe.');
			return;
		}

		const inlineKeyboard = new InlineKeyboard()
			.text('Rota 1', 'set_rota_1')
			.text('Rota 2', 'set_rota_2')
			.text('Rota 3', 'set_rota_3')
			.text('Office Hours', 'set_office_hours')
			.text('Stop Updates', 'stop_updates');

		await ctx.reply(buildSettingsMessages(rotaNumber), {
			reply_markup: inlineKeyboard,
			parse_mode: 'HTML',
		});

		// ctx.telegram.sendMessage(ctx.chat.id, buildSettingsMessages(rotaNumber), {
		// 	...Markup.inlineKeyboard([
		// 		[
		// 			Markup.button.callback('Rota 1', 'set_rota_1'),
		// 			Markup.button.callback('Rota 2', 'set_rota_2'),
		// 			Markup.button.callback('Rota 3', 'set_rota_3'),
		// 			Markup.button.callback('Office Hours', 'set_office_hours'),
		// 		],
		// 		[Markup.button.callback('Stop Updates', 'stop_updates')],
		// 	]),
		// 	parse_mode: 'HTML',
		// });
	});

	// Help
	bot.command('help', async (ctx: Context) => {
		await ctx.reply(HELP_MESSAGE, { parse_mode: 'HTML' });
	});
}

// TODO: Add handlers to add other admins via username
// TODO: Fix migration to workers
function registerAdminHandlers(bot: Telegraf, db: Db) {
	// Usage: /announcement [message]
	// Example: /announcement Weather update will be delayed today due to API issues.
	// bot.command('announcement', async (ctx) => {
	// 	// Check if the person is allowed to send an announcement
	// 	if (ctx.from.id.toString() !== env.OWNER_USER_ID) {
	// 		await ctx.reply('You are not authorized to use this command.');
	// 		return;
	// 	}
	//
	// 	const announcementMsg = ctx.message.text.split(' ').slice(1).join(' ').trim();
	//
	// 	if (!announcementMsg) {
	// 		await ctx.reply('Please provide a message for the announcement.');
	// 		return;
	// 	}
	//
	// 	const subscribedChatIds = await Redis.getAllChatIds();
	//
	// 	await MessageQueue.sendAnnouncementMessages(
	// 		bot,
	// 		subscribedChatIds.map((id) => parseInt(id, 10)),
	// 		announcementMsg,
	// 	);
	//
	// 	await ctx.reply('✅ Announcement sent to all subscribed chats.');
	// 	await ctx.reply('📢 Your announcement: ' + announcementMsg);
	//
	// 	logger.info(`Admin announcement sent by user: ${ctx.from.username} (ID: ${ctx.from.id}). Message: ${announcementMsg}`);
	// });
}

// Composition root for this module: builds bot + scheduler, wires handlers, and returns runtime.
// Caller controls when runtime starts by deciding when to invoke this function.
// export function startBot(BOT_ID: string, db: Db): BotRuntime {
// 	const bot = createBot(BOT_ID);
// 	registerBotActionHandlers(bot, job, db);
// 	// registerAdminHandlers(bot, job, db);
// 	registerHandlers(bot, job, db);
// 	return { bot };
// }
