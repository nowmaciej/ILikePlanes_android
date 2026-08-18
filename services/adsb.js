const { fetchUrl } = require('./http');

const ADSB_SOURCES = [
  { name: 'airplanes.live', url: 'https://api.airplanes.live/v2', endpoint: '/point/{lat}/{lon}/{dist}', priority: 1 },
  { name: 'adsb.lol', url: 'https://api.adsb.lol/v2', endpoint: '/lat/{lat}/lon/{lon}/dist/{dist}', priority: 2 },
  { name: 'adsb.fi', url: 'https://opendata.adsb.fi/api/v3', endpoint: '/lat/{lat}/lon/{lon}/dist/{dist}', priority: 3 }
];

let activeSource = null;

function normalizeAircraft(a) {
  return {
    hex: a.hex || a.icao || a.Icao || '',
    flight: (a.flight || a.callsign || a.Callsign || '').trim(),
    lat: a.lat ?? null,
    lon: a.lon ?? null,
    alt_baro: a.alt_baro || a.altitude || null,
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

function normalizeResponse(raw) {
  if (raw.ac) return raw.ac.map(normalizeAircraft);
  if (raw.data) return raw.data.map(normalizeAircraft);
  if (Array.isArray(raw)) return raw.map(normalizeAircraft);
  return [];
}

function buildEndpoint(template, params) {
  return template.replace('{lat}', params.lat).replace('{lon}', params.lon).replace('{dist}', params.dist);
}

async function queryADSB(endpointOrParams) {
  const sorted = [...ADSB_SOURCES].sort((a, b) => a.priority - b.priority);
  const errors = [];

  const trySource = async (source) => {
    let fullUrl;
    if (typeof endpointOrParams === 'string') {
      fullUrl = `${source.url}${endpointOrParams}`;
    } else {
      const ep = source.endpoint || '/lat/{lat}/lon/{lon}/dist/{dist}';
      fullUrl = `${source.url}${buildEndpoint(ep, endpointOrParams)}`;
    }
    const data = await fetchUrl(fullUrl);
    return normalizeResponse(data);
  };

  if (activeSource) {
    try {
      const normalized = await trySource(activeSource);
      return { data: normalized, source: activeSource.name };
    } catch (err) {
      errors.push({ source: activeSource.name, error: err.message });
      console.log(`[failover] ${activeSource.name} failed: ${err.message}`);
    }
  }

  for (const source of sorted) {
    if (activeSource && source.name === activeSource.name) continue;
    try {
      const normalized = await trySource(source);
      activeSource = source;
      console.log(`[failover] Switched to ${source.name}`);
      return { data: normalized, source: source.name };
    } catch (err) {
      errors.push({ source: source.name, error: err.message });
      console.log(`[failover] ${source.name} failed: ${err.message}`);
    }
  }
  throw new Error(`All ADS-B sources failed: ${JSON.stringify(errors)}`);
}

function getActiveSource() {
  return activeSource;
}

function getSources() {
  return ADSB_SOURCES.map(s => s.name);
}

function getSourceUrl(name) {
  const src = ADSB_SOURCES.find(s => s.name === name);
  return src ? src.url : null;
}

module.exports = { queryADSB, getActiveSource, getSources, getSourceUrl };