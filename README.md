# Solar Power Generation Prediction

<hr>

## Overview

<p>This project improves a physics-based baseline (JS backend) for solar AC output using a Python ML model trained on merged measured + NASA data.
Flow (high level):</p>
<ul>
  <li>Frontend collects user input → backend builds a baseline (PVWatt-like physics model).</li>
  <li>Backend exposes the baseline as a CSV route (/baseline_16day.csv).</li>
  <li>Python code fetches that CSV, converts daily → hourly, applies an ML model to correct/improve baseline, then returns hourly, daily, weekly, monthly forecasts.</li>
  <li>Outputs are saved as CSVs that the backend / frontend can use.
  </li>
</ul>

## Repository Layout
.
├─ backend/                      # Node/Express backend (serves baseline)
│  ├─ server.js
│  └─ public/                     # optional static CSV
├─ data/
│  ├─ synthetic_solar_hourly.csv  # sensor measurements (dummy dataset)
│  └─ nasa_power_data.csv         # NASA daily data
├─ merge2csv5.py                  # training pipeline (merges datasets, trains model, define `model`)
├─ finalcode3.py                  # production script that fetches baseline & predicts (this uses `model`)
├─ trained_model.joblib           # optional: saved trained model from merge2csv5.py
└─ README.md

<hr>

## Install requirements

<ol>
  <li>Node (backend):
  <br>

'''//on backend machine
npm install
//(ensure express is in package.json)'''
  </li>

  <li>Python (model & pipeline):
  <br>

'''pip install pandas scikit-learn joblib requests'''
  </li>

</ol>

## Data formats / expected columns

<p><strong>Backend baseline CSV (daily)</strong></p>

<p>The backend must expose an endpoint returning a CSV with one row per day and at least these columns:</p>
<br>

'''Date, ghi_w_m2, temperature_C'''

<br>

<ul>
<li>Date format: YYYY-MM-DD</li>
<li>ghi_w_m2: daily GHI baseline value (or a daily aggregate the backend provides)</li>
<li>temperature_C: daily temperature (optional, but recommended)</li>
</ul>

<p>If your backend includes system-specific columns (tilt/azimuth/num_panels), they will be used. Otherwise the Python script will fill defaults.</p>

<p><strong>Synth and NASA files (training)</strong></p>

<ul>
  <li>synthetic_solar_hourly.csv — hourly measurements; must contain timestamp_utc, measured_ac_kwh, ghi_w_m2, temperature_C, plus system features like tilt_deg, azimuth_deg, num_panels.
  </li>
  <li>nasa_power_data.csv — daily NASA data with a Date column (YYYYMMDD or YYYY-MM-DD). Training script will resample it to hourly.
  </li>
</ul>

<p><strong>Output files produced by Python</strong></p>

<ul>
  <li>baseline_16day_hourly_improved.csv — hourly corrected predictions with predicted_ac_kwh</li>
  <li>forecast_daily.csv, forecast_weekly.csv, forecast_monthly.csv — aggregated totals</li>
</ul>

## Contributers

<p>Team Quantum stack:</p>
<br>
<label>Aangi Doshi</label>
<label>Misri Solanki</label>
<label>Archit Dubey</label>
<label>Dhruvesh Chaudhari</label>
