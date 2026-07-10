import haversine from 'haversine-distance';
import type {
	AirTempAPIResponse,
	AirTempResponse,
	AirTempStation,
	BaseResponse,
	Coordinate,
	WBGTAPIResponse,
	WBGTResponse,
	WbgtReading,
	WbgtRecord,
	WbgtStation,
} from './weather.types';

export namespace Weather {
	const WBGT_API_URL = 'https://api-open.data.gov.sg/v2/real-time/api/weather?api=wbgt';
	const AIR_TEMP_API_URL = 'https://api-open.data.gov.sg/v2/real-time/api/air-temperature';

	async function requestDataGov<T>(url: string, requestName: 'WBGT' | 'Air Temperature', apiKey: string): Promise<BaseResponse<T>> {
		try {
			const response = await fetch(url, {
				headers: {
					'x-api-key': apiKey,
				},
			});
			if (!response.ok) {
				throw new Error(`Request failed with status ${response.status}`);
			}

			const data = (await response.json()) as BaseResponse<T>;

			return data;
		} catch (error) {
			console.error(`Error fetching ${requestName} data:`, error);
			throw error;
		}
	}

	export namespace Types {
		export type WeatherReadings = {
			cdaWBGT: WBGTResponse;
			cdaAirTemp: AirTempResponse;
			httcWBGT: WBGTResponse;
			httcAirTemp: AirTempResponse;
		};

		export type WeatherSnapshot = {
			heatStress: string;
			wbgt: string;
			airTemp: number;
			emoji: {
				color: string;
				symbol: string;
			};
			dateTime: string;
		};
	}

	export namespace Parser {
		export function parseWbgtLocation(location: WbgtReading['location']): Coordinate {
			return {
				latitude: parseFloat(location.latitude),
				longitude: parseFloat(location.longitude),
			};
		}

		/**
		 * Get the WBGT emoji based on the heat stress level.
		 * @param heatStress
		 */
		export function parseWBGTHeatStress(heatStress: string): Types.WeatherSnapshot['emoji'] {
			const heatStressLower = heatStress.toLowerCase();

			if (heatStressLower === 'low') {
				return {
					color: 'green',
					symbol: '🟢', // Green for low heat stress
				};
			} else if (heatStressLower === 'moderate') {
				return {
					color: 'yellow',
					symbol: '🟡', // Yellow for moderate heat stress
				};
			} else if (heatStressLower.includes('hi')) {
				return {
					color: 'red',
					symbol: '🔴', // Red for very high heat stress
				};
			} else {
				return {
					color: 'white',
					symbol: '⚪', // White for unknown or other cases
				};
			}
		}
	}

	export namespace Distance {
		export function distanceBetween(from: Coordinate, to: Coordinate) {
			return haversine(from, to);
		}

		export function findClosestWbgtStation(records: WbgtRecord[], targetLocation: Coordinate): WbgtStation | null {
			let closestStation: WbgtStation | null = null;
			let shortestDistance = Number.MAX_SAFE_INTEGER;

			for (const record of records) {
				for (const reading of record.item.readings) {
					const readingLocation = Weather.Parser.parseWbgtLocation(reading.location);
					const distance = Weather.Distance.distanceBetween(targetLocation, readingLocation);

					if (distance < shortestDistance) {
						shortestDistance = distance;
						closestStation = reading.station;
					}
				}
			}

			return closestStation;
		}

		export function findClosestAirTempStation(stations: AirTempStation[], targetLocation: Coordinate): AirTempStation {
			let closestStation = Weather.Defaults.defaultAirTempStation();
			let shortestDistance = Number.MAX_SAFE_INTEGER;

			for (const station of stations) {
				const distance = Weather.Distance.distanceBetween(targetLocation, station.location);
				if (distance < shortestDistance) {
					shortestDistance = distance;
					closestStation = station;
				}
			}

			return closestStation;
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

		export function defaultWbgtResponse(): WBGTResponse {
			return {
				wbgt: '',
				heatStress: '',
				station: {
					id: '',
					name: '',
					townCenter: '',
				},
				location: {
					latitude: -1,
					longitude: -1,
				},
				dateTime: '',
			};
		}

		export function defaultAirTempStation(): AirTempStation {
			return {
				deviceId: '',
				id: '',
				name: '',
				location: {
					latitude: -1,
					longitude: -1,
				},
			};
		}
	}

	export namespace BaseAPI {
		/**
		 * Read datetime for the latest WBGT data
		 */
		async function getWBGT(apiKey: string) {
			return requestDataGov<WBGTAPIResponse>(WBGT_API_URL, 'WBGT', apiKey);
		}

		/**
		 * Read datetime for the latest Air Temperature data
		 */
		async function getAirTemp(apiKey: string) {
			return requestDataGov<AirTempAPIResponse>(AIR_TEMP_API_URL, 'Air Temperature', apiKey);
		}

		/**
		 * Get the WBGT and heat stress from the closest station to the given latitude and longitude.
		 * @param targetLocation
		 * @param apiKey
		 */
		export async function fetchWBGTFromCoordinates(
			targetLocation: { latitude: number; longitude: number },
			apiKey: string,
		): Promise<WBGTResponse> {
			const wbgtApiRes = await getWBGT(apiKey);

			const closestStation = Weather.Distance.findClosestWbgtStation(wbgtApiRes.data.records, targetLocation);

			if (!closestStation) {
				return Weather.Defaults.defaultWbgtResponse();
			}

			for (const record of wbgtApiRes.data.records) {
				for (const reading of record.item.readings) {
					if (reading.station.id === closestStation.id) {
						const readingLocation = Weather.Parser.parseWbgtLocation(reading.location);

						return {
							wbgt: reading.wbgt,
							heatStress: reading.heatStress,
							station: {
								id: reading.station.id,
								name: reading.station.name,
								townCenter: reading.station.townCenter,
							},
							location: readingLocation,
							dateTime: record.datetime,
						};
					}
				}
			}

			return Weather.Defaults.defaultWbgtResponse();
		}

		/**
		 * Get the air temperature from the closest station to the given latitude and longitude.
		 * @param lat
		 * @param lng
		 */
		export async function fetchAirTemperatureFromCoordinates(
			targetLocation: { latitude: number; longitude: number },
			apiKey: string,
		): Promise<AirTempResponse> {
			const airTempApiRes = await getAirTemp(apiKey);

			const closestStation = Weather.Distance.findClosestAirTempStation(airTempApiRes.data.stations, targetLocation);

			const latestReading = airTempApiRes.data.readings[0];
			const stationReading = latestReading?.data.find((reading) => reading.stationId === closestStation.id);

			return {
				dateTime: latestReading?.timestamp ?? '',
				value: stationReading?.value ?? -1,
				station: {
					deviceId: closestStation.deviceId,
					id: closestStation.id,
					name: closestStation.name,
					location: {
						latitude: closestStation.location.latitude,
						longitude: closestStation.location.longitude,
					},
				},
				location: targetLocation,
			};
		}
	}

	export async function retrieveWeatherDataForBot(apiKey: string): Promise<Weather.Types.WeatherReadings> {
		const [cdaWBGT, cdaAirTemp, httcWBGT, httcAirTemp] = await Promise.all([
			Weather.BaseAPI.fetchWBGTFromCoordinates(
				{
					latitude: Weather.Defaults.CDA.latitude,
					longitude: Weather.Defaults.CDA.longitude,
				},
				apiKey,
			),
			Weather.BaseAPI.fetchAirTemperatureFromCoordinates(
				{
					latitude: Weather.Defaults.CDA.latitude,
					longitude: Weather.Defaults.CDA.longitude,
				},
				apiKey,
			),
			Weather.BaseAPI.fetchWBGTFromCoordinates(
				{
					latitude: Weather.Defaults.HTTC.latitude,
					longitude: Weather.Defaults.HTTC.longitude,
				},
				apiKey,
			),
			Weather.BaseAPI.fetchAirTemperatureFromCoordinates(
				{
					latitude: Weather.Defaults.HTTC.latitude,
					longitude: Weather.Defaults.HTTC.longitude,
				},
				apiKey,
			),
		]);

		return {
			cdaWBGT,
			cdaAirTemp,
			httcWBGT,
			httcAirTemp,
		};
	}

	// export async function getCachedOrFetchWeatherDataForBot(): Promise<{
	//   data: Weather.Types.WeatherReadings;
	//   isCached: boolean;
	// }> {
	//   const cacheKey = Cache.getCacheKeyForCurrentQuarterHour();
	//   const cachedData = await Cache.getCachedWeatherData(cacheKey);
	//
	//   if (cachedData) {
	//     return {
	//       data: cachedData,
	//       isCached: true,
	//     };
	//   }
	//
	//   const freshData = await retrieveWeatherDataForBot();
	//   await Cache.setCachedWeatherData(cacheKey, freshData);
	//   return {
	//     data: freshData,
	//     isCached: false,
	//   };
	// }
}
