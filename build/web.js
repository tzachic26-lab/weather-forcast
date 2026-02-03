import dotenv from "dotenv";
dotenv.config({ override: true });
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
const GEOCODING_BASE = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_BASE = "https://api.open-meteo.com/v1/forecast";
const app = express();
const port = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";
if (process.env.VERCEL) {
    app.set("trust proxy", 1);
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "..", "public");
app.use(session({
    secret: process.env.SESSION_SECRET || "dev-session-secret",
    resave: false,
    saveUninitialized: false,
    proxy: Boolean(process.env.VERCEL),
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: isProd,
    },
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static(publicDir));
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || `http://localhost:${port}/api/auth/google/callback`;
const googleConfigured = Boolean(googleClientId && googleClientSecret);
passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((user, done) => {
    done(null, user);
});
if (googleConfigured) {
    passport.use(new GoogleStrategy({
        clientID: googleClientId,
        clientSecret: googleClientSecret,
        callbackURL: googleCallbackUrl,
    }, (_accessToken, _refreshToken, profile, done) => {
        const user = {
            id: profile.id,
            displayName: profile.displayName || "",
            email: profile.emails?.[0]?.value ?? null,
            photo: profile.photos?.[0]?.value ?? null,
        };
        done(null, user);
    }));
}
const countryCache = new Map();
async function fetchJson(url) {
    try {
        const response = await fetch(url, {
            headers: { Accept: "application/json" },
        });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return (await response.json());
    }
    catch (error) {
        console.error("Request failed:", error);
        return null;
    }
}
async function getCountries(lang, refresh) {
    const normalizedLang = lang.toLowerCase();
    const cached = countryCache.get(normalizedLang);
    if (cached && !refresh) {
        return cached;
    }
    const url = "https://restcountries.com/v3.1/all?fields=name,cca2,translations,altSpellings";
    const data = await fetchJson(url);
    if (!data) {
        return [];
    }
    const countries = data
        .filter((item) => item.cca2 && item.name?.common)
        .map((item) => ({
        code: item.cca2.toUpperCase(),
        name: normalizedLang === "he"
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
function pickLocation(results, countryInput) {
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
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    return passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});
app.get("/api/ping", (_req, res) => {
    res.status(200).json({ ok: true, service: "api" });
});
app.get("/api/auth/google/callback", passport.authenticate("google", {
    failureRedirect: "/",
}), (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.redirect("/");
});
app.get("/api/auth/me", (req, res) => {
    const user = req.user ?? null;
    res.json({ user });
});
app.post("/api/auth/logout", (req, res) => {
    const logout = req.logout;
    if (typeof logout !== "function") {
        return res.status(501).json({ error: "Logout is not available." });
    }
    logout((error) => {
        if (error) {
            return res.status(500).json({ error: "Unable to log out." });
        }
        const session = req.session;
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
    const url = `https://restcountries.com/v3.1/translation/${encodeURIComponent(query)}?fields=name,cca2,translations,altSpellings`;
    let data = null;
    try {
        const response = await fetch(url, { headers: { Accept: "application/json" } });
        if (response.status === 404) {
            return res.json({ countries: [] });
        }
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        data = (await response.json());
    }
    catch (error) {
        console.error("Error fetching country translation:", error);
        return res.json({ countries: [] });
    }
    const normalizedLang = lang.toLowerCase();
    const countries = data
        .filter((item) => item.cca2 && item.name?.common)
        .map((item) => ({
        code: item.cca2.toUpperCase(),
        name: normalizedLang === "he"
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
    const geocodeUrl = `${GEOCODING_BASE}?name=${encodeURIComponent(query)}&count=20&language=${encodeURIComponent(lang)}&format=json`;
    const geocodeData = await fetchJson(geocodeUrl);
    const results = geocodeData?.results ?? [];
    const countryCode = country.toUpperCase();
    const filtered = results
        .filter((item) => item.country_code?.toUpperCase() === countryCode)
        .map((item) => ({
        name: item.name,
        admin1: item.admin1 ?? null,
    }));
    const unique = new Map();
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
    const geocodeUrl = `${GEOCODING_BASE}?name=${encodeURIComponent(city)}&count=10&language=${encodeURIComponent(lang)}&format=json`;
    const geocodeData = await fetchJson(geocodeUrl);
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
    const forecastData = await fetchJson(forecastUrl);
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
        }
        else {
            const currentDate = currentTime.split("T")[0];
            const dateIndex = hourlyTimes.findIndex((time) => time.startsWith(currentDate));
            if (dateIndex >= 0) {
                index = dateIndex;
            }
            else {
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
    const pickHourlyValue = (values) => {
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
        windspeed: pickHourlyValue(forecastData?.hourly?.wind_speed_10m) ??
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
if (!process.env.VERCEL) {
    app.listen(port, () => {
        console.log(`Weather web app running at http://localhost:${port}`);
    });
}
export default app;
