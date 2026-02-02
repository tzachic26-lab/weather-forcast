import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import passport from "passport";
import { Strategy as GoogleStrategy, Profile } from "passport-google-oauth20";

const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";

interface GeocodingResult {
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  country_code?: string;
  admin1?: string;
}

interface GeocodingResponse {
  results?: GeocodingResult[];
}

interface DailyForecast {
  time: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_probability_max?: number[];
  weathercode?: number[];
}

interface ForecastResponse {
  current_weather?: {
    temperature?: number;
    windspeed?: number;
    time?: string;
  };
  hourly?: {
    time?: string[];
    relative_humidity_2m?: number[];
    visibility?: number[];
    apparent_temperature?: number[];
    wind_speed_10m?: number[];
  };
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

const app = express();
const port = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(publicDir));

type AuthUser = {
  id?: string;
  displayName?: string;
  email?: string | null;
  photo?: string | null;
};

const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const googleCallbackUrl =
  process.env.GOOGLE_CALLBACK_URL || `http://localhost:${port}/api/auth/google/callback`;
const googleConfigured = Boolean(googleClientId && googleClientSecret);

passport.serializeUser((user: AuthUser, done: (error: Error | null, user?: AuthUser) => void) => {
  done(null, user);
});

passport.deserializeUser(
  (user: AuthUser, done: (error: Error | null, user?: AuthUser) => void) => {
    done(null, user);
  },
);

if (googleConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: googleCallbackUrl,
      },
      (
        _accessToken: string,
        _refreshToken: string,
        profile: Profile,
        done: (error: Error | null, user?: AuthUser) => void,
      ) => {
        const user: AuthUser = {
          id: profile.id,
          displayName: profile.displayName || "",
          email: profile.emails?.[0]?.value ?? null,
          photo: profile.photos?.[0]?.value ?? null,
        };
        done(null, user);
      },
    ),
  );
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

async function fetchJson<T>(url: string): Promise<T | null> {
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

async function getCountries(
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

function pickLocation(
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

app.get("/api/countries", async (req, res) => {
  const lang = typeof req.query.lang === "string" ? req.query.lang : "en";
  const refresh = typeof req.query.refresh === "string" && req.query.refresh === "1";
  const countries = await getCountries(lang, refresh);
  if (!countries.length) {
    return res.status(502).json({ error: "Unable to load countries list." });
  }
  return res.json({ countries });
});

app.get("/api/auth/google", (req, res, next) => {
  if (!googleConfigured) {
    return res.status(501).json({ error: "Google SSO is not configured." });
  }
  return passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

app.get(
  "/api/auth/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/",
  }),
  (req, res) => {
    res.redirect("/");
  },
);

app.get("/api/auth/me", (req, res) => {
  const user = (req as { user?: AuthUser }).user ?? null;
  res.json({ user });
});

app.post("/api/auth/logout", (req, res) => {
  const logout = (req as { logout?: (callback: (error?: Error) => void) => void }).logout;
  if (typeof logout !== "function") {
    return res.status(501).json({ error: "Logout is not available." });
  }
  logout((error?: Error) => {
    if (error) {
      return res.status(500).json({ error: "Unable to log out." });
    }
    const session = (req as { session?: { destroy: (callback: () => void) => void } }).session;
    session?.destroy(() => {
      res.json({ ok: true });
    });
  });
});

app.get("/api/countries/search", async (req, res) => {
  const lang = typeof req.query.lang === "string" ? req.query.lang : "en";
  const query = typeof req.query.query === "string" ? req.query.query.trim() : "";

  if (!query) {
    return res.status(400).json({ error: "Please provide query." });
  }

  const url = `https://restcountries.com/v3.1/translation/${encodeURIComponent(
    query,
  )}?fields=name,cca2,translations,altSpellings`;
  let data: CountryResponseItem[] | null = null;
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (response.status === 404) {
      return res.json({ countries: [] });
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    data = (await response.json()) as CountryResponseItem[];
  } catch (error) {
    console.error("Error fetching country translation:", error);
    return res.json({ countries: [] });
  }

  const normalizedLang = lang.toLowerCase();
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

  return res.json({ countries });
});

app.get("/api/cities", async (req, res) => {
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
});

app.get("/api/forecast", async (req, res) => {
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
      const dateIndex = hourlyTimes.findIndex((time: string) => time.startsWith(currentDate));
      if (dateIndex >= 0) {
        index = dateIndex;
      } else {
        const currentMs = Date.parse(currentTime);
        let bestIndex = 0;
        let bestDelta = Number.POSITIVE_INFINITY;
        hourlyTimes.forEach((time: string, i: number) => {
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
});

app.listen(port, () => {
  console.log(`Weather web app running at http://localhost:${port}`);
});
