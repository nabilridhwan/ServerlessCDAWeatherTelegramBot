export interface CatStatusAPIResponse {
  result: boolean;
  error: string | null;
  data: CatStatusData;
}

export interface CatStatusData {
  bases: WeatherEntry<'base'>;
  airbases: WeatherEntry<'airbase'>;
  armysectors: WeatherEntry<'sector'>;
}

export interface Location {
  name: string;
  latitude: number;
  longitude: number;
}

export interface Weather {
  PSI: number;
  temperature: string;
  image_name: string;
  CAT: string;
  cat_start_on: string;
  cat_end_on: string;
  update_on: string;
}

export type WeatherEntry<T extends string> = {
  [K in T]: Location;
} & {
  weather: Weather;
};
