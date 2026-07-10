import { CatStatus } from './catStatus.api';
import getNextTTLForCurrentQuarterHour from '../../weather-wbgt-service/src/getNextTTLForCurrentQuarterHour';
import { TZDate } from '@date-fns/tz';

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request, env, ctx): Promise<Response> {
		// Check if there is data in the cache
		const cachedData = await env.WEATHER_CACHE.get('CAT_DATA');

		if (cachedData) {
			console.log('Data in cache');
			const json = await JSON.parse(cachedData);
			return Response.json(json);
		}

		console.log("Cache expired or doesn't exist. Fetching new data");

		// Otherwise fetch new data and store in cache
		const expirationTtl = 5 * 60; // 5 minutes
		const cdaData = await CatStatus.API.getCatStatusFor('CDA');
		const cdaParsed = CatStatus.parseCATStatus(new Date(cdaData.cat_start_on), cdaData.CAT);

		const httcData = await CatStatus.API.getCatStatusFor('HTTC');
		const httcParsed = CatStatus.parseCATStatus(new Date(httcData.cat_start_on), httcData.CAT);

		const cdaFinalData = { ...cdaData, ...cdaParsed };
		cdaFinalData.cat_start_on = CatStatus.fixDate(new Date(cdaData.cat_start_on)).toISOString();
		cdaFinalData.update_on = CatStatus.fixDate(new Date(cdaData.update_on)).toISOString();
		cdaFinalData.cat_end_on = CatStatus.fixDate(new Date(cdaData.cat_end_on)).toISOString();

		const httcFinalData = { ...httcData, ...httcParsed };
		httcFinalData.cat_start_on = CatStatus.fixDate(new Date(httcData.cat_start_on)).toISOString();
		httcFinalData.update_on = CatStatus.fixDate(new Date(httcData.update_on)).toISOString();
		httcFinalData.cat_end_on = CatStatus.fixDate(new Date(httcData.cat_end_on)).toISOString();

		const res = {
			cache_expiration: new TZDate(new Date(Date.now() + expirationTtl * 1000), 'Asia/Singapore'),
			cda: cdaFinalData,
			httc: httcFinalData,
		};

		await env.WEATHER_CACHE.put('CAT_DATA', JSON.stringify(res), {
			expirationTtl,
		});

		return Response.json(res);
	},
} satisfies ExportedHandler<Env>;
