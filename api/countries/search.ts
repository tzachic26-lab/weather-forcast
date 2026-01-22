import { searchCountries } from "../_shared.js";

export default async function handler(req: any, res: any) {
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  const lang = typeof req.query.lang === "string" ? req.query.lang : "en";
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";

  if (!query) {
    return res.status(400).json({ error: "Please provide query." });
  }

  const countries = await searchCountries(lang, query);
  return res.json({ countries });
}
