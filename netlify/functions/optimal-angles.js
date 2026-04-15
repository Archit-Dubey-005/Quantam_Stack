import fetch from "node-fetch";

async function geocodeLocation(location) {
  const q = encodeURIComponent(location);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'solar-demo/1.0 (email@example.com)' } });
  const data = await res.json();
  if (!data || data.length === 0) throw new Error("Location not found");
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), display_name: data[0].display_name };
}

export async function handler(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { location } = event.queryStringParameters || {};
    if (!location) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Location parameter is required" })
      };
    }

    const geo = await geocodeLocation(location);
    const lat = geo.lat;
    const lon = geo.lon;
    
    const optimalTilt = Math.abs(lat);
    const optimalAzimuth = lat >= 0 ? 180 : 0; // South for Northern Hemisphere, North for Southern
    
    const response = {
      location: geo.display_name,
      coordinates: { lat: +lat.toFixed(4), lon: +lon.toFixed(4) },
      optimal: {
        tilt: +optimalTilt.toFixed(1),
        azimuth: +optimalAzimuth,
        explanation: {
          tilt: `Optimal tilt angle is approximately equal to the latitude (${lat.toFixed(1)}°)`,
          azimuth: lat >= 0 ? "South-facing (180°) for Northern Hemisphere" : "North-facing (0°) for Southern Hemisphere"
        }
      }
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };
  } catch (err) {
    console.error("Error in optimal-angles:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
}

