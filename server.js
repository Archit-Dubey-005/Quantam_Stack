import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { Parser } from "json2csv";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public"))); // serve static files

const PORT = 3001;

// ----------------- helpers -----------------
function deg2rad(d) {
  return d * Math.PI / 180;
}

// ----------------- geocoding -----------------
async function geocodeLocation(location) {
  const q = encodeURIComponent(location);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'solar-demo/1.0 (email@example.com)' } });
  const data = await res.json();
  if (!data || data.length === 0) throw new Error("Location not found");
  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    display_name: data[0].display_name
  };
}

// ----------------- forecast (daily + hourly) -----------------
async function fetchForecast(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=shortwave_radiation,temperature_2m&forecast_days=16&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data || !data.hourly || !Array.isArray(data.hourly.time)) {
    throw new Error("Weather API failed");
  }
  return {
    time: data.hourly.time,
    ghi: data.hourly.shortwave_radiation, // W/m²
    temp: data.hourly.temperature_2m      // °C
  };
}

// ----------------- physics -----------------
function calculateHourlyEnergy({
  ghi,
  tempC,
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
}) {
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

  const acKWhPerHour = acPowerW / 1000; // kWh per hour
  return +acKWhPerHour.toFixed(4);
}

// ----------------- 16-day endpoint (JSON + CSV URL) -----------------
app.post("/api/predict/16days", async (req, res) => {
  try {
    const {
      location,
      numPanels = 10,
      panelArea = 1.6,
      panelEfficiency = 0.18,
      inverterEfficiency = 0.95,
      tilt = null,
      azimuth = 180,
      tempCoeff = -0.004,
      soilingFactor = 0.95,
      systemDerate = 0.86,
      inverterRatedPower = null,
      noct = 45
    } = req.body;

    if (!location) return res.status(400).json({ error: "location is required" });

    const geo = await geocodeLocation(location);
    const lat = geo.lat;
    const lon = geo.lon;
    const tiltDeg = tilt ?? Math.abs(lat);

    // fetch forecast
    const forecast = await fetchForecast(lat, lon);

    // compute hourly energy
    const hourlyResults = forecast.time.map((t, i) => ({
      time: t,
      ghi_W_m2: forecast.ghi[i],
      temp_C: forecast.temp[i],
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

    // convert to CSV
    const fields = ["time", "ghi_W_m2", "temp_C", "ac_kWh"];
    const parser = new Parser({ fields });
    const csv = parser.parse(hourlyResults);

    // save CSV to public folder with timestamp
    const fileName = `training_data_${Date.now()}.csv`;
    const filePath = path.join(process.cwd(), "public", fileName);
    fs.writeFileSync(filePath, csv);

    // return JSON + download URL
    return res.json({
      site: { location: geo.display_name, lat, lon, tiltDeg, azimuth },
      hourly: hourlyResults,
      message: "CSV file generated for training",
      downloadUrl: `/${fileName}` // accessible via browser
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// ----------------- example static CSV route -----------------
app.get("/baseline-16day", (req, res) => {
  res.sendFile(path.join(__dirname, "baseline_16day.csv"));
});

// ----------------- start server -----------------
app.listen(PORT, () => {
  console.log(`Solar server running at http://localhost:${PORT}`);
});
