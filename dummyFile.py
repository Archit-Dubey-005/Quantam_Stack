# Save as generate_dummy_solar_data.py and run with: python generate_dummy_solar_data.py
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

np.random.seed(42)

def sin_daily(hour, peak=1.0):
    # Simple daily sinusoidal pattern (0 at night, peak midday)
    return np.maximum(0, peak * np.sin(np.pi * (hour / 24.0)))

def generate_systems(n_systems=5):
    systems = []
    for i in range(n_systems):
        systems.append({
            "system_id": f"sys_{i+1}",
            "num_panels": np.random.randint(8, 40),
            "panel_area_m2": round(np.random.uniform(1.6, 2.2), 3),
            "panel_efficiency": round(np.random.uniform(0.15, 0.22), 3),
            "inverter_efficiency": round(np.random.uniform(0.95, 0.98), 3),
            "tilt_deg": int(np.random.choice([10,15,20,25,30])),
            "azimuth_deg": int(np.random.choice([150,170,180,190,210])),
            "inverter_max_ac_kw": round(np.random.choice([3.0,5.0,7.0,10.0]),2),
            "lat": round(np.random.uniform(-35,35), 4),
            "lon": round(np.random.uniform(-120,120), 4),
        })
    return systems

def simulate_hourly_for_system(sys, start_dt, hours=240):
    rows = []
    # Simple per-system capacity (kW): num_panels * area * panel_efficiency * 1kW/m2 factor approx
    system_capacity_kw = sys["num_panels"] * sys["panel_area_m2"] * sys["panel_efficiency"] * 0.2
    # the 0.2 factor is arbitrary to keep numbers reasonable in synthetic set
    for h in range(hours):
        ts = start_dt + timedelta(hours=h)
        hour = ts.hour
        doy = ts.timetuple().tm_yday
        # Synthetic GHI pattern: base daily amplitude + seasonal effect + noise
        daily = sin_daily(hour, peak=1.0)  # 0..1
        seasonal = 0.8 + 0.4 * np.sin(2*np.pi*(doy/365.0))  # small seasonal variation
        ghi_w_m2 = np.maximum(0, (800 * daily * seasonal) + np.random.normal(0, 30))
        temp_c = 20 + 8 * np.sin(2*np.pi*(doy/365.0)) + 5 * np.sin(2*np.pi*(hour/24.0)) + np.random.normal(0, 1.5)

        # Very simple POA approximation: POA = GHI * cos_incidence_factor (depends on tilt)
        tilt_rad = np.radians(sys["tilt_deg"])
        cos_factor = max(0.4, np.cos(tilt_rad - 0))  # rough effect; keep between 0.4..1
        poa = ghi_w_m2 * cos_factor

        # Convert irradiance to energy per hour for system:
        # Assume 1 kW of panels produces ~1 kWh in 1000 W/m² for 1 m² panel at 100% eff.
        # We'll approximate system kW by system_capacity_kw computed earlier.
        # pvwatts_pred: physics benchmark (no losses)
        pvwatts_pred_kwh = system_capacity_kw * (poa / 1000.0) * sys["inverter_efficiency"]
        # your baseline does some derates/soiling/temperature correction
        temp_coeff = 1.0 - 0.004 * max(0, temp_c - 25)  # -0.4% per degC above 25°C
        derate = 0.96  # fixed derate factor
        your_baseline_kwh = pvwatts_pred_kwh * derate * temp_coeff

        # Synthesize measured output:
        # - systematic bias (some systems underperform by -3% to -10%)
        sys_bias = np.random.uniform(-0.10, -0.02)
        # - random noise (clouds, shading)
        rand_noise = np.random.normal(0, 0.05)  # 5% std dev
        # - occasional outage (1% chance)
        outage = 0.0
        if np.random.rand() < 0.01:
            outage = -1.0  # total loss this hour

        measured_kwh = max(0.0, pvwatts_pred_kwh * (1 + sys_bias + rand_noise + outage))

        rows.append({
            "system_id": sys["system_id"],
            "timestamp_utc": ts.isoformat(),
            "lat": sys["lat"],
            "lon": sys["lon"],
            "num_panels": sys["num_panels"],
            "panel_area_m2": sys["panel_area_m2"],
            "panel_efficiency": sys["panel_efficiency"],
            "inverter_efficiency": sys["inverter_efficiency"],
            "tilt_deg": sys["tilt_deg"],
            "azimuth_deg": sys["azimuth_deg"],
            "inverter_max_ac_kw": sys["inverter_max_ac_kw"],
            "ghi_w_m2": round(ghi_w_m2, 2),
            "temperature_C": round(temp_c, 2),
            "poa_w_m2": round(poa, 2),
            "system_capacity_kw": round(system_capacity_kw, 3),
            "pvwatts_pred_kwh": round(pvwatts_pred_kwh, 4),
            "your_baseline_kwh": round(your_baseline_kwh, 4),
            "measured_ac_kwh": round(measured_kwh, 4),
            "hour_of_day": hour,
            "day_of_year": doy
        })
    return rows

def generate_dataset(n_systems=5, hours_per_system=240):
    systems = generate_systems(n_systems)
    all_rows = []
    start = datetime.utcnow().replace(minute=0, second=0, microsecond=0) - timedelta(days=10)
    for sys in systems:
        rows = simulate_hourly_for_system(sys, start, hours=hours_per_system)
        all_rows.extend(rows)
    df = pd.DataFrame(all_rows)
    return df

if __name__ == "__main__":

    df = generate_dataset(n_systems=8, hours_per_system=300)  # generates ~2400 rows
    print(df.head())  # just shows first few rows in terminal

    # Save to CSV in the same folder
    df.to_csv("synthetic_solar_hourly.csv", index=False)
    print("Saved synthetic_solar_hourly.csv with", len(df), "rows")