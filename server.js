import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { Parser } from "json2csv";
import { fileURLToPath } from "url";
import { dirname } from "path";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// CORS configuration
app.use(cors());

app.use(express.json({  }));
app.use(express.urlencoded({  }));
app.use(express.static(path.join(process.cwd(), "public")));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const PORT = 3001;
const PVWATTS_API_KEY = process.env.PVWATTS_API_KEY;

// ----------------- helpers -----------------
function deg2rad(d) {
  return d * Math.PI / 180;
}

// Serve HTML pages
app.get('/', (req, res) => {
  // res.sendFile(path.join(__dirname, 'PREDICT1.'));
  res.render('PREDICT1.ejs');
});

app.get('/results', (req, res) => {
  // res.sendFile(path.join(__dirname, 'RESULT1.ejs'));
  res.render('RESULT1.ejs');
});

app.get('/export', (req, res) => {
  // res.sendFile(path.join(__dirname, 'EXPORT1.html'));
  res.render('EXPORT1.ejs');
});

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

// ----------------- PVWatts helpers -----------------
function computePVWattsParams({ lat, lon, systemCapacityKW = 5, tilt = 20, azimuth = 180, lossesPct = 14 }) {
  return new URLSearchParams({
    api_key: PVWATTS_API_KEY,
    lat: lat.toString(),
    lon: lon.toString(),
    system_capacity: systemCapacityKW.toString(),
    tilt: tilt.toString(),
    azimuth: azimuth.toString(),
    array_type: '1',
    module_type: '0',
    losses: lossesPct.toString(),
    timeframe: 'hourly'
  });
}

async function fetchPVWattsHourly(params) {
  const url = `https://developer.nrel.gov/api/pvwatts/v6.json?${params.toString()}`;
  const resp = await fetch(url, { headers: { 'User-Agent': 'solar-demo/1.0' } });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`PVWatts API error ${resp.status}: ${text}`);
  }
  const body = await resp.json();
  if (!body.outputs || !Array.isArray(body.outputs.ac)) throw new Error("PVWatts returned invalid data");
  return body.outputs.ac;
}

// ----------------- 16-day prediction endpoint -----------------
app.post("/api/predict/16days", async (req, res) => {
  try {
    // Input validation
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
    } = req.body;

    if (!location || typeof location !== 'string') {
      return res.status(400).json({ 
        error: "Valid location is required",
        code: "INVALID_LOCATION"
      });
    }

    // Validate numeric inputs
    const positiveParams = { numPanels, panelArea, panelEfficiency, inverterEfficiency, azimuth, soilingFactor, systemDerate, noct };
    for (const [key, value] of Object.entries(positiveParams)) {
      if (isNaN(value) || value < 0) {
        return res.status(400).json({ 
          error: `Invalid ${key}: must be a positive number`,
          code: "INVALID_PARAMETER"
        });
      }
    }
    
    // Validate tempCoeff separately (can be negative)
    if (isNaN(tempCoeff)) {
      return res.status(400).json({ 
        error: "Invalid tempCoeff: must be a number",
        code: "INVALID_PARAMETER"
      });
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

    // PVWatts comparison (optional)
    let pvwattsComparison = null;
    if (PVWATTS_API_KEY) {
      try {
        const systemCapacityKW = (numPanels * panelArea * panelEfficiency);
        const lossesPct = (1 - inverterEfficiency * soilingFactor * systemDerate) * 100;

        const params = computePVWattsParams({ lat, lon, systemCapacityKW, tilt: tiltDeg, azimuth, lossesPct });
        const pvAcArray = await fetchPVWattsHourly(params);

        const aligned = pvAcArray.slice(0, hourlyResults.length);
        const pvHourly = aligned.map(v => ({ ac_kW: v, kWh: v }));
        const pvTotal = pvHourly.reduce((s, h) => s + h.kWh, 0);

        const n = hourlyResults.length;
        const mae = hourlyResults.reduce((sum, r, i) => sum + Math.abs(r.ac_kWh - pvHourly[i].kWh), 0) / n;
        const biasPct = ((ourTotal - pvTotal) / pvTotal) * 100;

        pvwattsComparison = {
          totalKWh: +pvTotal.toFixed(4),
          hourly: pvHourly,
          mae: +mae.toFixed(4),
          biasPct: +biasPct.toFixed(2)
        };
      } catch (e) {
        console.warn("PVWatts comparison failed:", e.message);
      }
    }

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

    // Save CSV for download
    const parser = new Parser({ 
      fields: [
        "timestamp", 
        "ghi_W_m2", 
        "temp_C", 
        "humidity_pct", 
        "cloud_cover_pct", 
        "wind_speed_ms", 
        "wind_direction_deg", 
        "precipitation_mm", 
        "ac_kWh"
      ] 
    });
    const csv = parser.parse(hourlyResults);
    const fileName = `solar_prediction_${Date.now()}.csv`;
    const filePath = path.join(process.cwd(), "public", fileName);
    
    // Ensure public directory exists
    if (!fs.existsSync(path.join(process.cwd(), "public"))) {
      fs.mkdirSync(path.join(process.cwd(), "public"));
    }
    
    fs.writeFileSync(filePath, csv);

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
      pvwatts: pvwattsComparison,
      downloadUrl: `/${fileName}`,
      timestamp: new Date().toISOString()
    };

    res.json(response);

  } catch (err) {
    console.error("Error in /api/predict/16days:", err);
    
    // More specific error handling
    if (err.message.includes("Location not found")) {
      return res.status(404).json({ 
        error: "Location not found. Please check the spelling and try again.",
        code: "LOCATION_NOT_FOUND"
      });
    }
    
    if (err.message.includes("Weather API failed")) {
      return res.status(503).json({ 
        error: "Weather service temporarily unavailable. Please try again later.",
        code: "WEATHER_API_ERROR"
      });
    }

    res.status(500).json({ 
      error: "Internal server error. Please try again later.",
      code: "INTERNAL_ERROR"
    });
  }
});

// ----------------- Baseline CSV endpoint for Python scripts -----------------
app.get("/baseline-16day", async (req, res) => {
  try {
    // Default parameters for baseline generation
    const defaultParams = {
      location: "San Francisco, CA",
      numPanels: 20,
      panelArea: 1.6,
      panelEfficiency: 0.2,
      inverterEfficiency: 0.96,
      tilt: null,
      azimuth: 180,
      tempCoeff: -0.004,
      soilingFactor: 0.95,
      systemDerate: 0.86,
      inverterRatedPower: null,
      noct: 45
    };

    const geo = await geocodeLocation(defaultParams.location);
    const lat = geo.lat;
    const lon = geo.lon;
    const tiltDeg = defaultParams.tilt ?? Math.abs(lat);

    // Fetch forecast
    const forecast = await fetchForecast(lat, lon);

    // Physics-based daily energy (aggregated from hourly)
    const dailyResults = [];
    for (let i = 0; i < forecast.time.length; i += 24) {
      const dayData = forecast.time.slice(i, i + 24);
      const dayGhi = forecast.ghi.slice(i, i + 24);
      const dayTemp = forecast.temp.slice(i, i + 24);
      
      const dailyKWh = dayData.reduce((sum, _, hourIndex) => {
        const hourlyEnergy = calculateHourlyEnergy({
          ghi: dayGhi[hourIndex],
          tempC: dayTemp[hourIndex],
          numPanels: defaultParams.numPanels,
          panelArea: defaultParams.panelArea,
          panelEfficiency: defaultParams.panelEfficiency,
          inverterEfficiency: defaultParams.inverterEfficiency,
          tiltDeg,
          tempCoeff: defaultParams.tempCoeff,
          soilingFactor: defaultParams.soilingFactor,
          systemDerate: defaultParams.systemDerate,
          inverterRatedPower: defaultParams.inverterRatedPower,
          noct: defaultParams.noct
        });
        return sum + hourlyEnergy;
      }, 0);

      const avgGhi = dayGhi.reduce((sum, ghi) => sum + (ghi || 0), 0) / dayGhi.length;
      const avgTemp = dayTemp.reduce((sum, temp) => sum + (temp || 0), 0) / dayTemp.length;

      dailyResults.push({
        Date: dayData[0].split('T')[0], // Extract date part
        ghi_w_m2: Math.round(avgGhi * 100) / 100,
        temperature_C: Math.round(avgTemp * 100) / 100
      });
    }

    // Convert to CSV
    const parser = new Parser({ fields: ["Date", "ghi_w_m2", "temperature_C"] });
    const csv = parser.parse(dailyResults);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="baseline_16day.csv"');
    res.send(csv);

  } catch (err) {
    console.error("Error in /baseline-16day:", err);
    res.status(500).json({ error: err.message });
  }
});

// ----------------- Additional utility endpoints -----------------

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    services: {
      geocoding: "Nominatim",
      weather: "Open-Meteo",
      pvwatts: PVWATTS_API_KEY ? "Available" : "Not configured"
    }
  });
});

// Get optimal angles for a location
app.get("/api/optimal-angles", async (req, res) => {
  try {
    const { location } = req.query;
    if (!location) {
      return res.status(400).json({ error: "Location parameter is required" });
    }

    const geo = await geocodeLocation(location);
    const lat = geo.lat;
    const lon = geo.lon;
    
    const optimalTilt = Math.abs(lat);
    const optimalAzimuth = lat >= 0 ? 180 : 0; // South for Northern Hemisphere, North for Southern
    
    res.json({
      location: geo.display_name,
      coordinates: { lat: +lat.toFixed(4), lon: +lon.toFixed(4) },
      optimal: {
        tilt: +optimalTilt.toFixed(1),
        azimuth: +optimalAzimuth,
        explanation: {
          tilt: `Optimal tilt angle is approximately equal to the latitude (${lat.toFixed(1)}°)`,
          azimuth: lat >= 0 ? "South-facing (180°) for Northern Hemisphere" : "North-facing (0°) for Southern Hemisphere"
        }
      }
    });
  } catch (err) {
    console.error("Error in /api/optimal-angles:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get system capacity calculation
app.post("/api/calculate-capacity", (req, res) => {
  try {
    const { numPanels, panelArea, panelEfficiency, inverterEfficiency = 0.96 } = req.body;
    
    if (!numPanels || !panelArea || !panelEfficiency) {
      return res.status(400).json({ 
        error: "numPanels, panelArea, and panelEfficiency are required" 
      });
    }

    const dcCapacityKW = (numPanels * panelArea * panelEfficiency * 1000) / 1000; // Convert to kW
    const acCapacityKW = dcCapacityKW * inverterEfficiency;
    const annualEstimate = acCapacityKW * 4.5 * 365; // Rough estimate: 4.5 hours/day average

    res.json({
      system: {
        numPanels: +numPanels,
        panelArea: +panelArea,
        panelEfficiency: +panelEfficiency,
        inverterEfficiency: +inverterEfficiency
      },
      capacity: {
        dcKW: +dcCapacityKW.toFixed(2),
        acKW: +acCapacityKW.toFixed(2),
        annualEstimateKWh: +annualEstimate.toFixed(0)
      }
    });
  } catch (err) {
    console.error("Error in /api/calculate-capacity:", err);
    res.status(500).json({ error: err.message });
  }
});

// List available CSV files for download
app.get("/api/files", (req, res) => {
  try {
    const publicDir = path.join(process.cwd(), "public");
    if (!fs.existsSync(publicDir)) {
      return res.json({ files: [] });
    }

    const files = fs.readdirSync(publicDir)
      .filter(file => file.endsWith('.csv'))
      .map(file => {
        const filePath = path.join(publicDir, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          created: stats.birthtime,
          downloadUrl: `/${file}`
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json({ files });
  } catch (err) {
    console.error("Error in /api/files:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Server running at http://0.0.0.0:${PORT}`));

