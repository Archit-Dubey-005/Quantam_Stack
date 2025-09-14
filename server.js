// import express from "express";
// import cors from "cors";
// import fetch from "node-fetch";
// import fs from "fs";
// import path from "path";
// import { Parser } from "json2csv";
// import { fileURLToPath } from "url";
// import { dirname } from "path";
// import dotenv from "dotenv";

// dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

// const app = express();
// app.use(cors());
// app.use(express.json());
// app.use(express.static(path.join(process.cwd(), "public")));

// const PORT = 3001;
// const PVWATTS_API_KEY = process.env.PVWATTS_API_KEY;

// // ----------------- helpers -----------------
// function deg2rad(d) {
//   return d * Math.PI / 180;
// }

// async function geocodeLocation(location) {
//   const q = encodeURIComponent(location);
//   const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
//   const res = await fetch(url, { headers: { 'User-Agent': 'solar-demo/1.0 (email@example.com)' } });
//   const data = await res.json();
//   if (!data || data.length === 0) throw new Error("Location not found");
//   return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display_name: data[0].display_name };
// }

// async function fetchForecast(lat, lon) {
//   const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=shortwave_radiation,temperature_2m&forecast_days=16&timezone=auto`;
//   const res = await fetch(url);
//   const data = await res.json();
//   if (!data || !data.hourly || !Array.isArray(data.hourly.time)) throw new Error("Weather API failed");
//   return { time: data.hourly.time, ghi: data.hourly.shortwave_radiation, temp: data.hourly.temperature_2m };
// }

// function calculateHourlyEnergy({ ghi, tempC, numPanels, panelArea, panelEfficiency, inverterEfficiency, tiltDeg, tempCoeff, soilingFactor, systemDerate, inverterRatedPower, noct }) {
//   if (ghi === null || tempC === null) return 0;

//   const tiltRad = deg2rad(tiltDeg);
//   const poa = ghi * Math.cos(tiltRad);
//   const cellTemp = tempC + (noct - 20) * (poa / 800.0);
//   const tempFactor = 1 + tempCoeff * (cellTemp - 25);
//   const perPanelW = poa * panelArea * panelEfficiency;
//   const dcPowerW = perPanelW * numPanels * tempFactor;
//   const afterSoilingW = dcPowerW * soilingFactor;
//   const afterDerateW = afterSoilingW * systemDerate;
//   let acPowerW = afterDerateW * inverterEfficiency;
//   if (inverterRatedPower && inverterRatedPower > 0) acPowerW = Math.min(acPowerW, inverterRatedPower);
//   return +(acPowerW / 1000).toFixed(4);
// }

// // ----------------- PVWatts helpers -----------------
// function computePVWattsParams({ lat, lon, systemCapacityKW = 5, tilt = 20, azimuth = 180, lossesPct = 14 }) {
//   return new URLSearchParams({
//     api_key: PVWATTS_API_KEY,
//     lat: lat.toString(),
//     lon: lon.toString(),
//     system_capacity: systemCapacityKW.toString(),
//     tilt: tilt.toString(),
//     azimuth: azimuth.toString(),
//     array_type: '1',
//     module_type: '0',
//     losses: lossesPct.toString(),
//     timeframe: 'hourly'
//   });
// }

// async function fetchPVWattsHourly(params) {
//   const url = `https://developer.nrel.gov/api/pvwatts/v6.json?${params.toString()}`;
//   const resp = await fetch(url, { headers: { 'User-Agent': 'solar-demo/1.0' } });
//   if (!resp.ok) {
//     const text = await resp.text();
//     throw new Error(`PVWatts API error ${resp.status}: ${text}`);
//   }
//   const body = await resp.json();
//   if (!body.outputs || !Array.isArray(body.outputs.ac)) throw new Error("PVWatts returned invalid data");
//   return body.outputs.ac;
// }

// // ----------------- 16-day endpoint -----------------
// app.post("/api/predict/16days", async (req, res) => {
//   try {
//     const { location, numPanels = 10, panelArea = 1.6, panelEfficiency = 0.18, inverterEfficiency = 0.95, tilt = null, azimuth = 180, tempCoeff = -0.004, soilingFactor = 0.95, systemDerate = 0.86, inverterRatedPower = null, noct = 45 } = req.body;
//     if (!location) return res.status(400).json({ error: "location is required" });

//     const geo = await geocodeLocation(location);
//     const lat = geo.lat;
//     const lon = geo.lon;
//     const tiltDeg = tilt ?? Math.abs(lat);

//     // Fetch forecast
//     const forecast = await fetchForecast(lat, lon);

//     // Physics-based hourly energy
//     const hourlyResults = forecast.time.map((t, i) => ({
//       Date: t + ":00",
//       ghi_W_m2: forecast.ghi[i],
//       temp_C: forecast.temp[i],
//       ac_kWh: calculateHourlyEnergy({
//         ghi: forecast.ghi[i],
//         tempC: forecast.temp[i],
//         numPanels,
//         panelArea,
//         panelEfficiency,
//         inverterEfficiency,
//         tiltDeg,
//         tempCoeff,
//         soilingFactor,
//         systemDerate,
//         inverterRatedPower,
//         noct
//       })
//     }));
//     const ourTotal = hourlyResults.reduce((sum, r) => sum + r.ac_kWh, 0);

//     // PVWatts comparison
//     let pvHourly = [];
//     let pvTotal = null;
//     let mae = null;
//     let biasPct = null;

//     if (PVWATTS_API_KEY) {
//       try {
//         const systemCapacityKW = (numPanels * panelArea * panelEfficiency); // W to kW
//         const lossesPct = (1 - inverterEfficiency * soilingFactor * systemDerate) * 100;

//         const params = computePVWattsParams({ lat, lon, systemCapacityKW, tilt: tiltDeg, azimuth, lossesPct });
//         const pvAcArray = await fetchPVWattsHourly(params);

//         // Align hourly
//         const aligned = pvAcArray.slice(0, hourlyResults.length);
//         pvHourly = aligned.map(v => ({ ac_kW: v, kWh: v })); // 1 hour = kWh
//         pvTotal = pvHourly.reduce((s, h) => s + h.kWh, 0);

//         // MAE and bias
//         const n = hourlyResults.length;
//         mae = hourlyResults.reduce((sum, r, i) => sum + Math.abs(r.ac_kWh - pvHourly[i].kWh), 0) / n;
//         biasPct = ((ourTotal - pvTotal) / pvTotal) * 100;

//       } catch (e) {
//         console.error("PVWatts fetch failed:", e.message);
//       }
//     }

//     // Save CSV
//     const parser = new Parser({ fields: ["Date", "ghi_W_m2", "temp_C", "ac_kWh"] });
//     const csv = parser.parse(hourlyResults);
//     const fileName = `training_data_${Date.now()}.csv`;
//     const filePath = path.join(process.cwd(), "public", fileName);
//     fs.writeFileSync(filePath, csv);

//     return res.json({
//       site: { location: geo.display_name, lat, lon, tiltDeg, azimuth },
//       hourly: hourlyResults,
//       ourTotal,
//       pvwatts: pvTotal ? { totalKWh: pvTotal, hourly: pvHourly } : null,
//       comparison: pvTotal ? { mae: +mae.toFixed(4), biasPct: +biasPct.toFixed(2) } : null,
//       downloadUrl: `/${fileName}`
//     });

//   } catch (err) {
//     console.error("Error in /api/predict/16days:", err);
//     return res.status(500).json({ error: err.message });
//   }
// });

// app.listen(PORT, "0.0.0.0", () => console.log(`Server running at http://0.0.0.0:${PORT}`));
// import express from "express";
// import cors from "cors";
// import fetch from "node-fetch";
// import fs from "fs";
// import path from "path";
// import { Parser } from "json2csv";
// import { fileURLToPath } from "url";
// import { dirname } from "path";
// import dotenv from "dotenv";

// dotenv.config();

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);

// const app = express();
// app.use(cors());
// app.use(express.json());
// app.use(express.static(path.join(process.cwd(), "public")));

// const PORT = 3001;
// const PVWATTS_API_KEY = process.env.PVWATTS_API_KEY; // Your PVWatts API key

// // ----------------- helpers -----------------
// function deg2rad(d) {
//   return d * Math.PI / 180;
// }

// async function geocodeLocation(location) {
//   const q = encodeURIComponent(location);
//   const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
//   const res = await fetch(url, { headers: { 'User-Agent': 'solar-demo/1.0 (email@example.com)' } });
//   const data = await res.json();
//   if (!data || data.length === 0) throw new Error("Location not found");
//   return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display_name: data[0].display_name };
// }

// async function fetchForecast(lat, lon) {
//   const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=shortwave_radiation,temperature_2m&forecast_days=16&timezone=auto`;
//   const res = await fetch(url);
//   const data = await res.json();
//   if (!data || !data.hourly || !Array.isArray(data.hourly.time)) throw new Error("Weather API failed");
//   return { time: data.hourly.time, ghi: data.hourly.shortwave_radiation, temp: data.hourly.temperature_2m };
// }

// function calculateHourlyEnergy({ ghi, tempC, numPanels, panelArea, panelEfficiency, inverterEfficiency, tiltDeg, tempCoeff, soilingFactor, systemDerate, inverterRatedPower, noct }) {
//   const tiltRad = deg2rad(tiltDeg);
//   const poa = ghi * Math.cos(tiltRad);
//   const cellTemp = tempC + (noct - 20) * (poa / 800.0);
//   const tempFactor = 1 + tempCoeff * (cellTemp - 25);
//   const perPanelW = poa * panelArea * panelEfficiency;
//   const dcPowerW = perPanelW * numPanels * tempFactor;
//   const afterSoilingW = dcPowerW * soilingFactor;
//   const afterDerateW = afterSoilingW * systemDerate;
//   let acPowerW = afterDerateW * inverterEfficiency;
//   if (inverterRatedPower && inverterRatedPower > 0) acPowerW = Math.min(acPowerW, inverterRatedPower);
//   return + (acPowerW / 1000).toFixed(4); // kWh
// }

// // ----------------- PVWatts helpers -----------------
// function computePVWattsParams({ lat, lon, systemCapacityKW = 5, tilt = 20, azimuth = 180, lossesPct = 14 }) {
//   return new URLSearchParams({
//     api_key: PVWATTS_API_KEY,
//     lat: lat.toString(),
//     lon: lon.toString(),
//     system_capacity: systemCapacityKW.toString(),
//     tilt: tilt.toString(),
//     azimuth: azimuth.toString(),
//     array_type: '1',
//     module_type: '0',
//     losses: lossesPct.toString(),
//     timeframe: 'hourly'
//   });
// }

// async function fetchPVWattsHourly(params) {
//   const url = `https://developer.nrel.gov/api/pvwatts/v6.json?${params.toString()}`;
//   const resp = await fetch(url);
//   if (!resp.ok) throw new Error(`PVWatts API error ${resp.status}`);
//   const body = await resp.json();
//   if (!body.outputs || !body.outputs.ac) throw new Error("PVWatts returned invalid data");
//   return body.outputs.ac; // array of hourly kW
// }

// // ----------------- 16-day endpoint -----------------
// app.post("/api/predict/16days", async (req, res) => {
//   try {
//     const { location, numPanels = 10, panelArea = 1.6, panelEfficiency = 0.18, inverterEfficiency = 0.95, tilt = null, azimuth = 180, tempCoeff = -0.004, soilingFactor = 0.95, systemDerate = 0.86, inverterRatedPower = null, noct = 45 } = req.body;
//     if (!location) return res.status(400).json({ error: "location is required" });

//     const geo = await geocodeLocation(location);
//     const lat = geo.lat;
//     const lon = geo.lon;
//     const tiltDeg = tilt ?? Math.abs(lat);

//     // fetch forecast
//     const forecast = await fetchForecast(lat, lon);

//     // compute physics-based hourly energy
//     const hourlyResults = forecast.time.map((t, i) => ({
//       Date: t + ":00",
//       ghi_W_m2: forecast.ghi[i],
//       temp_C: forecast.temp[i],
//       ac_kWh: calculateHourlyEnergy({
//         ghi: forecast.ghi[i],
//         tempC: forecast.temp[i],
//         numPanels,
//         panelArea,
//         panelEfficiency,
//         inverterEfficiency,
//         tiltDeg,
//         tempCoeff,
//         soilingFactor,
//         systemDerate,
//         inverterRatedPower,
//         noct
//       })
//     }));
//     const ourTotal = hourlyResults.reduce((sum, r) => sum + r.ac_kWh, 0);

//     // ---------------- PVWatts comparison ----------------
//     let pvHourly = [];
//     let pvTotal = null;
//     let mae = null;
//     let biasPct = null;

//     if (PVWATTS_API_KEY) {
//       try {
//         const params = computePVWattsParams({ lat, lon, systemCapacityKW: numPanels * panelArea * panelEfficiency, tilt: tiltDeg, azimuth, lossesPct: (1 - inverterEfficiency * soilingFactor * systemDerate) * 100 });
//         const pvAcArray = await fetchPVWattsHourly(params);

//         // align first N hours to forecast
//         const aligned = pvAcArray.slice(0, hourlyResults.length);
//         pvHourly = aligned.map(v => ({ ac_kW: v, kWh: v / 1 })); // 1 hour = kWh
//         pvTotal = pvHourly.reduce((s, h) => s + h.kWh, 0);

//         // hourly MAE and bias %
//         const n = hourlyResults.length;
//         mae = hourlyResults.reduce((sum, r, i) => sum + Math.abs(r.ac_kWh - pvHourly[i].kWh), 0) / n;
//         biasPct = ((ourTotal - pvTotal) / pvTotal) * 100;

//       } catch (e) {
//         console.error("PVWatts fetch failed:", e.message);
//       }
//     }

//     // save CSV
//     const parser = new Parser({ fields: ["Date", "ghi_W_m2", "temp_C", "ac_kWh"] });
//     const csv = parser.parse(hourlyResults);
//     const fileName = `training_data_${Date.now()}.csv`;
//     const filePath = path.join(process.cwd(), "public", fileName);
//     fs.writeFileSync(filePath, csv);

//     // response
//     return res.json({
//       site: { location: geo.display_name, lat, lon, tiltDeg, azimuth },
//       hourly: hourlyResults,
//       ourTotal,
//       pvwatts: pvTotal ? { totalKWh: pvTotal, hourly: pvHourly } : null,
//       comparison: pvTotal ? { mae: +mae.toFixed(4), biasPct: +biasPct.toFixed(2) } : null,
//       downloadUrl: `/${fileName}`
//     });

//   } catch (err) {
//     console.error(err);
//     return res.status(500).json({ error: err.message });
//   }
// });

// app.listen(PORT, "0.0.0.0", () => console.log(`Server running at http://0.0.0.0:${PORT}`));
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
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

const PORT = 3001;
const PVWATTS_API_KEY = process.env.PVWATTS_API_KEY;

// ----------------- helpers -----------------
function deg2rad(d) {
  return d * Math.PI / 180;
}

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'TEST1.html'));
});

app.get('/results', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'TEST2.html'));
});

app.get('/export', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'TEST3.html'));
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
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=shortwave_radiation,temperature_2m&forecast_days=16&timezone=auto`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data || !data.hourly || !Array.isArray(data.hourly.time)) throw new Error("Weather API failed");
  return { time: data.hourly.time, ghi: data.hourly.shortwave_radiation, temp: data.hourly.temperature_2m };
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

// ----------------- 16-day endpoint -----------------
app.post("/api/predict/16days", async (req, res) => {
  try {
    const { location, numPanels = 10, panelArea = 1.6, panelEfficiency = 0.18, inverterEfficiency = 0.95, tilt = null, azimuth = 180, tempCoeff = -0.004, soilingFactor = 0.95, systemDerate = 0.86, inverterRatedPower = null, noct = 45 } = req.body;
    if (!location) return res.status(400).json({ error: "location is required" });

    const geo = await geocodeLocation(location);
    const lat = geo.lat;
    const lon = geo.lon;
    const tiltDeg = tilt ?? Math.abs(lat);

    // Fetch forecast
    const forecast = await fetchForecast(lat, lon);

    // Physics-based hourly energy
    const hourlyResults = forecast.time.map((t, i) => ({
      Date: t + ":00",
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
    const ourTotal = hourlyResults.reduce((sum, r) => sum + r.ac_kWh, 0);

    // PVWatts comparison
    let pvHourly = [];
    let pvTotal = null;
    let mae = null;
    let biasPct = null;

    if (PVWATTS_API_KEY) {
      try {
        const systemCapacityKW = (numPanels * panelArea * panelEfficiency); // W to kW
        const lossesPct = (1 - inverterEfficiency * soilingFactor * systemDerate) * 100;

        const params = computePVWattsParams({ lat, lon, systemCapacityKW, tilt: tiltDeg, azimuth, lossesPct });
        const pvAcArray = await fetchPVWattsHourly(params);

        // Align hourly
        const aligned = pvAcArray.slice(0, hourlyResults.length);
        pvHourly = aligned.map(v => ({ ac_kW: v, kWh: v })); // 1 hour = kWh
        pvTotal = pvHourly.reduce((s, h) => s + h.kWh, 0);

        // MAE and bias
        const n = hourlyResults.length;
        mae = hourlyResults.reduce((sum, r, i) => sum + Math.abs(r.ac_kWh - pvHourly[i].kWh), 0) / n;
        biasPct = ((ourTotal - pvTotal) / pvTotal) * 100;

      } catch (e) {
        console.error("PVWatts fetch failed:", e.message);
      }
    }

    // Save CSV
    const parser = new Parser({ fields: ["Date", "ghi_W_m2", "temp_C", "ac_kWh"] });
    const csv = parser.parse(hourlyResults);
    const fileName = `training_data_${Date.now()}.csv`;
    const filePath = path.join(process.cwd(), "public", fileName);
    fs.writeFileSync(filePath, csv);

    return res.json({
      site: { location: geo.display_name, lat, lon, tiltDeg, azimuth },
      hourly: hourlyResults,
      ourTotal,
      pvwatts: pvTotal ? { totalKWh: pvTotal, hourly: pvHourly } : null,
      comparison: pvTotal ? { mae: +mae.toFixed(4), biasPct: +biasPct.toFixed(2) } : null,
      downloadUrl: `/${fileName}`
    });

  } catch (err) {
    console.error("Error in /api/predict/16days:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Server running at http://0.0.0.0:${PORT}`));

