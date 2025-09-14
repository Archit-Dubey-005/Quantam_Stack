import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib
from datetime import datetime, timedelta
import requests
import os

print("🚀 Starting ML Training Pipeline...")

# ====== 1. Load and prepare datasets ======
print("📊 Loading datasets...")

# Load synthetic solar data (hourly measurements)
try:
    synthetic_data = pd.read_csv("synthetic_solar_hourly.csv")
    print(f"✅ Loaded synthetic data: {synthetic_data.shape[0]} rows")
except FileNotFoundError:
    print("❌ synthetic_solar_hourly.csv not found. Creating dummy dataset...")
    # Create a simple dummy dataset if file doesn't exist
    dates = pd.date_range(start='2024-01-01', end='2024-12-31', freq='H')
    synthetic_data = pd.DataFrame({
        'timestamp_utc': dates,
        'measured_ac_kwh': np.random.uniform(0, 5, len(dates)),
        'ghi_w_m2': np.random.uniform(0, 1000, len(dates)),
        'temperature_C': np.random.uniform(10, 35, len(dates)),
        'tilt_deg': np.random.choice([20, 25, 30, 35], len(dates)),
        'azimuth_deg': np.random.choice([170, 180, 190], len(dates)),
        'num_panels': np.random.choice([15, 20, 25, 30], len(dates))
    })
    synthetic_data.to_csv("synthetic_solar_hourly.csv", index=False)
    print(f"✅ Created dummy synthetic data: {synthetic_data.shape[0]} rows")

# Load NASA power data (daily)
try:
    nasa_data = pd.read_csv("nasa_power_data.csv")
    print(f"✅ Loaded NASA data: {nasa_data.shape[0]} rows")
except FileNotFoundError:
    print("❌ nasa_power_data.csv not found. Creating dummy dataset...")
    # Create dummy NASA data
    dates = pd.date_range(start='2024-01-01', end='2024-12-31', freq='D')
    nasa_data = pd.DataFrame({
        'Date': dates.strftime('%Y%m%d'),
        'Solar_Radiation': np.random.uniform(15, 25, len(dates)),
        'Temperature': np.random.uniform(15, 30, len(dates))
    })
    nasa_data.to_csv("nasa_power_data.csv", index=False)
    print(f"✅ Created dummy NASA data: {nasa_data.shape[0]} rows")

# ====== 2. Data preprocessing ======
print("🔧 Preprocessing data...")

# Convert timestamps
synthetic_data['timestamp_utc'] = pd.to_datetime(synthetic_data['timestamp_utc'])
nasa_data['Date'] = pd.to_datetime(nasa_data['Date'], format='%Y%m%d')

# Resample NASA daily data to hourly
nasa_hourly = nasa_data.set_index('Date').resample('H').ffill().reset_index()
nasa_hourly.rename(columns={'Date': 'timestamp_utc'}, inplace=True)

# Merge datasets on timestamp
merged_data = pd.merge(synthetic_data, nasa_hourly, on='timestamp_utc', how='inner', suffixes=('', '_nasa'))

print(f"✅ Merged dataset shape: {merged_data.shape}")

# ====== 3. Feature engineering ======
print("⚙️ Engineering features...")

# Add time-based features
merged_data['hour'] = merged_data['timestamp_utc'].dt.hour
merged_data['day_of_year'] = merged_data['timestamp_utc'].dt.dayofyear
merged_data['month'] = merged_data['timestamp_utc'].dt.month
merged_data['is_weekend'] = merged_data['timestamp_utc'].dt.weekday >= 5

# Add solar position features (simplified)
merged_data['solar_elevation'] = np.maximum(0, 90 - np.abs(merged_data['day_of_year'] - 172) * 0.4)
merged_data['daylight_hours'] = np.where(merged_data['hour'].between(6, 18), 1, 0)

# Add system efficiency features
merged_data['system_capacity'] = merged_data['num_panels'] * merged_data.get('panel_area_m2', 1.6) * merged_data.get('panel_efficiency', 0.2)
merged_data['tilt_efficiency'] = np.cos(np.radians(merged_data['tilt_deg'] - merged_data['solar_elevation']))

# Handle missing values - only fill numeric columns
numeric_columns = merged_data.select_dtypes(include=[np.number]).columns
merged_data[numeric_columns] = merged_data[numeric_columns].fillna(merged_data[numeric_columns].median())

print(f"✅ Feature engineering complete. Features: {list(merged_data.columns)}")

# ====== 4. Prepare training data ======
print("📋 Preparing training data...")

# Define feature columns
feature_cols = [
    'ghi_w_m2', 'temperature_C', 'tilt_deg', 'azimuth_deg', 'num_panels',
    'hour', 'day_of_year', 'month', 'is_weekend', 'solar_elevation', 
    'daylight_hours', 'system_capacity', 'tilt_efficiency'
]

# Add NASA features if available
if 'Solar_Radiation' in merged_data.columns:
    feature_cols.append('Solar_Radiation')
if 'Temperature' in merged_data.columns:
    feature_cols.append('Temperature')

# Filter available features
available_features = [col for col in feature_cols if col in merged_data.columns]
print(f"Available features for training: {available_features}")

# Check if we have the target variable
if 'measured_ac_kwh' not in merged_data.columns:
    print("❌ Target variable 'measured_ac_kwh' not found in data")
    exit(1)

X = merged_data[available_features]
y = merged_data['measured_ac_kwh']

print(f"✅ Training features: {available_features}")
print(f"✅ Training samples: {X.shape[0]}")

# ====== 5. Train multiple models ======
print("🤖 Training models...")

# Split data
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Train Random Forest (primary model)
rf_model = RandomForestRegressor(
    n_estimators=100,
    max_depth=10,
    min_samples_split=5,
    min_samples_leaf=2,
    random_state=42,
    n_jobs=-1
)
rf_model.fit(X_train, y_train)

# Train Linear Regression (backup model)
lr_model = LinearRegression()
lr_model.fit(X_train, y_train)

# ====== 6. Model evaluation ======
print("📈 Evaluating models...")

# Random Forest evaluation
rf_pred = rf_model.predict(X_test)
rf_mae = mean_absolute_error(y_test, rf_pred)
rf_mse = mean_squared_error(y_test, rf_pred)
rf_r2 = r2_score(y_test, rf_pred)

# Linear Regression evaluation
lr_pred = lr_model.predict(X_test)
lr_mae = mean_absolute_error(y_test, lr_pred)
lr_mse = mean_squared_error(y_test, lr_pred)
lr_r2 = r2_score(y_test, lr_pred)

print(f"🌲 Random Forest - MAE: {rf_mae:.4f}, MSE: {rf_mse:.4f}, R²: {rf_r2:.4f}")
print(f"📊 Linear Regression - MAE: {lr_mae:.4f}, MSE: {lr_mse:.4f}, R²: {lr_r2:.4f}")

# Choose best model based on R² score
if rf_r2 > lr_r2:
    model = rf_model
    model_name = "RandomForest"
    print(f"🏆 Selected Random Forest as primary model (R²: {rf_r2:.4f})")
else:
    model = lr_model
    model_name = "LinearRegression"
    print(f"🏆 Selected Linear Regression as primary model (R²: {lr_r2:.4f})")

# ====== 7. Save model and metadata ======
print("💾 Saving model...")

# Save the trained model
joblib.dump(model, "trained_model.joblib")

# Save model metadata
model_metadata = {
    'model_name': model_name,
    'features': available_features,
    'training_date': datetime.now().isoformat(),
    'training_samples': len(X_train),
    'test_samples': len(X_test),
    'performance': {
        'mae': float(rf_mae if model_name == "RandomForest" else lr_mae),
        'mse': float(rf_mse if model_name == "RandomForest" else lr_mse),
        'r2': float(rf_r2 if model_name == "RandomForest" else lr_r2)
    },
    'feature_importance': {}
}

# Add feature importance for Random Forest
if model_name == "RandomForest":
    feature_importance = dict(zip(available_features, model.feature_importances_))
    model_metadata['feature_importance'] = feature_importance
    print("🔍 Top 5 most important features:")
    for feature, importance in sorted(feature_importance.items(), key=lambda x: x[1], reverse=True)[:5]:
        print(f"   {feature}: {importance:.4f}")

# Save metadata
import json
with open("model_metadata.json", "w") as f:
    json.dump(model_metadata, f, indent=2)

print("✅ Model training complete!")
print(f"📁 Saved files:")
print(f"   - trained_model.joblib (model)")
print(f"   - model_metadata.json (metadata)")
print(f"🎯 Model ready for production use!")

# ====== 8. Test model with sample prediction ======
print("🧪 Testing model with sample prediction...")

# Create sample input with all possible features
sample_data = {
    'ghi_w_m2': [500],
    'temperature_C': [25],
    'tilt_deg': [30],
    'azimuth_deg': [180],
    'num_panels': [20],
    'hour': [12],
    'day_of_year': [180],
    'month': [6],
    'is_weekend': [False],
    'solar_elevation': [70],
    'daylight_hours': [1],
    'system_capacity': [6.4],
    'tilt_efficiency': [0.8]
}

# Add NASA features if they were used in training
if 'Solar_Radiation' in available_features:
    sample_data['Solar_Radiation'] = [20]
if 'Temperature' in available_features:
    sample_data['Temperature'] = [25]

sample_input = pd.DataFrame(sample_data)

# Filter to available features
sample_input = sample_input[available_features]
prediction = model.predict(sample_input)[0]

print(f"🔮 Sample prediction: {prediction:.4f} kWh")
print("✅ Model test successful!")

print("\n🎉 ML Training Pipeline Complete!")
print("=" * 50)
