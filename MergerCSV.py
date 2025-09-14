import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression

# ====== Load datasets ======
nasa = pd.read_csv("nasa_power_data.csv")  # daily
dummy = pd.read_csv("synthetic_solar_hourly.csv")  # hourly

# ====== Convert timestamps ======
nasa['timestamp_utc'] = pd.to_datetime(nasa['Date'], format='%Y%m%d')
dummy['timestamp_utc'] = pd.to_datetime(dummy['timestamp_utc'])

# ====== Restrict NASA to dummy's date range ======
start_date = dummy['timestamp_utc'].min().normalize()
end_date = dummy['timestamp_utc'].max().normalize()
nasa = nasa[(nasa['timestamp_utc'] >= start_date) & (nasa['timestamp_utc'] <= end_date)]

# ====== Resample NASA daily to hourly ======
nasa_hourly = nasa.set_index('timestamp_utc').resample('H').ffill().reset_index()

# ====== Round lat/lon for approximate matching ======
for col in ['lat', 'lon', 'latitude', 'longitude']:
    if col in nasa_hourly.columns:
        nasa_hourly[col] = nasa_hourly[col].round(2)
    if col in dummy.columns:
        dummy[col] = dummy[col].round(2)

# ====== Merge datasets ======
merge_keys = ['timestamp_utc']
if 'lat' in nasa_hourly.columns and 'lat' in dummy.columns:
    merge_keys.append('lat')
if 'lon' in nasa_hourly.columns and 'lon' in dummy.columns:
    merge_keys.append('lon')

merged = pd.merge(dummy, nasa_hourly, on=merge_keys, how='inner')

if merged.empty:
    print("⚠ Warning: Merge produced 0 rows! Check timestamp alignment and lat/lon values.")
else:
    print("Merged dataset shape:", merged.shape)

# ====== Select features and target ======
feature_cols = [c for c in ['ghi_w_m2', 'temperature_C', 'tilt_deg', 'azimuth_deg', 'num_panels'] if c in merged.columns]
X = merged[feature_cols]
y = merged['measured_ac_kwh']

# ====== Train/test split ======
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# ====== Train model ======
model = LinearRegression()
model.fit(X_train, y_train)

score = model.score(X_test, y_test)
print("\n✅ Model trained successfully!")
print("R^2 score:", score)