import getNextTTLForCurrentQuarterHour from './getNextTTLForCurrentQuarterHour';
import { env } from 'cloudflare:workers';
import { Weather } from './weather.api';
import { TZDate } from '@date-fns/tz';
/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

export default {
	/**
	 * This is the standard fetch handler for a Cloudflare Worker
	 *
	 * @param request - The request submitted to the Worker from the client
	 * @param env - The interface to reference bindings declared in wrangler.jsonc
	 * @param ctx - The execution context of the Worker
	 * @returns The response to be sent back to the client
	 */
	async fetch(request, env, ctx): Promise<Response> {
		// Check if there is data in the cache
		const cachedData = await env.WEATHER_CACHE.get('WGBT_DATA');

		if (cachedData) {
			console.log('Data in cache');
			const json = await JSON.parse(cachedData);
			return Response.json(json);
		}

		console.log("Cache expired or doesn't exist. Fetching new data");

		// Otherwise fetch new data and store in cache
		const expirationTtl = getNextTTLForCurrentQuarterHour(3 * 60);
		console.log(`Requesting with ${env.DATA_GOV_API_KEY}`);
		const readings = await Weather.retrieveWeatherDataForBot(env.DATA_GOV_API_KEY);

		const res = {
			cache_expiration: new TZDate(new Date(Date.now() + expirationTtl * 1000), 'Asia/Singapore'),
			cda: {
				heatStress: readings.cdaWBGT.heatStress,
				wbgt: readings.cdaWBGT.wbgt,
				airTemp: readings.cdaAirTemp.value,
				emoji: Weather.Parser.parseWBGTHeatStress(readings.cdaWBGT.heatStress),
				dateTime: readings.cdaWBGT.dateTime,
			},
			httc: {
				heatStress: readings.httcWBGT.heatStress,
				wbgt: readings.httcWBGT.wbgt,
				airTemp: readings.httcAirTemp.value,
				emoji: Weather.Parser.parseWBGTHeatStress(readings.httcWBGT.heatStress),
				dateTime: readings.httcWBGT.dateTime,
			},
		};

		console.log('Done fetching new data');

		await env.WEATHER_CACHE.put('WGBT_DATA', JSON.stringify(res), {
			expirationTtl,
		});

		console.log('Done storing in cache');

		return Response.json(res);
	},
} satisfies ExportedHandler<Env>;
