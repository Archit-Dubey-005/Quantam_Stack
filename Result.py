import pandas as pd
import requests
from io import StringIO

# ====== 0. Load the trained model from merge2csv5.py ======
# Make sure merge2csv5.py defines 'model' at the global level
from merge2csv5 import model
url = "http://192.168.56.1:3001/baseline-16day"

# ====== 1. Fetch daily baseline CSV from backend route ======

response = requests.get(url)
if response.status_code == 200:
    baseline_daily = pd.read_csv(StringIO(response.text))
    print("Fetched baseline CSV successfully!")
else:
    raise Exception(f"Failed to fetch baseline CSV. Status code: {response.status_code}")

# ====== 2. Convert Date column to datetime ======
baseline_daily['timestamp_utc'] = pd.to_datetime(baseline_daily['Date'], format='%Y-%m-%d')

# ====== 3. Resample daily values to hourly ======
baseline_hourly = baseline_daily.set_index('timestamp_utc').resample('H').ffill().reset_index()

# ====== 4. Add system-specific features required by the model ======
baseline_hourly['tilt_deg'] = 20
baseline_hourly['azimuth_deg'] = 180
baseline_hourly['num_panels'] = 24

# ====== 5. Define feature columns for model ======
feature_cols = ['ghi_w_m2', 'temperature_C', 'tilt_deg', 'azimuth_deg', 'num_panels']

# ====== 6. Predict using trained Python model ======
baseline_hourly['predicted_ac_kwh'] = model.predict(baseline_hourly[feature_cols])

# ====== 7. Save improved hourly forecast ======
baseline_hourly.to_csv("baseline_16day_hourly_improved.csv", index=False)
print("Saved hourly improved forecast to 'baseline_16day_hourly_improved.csv'")

# ====== 8. Aggregate to daily, weekly, and monthly totals ======
daily_forecast = (
    baseline_hourly.groupby(baseline_hourly['timestamp_utc'].dt.date)['predicted_ac_kwh']
    .sum()
    .reset_index()
    .rename(columns={'timestamp_utc': 'Date', 'predicted_ac_kwh': 'daily_predicted_ac_kwh'})
)

weekly_forecast = (
    baseline_hourly.set_index('timestamp_utc')
    .resample('W')['predicted_ac_kwh']
    .sum()
    .reset_index()
    .rename(columns={'predicted_ac_kwh': 'weekly_predicted_ac_kwh'})
)

monthly_forecast = (
    baseline_hourly.set_index('timestamp_utc')
    .resample('M')['predicted_ac_kwh']
    .sum()
    .reset_index()
    .rename(columns={'predicted_ac_kwh': 'monthly_predicted_ac_kwh'})
)

# ====== 9. Save aggregated forecasts ======
daily_forecast.to_csv("forecast_daily.csv", index=False)
weekly_forecast.to_csv("forecast_weekly.csv", index=False)
monthly_forecast.to_csv("forecast_monthly.csv", index=False)

print("Saved daily, weekly, and monthly improved forecasts successfully!")