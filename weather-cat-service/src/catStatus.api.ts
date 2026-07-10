import { tz, TZDate } from '@date-fns/tz';
import { format } from 'date-fns/format';
import { CatStatusAPIResponse } from './catStatus.types';
import { isAfter } from 'date-fns';

export namespace CatStatus {
	const SINGAPORE_TIME_ZONE = 'Asia/Singapore';

	const CAT_STATUS_API_BASE_URL = 'https://api.andewmole.com/cat1';

	async function requestCatStatusAPI(url: string): Promise<CatStatusAPIResponse> {
		try {
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`Request failed with status ${response.status}`);
			}

			const data = (await response.json()) as CatStatusAPIResponse;

			return data;
		} catch (error) {
			console.error(`Error fetching CAT Status data:`, error);
			throw error;
		}
	}

	export function formatDate(date: Date | string): string {
		return format(new Date(date), 'd MMMM yyyy HH:mm', {
			in: tz(SINGAPORE_TIME_ZONE),
		});
	}

	export function fixDate(date: Date) {
		const fixed = new Date(date.getTime() - 8 * 60 * 60 * 1000);
		const fixedTZ = new TZDate(fixed, SINGAPORE_TIME_ZONE);
		return fixedTZ;
	}

	export function parseCATStatus(startDate: Date, catStatus: string) {
		// The var here is needed because the time from the API is returning the correct time but wrong timezone
		// "2026-07-07T13:50:00.000Z" -> Correct SG time of 13:50 but the Z at the end represents UTC timezone hence it is wrong
		// So we minus 8 hours from the time and then it becomes UTC time
		// Use the UTC time and convert to Asia/Singapore
		const fixedTZ = fixDate(startDate);

		// Convert our current time into Asia/Singapore
		const date = new TZDate(new Date(), SINGAPORE_TIME_ZONE);

		// Debug log
		console.log(
			`Parsing cat status for startDate: ${fixedTZ.toISOString()} cat status: ${catStatus} and current date: ${date.toISOString()}`,
		);

		switch (catStatus) {
			case '3':
				return {
					emoji: '🟢',
					catText: 'CAT 3',
				};

			case '2':
				return {
					emoji: '🟡',
					catText: 'CAT 2',
				};

			case '1':
				if (isAfter(fixedTZ, date)) {
					return {
						emoji: '🟠',
						catText: 'CAT 1 (Incoming)',
					};
				}

				return {
					emoji: '🔴',
					catText: 'CAT 1',
				};

			default:
				return {
					emoji: '',
					catText: catStatus,
				};
		}
	}

	export namespace Defaults {
		export const CDA = {
			latitude: 1.3659363,
			longitude: 103.6898665,
			name: 'Civil Defence Academy',
			shortName: 'CDA',
		};

		export const HTTC = {
			latitude: 1.4063182,
			longitude: 103.759932,
			name: 'Home Team Tactical Centre',
			shortName: 'HTTC',
		};
	}

	export namespace API {
		export async function getCatStatusFor(location: 'CDA' | 'HTTC') {
			let str = '';

			switch (location) {
				case 'CDA':
					str = `/getCATInfo?lat=${Defaults.CDA.latitude}&long=${Defaults.CDA.longitude}`;
					break;
				case 'HTTC':
					str = `/getCATInfo?lat=${Defaults.HTTC.latitude}&long=${Defaults.HTTC.longitude}`;
					break;
			}

			const response = await requestCatStatusAPI(CAT_STATUS_API_BASE_URL + str);

			if (!response.data) {
				console.log('Error getting CAT Status API');
				throw new Error('Error getting CAT Status API');
			}

			if (!response.data.armysectors) {
				console.log('No army sectors found');
				throw new Error('No army sectors found');
			}

			console.log('Get CAT Status API');
			console.log(response.data);

			const sector = response.data.armysectors;

			const data = sector.weather;

			return data;
		}
	}
}
