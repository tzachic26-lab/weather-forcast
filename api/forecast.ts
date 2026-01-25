import {
  fetchJson,
  FORECAST_BASE,
  GEOCODING_BASE,
  GeocodingResponse,
  ForecastResponse,
  pickLocation,
} from "./_shared.js";

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const city = typeof req.query.city === "string" ? req.query.city.trim() : "";
  const country = typeof req.query.country === "string" ? req.query.country.trim() : "";
  const lang = typeof req.query.lang === "string" ? req.query.lang : "en";

  if (!city || !country) {
    return res.status(400).json({
      error: "Please provide both city and country.",
    });
  }

  const geocodeUrl = `${GEOCODING_BASE}?name=${encodeURIComponent(
    city,
  )}&count=10&language=${encodeURIComponent(lang)}&format=json`;
  const geocodeData = await fetchJson<GeocodingResponse>(geocodeUrl);
  const results = geocodeData?.results ?? [];

  if (!results.length) {
    return res.status(404).json({
      error: "No locations found for that city.",
    });
  }

  const location = pickLocation(results, country);
  if (!location) {
    return res.status(404).json({
      error: "No matching location for that country.",
    });
  }

  const forecastUrl = `${FORECAST_BASE}?latitude=${location.latitude}&longitude=${location.longitude}&current_weather=true&hourly=relative_humidity_2m,visibility,apparent_temperature,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&forecast_days=8&timezone=auto`;
  const forecastData = await fetchJson<ForecastResponse>(forecastUrl);

  if (!forecastData?.daily?.time?.length) {
    return res.status(502).json({
      error: "Forecast data not available for this location.",
    });
  }

  const hourlyTimes = forecastData?.hourly?.time ?? [];
  const currentTime = forecastData?.current_weather?.time;
  let index = 0;
  if (currentTime && hourlyTimes.length > 0) {
    const exactIndex = hourlyTimes.indexOf(currentTime);
    if (exactIndex >= 0) {
      index = exactIndex;
    } else {
      const currentDate = currentTime.split("T")[0];
      const dateIndex = hourlyTimes.findIndex((time) => time.startsWith(currentDate));
      if (dateIndex >= 0) {
        index = dateIndex;
      } else {
        const currentMs = Date.parse(currentTime);
        let bestIndex = 0;
        let bestDelta = Number.POSITIVE_INFINITY;
        hourlyTimes.forEach((time, i) => {
          const ms = Date.parse(time);
          if (Number.isNaN(ms) || Number.isNaN(currentMs)) {
            return;
          }
          const delta = Math.abs(ms - currentMs);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestIndex = i;
          }
        });
        index = bestIndex;
      }
    }
  }
  const pickHourlyValue = (values?: number[]) => {
    if (!values || values.length === 0) {
      return null;
    }
    const candidate = values[index];
    if (typeof candidate === "number") {
      return candidate;
    }
    const first = values.find((value) => typeof value === "number");
    return typeof first === "number" ? first : null;
  };
  const current = {
    temperature: forecastData?.current_weather?.temperature ?? null,
    windspeed:
      pickHourlyValue(forecastData?.hourly?.wind_speed_10m) ??
      forecastData?.current_weather?.windspeed ??
      null,
    humidity: pickHourlyValue(forecastData?.hourly?.relative_humidity_2m) ?? null,
    visibility: pickHourlyValue(forecastData?.hourly?.visibility) ?? null,
    apparentTemperature: pickHourlyValue(forecastData?.hourly?.apparent_temperature) ?? null,
  };

  return res.json({
    location: {
      name: location.name,
      admin1: location.admin1 ?? null,
      country: location.country,
      country_code: location.country_code ?? null,
      latitude: location.latitude,
      longitude: location.longitude,
    },
    timezone: forecastData.timezone ?? null,
    current,
    current_weather: forecastData.current_weather ?? null,
    hourly: forecastData.hourly ?? null,
    daily: forecastData.daily,
  });
}
