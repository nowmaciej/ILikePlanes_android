const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const ADSB_SOURCES = [
  { name: 'airplanes.live', url: 'https://api.airplanes.live/v2', priority: 1 },
  { name: 'adsb.lol', url: 'https://api.adsb.lol/v2', priority: 2 },
  { name: 'adsb.fi', url: 'https://api.adsb.fi/v1', priority: 3 }
];

let activeSource = ADSB_SOURCES[0];
let lastFailover = 0;
const FAILOVER_COOLDOWN = 60000;

function fetchUrl(targetUrl, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(targetUrl, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function normalizeResponse(raw, source) {
  if (source.name === 'airplanes.live') {
    if (raw.ac) return raw.ac.map(normalizeAircraft);
    if (raw.data) return raw.data.map(normalizeAircraft);
    if (Array.isArray(raw)) return raw.map(normalizeAircraft);
  }
  if (source.name === 'adsb.lol') {
    if (raw.ac) return raw.ac.map(normalizeAircraft);
    if (raw.data) return raw.data.map(normalizeAircraft);
    if (Array.isArray(raw)) return raw.map(normalizeAircraft);
  }
  if (source.name === 'adsb.fi') {
    if (raw.ac) return raw.ac.map(normalizeAircraft);
    if (raw.data) return raw.data.map(normalizeAircraft);
    if (Array.isArray(raw)) return raw.map(normalizeAircraft);
  }
  return [];
}

function normalizeAircraft(a) {
  return {
    hex: a.hex || a.icao || a.Icao || '',
    flight: (a.flight || a.callsign || a.Callsign || '').trim(),
    lat: a.lat || a.latitude || null,
    lon: a.lon || a.longitude || null,
    alt_baro: a.alt_baro || a.altitude || a.alt_baro || null,
    alt_geom: a.alt_geom || null,
    gs: a.gs || a.ground_speed || null,
    track: a.track || a.heading || null,
    baro_rate: a.baro_rate || a.vertical_rate || null,
    squawk: a.squawk || null,
    category: a.category || a.dbFlags || null,
    r: a.r || a.registration || '',
    t: a.t || a.type || '',
   ownOp: a.ownOp || a.airline || '',
    origin: a.origin || null,
    destination: a.destination || null,
    route: a.route || null,
    emergency: a.emergency || null,
    seen: a.seen || 0,
    rssi: a.rssi || null,
    lat: a.lat ?? null,
    lon: a.lon ?? null,
    dbFlags: a.dbFlags || 0,
    alert: a.alert || 0,
    spi: a.spi || 0,
    mlat: a.mlat || false,
    tisb: a.tisb || false,
    help: a.help || false,
    emergency_p: a.emergency_p || null,
    emergency_s: a.emergency_s || null,
    emergency_n: a.emergency_n || null
  };
}

async function queryADSB(endpoint) {
  const errors = [];
  const sorted = [...ADSB_SOURCES].sort((a, b) => a.priority - b.priority);

  for (const source of sorted) {
    try {
      const fullUrl = `${source.url}${endpoint}`;
      const data = await fetchUrl(fullUrl);
      const normalized = normalizeResponse(data, source);
      if (source.name !== activeSource.name) {
        activeSource = source;
        console.log(`[failover] Switched to ${source.name}`);
      }
      return { data: normalized, source: source.name };
    } catch (err) {
      errors.push({ source: source.name, error: err.message });
      console.log(`[failover] ${source.name} failed: ${err.message}`);
    }
  }
  throw new Error(`All ADS-B sources failed: ${JSON.stringify(errors)}`);
}

app.get('/api/flights', async (req, res) => {
  try {
    const { lat, lon, radius } = req.query;
    if (!lat || !lon) {
      return res.status(400).json({ error: 'lat and lon required' });
    }
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
      result = await queryADSB(`/lat/${lat}/lon/${lon}/dist/${r}`);
    } catch {
      try {
        result = await queryADSB(`/point/${lat}/${lon}/${r}`);
      } catch {
        result = await queryADSB(`/all`);
      }
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
    const result = await queryADSB(`/icao/${req.params.hex}`);
    res.json({ flight: result.data[0] || null, source: result.source });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/routes/:hex', async (req, res) => {
  try {
    const result = await queryADSB(`/icao/${req.params.hex}/route`);
    res.json({ route: result.data, source: result.source });
  } catch (err) {
    try {
      const result = await queryADSB(`/icao/${req.params.hex}`);
      res.json({ route: result.data[0]?.route || null, source: result.source });
    } catch (err2) {
      res.status(500).json({ error: err2.message });
    }
  }
});

app.get('/api/source', (req, res) => {
  res.json({ active: activeSource.name, sources: ADSB_SOURCES.map(s => s.name) });
});

app.get('/api/health', async (req, res) => {
  const health = [];
  for (const source of ADSB_SOURCES) {
    try {
      await fetchUrl(`${source.url}/stats`, 5000);
      health.push({ name: source.name, status: 'ok' });
    } catch {
      health.push({ name: source.name, status: 'down' });
    }
  }
  res.json({ health, active: activeSource.name });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`FlightRadar Local running at http://localhost:${PORT}`);
});
