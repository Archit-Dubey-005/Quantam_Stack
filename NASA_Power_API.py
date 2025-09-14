import requests
import csv

# Define the API endpoint and parameters
url = "https://power.larc.nasa.gov/api/temporal/daily/point"
params = {
    "parameters": "ALLSKY_SFC_SW_DWN,T2M",  # solar radiation, temperature
    "community": "RE",
    "latitude": 40,
    "longitude": -105,
    "start": "20240912",  # YYYYMMDD
    "end": "20250912",
    "format": "JSON"
}

# Make the GET request
response = requests.get(url, params=params)

if response.status_code == 200:
    data = response.json()
    
    # Extract daily data
    daily_data = data["properties"]["parameter"]
    solar = daily_data["ALLSKY_SFC_SW_DWN"]
    temp = daily_data["T2M"]
    
    # Write data to CSV
    with open("nasa_power_data.csv", mode="w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["Date", "Solar_Radiation", "Temperature"])
        
        for date in solar.keys():
            writer.writerow([date, solar[date], temp[date]])
    
    print("CSV file 'nasa_power_data.csv' has been created successfully.")
else:
    print(f"Error: {response.status_code}")