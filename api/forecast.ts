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

  const forecastUrl = `${FORECAST_BASE}?latitude=${location.latitude}&longitude=${location.longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&timezone=auto`;
  const forecastData = await fetchJson<ForecastResponse>(forecastUrl);

  if (!forecastData?.daily?.time?.length) {
    return res.status(502).json({
      error: "Forecast data not available for this location.",
    });
  }

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
    daily: forecastData.daily,
  });
}
