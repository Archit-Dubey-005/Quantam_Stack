import pandas as pd
import numpy as np
import requests
from io import StringIO
import joblib
import json
from datetime import datetime, timedelta
import os

print("🚀 Starting Solar Power Prediction Pipeline...")

# ====== 1. Load trained model ======
print("📦 Loading trained model...")

try:
    model = joblib.load("trained_model.joblib")
    print("✅ Model loaded successfully")
except FileNotFoundError:
    print("❌ trained_model.joblib not found. Please run merge2csv5.py first to train the model.")
    exit(1)

# Load model metadata
try:
    with open("model_metadata.json", "r") as f:
        model_metadata = json.load(f)
    print(f"✅ Model metadata loaded: {model_metadata['model_name']}")
    print(f"📊 Model performance: R² = {model_metadata['performance']['r2']:.4f}")
except FileNotFoundError:
    print("⚠️ model_metadata.json not found. Using default feature list.")
    model_metadata = {
        'features': ['ghi_w_m2', 'temperature_C', 'tilt_deg', 'azimuth_deg', 'num_panels']
    }

# ====== 2. Fetch baseline data from backend ======
print("🌐 Fetching baseline data from backend...")

backend_url = "http://localhost:3001/baseline-16day"

try:
    response = requests.get(backend_url, timeout=30)
    if response.status_code == 200:
        baseline_daily = pd.read_csv(StringIO(response.text))
        print(f"✅ Fetched baseline data: {baseline_daily.shape[0]} days")
    else:
        print(f"❌ Backend error: {response.status_code}")
        exit(1)
except requests.exceptions.RequestException as e:
    print(f"❌ Failed to connect to backend: {e}")
    print("💡 Make sure the backend server is running on http://localhost:3001")
    exit(1)

# ====== 3. Convert daily to hourly data ======
print("⏰ Converting daily data to hourly...")

# Convert Date column to datetime
baseline_daily['timestamp_utc'] = pd.to_datetime(baseline_daily['Date'])

# Create hourly data by resampling and forward filling
baseline_hourly = baseline_daily.set_index('timestamp_utc').resample('h').ffill().reset_index()

# Add system-specific features (default values)
baseline_hourly['tilt_deg'] = 30  # Default tilt
baseline_hourly['azimuth_deg'] = 180  # Default azimuth (south-facing)
baseline_hourly['num_panels'] = 20  # Default number of panels

# Add NASA features if they were used in training (use same values as weather data)
baseline_hourly['Solar_Radiation'] = baseline_hourly['ghi_w_m2'] / 1000  # Convert W/m² to MJ/m²
baseline_hourly['Temperature'] = baseline_hourly['temperature_C']

print(f"✅ Created hourly data: {baseline_hourly.shape[0]} hours")

# ====== 4. Feature engineering ======
print("⚙️ Engineering features...")

# Add time-based features
baseline_hourly['hour'] = baseline_hourly['timestamp_utc'].dt.hour
baseline_hourly['day_of_year'] = baseline_hourly['timestamp_utc'].dt.dayofyear
baseline_hourly['month'] = baseline_hourly['timestamp_utc'].dt.month
baseline_hourly['is_weekend'] = baseline_hourly['timestamp_utc'].dt.weekday >= 5

# Add solar position features
baseline_hourly['solar_elevation'] = np.maximum(0, 90 - np.abs(baseline_hourly['day_of_year'] - 172) * 0.4)
baseline_hourly['daylight_hours'] = np.where(baseline_hourly['hour'].between(6, 18), 1, 0)

# Add system efficiency features
baseline_hourly['system_capacity'] = baseline_hourly['num_panels'] * 1.6 * 0.2  # Default panel specs
baseline_hourly['tilt_efficiency'] = np.cos(np.radians(baseline_hourly['tilt_deg'] - baseline_hourly['solar_elevation']))

# Handle missing values - only fill numeric columns
numeric_columns = baseline_hourly.select_dtypes(include=[np.number]).columns
baseline_hourly[numeric_columns] = baseline_hourly[numeric_columns].fillna(baseline_hourly[numeric_columns].median())

print(f"✅ Feature engineering complete")

# ====== 5. Make predictions ======
print("🔮 Making ML predictions...")

# Get required features for the model
required_features = model_metadata['features']
available_features = [col for col in required_features if col in baseline_hourly.columns]

if len(available_features) < len(required_features):
    print(f"⚠️ Warning: Only {len(available_features)}/{len(required_features)} features available")
    print(f"Available: {available_features}")
    print(f"Required: {required_features}")

# Prepare features for prediction
X = baseline_hourly[available_features]

# Make predictions
try:
    predictions = model.predict(X)
    baseline_hourly['predicted_ac_kwh'] = predictions
    print(f"✅ Generated {len(predictions)} predictions")
except Exception as e:
    print(f"❌ Prediction failed: {e}")
    exit(1)

# ====== 6. Generate aggregated forecasts ======
print("📊 Generating aggregated forecasts...")

# Daily aggregation
daily_forecast = (
    baseline_hourly.groupby(baseline_hourly['timestamp_utc'].dt.date)['predicted_ac_kwh']
    .sum()
    .reset_index()
    .rename(columns={'timestamp_utc': 'Date', 'predicted_ac_kwh': 'daily_predicted_ac_kwh'})
)

# Weekly aggregation
weekly_forecast = (
    baseline_hourly.set_index('timestamp_utc')
    .resample('W')['predicted_ac_kwh']
    .sum()
    .reset_index()
    .rename(columns={'predicted_ac_kwh': 'weekly_predicted_ac_kwh'})
)

# Monthly aggregation
monthly_forecast = (
    baseline_hourly.set_index('timestamp_utc')
    .resample('M')['predicted_ac_kwh']
    .sum()
    .reset_index()
    .rename(columns={'predicted_ac_kwh': 'monthly_predicted_ac_kwh'})
)

print(f"✅ Generated forecasts:")
print(f"   - Daily: {len(daily_forecast)} days")
print(f"   - Weekly: {len(weekly_forecast)} weeks")
print(f"   - Monthly: {len(monthly_forecast)} months")

# ====== 7. Save results ======
print("💾 Saving results...")

# Save hourly improved forecast
baseline_hourly.to_csv("baseline_16day_hourly_improved.csv", index=False)
print("✅ Saved: baseline_16day_hourly_improved.csv")

# Save aggregated forecasts
daily_forecast.to_csv("forecast_daily.csv", index=False)
weekly_forecast.to_csv("forecast_weekly.csv", index=False)
monthly_forecast.to_csv("forecast_monthly.csv", index=False)

print("✅ Saved: forecast_daily.csv")
print("✅ Saved: forecast_weekly.csv")
print("✅ Saved: forecast_monthly.csv")

# ====== 8. Generate summary statistics ======
print("📈 Generating summary statistics...")

total_kwh = baseline_hourly['predicted_ac_kwh'].sum()
daily_avg = baseline_hourly['predicted_ac_kwh'].mean() * 24  # Convert hourly to daily
max_daily = daily_forecast['daily_predicted_ac_kwh'].max()
min_daily = daily_forecast['daily_predicted_ac_kwh'].min()

summary = {
    'prediction_date': datetime.now().isoformat(),
    'forecast_period_days': len(daily_forecast),
    'total_predicted_kwh': round(total_kwh, 2),
    'daily_average_kwh': round(daily_avg, 2),
    'max_daily_kwh': round(max_daily, 2),
    'min_daily_kwh': round(min_daily, 2),
    'model_used': model_metadata['model_name'],
    'model_performance': model_metadata['performance']
}

# Save summary
with open("prediction_summary.json", "w") as f:
    json.dump(summary, f, indent=2)

print("✅ Saved: prediction_summary.json")

# ====== 9. Display results ======
print("\n🎉 Solar Power Prediction Complete!")
print("=" * 50)
print(f"📅 Forecast Period: {len(daily_forecast)} days")
print(f"⚡ Total Predicted Output: {total_kwh:.2f} kWh")
print(f"📊 Daily Average: {daily_avg:.2f} kWh/day")
print(f"📈 Peak Daily Output: {max_daily:.2f} kWh")
print(f"📉 Minimum Daily Output: {min_daily:.2f} kWh")
print(f"🤖 Model Used: {model_metadata['model_name']}")
print(f"🎯 Model Accuracy (R²): {model_metadata['performance']['r2']:.4f}")

print("\n📁 Generated Files:")
print("   - baseline_16day_hourly_improved.csv (hourly predictions)")
print("   - forecast_daily.csv (daily totals)")
print("   - forecast_weekly.csv (weekly totals)")
print("   - forecast_monthly.csv (monthly totals)")
print("   - prediction_summary.json (summary statistics)")

print("\n✅ Pipeline execution successful!")
print("🚀 Ready for frontend integration!")
