const { fetchUrl } = require('./http');

async function fetchMetar(lat, lon) {
  if (!lat || !lon) throw new Error('lat and lon required');
  const latN = parseFloat(lat) + 0.8;
  const latS = parseFloat(lat) - 0.8;
  const lonE = parseFloat(lon) + 1.2;
  const lonW = parseFloat(lon) - 1.2;
  const metarUrl = `https://aviationweather.gov/api/data/metar?bbox=${latS},${lonW},${latN},${lonE}&format=json`;
  const data = await fetchUrl(metarUrl, 10000);
  return Array.isArray(data) ? data : (data.data || data.metar || []);
}

module.exports = { fetchMetar };