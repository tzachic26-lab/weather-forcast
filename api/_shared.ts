export const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1/search";
export const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";

export interface GeocodingResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  country_code?: string;
  admin1?: string;
}

export interface GeocodingResponse {
  results?: GeocodingResult[];
}

export interface DailyForecast {
  time: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_probability_max?: number[];
  weathercode?: number[];
}

export interface ForecastResponse {
  daily?: DailyForecast;
  timezone?: string;
}

interface CountryResponseItem {
  name: {
    common: string;
    nativeName?: Record<string, { common?: string }>;
  };
  cca2: string;
  translations?: Record<string, { common?: string }>;
  altSpellings?: string[];
}

const countryCache = new Map<
  string,
  {
    code: string;
    name: string;
    englishName: string;
    hebrewName?: string;
    altSpellings?: string[];
  }[]
>();

export async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Request failed:", error);
    return null;
  }
}

export async function getCountries(
  lang: string,
  refresh: boolean,
): Promise<
  { code: string; name: string; englishName: string; hebrewName?: string; altSpellings?: string[] }[]
> {
  const normalizedLang = lang.toLowerCase();
  const cached = countryCache.get(normalizedLang);
  if (cached && !refresh) {
    return cached;
  }

  const url = "https://restcountries.com/v3.1/all?fields=name,cca2,translations,altSpellings";
  const data = await fetchJson<CountryResponseItem[]>(url);

  if (!data) {
    return [];
  }

  const countries = data
    .filter((item) => item.cca2 && item.name?.common)
    .map((item) => ({
      code: item.cca2.toUpperCase(),
      name:
        normalizedLang === "he"
          ? item.translations?.heb?.common ||
            item.name?.nativeName?.heb?.common ||
            item.name.common
          : item.name.common,
      englishName: item.name.common,
      hebrewName: item.translations?.heb?.common || item.name?.nativeName?.heb?.common,
      altSpellings: item.altSpellings,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  countryCache.set(normalizedLang, countries);
  return countries;
}

export async function searchCountries(
  lang: string,
  query: string,
): Promise<
  { code: string; name: string; englishName: string; hebrewName?: string; altSpellings?: string[] }[]
> {
  const url = `https://restcountries.com/v3.1/translation/${encodeURIComponent(
    query,
  )}?fields=name,cca2,translations,altSpellings`;
  let data: CountryResponseItem[] | null = null;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (response.status === 404) {
      return [];
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    data = (await response.json()) as CountryResponseItem[];
  } catch (error) {
    console.error("Error fetching country translation:", error);
    return [];
  }

  const normalizedLang = lang.toLowerCase();
  return data
    .filter((item) => item.cca2 && item.name?.common)
    .map((item) => ({
      code: item.cca2.toUpperCase(),
      name:
        normalizedLang === "he"
          ? item.translations?.heb?.common ||
            item.name?.nativeName?.heb?.common ||
            item.name.common
          : item.name.common,
      englishName: item.name.common,
      hebrewName: item.translations?.heb?.common || item.name?.nativeName?.heb?.common,
      altSpellings: item.altSpellings,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function pickLocation(
  results: GeocodingResult[],
  countryInput: string,
): GeocodingResult | null {
  const normalized = countryInput.trim().toLowerCase();
  const isCode = normalized.length === 2;

  const matches = results.filter((result) => {
    if (isCode && result.country_code) {
      return result.country_code.toLowerCase() === normalized;
    }
    return result.country.toLowerCase() === normalized;
  });

  return (matches.length ? matches : results)[0] || null;
}
