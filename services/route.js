const { fetchUrl } = require('./http');

const routeCache = new Map();
const airportCache = new Map();

async function lookupRoute(callsign) {
  const key = (callsign || '').trim().toUpperCase();
  if (!key) return null;
  if (routeCache.has(key)) return routeCache.get(key);

  try {
    const data = await fetchUrl(`https://hexdb.io/api/v1/route/icao/${key}`, 5000);
    if (data && data.route) {
      const parts = data.route.split('-');
      const result = { origin: parts[0] || null, destination: parts[1] || null, route: data.route };
      routeCache.set(key, result);
      return result;
    }
  } catch {}

  routeCache.set(key, null);
  return null;
}

async function lookupAirport(icao) {
  if (!icao) return null;
  const code = icao.trim().toUpperCase();
  if (airportCache.has(code)) return airportCache.get(code);

  try {
    const data = await fetchUrl(`https://hexdb.io/api/v1/airport/icao/${code}`, 5000);
    if (data && data.airport) {
      const info = { icao: code, iata: data.iata || '', name: data.airport, lat: data.latitude, lon: data.longitude, country: data.country_code };
      airportCache.set(code, info);
      return info;
    }
  } catch {}

  airportCache.set(code, null);
  return null;
}

async function getRouteWithAirports(callsign) {
  const routeInfo = await lookupRoute(callsign);
  if (!routeInfo) return { origin: null, destination: null, route: null };

  const [originInfo, destInfo] = await Promise.all([
    lookupAirport(routeInfo.origin),
    lookupAirport(routeInfo.destination)
  ]);

  return {
    origin: originInfo ? { icao: originInfo.icao, iata: originInfo.iata, name: originInfo.name, lat: originInfo.lat, lon: originInfo.lon } : (routeInfo.origin ? { icao: routeInfo.origin } : null),
    destination: destInfo ? { icao: destInfo.icao, iata: destInfo.iata, name: destInfo.name, lat: destInfo.lat, lon: destInfo.lon } : (routeInfo.destination ? { icao: routeInfo.destination } : null),
    route: routeInfo.route
  };
}

module.exports = { lookupRoute, lookupAirport, getRouteWithAirports };