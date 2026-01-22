import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const NWS_API_BASE = "https://api.weather.gov";
const OPEN_METEO_API_BASE = "https://api.open-meteo.com/v1/forecast";
const USER_AGENT = "weather-app/1.0";
// Helper function for making NWS API requests
async function makeNWSRequest(url) {
    const headers = {
        "User-Agent": USER_AGENT,
        Accept: "application/geo+json",
    };
    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return (await response.json());
    }
    catch (error) {
        console.error("Error making NWS request:", error);
        return null;
    }
}
// Helper function for making Open-Meteo API requests
async function makeOpenMeteoRequest(url) {
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
        console.error("Error making Open-Meteo request:", error);
        return null;
    }
}
// Format alert data
function formatAlert(feature) {
    const props = feature.properties;
    return [
        `Event: ${props.event || "Unknown"}`,
        `Area: ${props.areaDesc || "Unknown"}`,
        `Severity: ${props.severity || "Unknown"}`,
        `Status: ${props.status || "Unknown"}`,
        `Headline: ${props.headline || "No headline"}`,
        "---",
    ].join("\n");
}
function formatOpenMeteoForecast(data, latitude, longitude) {
    const daily = data.daily;
    if (!daily?.time?.length) {
        return `No forecast periods available for ${latitude}, ${longitude}`;
    }
    const current = data.current_weather;
    const currentLine = current
        ? `Current: ${current.temperature ?? "Unknown"}°C, Wind ${current.windspeed ?? "Unknown"} km/h`
        : null;
    const formattedDays = daily.time.map((date, index) => {
        const max = daily.temperature_2m_max?.[index];
        const min = daily.temperature_2m_min?.[index];
        const maxText = typeof max === "number" ? `${max}°C` : "Unknown";
        const minText = typeof min === "number" ? `${min}°C` : "Unknown";
        return `${date}: High ${maxText}, Low ${minText}`;
    });
    return `Forecast for ${latitude}, ${longitude} (Open-Meteo):\n\n${currentLine ? `${currentLine}\n` : ""}${formattedDays.join("\n")}`;
}
// Create server instance
const server = new McpServer({
    name: "weather",
    version: "1.0.0",
});
// Register weather tools
server.registerTool("get-alerts", {
    title: "Get Weather Alerts",
    description: "Get weather alerts for a state",
    inputSchema: {
        state: z.string().length(2).describe("Two-letter state code (e.g. CA, NY)"),
    },
}, async ({ state }) => {
    const stateCode = state.toUpperCase();
    const alertsUrl = `${NWS_API_BASE}/alerts?area=${stateCode}`;
    const alertsData = await makeNWSRequest(alertsUrl);
    if (!alertsData) {
        return {
            content: [
                {
                    type: "text",
                    text: "Failed to retrieve alerts data",
                },
            ],
        };
    }
    const features = alertsData.features || [];
    if (features.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: `No active alerts for ${stateCode}`,
                },
            ],
        };
    }
    const formattedAlerts = features.map(formatAlert);
    const alertsText = `Active alerts for ${stateCode}:\n\n${formattedAlerts.join("\n")}`;
    return {
        content: [
            {
                type: "text",
                text: alertsText,
            },
        ],
    };
});
server.registerTool("get-forecast", {
    title: "Get Weather Forecast",
    description: "Get weather forecast for a location",
    inputSchema: {
        latitude: z.number().min(-90).max(90).describe("Latitude of the location"),
        longitude: z
            .number()
            .min(-180)
            .max(180)
            .describe("Longitude of the location"),
    },
}, async ({ latitude, longitude }) => {
    // Get grid point data
    const pointsUrl = `${NWS_API_BASE}/points/${latitude.toFixed(4)},${longitude.toFixed(4)}`;
    const pointsData = await makeNWSRequest(pointsUrl);
    if (!pointsData) {
        const openMeteoUrl = `${OPEN_METEO_API_BASE}?latitude=${latitude}&longitude=${longitude}&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
        const openMeteoData = await makeOpenMeteoRequest(openMeteoUrl);
        if (!openMeteoData) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failed to retrieve forecast data for coordinates: ${latitude}, ${longitude}`,
                    },
                ],
            };
        }
        const forecastText = formatOpenMeteoForecast(openMeteoData, latitude, longitude);
        return {
            content: [
                {
                    type: "text",
                    text: forecastText,
                },
            ],
        };
    }
    const forecastUrl = pointsData.properties?.forecast;
    if (!forecastUrl) {
        const openMeteoUrl = `${OPEN_METEO_API_BASE}?latitude=${latitude}&longitude=${longitude}&current_weather=true&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;
        const openMeteoData = await makeOpenMeteoRequest(openMeteoUrl);
        if (!openMeteoData) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failed to get forecast data from grid point response and Open-Meteo",
                    },
                ],
            };
        }
        const forecastText = formatOpenMeteoForecast(openMeteoData, latitude, longitude);
        return {
            content: [
                {
                    type: "text",
                    text: forecastText,
                },
            ],
        };
    }
    // Get forecast data
    const forecastData = await makeNWSRequest(forecastUrl);
    if (!forecastData) {
        return {
            content: [
                {
                    type: "text",
                    text: "Failed to retrieve forecast data",
                },
            ],
        };
    }
    const periods = forecastData.properties?.periods || [];
    if (periods.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: "No forecast periods available",
                },
            ],
        };
    }
    // Format forecast periods
    const formattedForecast = periods.map((period) => [
        `${period.name || "Unknown"}:`,
        `Temperature: ${period.temperature || "Unknown"}°${period.temperatureUnit || "F"}`,
        `Wind: ${period.windSpeed || "Unknown"} ${period.windDirection || ""}`,
        `${period.shortForecast || "No forecast available"}`,
        "---",
    ].join("\n"));
    const forecastText = `Forecast for ${latitude}, ${longitude}:\n\n${formattedForecast.join("\n")}`;
    return {
        content: [
            {
                type: "text",
                text: forecastText,
            },
        ],
    };
});
// Start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Weather MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
