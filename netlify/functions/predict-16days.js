import fetch from "node-fetch";
import { Parser } from "json2csv";

// Helper functions
function deg2rad(d) {
  return d * Math.PI / 180;
}

async function geocodeLocation(location) {
  const q = encodeURIComponent(location);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'solar-demo/1.0 (email@example.com)' } });
  const data = await res.json();
  if (!data || data.length === 0) throw new Error("Location not found");
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display_name: data[0].display_name };
}

async function fetchForecast(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=shortwave_radiation,temperature_2m,relative_humidity_2m,cloud_cover,wind_speed_10m,wind_direction_10m,precipitation&forecast_days=16&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data || !data.hourly || !Array.isArray(data.hourly.time)) throw new Error("Weather API failed");
  return { 
    time: data.hourly.time, 
    ghi: data.hourly.shortwave_radiation, 
    temp: data.hourly.temperature_2m,
    humidity: data.hourly.relative_humidity_2m,
    cloudCover: data.hourly.cloud_cover,
    windSpeed: data.hourly.wind_speed_10m,
    windDirection: data.hourly.wind_direction_10m,
    precipitation: data.hourly.precipitation
  };
}

function calculateHourlyEnergy({ ghi, tempC, numPanels, panelArea, panelEfficiency, inverterEfficiency, tiltDeg, tempCoeff, soilingFactor, systemDerate, inverterRatedPower, noct }) {
  if (ghi === null || tempC === null) return 0;

  const tiltRad = deg2rad(tiltDeg);
  const poa = ghi * Math.cos(tiltRad);
  const cellTemp = tempC + (noct - 20) * (poa / 800.0);
  const tempFactor = 1 + tempCoeff * (cellTemp - 25);
  const perPanelW = poa * panelArea * panelEfficiency;
  const dcPowerW = perPanelW * numPanels * tempFactor;
  const afterSoilingW = dcPowerW * soilingFactor;
  const afterDerateW = afterSoilingW * systemDerate;
  let acPowerW = afterDerateW * inverterEfficiency;
  if (inverterRatedPower && inverterRatedPower > 0) acPowerW = Math.min(acPowerW, inverterRatedPower);
  return +(acPowerW / 1000).toFixed(4);
}

export async function handler(event, context) {
  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body);
    const { 
      location, 
      numPanels = 20, 
      panelArea = 1.6, 
      panelEfficiency = 0.2, 
      inverterEfficiency = 0.96, 
      tilt = null, 
      azimuth = 180, 
      tempCoeff = -0.004, 
      soilingFactor = 0.95, 
      systemDerate = 0.86, 
      inverterRatedPower = null, 
      noct = 45 
    } = body;

    if (!location || typeof location !== 'string') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: "Valid location is required",
          code: "INVALID_LOCATION"
        })
      };
    }

    // Validate numeric inputs
    const positiveParams = { numPanels, panelArea, panelEfficiency, inverterEfficiency, azimuth, soilingFactor, systemDerate, noct };
    for (const [key, value] of Object.entries(positiveParams)) {
      if (isNaN(value) || value < 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ 
            error: `Invalid ${key}: must be a positive number`,
            code: "INVALID_PARAMETER"
          })
        };
      }
    }
    
    // Validate tempCoeff separately (can be negative)
    if (isNaN(tempCoeff)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: "Invalid tempCoeff: must be a number",
          code: "INVALID_PARAMETER"
        })
      };
    }

    // Geocode location
    const geo = await geocodeLocation(location);
    const lat = geo.lat;
    const lon = geo.lon;
    const tiltDeg = tilt ?? Math.abs(lat);

    // Fetch weather forecast
    const forecast = await fetchForecast(lat, lon);

    // Calculate hourly energy production
    const hourlyResults = forecast.time.map((t, i) => ({
      timestamp: t,
      ghi_W_m2: forecast.ghi[i] || 0,
      temp_C: forecast.temp[i] || 0,
      humidity_pct: forecast.humidity[i] || 0,
      cloud_cover_pct: forecast.cloudCover[i] || 0,
      wind_speed_ms: forecast.windSpeed[i] || 0,
      wind_direction_deg: forecast.windDirection[i] || 0,
      precipitation_mm: forecast.precipitation[i] || 0,
      ac_kWh: calculateHourlyEnergy({
        ghi: forecast.ghi[i],
        tempC: forecast.temp[i],
        numPanels,
        panelArea,
        panelEfficiency,
        inverterEfficiency,
        tiltDeg,
        tempCoeff,
        soilingFactor,
        systemDerate,
        inverterRatedPower,
        noct
      })
    }));

    const ourTotal = hourlyResults.reduce((sum, r) => sum + r.ac_kWh, 0);

    // Calculate optimal angles (simple optimization)
    const optimalTilt = Math.abs(lat);
    const optimalAzimuth = 180; // South-facing for Northern Hemisphere
    const efficiencyGain = tiltDeg !== optimalTilt ? Math.abs(optimalTilt - tiltDeg) * 0.5 : 0;

    // Generate recommendations
    const recommendations = [];
    if (Math.abs(tiltDeg - optimalTilt) > 5) {
      recommendations.push(`Consider adjusting tilt angle from ${tiltDeg.toFixed(1)}° to ${optimalTilt.toFixed(1)}° for optimal performance`);
    }
    if (Math.abs(azimuth - optimalAzimuth) > 10) {
      recommendations.push(`Consider adjusting azimuth angle from ${azimuth}° to ${optimalAzimuth}° for better sun exposure`);
    }
    if (panelEfficiency < 0.18) {
      recommendations.push("Consider upgrading to higher efficiency panels for better energy output");
    }

    // Response structure
    const response = {
      success: true,
      site: { 
        location: geo.display_name, 
        lat: +lat.toFixed(4), 
        lon: +lon.toFixed(4), 
        tiltDeg: +tiltDeg.toFixed(1), 
        azimuth: +azimuth 
      },
      forecast: {
        hourly: hourlyResults,
        totalKWh: +ourTotal.toFixed(2),
        dailyAverage: +(ourTotal / 16).toFixed(2)
      },
      optimization: {
        currentTilt: +tiltDeg.toFixed(1),
        optimalTilt: +optimalTilt.toFixed(1),
        currentAzimuth: +azimuth,
        optimalAzimuth: +optimalAzimuth,
        efficiencyGain: +efficiencyGain.toFixed(1)
      },
      recommendations,
      timestamp: new Date().toISOString()
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };

  } catch (err) {
    console.error("Error in predict-16days:", err);
    
    // More specific error handling
    if (err.message.includes("Location not found")) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: "Location not found. Please check the spelling and try again.",
          code: "LOCATION_NOT_FOUND"
        })
      };
    }
    
    if (err.message.includes("Weather API failed")) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({ 
          error: "Weather service temporarily unavailable. Please try again later.",
          code: "WEATHER_API_ERROR"
        })
      };
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: "Internal server error. Please try again later.",
        code: "INTERNAL_ERROR"
      })
    };
  }
}

