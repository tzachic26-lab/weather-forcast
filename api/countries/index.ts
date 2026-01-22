import { getCountries } from "../_shared.js";

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const lang = typeof req.query.lang === "string" ? req.query.lang : "en";
  const refresh = typeof req.query.refresh === "string" && req.query.refresh === "1";
  const countries = await getCountries(lang, refresh);
  if (!countries.length) {
    return res.status(502).json({ error: "Unable to load countries list." });
  }
  return res.json({ countries });
}
