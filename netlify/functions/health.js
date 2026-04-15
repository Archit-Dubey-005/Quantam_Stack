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

  const response = {
    status: "OK", 
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    services: {
      geocoding: "Nominatim",
      weather: "Open-Meteo",
      pvwatts: "Not configured"
    }
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(response)
  };
}

