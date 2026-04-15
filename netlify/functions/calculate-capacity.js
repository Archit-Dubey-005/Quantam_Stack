export async function handler(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { numPanels, panelArea, panelEfficiency, inverterEfficiency = 0.96 } = JSON.parse(event.body);
    
    if (!numPanels || !panelArea || !panelEfficiency) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: "numPanels, panelArea, and panelEfficiency are required" 
        })
      };
    }

    const dcCapacityKW = (numPanels * panelArea * panelEfficiency * 1000) / 1000; // Convert to kW
    const acCapacityKW = dcCapacityKW * inverterEfficiency;
    const annualEstimate = acCapacityKW * 4.5 * 365; // Rough estimate: 4.5 hours/day average

    const response = {
      system: {
        numPanels: +numPanels,
        panelArea: +panelArea,
        panelEfficiency: +panelEfficiency,
        inverterEfficiency: +inverterEfficiency
      },
      capacity: {
        dcKW: +dcCapacityKW.toFixed(2),
        acKW: +acCapacityKW.toFixed(2),
        annualEstimateKWh: +annualEstimate.toFixed(0)
      }
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response)
    };
  } catch (err) {
    console.error("Error in calculate-capacity:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
}

