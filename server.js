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
  { name: 'airplanes.live', url: 'https://api.airplanes.live/v2', endpoint: '/point/{lat}/{lon}/{dist}', priority: 1 },
  { name: 'adsb.lol', url: 'https://api.adsb.lol/v2', endpoint: '/lat/{lat}/lon/{lon}/dist/{dist}', priority: 2 },
  { name: 'adsb.fi', url: 'https://opendata.adsb.fi/api/v3', endpoint: '/lat/{lat}/lon/{lon}/dist/{dist}', priority: 3 }
];

let activeSource = ADSB_SOURCES[0];
let lastFailover = 0;
const FAILOVER_COOLDOWN = 60000;

function fetchUrl(targetUrl, timeout = 8000, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(targetUrl, { timeout }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
        res.resume();
        return fetchUrl(res.headers.location, timeout, maxRedirects - 1).then(resolve, reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Invalid JSON')); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function normalizeResponse(raw) {
  if (raw.ac) return raw.ac.map(normalizeAircraft);
  if (raw.data) return raw.data.map(normalizeAircraft);
  if (Array.isArray(raw)) return raw.map(normalizeAircraft);
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

function buildEndpoint(template, params) {
  return template.replace('{lat}', params.lat).replace('{lon}', params.lon).replace('{dist}', params.dist);
}

async function queryADSB(endpointOrParams, sourceOverride) {
  const errors = [];
  const sorted = [...ADSB_SOURCES].sort((a, b) => a.priority - b.priority);

  for (const source of sorted) {
    if (sourceOverride && source.name !== sourceOverride) continue;
    try {
      let fullUrl;
      if (typeof endpointOrParams === 'string') {
        fullUrl = `${source.url}${endpointOrParams}`;
      } else {
        const ep = source.endpoint || '/lat/{lat}/lon/{lon}/dist/{dist}';
        fullUrl = `${source.url}${buildEndpoint(ep, endpointOrParams)}`;
      }
      const data = await fetchUrl(fullUrl);
      const normalized = normalizeResponse(data);
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
      result = await queryADSB({ lat, lon, dist: r });
    } catch {
      result = await queryADSB('/all');
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

const routeCache = new Map();
const AIRPORT_CACHE = new Map();

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
  if (AIRPORT_CACHE.has(code)) return AIRPORT_CACHE.get(code);

  try {
    const data = await fetchUrl(`https://hexdb.io/api/v1/airport/icao/${code}`, 5000);
    if (data && data.airport) {
      const info = { icao: data.iata ? code : code, iata: data.iata || '', name: data.airport, lat: data.latitude, lon: data.longitude, country: data.country_code };
      AIRPORT_CACHE.set(code, info);
      return info;
    }
  } catch {}

  AIRPORT_CACHE.set(code, null);
  return null;
}

app.get('/api/route/:callsign', async (req, res) => {
  try {
    const callsign = req.params.callsign.trim().toUpperCase();
    const routeInfo = await lookupRoute(callsign);
    if (!routeInfo) return res.json({ origin: null, destination: null, route: null });

    const [originInfo, destInfo] = await Promise.all([
      lookupAirport(routeInfo.origin),
      lookupAirport(routeInfo.destination)
    ]);

    res.json({
      origin: originInfo ? { icao: originInfo.icao, iata: originInfo.iata, name: originInfo.name, lat: originInfo.lat, lon: originInfo.lon } : (routeInfo.origin ? { icao: routeInfo.origin } : null),
      destination: destInfo ? { icao: destInfo.icao, iata: destInfo.iata, name: destInfo.name, lat: destInfo.lat, lon: destInfo.lon } : (routeInfo.destination ? { icao: routeInfo.destination } : null),
      route: routeInfo.route
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/routes-batch', async (req, res) => {
  try {
    const callsigns = (req.query.callsigns || '').split(',').filter(Boolean).slice(0, 15);
    const results = {};
    await Promise.all(callsigns.map(async (cs) => {
      const routeInfo = await lookupRoute(cs);
      if (routeInfo && (routeInfo.origin || routeInfo.destination)) {
        const [originInfo, destInfo] = await Promise.all([
          lookupAirport(routeInfo.origin),
          lookupAirport(routeInfo.destination)
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
    const latN = parseFloat(lat) + 0.8;
    const latS = parseFloat(lat) - 0.8;
    const lonE = parseFloat(lon) + 1.2;
    const lonW = parseFloat(lon) - 1.2;
    const metarUrl = `https://aviationweather.gov/api/data/metar?bbox=${latS},${lonW},${latN},${lonE}&format=json`;
    const data = await fetchUrl(metarUrl, 10000);
    const list = Array.isArray(data) ? data : (data.data || data.metar || []);
    res.json(list);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/source', (req, res) => {
  res.json({ active: activeSource.name, sources: ADSB_SOURCES.map(s => s.name) });
});

let openskyToken = null;
let openskyTokenExpiry = 0;
let openskyTokenClientId = '';
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

async function getOpenSkyToken(clientId, clientSecret) {
  if (!clientId || !clientSecret) return null;
  if (openskyToken && openskyTokenClientId === clientId && Date.now() < openskyTokenExpiry - 60000) return openskyToken;
  try {
    const postData = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;
    const data = await new Promise((resolve, reject) => {
      const tokenReq = https.request(OPENSKY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
        timeout: 10000
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('Invalid JSON')); }
          } else { reject(new Error(`HTTP ${res.statusCode}`)); }
        });
      });
      tokenReq.on('error', reject);
      tokenReq.write(postData);
      tokenReq.end();
    });
    openskyToken = data.access_token;
    openskyTokenExpiry = Date.now() + (data.expires_in || 1800) * 1000;
    openskyTokenClientId = clientId;
    return openskyToken;
  } catch (err) {
    console.log('[OpenSky] Token error:', err.message);
    openskyToken = null;
    return null;
  }
}

app.get('/api/opensky-track/:hex', async (req, res) => {
  const clientId = req.query.client_id || '';
  const clientSecret = req.query.client_secret || '';
  const token = await getOpenSkyToken(clientId, clientSecret);
  if (!token) return res.json({ trail: [], error: 'no_token' });
  const hex = req.params.hex.toLowerCase();
  try {
    const data = await new Promise((resolve, reject) => {
      const trackReq = https.get(`https://opensky-network.org/api/tracks/all?icao24=${hex}&time=0`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000
      }, (resp) => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('Invalid JSON')); }
          } else { reject(new Error(`HTTP ${resp.statusCode}`)); }
        });
      });
      trackReq.on('error', reject);
    });
    if (!data || !data.path) return res.json({ trail: [] });
    const trail = data.path.map(wp => ({
      lat: wp[1], lon: wp[2], alt: wp[3] != null ? Math.round(wp[3] * 3.28084) : null,
      track: wp[4], onGround: wp[5], ts: wp[0] * 1000
    })).filter(p => p.lat != null && p.lon != null);
    res.json({ trail, startTime: data.startTime, callsign: data.callsign });
  } catch (err) {
    res.json({ trail: [], error: err.message });
  }
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
