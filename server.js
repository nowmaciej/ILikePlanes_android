const express = require('express');
const path = require('path');
const adsb = require('./services/adsb');
const routeService = require('./services/route');
const metar = require('./services/metar');
const opensky = require('./services/opensky');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/flights', async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

    const r = Math.min(Math.max(parseInt(radius) || 250, 10), 250);
    const nmToDeg = 1 / 60;
    const latDeg = r * nmToDeg;
    const lonDeg = r * (nmToDeg / Math.cos(parseFloat(lat) * Math.PI / 180));
    const minLat = parseFloat(lat) - latDeg;
    const maxLat = parseFloat(lat) + latDeg;
    const minLon = parseFloat(lon) - lonDeg;
    const maxLon = parseFloat(lon) + lonDeg;

    let result;
    try {
      result = await adsb.queryADSB({ lat, lon, dist: r });
    } catch {
      result = await adsb.queryADSB('/all');
    }

    const filtered = result.data.filter(a => {
      if (a.lat == null || a.lon == null) return false;
      return a.lat >= minLat && a.lat <= maxLat && a.lon >= minLon && a.lon <= maxLon;
    });

    res.json({ flights: filtered, source: result.source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/flights/:hex', async (req, res) => {
  try {
    const result = await adsb.queryADSB(`/icao/${req.params.hex}`);
    res.json({ flight: result.data[0] || null, source: result.source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/routes/:hex', async (req, res) => {
  try {
    const result = await adsb.queryADSB(`/icao/${req.params.hex}/route`);
    res.json({ route: result.data, source: result.source });
  } catch {
    try {
      const result = await adsb.queryADSB(`/icao/${req.params.hex}`);
      res.json({ route: result.data[0]?.route || null, source: result.source });
    } catch (err2) {
      res.status(500).json({ error: err2.message });
    }
  }
});

app.get('/api/route/:callsign', async (req, res) => {
  try {
    const callsign = req.params.callsign.trim().toUpperCase();
    const result = await routeService.getRouteWithAirports(callsign);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/routes-batch', async (req, res) => {
  try {
    const callsigns = (req.query.callsigns || '').split(',').filter(Boolean).slice(0, 15);
    const results = {};
    await Promise.all(callsigns.map(async (cs) => {
      const routeInfo = await routeService.lookupRoute(cs);
      if (routeInfo && (routeInfo.origin || routeInfo.destination)) {
        const [originInfo, destInfo] = await Promise.all([
          routeService.lookupAirport(routeInfo.origin),
          routeService.lookupAirport(routeInfo.destination)
        ]);
        results[cs] = {
          origin: originInfo ? { icao: originInfo.icao, iata: originInfo.iata, name: originInfo.name, lat: originInfo.lat, lon: originInfo.lon } : (routeInfo.origin ? { icao: routeInfo.origin } : null),
          destination: destInfo ? { icao: destInfo.icao, iata: destInfo.iata, name: destInfo.name, lat: destInfo.lat, lon: destInfo.lon } : (routeInfo.destination ? { icao: routeInfo.destination } : null),
          route: routeInfo.route
        };
      }
    }));
    res.json(results);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/metar', async (req, res) => {
  try {
    const { lat, lon } = req.query;
    if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });
    const list = await metar.fetchMetar(lat, lon);
    res.json(list);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/source', (req, res) => {
  res.json({ active: adsb.getActiveSource().name, sources: adsb.getSources() });
});

app.get('/api/opensky-track/:hex', async (req, res) => {
  const clientId = req.query.client_id || '';
  const clientSecret = req.query.client_secret || '';
  const token = await opensky.getToken(clientId, clientSecret);
  if (!token) return res.json({ trail: [], error: 'no_token' });
  const result = await opensky.fetchTrack(req.params.hex, token);
  res.json(result);
});

app.get('/api/health', async (req, res) => {
  const { fetchUrl } = require('./services/http');
  const health = [];
  for (const sourceName of adsb.getSources()) {
    const url = adsb.getSourceUrl(sourceName);
    if (!url) { health.push({ name: sourceName, status: 'unknown' }); continue; }
    try {
      await fetchUrl(`${url}/stats`, 5000);
      health.push({ name: sourceName, status: 'ok' });
    } catch {
      health.push({ name: sourceName, status: 'down' });
    }
  }
  res.json({ health, active: adsb.getActiveSource().name });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`I Like Plains running at http://localhost:${PORT}`);
});