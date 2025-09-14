# Quantam_Stack
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
