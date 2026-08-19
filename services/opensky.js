const https = require('https');
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';

let openskyToken = null;
let openskyTokenExpiry = 0;
let openskyTokenClientId = '';

async function getToken(clientId, clientSecret) {
  if (!clientId || !clientSecret) return null;
  if (openskyToken && openskyTokenClientId === clientId && Date.now() < openskyTokenExpiry - 60000) return openskyToken;

  const postData = `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`;

  try {
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

async function fetchTrack(hex, token) {
  const hexLower = hex.toLowerCase();
  try {
    const data = await new Promise((resolve, reject) => {
      const trackReq = https.get(`https://opensky-network.org/api/tracks/all?icao24=${hexLower}&time=0`, {
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 10000
      }, (resp) => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            try {
              const parsed = JSON.parse(body);
              parsed._creditsRemaining = resp.headers['x-rate-limit-remaining'] || null;
              resolve(parsed);
            } catch(e) { reject(new Error('Invalid JSON')); }
          } else if (resp.statusCode === 404) {
            resolve({ path: null, _creditsRemaining: resp.headers['x-rate-limit-remaining'] || null });
          } else { reject(new Error(`HTTP ${resp.statusCode}`)); }
        });
      });
      trackReq.on('error', reject);
    });

    if (!data || !data.path) return { trail: [], creditsRemaining: data?._creditsRemaining || null };
    const trail = data.path.map(wp => ({
      lat: wp[1], lon: wp[2], alt: wp[3] != null ? Math.round(wp[3] * 3.28084) : null,
      track: wp[4], onGround: wp[5], ts: wp[0] * 1000
    })).filter(p => p.lat != null && p.lon != null);

    return { trail, startTime: data.startTime, callsign: data.callsign, creditsRemaining: data._creditsRemaining };
  } catch (err) {
    return { trail: [], error: err.message };
  }
}

module.exports = { getToken, fetchTrack };