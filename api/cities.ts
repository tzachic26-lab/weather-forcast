import { fetchJson, GEOCODING_BASE, GeocodingResponse } from "./_shared.js";

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const country = typeof req.query.country === "string" ? req.query.country.trim() : "";
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
  const lang = typeof req.query.lang === "string" ? req.query.lang : "en";

  if (!country || !query) {
    return res.status(400).json({ error: "Please provide country and query." });
  }

  const geocodeUrl = `${GEOCODING_BASE}?name=${encodeURIComponent(query)}&count=20&language=${encodeURIComponent(
    lang,
  )}&format=json`;
  const geocodeData = await fetchJson<GeocodingResponse>(geocodeUrl);
  const results = geocodeData?.results ?? [];
  const countryCode = country.toUpperCase();

  const filtered = results
    .filter((item) => item.country_code?.toUpperCase() === countryCode)
    .map((item) => ({
      name: item.name,
      admin1: item.admin1 ?? null,
    }));

  const unique = new Map<string, { name: string; admin1: string | null }>();
  for (const item of filtered) {
    const key = `${item.name.toLowerCase()}|${item.admin1 ?? ""}`;
    if (!unique.has(key)) {
      unique.set(key, item);
    }
  }

  return res.json({ cities: Array.from(unique.values()) });
}
