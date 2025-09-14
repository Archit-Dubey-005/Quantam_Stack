import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import path from "path";
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

const PORT = 3001;

// ----------------- utilities -----------------
function deg2rad(d) { return d * Math.PI / 180; }

// ----------------- geocoding -----------------
async function geocodeLocation(location) {
  const q = encodeURIComponent(location);
  const url = https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1;
  const res = await fetch(url, { headers: { 'User-Agent': 'solar-demo/1.0 (email@example.com)' } });
  const data = await res.json();
  if (!data || data.length === 0) throw new Error("Location not found");
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display_name: data[0].display_name };
}

// ----------------- weather -----------------
async function fetchForecast(lat, lon) {
  const url = https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=shortwave_radiation_sum,temperature_2m_max,temperature_2m_min&forecast_days=16&timezone=auto;
  const res = await fetch(url);
  const data = await res.json();
  if (!data || !data.daily || !Array.isArray(data.daily.time)) {
    throw new Error("Weather API failed");
  }
  return {
    dates: data.daily.time,
    ghiMJ: data.daily.shortwave_radiation_sum,
    tempMax: data.daily.temperature_2m_max,
    tempMin: data.daily.temperature_2m_min
  };
}

// ----------------- physics helpers -----------------
function calculateDailyEnergy({ ghiMJ, tempMeanC, numPanels, panelArea, panelEfficiency, inverterEfficiency, tiltDeg, tempCoeff, soilingFactor, systemDerate, inverterRatedPower, noct }) {
  const ghi = (ghiMJ * 1e6) / (24 * 3600); // W/m² average
  const tiltRad = deg2rad(tiltDeg);
  const poa = ghi * Math.cos(tiltRad);

  const cellTemp = tempMeanC + (noct - 20) * (poa / 800.0);
  const tempFactor = 1 + tempCoeff * (cellTemp - 25);

  const perPanelW = poa * panelArea * panelEfficiency;
  const dcPowerW = perPanelW * numPanels * tempFactor;

  const afterSoilingW = dcPowerW * soilingFactor;
  const afterDerateW = afterSoilingW * systemDerate;

  let acPowerW = afterDerateW * inverterEfficiency;
  if (inverterRatedPower && inverterRatedPower > 0) acPowerW = Math.min(acPowerW, inverterRatedPower);

  const acKWhPerDay = (acPowerW / 1000) * 24;
  const ghiKWhPerM2PerDay = ghiMJ / 3.6; // MJ/m²/day → kWh/m²/day

  return {
    acKWhPerDay: +acKWhPerDay.toFixed(2),
    ghiKWhPerM2PerDay: +ghiKWhPerM2PerDay.toFixed(2)
  };
}

// ----------------- PVWatts integration -----------------
const PVWATTS_API_KEY = process.env.pv_watt_api;

function computePVWattsParams({ numPanels, panelArea, panelEfficiency, systemDerate = 0.86, soilingFactor = 0.95, inverterEfficiency = 0.95 }) {
  const perPanelW = panelArea * 1000.0 * panelEfficiency;
  const systemCapacityKW = (numPanels * perPanelW) / 1000.0;
  const combinedEff = systemDerate * soilingFactor * inverterEfficiency;
  const lossesPct = (1.0 - combinedEff) * 100.0;
  return {
    perPanelW,
    systemCapacityKW: +systemCapacityKW.toFixed(4),
    lossesPct: +lossesPct.toFixed(4)
  };
}

async function fetchPVWattsHourly({ lat, lon, systemCapacityKW, tilt, azimuth, lossesPct }) {
  if (!PVWATTS_API_KEY) throw new Error('PVWATTS_API_KEY not set in environment');

  const base = 'https://developer.nrel.gov/api/pvwatts/v6.json';
  const params = new URLSearchParams({
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

  const url = ${base}?${params.toString()};
  const resp = await fetch(url);
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(PVWatts API error ${resp.status}: ${txt});
  }
  const body = await resp.json();
  const outputs = body.outputs || {};
  const acArray = outputs.ac || null;
  const acAnnual = outputs.ac_annual || null;

  let hourly = [];
  let totalKWh = null;
  if (Array.isArray(acArray)) {
    hourly = acArray.map(v => ({ ac_kW: v, kWh: Number(v) }));
    totalKWh = hourly.reduce((s, it) => s + (Number(it.kWh) || 0), 0);
  } else if (acAnnual !== null) {
    totalKWh = Number(acAnnual);
  }

  return {
    raw: body,
    hourly,
    totalKWh: totalKWh !== null ? +totalKWh.toFixed(4) : null
  };
}

// ----------------- 16-day endpoint -----------------
app.post("/api/predict/16days", async (req, res) => {
  try {
    const {
      location,
      numPanels = req.body.numPanels || 10,
      panelArea = req.body.panelArea || 1.6,
      panelEfficiency = req.body.panelEfficiency || 0.18,
      inverterEfficiency = req.body.inverterEfficiency || 0.95,
      tilt = req.body.tilt || null,
      azimuth = req.body.azimuth || 180,
      tempCoeff = req.body.tempCoeff || -0.004,
      soilingFactor = req.body.soilingFactor || 0.95,
      systemDerate = req.body.systemDerate || 0.86,
      inverterRatedPower = req.body.inverterRatedPower || null,
      noct = 45
    } = req.body;

    if (!location) return res.status(400).json({ error: "location is required" });

    const geo = await geocodeLocation(location);
    const lat = geo.lat;
    const lon = geo.lon;
    const tiltDeg = tilt ?? Math.abs(lat);

    const forecast = await fetchForecast(lat, lon);

    // ----------------- our model -----------------
    const dailyResults = forecast.dates.map((date, i) => {
      const tempMean = (forecast.tempMax[i] + forecast.tempMin[i]) / 2;
      const daily = calculateDailyEnergy({
        ghiMJ: forecast.ghiMJ[i],
        tempMeanC: tempMean,
        numPanels,
        panelArea,
        panelEfficiency,
        inverterEfficiency,
        tiltDeg,
        azimuthDeg: azimuth,
        tempCoeff,
        soilingFactor,
        systemDerate,
        inverterRatedPower,
        noct
      });
      return {
        date,
        ghi_kWh_m2_day: daily.ghiKWhPerM2PerDay,
        ac_kWh_day: daily.acKWhPerDay
      };
    });

    // ----------------- summary -----------------
    const totalKWh = dailyResults.reduce((sum, d) => sum + d.ac_kWh_day, 0);
    const summary = { totalKWh: +totalKWh.toFixed(2), numPanels, panelArea, panelEfficiency };

    // ----------------- PVWatts comparison -----------------
    let pvwattsResult = null;
    let comparison = { biasPct: null };

    try {
      const { systemCapacityKW, lossesPct } = computePVWattsParams({ numPanels, panelArea, panelEfficiency, systemDerate, soilingFactor, inverterEfficiency });
      pvwattsResult = await fetchPVWattsHourly({ lat, lon, systemCapacityKW, tilt: tiltDeg, azimuth, lossesPct });

      if (pvwattsResult.totalKWh !== null) {
        comparison.biasPct = +(((totalKWh - pvwattsResult.totalKWh) / pvwattsResult.totalKWh) * 100).toFixed(3);
      }
    } catch (pvErr) {
      console.warn('PVWatts error', pvErr.message);
    }

    return res.json({
      site: { location: geo.display_name, lat, lon, tiltDeg, azimuth },
      forecast: dailyResults,
      summary,
      pvwatts: pvwattsResult,
      comparison
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(Solar server running at http://localhost:${PORT});
});