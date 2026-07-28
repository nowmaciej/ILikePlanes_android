(function(){
'use strict';

const NM_TO_KM = 1.852;
const KM_TO_MI = 0.621371;
const FT_TO_M = 0.3048;
const KTS_TO_KMH = 1.852;
const KTS_TO_MPH = 1.15078;
const EARTH_R_KM = 6371;
const MAX_TRACKED = 80;
const MAX_DISPLAYED = 40;

const THEMES = ['default','dark','light','ocean','forest','sunset','cyber','radar'];
const THEME_COLORS = {
  default:'#3b82f6', dark:'#4dabf7', light:'#2563eb',
  ocean:'#00b4d8', forest:'#4ade80', sunset:'#f97316',
  cyber:'#e040fb', radar:'#00ff41'
};

const AIRLINE_LOGO_CACHE = {};
const AIRLINE_ICAO_MAP = {};

const state = {
  lang: 'en',
  theme: 'default',
  nightMode: false,
  units: 'metric',
  radius: 250,
  rangeUnit: 'nm',
  refreshRate: 8,
  hideSurface: false,
  localReceiver: false,
  receiverUrl: '',
  faKey: '',
  openskyClientId: '',
  openskyClientSecret: '',
  openskyRouteData: false,
  radarRouteLayer: null,
  position: null,
  locationMode: 'auto',
  manualLocation: null,
  flights: [],
  selectedFlight: null,
  currentView: 'list',
  source: '---',
  refreshTimer: null,
  sessionStart: new Date(),
  sessionFlights: new Map(),
  sessionHourly: {},
  lastRefresh: null,
  map: null,
  detailMap: null,
  radarMarkers: {},
  radarTrails: {},
  radarCircle: null,
  myLocationMarker: null,
  layerAirports: null,
  layerPlanes: null,
  metarData: null,
  translations: { en: {}, pl: {} },
  routeCache: {},
  sortKey: 'distance',
  sortAsc: true
};

let t = (key) => {
  const parts = key.split('.');
  let v = state.translations[state.lang];
  for (const p of parts) { v = v?.[p]; }
  return v || key;
};

function createPlaneIcon(f, selected) {
  const iconId = getCategoryIcon(f.category);
  const color = selected ? 'var(--danger)' : 'var(--accent)';
  const size = selected ? 33 : 24;
  return L.divIcon({
    className: `radar-plane${selected ? ' radar-plane-selected' : ''}`,
    html: `<svg class="radar-plane-icon map-icon" width="${size}" height="${size}" viewBox="0 0 24 24" style="color:${color};transform:rotate(${f.track||0}deg);transition:transform .5s, color .3s;${selected ? 'filter:drop-shadow(0 0 6px var(--danger));' : ''}"><use href="icons.svg#${iconId}"/></svg>`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) Object.entries(attrs).forEach(([k,v]) => {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v);
  });
  children.flat().forEach(c => {
    if (typeof c === 'string') el.appendChild(document.createTextNode(c));
    else if (c) el.appendChild(c);
  });
  return el;
}

function degToRad(d) { return d * Math.PI / 180; }
function radToDeg(r) { return r * 180 / Math.PI; }

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = degToRad(lat2 - lat1);
  const dLon = degToRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(degToRad(lat1))*Math.cos(degToRad(lat2))*Math.sin(dLon/2)**2;
  return EARTH_R_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function bearing(lat1, lon1, lat2, lon2) {
  const dLon = degToRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(degToRad(lat2));
  const x = Math.cos(degToRad(lat1))*Math.sin(degToRad(lat2)) - Math.sin(degToRad(lat1))*Math.cos(degToRad(lat2))*Math.cos(dLon);
  return (radToDeg(Math.atan2(y, x)) + 360) % 360;
}

function bearingToCardinal(b) {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(b / 45) % 8];
}

function formatAltitude(alt, unit) {
  if (alt == null || alt === 'ground') return 'GND';
  const ft = Math.round(alt);
  if (unit === 'metric') return `${Math.round(ft * FT_TO_M)}m`;
  return `${ft}ft`;
}

function formatSpeed(spd, unit) {
  if (spd == null) return '---';
  if (unit === 'metric') return `${Math.round(spd * KTS_TO_KMH)} km/h`;
  return `${Math.round(spd)} kts`;
}

function formatDistance(km) {
  if (state.units === 'metric') return `${km.toFixed(1)} km`;
  return `${(km * KM_TO_MI).toFixed(1)} mi`;
}

function formatRange(km) {
  if (state.rangeUnit === 'km') return `${km.toFixed(1)} km`;
  return `${(km / NM_TO_KM).toFixed(1)} NM`;
}

function formatRadiusUnit(nm) {
  if (state.rangeUnit === 'km') return `${(nm * NM_TO_KM).toFixed(0)} km`;
  return `${nm} NM`;
}

function countryFlag(code) {
  if (!code || code.length !== 2) return '';
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 - 65 + c.charCodeAt(0)));
}

function getAirlineLogo(flight, registration) {
  const icao = flight?.substring(0, 3);
  if (!icao) return null;
  return `https://logo.clearbit.com/${icao.toLowerCase()}airlines.com`;
}

function getAirlineName(ownOp, flight) {
  if (ownOp) return ownOp;
  const icao = flight?.substring(0, 3);
  const airlines = {
    'LOT':'LOT Polish Airlines','BAW':'British Airways','DLH':'Lufthansa',
    'AFR':'Air France','KLM':'KLM','RYR':'Ryanair','EZY':'easyJet',
    'WZZ':'Wizz Air','SAS':'SAS','THY':'Turkish Airlines',
    'UAL':'United Airlines','AAL':'American Airlines','DAL':'Delta Air Lines',
    'SWA':'Southwest Airlines','ACA':'Air Canada','QFA':'Qantas',
    'ANA':'All Nippon Airways','JAL':'Japan Airlines','CPA':'Cathay Pacific',
    'SIA':'Singapore Airlines','EVA':'EVA Air','AIC':'Air India',
    'ETH':'Ethiopian Airlines','MSA':'EgyptAir','SVA':'Saudia',
    'UAE':'Emirates','ETD':'Etihad Airways','QTR':'Qatar Airways',
    'VLG':'Vueling','IBE':'Iberia','AZA':'ITA Airways','TAP':'TAP Portugal',
    'FIN':'Finnair','NAX':'Norwegian','TRA':'Transavia','TVS':'Smartwings',
    'CSA':'Czech Airlines','LOT':'LOT Polish Airlines','WZZ':'Wizz Air'
  };
  return airlines[icao] || icao || '---';
}

function metarUrl(icao) {
  return `https://aviationweather.gov/api/data/metar?id=${icao}&format=json`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = h('div', { class: `toast ${type}` }, msg);
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function updateClock() {
  const now = new Date();
  const el = document.getElementById('clock');
  if (el) el.textContent = now.toLocaleTimeString(state.lang === 'pl' ? 'pl-PL' : 'en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function updateCompass(heading) {
  const needle = document.getElementById('compass-needle');
  if (needle && heading != null) needle.style.transform = `translate(-50%,-100%) rotate(${heading}deg)`;
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  state.theme = theme;
  localStorage.setItem('frl-theme', theme);
  updateThemeSwatches();
}

function updateThemeSwatches() {
  document.querySelectorAll('.theme-swatch').forEach(sw => {
    sw.classList.toggle('active', sw.dataset.theme === state.theme);
  });
}

function applyNightMode(on) {
  document.body.classList.toggle('night-mode', on);
  state.nightMode = on;
  localStorage.setItem('frl-night', on);
  const cb = document.getElementById('setting-night');
  if (cb) cb.checked = on;
}

function applyLanguage(lang) {
  state.lang = lang;
  document.documentElement.lang = lang;
  localStorage.setItem('frl-lang', lang);
  const sel = document.getElementById('setting-language');
  if (sel) sel.value = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const val = t(key);
    if (val !== key) el.textContent = val;
  });
}

function loadSettings() {
  const saved = (key, def) => localStorage.getItem(`frl-${key}`) ?? def;
  state.lang = saved('lang', 'en');
  state.theme = saved('theme', 'default');
  state.nightMode = saved('night', 'false') === 'true';
  state.units = saved('units', 'metric');
  state.radius = parseInt(saved('radius', '250'));
  state.rangeUnit = saved('range-unit', 'nm');
  state.refreshRate = parseInt(saved('refresh', '8'));
  state.hideSurface = saved('hide-surface', 'false') === 'true';
  state.localReceiver = saved('local', 'false') === 'true';
  state.receiverUrl = saved('receiver-url', '');
  state.faKey = saved('fa-key', '');
  state.openskyClientId = saved('opensky-client-id', '');
  state.openskyClientSecret = saved('opensky-client-secret', '');
  state.openskyRouteData = saved('opensky-route-data', 'false') === 'true';
  state.locationMode = saved('location-mode', 'auto');
  const ml = saved('manual-location', null);
  state.manualLocation = ml ? JSON.parse(ml) : null;
}

function saveSettings() {
  const set = (key, val) => localStorage.setItem(`frl-${key}`, val);
  set('lang', state.lang);
  set('theme', state.theme);
  set('night', state.nightMode);
  set('units', state.units);
  set('radius', state.radius);
  set('range-unit', state.rangeUnit);
  set('refresh', state.refreshRate);
  set('hide-surface', state.hideSurface);
  set('local', state.localReceiver);
  set('receiver-url', state.receiverUrl);
  set('fa-key', state.faKey);
  set('opensky-client-id', state.openskyClientId);
  set('opensky-client-secret', state.openskyClientSecret);
  set('opensky-route-data', state.openskyRouteData);
  set('location-mode', state.locationMode);
  set('manual-location', state.manualLocation ? JSON.stringify(state.manualLocation) : '');
}

function initSettings() {
  loadSettings();
  applyLanguage(state.lang);
  applyTheme(state.theme);
  applyNightMode(state.nightMode);

  document.getElementById('setting-language').value = state.lang;
  document.getElementById('setting-units').value = state.units;
  document.getElementById('setting-range-unit').value = state.rangeUnit;
  document.getElementById('setting-refresh').value = state.refreshRate;
  document.getElementById('setting-local').checked = state.localReceiver;
  document.getElementById('setting-receiver-url').value = state.receiverUrl;
  document.getElementById('setting-fa-key').value = state.faKey;
  document.getElementById('setting-opensky-client-id').value = state.openskyClientId;
  document.getElementById('setting-opensky-client-secret').value = state.openskyClientSecret;
  document.getElementById('setting-opensky-route').checked = state.openskyRouteData;
  document.getElementById('setting-hide-surface').checked = state.hideSurface;
  document.getElementById('setting-night').checked = state.nightMode;
  document.getElementById('radius-slider').value = state.radius;
  document.getElementById('radius-value').textContent = formatRadiusUnit(state.radius);
  document.getElementById('radar-radius-slider').value = state.radius;
  document.getElementById('radar-radius-value').textContent = formatRadiusUnit(state.radius);
  document.getElementById('range-badge').textContent = formatRadiusUnit(state.radius);

  const themeContainer = document.getElementById('theme-selector');
  themeContainer.innerHTML = '';
  THEMES.forEach(theme => {
    const swatch = h('div', {
      class: `theme-swatch${theme === state.theme ? ' active' : ''}`,
      style: `background:${THEME_COLORS[theme]}`,
      'data-theme': theme,
      onClick: () => { applyTheme(theme); saveSettings(); }
    });
    themeContainer.appendChild(swatch);
  });

  document.getElementById('setting-language').addEventListener('change', e => {
    state.lang = e.target.value; applyLanguage(state.lang); saveSettings();
  });
  document.getElementById('setting-units').addEventListener('change', e => {
    state.units = e.target.value; saveSettings(); renderFlightList();
  });
  document.getElementById('setting-range-unit').addEventListener('change', e => {
    state.rangeUnit = e.target.value;
    document.getElementById('radius-value').textContent = formatRadiusUnit(state.radius);
    document.getElementById('radar-radius-value').textContent = formatRadiusUnit(state.radius);
    document.getElementById('range-badge').textContent = formatRadiusUnit(state.radius);
    document.getElementById('rsb-ground-dist').textContent = '';
    if (state.selectedFlight && state.currentView === 'radar') updateRadarSidebar();
    saveSettings(); renderFlightList();
  });
  document.getElementById('setting-refresh').addEventListener('change', e => {
    state.refreshRate = parseInt(e.target.value); saveSettings(); restartRefresh();
  });
  document.getElementById('setting-night').addEventListener('change', e => {
    applyNightMode(e.target.checked); saveSettings();
  });
  document.getElementById('setting-local').addEventListener('change', e => {
    state.localReceiver = e.target.checked; saveSettings();
  });
  document.getElementById('setting-receiver-url').addEventListener('input', e => {
    state.receiverUrl = e.target.value; saveSettings();
  });
  document.getElementById('setting-fa-key').addEventListener('input', e => {
    state.faKey = e.target.value; saveSettings();
  });
  document.getElementById('setting-opensky-client-id').addEventListener('input', e => {
    state.openskyClientId = e.target.value; saveSettings();
  });
  document.getElementById('setting-opensky-client-secret').addEventListener('input', e => {
    state.openskyClientSecret = e.target.value; saveSettings();
  });
  document.getElementById('setting-opensky-route').addEventListener('change', e => {
    state.openskyRouteData = e.target.checked; saveSettings();
    if (state.selectedFlight && state.currentView === 'radar') updateRadarRoute();
  });
  document.getElementById('setting-hide-surface').addEventListener('change', e => {
    state.hideSurface = e.target.checked; saveSettings(); renderFlightList(); updateFlightCount();
  });

  const locMode = document.getElementById('setting-location-mode');
  const manualSection = document.getElementById('manual-location-section');
  locMode.value = state.locationMode;
  manualSection.classList.toggle('hidden', state.locationMode === 'auto');
  updateLocationDisplay();

  locMode.addEventListener('change', e => {
    state.locationMode = e.target.value;
    manualSection.classList.toggle('hidden', state.locationMode === 'auto');
    saveSettings();
    if (state.locationMode === 'manual' && state.manualLocation) {
      applyManualPosition(state.manualLocation.lat, state.manualLocation.lon, state.manualLocation.name);
    } else if (state.locationMode === 'auto') {
      initGeolocation();
    }
  });

  document.getElementById('btn-use-gps').addEventListener('click', () => {
    state.locationMode = 'auto';
    state.manualLocation = null;
    locMode.value = 'auto';
    manualSection.classList.add('hidden');
    saveSettings();
    initGeolocation();
    toast(t('settings.locationAuto'), 'success');
  });

  const searchInput = document.getElementById('setting-city-search');
  const resultsContainer = document.getElementById('city-search-results');
  let searchDebounce = null;

  searchInput.addEventListener('input', e => {
    const query = e.target.value.trim();
    clearTimeout(searchDebounce);
    if (query.length < 2) {
      resultsContainer.classList.add('hidden');
      return;
    }
    resultsContainer.innerHTML = `<div class="city-search-loading">${t('settings.searching')}</div>`;
    resultsContainer.classList.remove('hidden');
    searchDebounce = setTimeout(() => searchCity(query), 400);
  });

  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim().length >= 2) resultsContainer.classList.remove('hidden');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.location-search-wrap')) resultsContainer.classList.add('hidden');
  });

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      resultsContainer.classList.add('hidden');
      searchInput.blur();
    }
  });
}

async function searchCity(query) {
  const resultsContainer = document.getElementById('city-search-results');
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=8&addressdetails=1&accept-language=${state.lang}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'FlightRadarLocal/1.0' } });
    const data = await res.json();

    if (!data.length) {
      resultsContainer.innerHTML = `<div class="city-search-loading">${t('settings.noResults')}</div>`;
      return;
    }

    resultsContainer.innerHTML = '';
    data.forEach(place => {
      const name = place.display_name.split(',').slice(0, 2).join(',');
      const country = place.address?.country || '';
      const item = h('div', { class: 'city-search-item', onClick: () => selectCity(place) });
      item.innerHTML = `<span class="city-name">${name}</span><span class="city-country">${country}</span><span class="city-coords">${parseFloat(place.lat).toFixed(4)}, ${parseFloat(place.lon).toFixed(4)}</span>`;
      resultsContainer.appendChild(item);
    });
  } catch (err) {
    resultsContainer.innerHTML = `<div class="city-search-loading">${t('app.error')}</div>`;
  }
}

function selectCity(place) {
  const lat = parseFloat(place.lat);
  const lon = parseFloat(place.lon);
  const name = place.display_name.split(',').slice(0, 2).join(',');

  state.manualLocation = { lat, lon, name };
  state.locationMode = 'manual';
  document.getElementById('setting-location-mode').value = 'manual';
  document.getElementById('manual-location-section').classList.remove('hidden');
  document.getElementById('setting-city-search').value = '';
  document.getElementById('city-search-results').classList.add('hidden');
  saveSettings();
  applyManualPosition(lat, lon, name);
  toast(`${t('settings.locationSet')}: ${name}`, 'success');
}

function applyManualPosition(lat, lon, name) {
  state.position = { lat, lon };
  updateLocationDisplay();
  if (state.map) {
    state.map.panTo([lat, lon]);
    if (state.myLocationMarker) state.myLocationMarker.setLatLng([lat, lon]);
    if (state.radarCircle) {
      state.radarCircle.setLatLng([lat, lon]);
    }
  }
  fetchFlights();
}

function updateLocationDisplay() {
  const display = document.getElementById('current-location-display');
  if (!display) return;
  if (state.locationMode === 'manual' && state.manualLocation) {
    display.textContent = state.manualLocation.name || `${state.manualLocation.lat.toFixed(4)}, ${state.manualLocation.lon.toFixed(4)}`;
  } else if (state.position) {
    display.textContent = `${state.position.lat.toFixed(4)}, ${state.position.lon.toFixed(4)}`;
  } else {
    display.textContent = '---';
  }
}

async function fetchFlights() {
  if (!state.position) return;
  const { lat, lon } = state.position;
  try {
    let url;
    if (state.localReceiver && state.receiverUrl) {
      try {
        const localData = await fetchJSON(`${state.receiverUrl}/data/aircraft.json`);
        state.flights = (localData.aircraft || []).map(normalizeLocalData);
        state.source = 'local';
        updateSourceBadge();
        processFlights();
        return;
      } catch(e) {
        console.log('Local receiver failed, falling back to internet');
      }
    }
    const data = await fetchJSON(`/api/flights?lat=${lat}&lon=${lon}&radius=${state.radius}`);
    state.flights = data.flights || [];
    state.source = data.source || '---';
    updateSourceBadge();
    processFlights();
  } catch(err) {
    console.warn('Fetch failed, keeping last state:', err.message);
    document.getElementById('source-badge').textContent = state.source + ' \u26A0';
  }
}

function normalizeLocalData(a) {
  return {
    hex: a.hex || a.icao || '',
    flight: (a.flight || a.callsign || '').trim(),
    lat: a.lat ?? null,
    lon: a.lon ?? null,
    alt_baro: a.alt_baro ?? null,
    alt_geom: a.alt_geom ?? null,
    gs: a.gs ?? null,
    track: a.track ?? null,
    baro_rate: a.baro_rate ?? null,
    squawk: a.squawk ?? null,
    category: a.category ?? null,
    r: a.r || '',
    t: a.t || '',
    ownOp: a.ownOp || '',
    seen: a.seen ?? 0,
    dbFlags: a.dbFlags ?? 0,
    emergency: a.emergency ?? null
  };
}

function processFlights() {
  const pos = state.position;
  if (!pos) return;

  state.flights.forEach(f => {
    if (f.lat != null && f.lon != null) {
      f._distance = haversine(pos.lat, pos.lon, f.lat, f.lon);
      f._bearing = bearing(pos.lat, pos.lon, f.lat, f.lon);
      f._elevation = calcElevation(f.alt_baro, f._distance);
      f._categoryLabel = decodeCategory(f.category);
      if (!state.sessionFlights.has(f.hex)) {
        state.sessionFlights.set(f.hex, { firstSeen: new Date(), flight: f });
      }
      state.sessionFlights.get(f.hex).lastSeen = new Date();
      state.sessionFlights.get(f.hex).flight = f;
    }
  });

  state.flights.sort((a, b) => (a._distance || 9999) - (b._distance || 9999));

  const inRange = state.flights.filter(f => f._distance <= state.radius * NM_TO_KM);
  state.flights = inRange.slice(0, MAX_TRACKED);

  updateStats();
  renderFlightList();
  if (state.currentView === 'radar') updateRadarMap();
  if (state.selectedFlight) updateDetailPanel(state.selectedFlight);
  if (state.selectedFlight && state.currentView === 'radar') updateRadarSidebar();
  updateFlightCount();

  const displayed = getVisibleFlights();
  const callsigns = displayed.map(f => f.flight).filter(Boolean);
  fetchRoutesBatch(callsigns).then(() => {
    updateAirportMarkers();
    if (state.currentView === 'list') renderFlightList();
    if (state.selectedFlight && state.currentView === 'radar') {
      updateRadarSidebar();
    }
  });
}

const SURFACE_CATEGORIES = new Set(['A1', 'D1', 'S1', 'S2', 'S3']);
function isSurfaceFlight(f) {
  if (!f.category) return false;
  const key = typeof f.category === 'number' ? `A${f.category}` : f.category;
  return SURFACE_CATEGORIES.has(key);
}
function getVisibleFlights() {
  const flights = state.hideSurface ? state.flights.filter(f => !isSurfaceFlight(f)) : state.flights;
  return flights.slice(0, MAX_DISPLAYED);
}

function calcElevation(altFt, distKm) {
  if (altFt == null || !distKm || distKm < 0.1) return 0;
  const altKm = altFt * FT_TO_M / 1000;
  return radToDeg(Math.atan2(altKm, distKm));
}

function decodeCategory(cat) {
  if (!cat) return '';
  const categories = {
    'A0':'No info','A1':'Surface','A2':'Light','A3':'Small',
    'A4':'Large','A5':'High vortex','A6':'Heavy','A7':'Rotorcraft',
    'B0':'No info','B1':'Glider','B2':'Lighter-than-air',
    'B3':'Parachutist','B4':'Drop plane','B5':'Ultralight',
    'C0':'No info','C1':'Powered lift','C2':'Jet',
    'C3':'Unknown','C4':'Helicopter','C5':'Glider','C6':'Lighter-than-air',
    'D0':'No info','D1':'Surface','D2':'Emergency',
    'L1':'Landplane single engine','L2':'Landplane multi engine',
    'L3':'Amphibian single','L4':'Amphibian multi',
    'L5':'Helicopter','L6':'Glider','L7':'Lighter-than-air',
    'S1':'Surface ship','S2':'Emergency surface','S3':'Surface support'
  };
  const key = typeof cat === 'number' ? `A${cat}` : cat;
  return categories[key] || cat;
}

function getCategoryIcon(cat) {
  if (!cat) return 'cat-a2';
  const key = typeof cat === 'number' ? `A${cat}` : cat;
  return `cat-${key.toLowerCase()}`;
}

function updateSourceBadge() {
  document.getElementById('source-badge').textContent = state.source;
}

function updateFlightCount() {
  const visible = getVisibleFlights();
  document.getElementById('flight-count').textContent = `${visible.length} / ${state.flights.length} ${t('list.trackCount')}`;
}

function getFlightCallsign(f) {
  return f.flight || f.hex.toUpperCase();
}

async function fetchRoute(callsign) {
  const key = (callsign || '').trim().toUpperCase();
  if (!key) return null;
  if (state.routeCache[key] !== undefined) {
    console.log('[ROUTE] cache hit', key, state.routeCache[key]);
    return state.routeCache[key];
  }
  try {
    const data = await fetchJSON(`/api/route/${key}`);
    console.log('[ROUTE] fetched', key, data);
    state.routeCache[key] = data;
    return data;
  } catch (e) {
    console.log('[ROUTE] fetch error', key, e);
    state.routeCache[key] = null;
    return null;
  }
}

async function fetchRoutesBatch(callsigns) {
  const toFetch = callsigns.filter(cs => {
    const key = (cs || '').trim().toUpperCase();
    return key && state.routeCache[key] === undefined;
  });
  if (toFetch.length === 0) return;
  try {
    const data = await fetchJSON(`/api/routes-batch?callsigns=${toFetch.join(',')}`);
    toFetch.forEach(cs => {
      const key = cs.trim().toUpperCase();
      state.routeCache[key] = data[key] || null;
    });
  } catch {}
}

function getRouteDisplay(f) {
  const key = (f.flight || '').trim().toUpperCase();
  const r = state.routeCache[key];
  if (!r) return null;
  const from = r.origin?.iata || r.origin?.icao || null;
  const to = r.destination?.iata || r.destination?.icao || null;
  if (!from && !to) return null;
  return { from, to, origin: r.origin, destination: r.destination };
}

function updateAirportMarkers() {
  if (!state.layerAirports) return;
  state.layerAirports.clearLayers();
  if (!state.map) return;

  const seen = new Set();
  const displayed = getVisibleFlights();

  displayed.forEach(f => {
    const key = (f.flight || '').trim().toUpperCase();
    const route = state.routeCache[key];
    if (!route) return;

    const airports = [route.origin, route.destination].filter(a => a?.lat != null && a?.lon != null);
    airports.forEach(a => {
      const id = a.icao || a.iata;
      if (!id || seen.has(id)) return;
      seen.add(id);
      const label = a.iata ? `${a.iata}: ${a.name}` : (a.name || a.icao || '');
      L.marker([a.lat, a.lon], {
        icon: L.divIcon({
          className: 'radar-airport-marker',
          html: `<div style="width:7px;height:7px;background:#facc15;border:2px solid #fff;border-radius:50%;box-shadow:0 0 4px rgba(0,0,0,.4)"></div>`,
          iconSize: [7, 7], iconAnchor: [3.5, 3.5]
        })
      }).addTo(state.layerAirports).bindPopup(label);
    });
  });
}

function getSortValue(f, key) {
  switch (key) {
    case 'callsign': return (f.flight || f.hex || '').trim().toUpperCase();
    case 'route': {
      const rd = getRouteDisplay(f);
      return (rd?.to || '').toUpperCase();
    }
    case 'airline': return (getAirlineInfo(f).name || '').toLowerCase();
    case 'type': return (f.t || '').toLowerCase();
    case 'category': return (f._categoryLabel || '').toLowerCase();
    case 'altitude': return f.alt_baro == null || f.alt_baro === 'ground' ? -1 : f.alt_baro;
    case 'speed': return f.gs ?? -1;
    case 'distance': return f._distance ?? 99999;
    case 'heading': return f.track ?? -1;
    default: return 0;
  }
}

function sortFlights(flights) {
  const key = state.sortKey;
  if (!key) return flights;
  const asc = state.sortAsc;
  return [...flights].sort((a, b) => {
    const va = getSortValue(a, key);
    const vb = getSortValue(b, key);
    if (typeof va === 'string') return asc ? va.localeCompare(vb) : vb.localeCompare(va);
    return asc ? va - vb : vb - va;
  });
}

function getAirlineInfo(f) {
  const name = getAirlineName(f.ownOp, f.flight);
  const icao = (f.flight || '').substring(0, 3);
  return { name, icao };
}

function renderFlightList() {
  const tbody = document.getElementById('flight-list-body');
  const displayed = sortFlights(getVisibleFlights());

  if (displayed.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--fg3)">${t('list.noFlights')}</td></tr>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  displayed.forEach(f => {
    const airline = getAirlineInfo(f);
    const altDir = f.baro_rate > 100 ? 'up' : f.baro_rate < -100 ? 'down' : 'level';
    const arrowChar = altDir === 'up' ? '\u25B2' : altDir === 'down' ? '\u25BC' : '\u2500';

    const row = h('tr', {
      class: `flight-row${state.selectedFlight?.hex === f.hex ? ' selected' : ''}`,
      onClick: () => selectFlight(f)
    });

    const logoTd = h('td');
    const logoDiv = h('div', { class: 'airline-logo-cell' });
    const img = h('img', { alt: airline.name, src: '' });
    img.onerror = function() { this.style.display='none'; logoDiv.appendChild(h('span', { class:'fallback-icon', text: (airline.icao || '?').substring(0,2) })); };
    img.src = getAirlineLogo(f.flight, f.r);
    logoDiv.appendChild(img);
    logoTd.appendChild(logoDiv);

    row.innerHTML = '';
    row.appendChild(logoTd);

    const callsignTd = h('td', { class:'callsign-cell callsign-link', text: getFlightCallsign(f) });
    callsignTd.addEventListener('click', (e) => {
      e.stopPropagation();
      selectFlight(f);
      switchView('radar');
    });
    row.appendChild(callsignTd);

    const routeDisplay = getRouteDisplay(f);
    const routeTd = h('td', { class:'route-cell' });
    if (routeDisplay) {
      routeTd.textContent = `${routeDisplay.from} \u2192 ${routeDisplay.to}`;
    } else {
      routeTd.textContent = '---';
    }
    row.appendChild(routeTd);

    row.appendChild(h('td', { text: airline.name }));
    row.appendChild(h('td', { text: f.t || '---', title: f.t }));
    row.appendChild(h('td', { text: f._categoryLabel || '---' }));
    row.appendChild(h('td', { class:'alt-cell', html: `<span class="alt-arrow alt-${altDir}">${arrowChar}</span> ${formatAltitude(f.alt_baro, state.units)}` }));
    row.appendChild(h('td', { class:'speed-cell', text: formatSpeed(f.gs, state.units) }));
    row.appendChild(h('td', { class:'distance-cell', text: f._distance != null ? formatRange(f._distance) : '---' }));
    row.appendChild(h('td', { text: f.track != null ? `${Math.round(f.track)}\u00B0 ${bearingToCardinal(f.track)}` : '---' }));

    fragment.appendChild(row);
  });

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}

function selectFlight(f) {
  const prevHex = state.selectedFlight?.hex;
  state.selectedFlight = f;
  renderFlightList();
  showSpotterPanel(f);
  updateCompass(f.track);
  if (state.currentView === 'radar') {
    showRadarSidebar(f);
    highlightRadarMarker(prevHex, f.hex);
    updateRadarRoute();
  }
  centerMapOnFlight(f);

  if (f.flight) {
    console.log('[SELECT] fetching route for', f.flight);
    fetchRoute(f.flight).then(route => {
      console.log('[SELECT] route resolved', route);
      if (state.selectedFlight?.hex === f.hex) {
        if (state.currentView === 'radar') {
          updateRadarSidebar();
          updateRadarRoute();
        }
        renderFlightList();
      }
    });
  }
}

function highlightRadarMarker(prevHex, newHex) {
  if (!state.map) return;
  if (prevHex && prevHex !== newHex) {
    const prevF = state.flights.find(fl => fl.hex === prevHex);
    const prevMarker = state.radarMarkers[prevHex];
    if (prevMarker && prevF) {
      prevMarker.setIcon(createPlaneIcon(prevF, false));
      prevMarker.setZIndexOffset(0);
    }
  }
  if (newHex) {
    const newF = state.flights.find(fl => fl.hex === newHex);
    const newMarker = state.radarMarkers[newHex];
    if (newMarker && newF) {
      newMarker.setIcon(createPlaneIcon(newF, true));
      newMarker.setZIndexOffset(1000000);
    }
  }
}

function centerMapOnFlight(f) {
  if (!state.map || !f.lat || !f.lon) return;
  requestAnimationFrame(() => {
    const sidebar = document.getElementById('radar-sidebar');
    const mapEl = state.map.getContainer();
    const mapRect = mapEl.getBoundingClientRect();
    let offsetX = 0;
    let offsetY = 0;
    if (sidebar && !sidebar.classList.contains('hidden')) {
      const sbRect = sidebar.getBoundingClientRect();
      const sbCenterX = (sbRect.left + sbRect.right) / 2;
      const mapCenterX = (mapRect.left + mapRect.right) / 2;
      const sbCenterY = (sbRect.top + sbRect.bottom) / 2;
      const mapCenterY = (mapRect.top + mapRect.bottom) / 2;
      if (sbCenterX > mapCenterX) offsetX = sbRect.width / 2;
      else if (sbCenterX < mapCenterX) offsetX = -sbRect.width / 2;
      if (sbCenterY > mapCenterY) offsetY = sbRect.height / 2;
      else if (sbCenterY < mapCenterY) offsetY = -sbRect.height / 2;
    }
    const size = state.map.getSize();
    const targetPx = [size.x / 2 - offsetX, size.y / 2 - offsetY];
    const planePx = state.map.latLngToContainerPoint([f.lat, f.lon]);
    state.map.panBy([planePx.x - targetPx[0], planePx.y - targetPx[1]], { animate: true });
  });
}


function showSpotterPanel(f) {
  const panel = document.getElementById('spotter-panel');
  panel.classList.remove('hidden');

  const airline = getAirlineInfo(f);

  document.getElementById('spotter-callsign').textContent = getFlightCallsign(f);
  document.getElementById('spotter-route').textContent = `${airline.name} ${f.t ? '(' + f.t + ')' : ''}`;

  const logoEl = document.getElementById('spotter-airline-logo');
  logoEl.innerHTML = '';
  const img = h('img', { alt: airline.name });
  img.onerror = function() { this.style.display='none'; logoEl.appendChild(h('span', { text: (airline.icao || '?').substring(0,2) })); };
  img.src = getAirlineLogo(f.flight, f.r);
  logoEl.appendChild(img);

  drawSpotterCompass(f._bearing || 0, f._elevation || 0);

  const pred = predictFlyover(f);
  const predEl = document.getElementById('spotter-prediction');
  if (pred) {
    predEl.textContent = `${t('spotter.flyover')} ~${pred.minutes} ${t('spotter.minutes')} ${t('spotter.at')} ${pred.distance} ${state.units === 'metric' ? 'km' : 'mi'}`;
    predEl.classList.remove('hidden');
  } else {
    predEl.classList.add('hidden');
  }

  const details = document.getElementById('spotter-details');
  details.innerHTML = [
    `${t('spotter.bearing')}: ${Math.round(f._bearing || 0)}\u00B0 ${bearingToCardinal(f._bearing || 0)}`,
    `${t('spotter.elevation')}: ${(f._elevation || 0).toFixed(1)}\u00B0`,
    `${t('spotter.distance')}: ${f._distance != null ? formatDistance(f._distance) : '---'}`,
    `${t('details.altitude')}: ${formatAltitude(f.alt_baro, state.units)}`,
    `${t('details.speed')}: ${formatSpeed(f.gs, state.units)}`
  ].join(' \u2022 ');
}

function showRadarSidebar(f) {
  const sidebar = document.getElementById('radar-sidebar');
  sidebar.classList.remove('hidden');

  const airline = getAirlineInfo(f);
  const callsign = getFlightCallsign(f);

  document.getElementById('rsb-callsign').textContent = callsign;
  document.getElementById('rsb-airline').textContent = `${airline.name} ${f.t ? '(' + f.t + ')' : ''}`;

  const routeEl = document.getElementById('rsb-route');
  const routeDisplay = getRouteDisplay(f);
  const fromIcao = routeDisplay?.origin?.icao || f.origin?.icao || '';
  const fromName = routeDisplay?.origin?.name || f.origin?.name || fromIcao || '---';
  const toIcao = routeDisplay?.destination?.icao || f.destination?.icao || '';
  const toName = routeDisplay?.destination?.name || f.destination?.name || toIcao || '---';
  routeEl.innerHTML = `
    <div class="rsb-route-from"><span class="rsb-route-icao">${fromIcao || '---'}</span><span class="rsb-route-city">${fromName}</span></div>
    <span class="rsb-route-arrow">\u2708\uFE0F \u2192</span>
    <div class="rsb-route-to"><span class="rsb-route-icao">${toIcao || '---'}</span><span class="rsb-route-city">${toName}</span></div>
  `;

  document.getElementById('rsb-type').textContent = f.t || '---';
  document.getElementById('rsb-reg').textContent = f.r || '---';
  document.getElementById('rsb-alt').textContent = formatAltitude(f.alt_baro, state.units);
  document.getElementById('rsb-speed').textContent = formatSpeed(f.gs, state.units);
  document.getElementById('rsb-heading').textContent = f.track != null ? `${Math.round(f.track)}\u00B0 ${bearingToCardinal(f.track)}` : '---';
  document.getElementById('rsb-squawk').textContent = f.squawk || '---';
  document.getElementById('rsb-category').textContent = f._categoryLabel || f.category || '---';
  document.getElementById('rsb-icao').textContent = f.hex || '---';
  document.getElementById('rsb-distance').textContent = f._distance != null ? formatDistance(f._distance) : '---';
  document.getElementById('rsb-bearing').textContent = f._bearing != null ? `${Math.round(f._bearing)}\u00B0 ${bearingToCardinal(f._bearing)}` : '---';

  drawSidebarCompass(f._bearing || 0, f._elevation || 0);

  const groundDist = f._distance != null ? (state.rangeUnit === 'km' ? (f._distance >= 10 ? Math.round(f._distance) + ' km' : f._distance.toFixed(2) + ' km') : ((f._distance / NM_TO_KM) >= 10 ? Math.round(f._distance / NM_TO_KM) + ' NM' : (f._distance / NM_TO_KM).toFixed(2) + ' NM')) : '---';
  document.getElementById('rsb-ground-dist').textContent = `Ground distance: ${groundDist}`;

  const pred = predictFlyover(f);
  const predEl = document.getElementById('rsb-prediction');
  if (pred) {
    predEl.textContent = `${t('spotter.flyover')} ~${pred.minutes} ${t('spotter.minutes')} ${t('spotter.at')} ${pred.distance}`;
  } else {
    predEl.textContent = '';
  }
}

function drawSidebarCompass(bearingDeg, elevationDeg) {
  const svg = document.getElementById('rsb-compass');
  const cx = 100, cy = 100, r = 85;
  let html = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border2)" stroke-width="2"/>`;
  for (let i = 0; i < 360; i += 30) {
    const rad = degToRad(i - 90);
    const x1 = cx + (r-6)*Math.cos(rad), y1 = cy + (r-6)*Math.sin(rad);
    const x2 = cx + r*Math.cos(rad), y2 = cy + r*Math.sin(rad);
    html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--fg3)" stroke-width="1"/>`;
  }
  const needleRad = degToRad(bearingDeg - 90);
  const nx = cx + 60*Math.cos(needleRad), ny = cy + 60*Math.sin(needleRad);
  html += `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="var(--danger)" stroke-width="3" stroke-linecap="round"/>`;
  html += `<circle cx="${cx}" cy="${cy}" r="4" fill="var(--accent)"/>`;
  ['N','E','S','W'].forEach((d,i) => {
    const angle = i * 90 - 90;
    const rad = degToRad(angle);
    const tx = cx + (r-18)*Math.cos(rad), ty = cy + (r-18)*Math.sin(rad);
    html += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" fill="var(--fg2)" font-size="10" font-weight="600">${d}</text>`;
  });
  svg.innerHTML = html;
}

function hideRadarSidebar() {
  const prevHex = state.selectedFlight?.hex;
  state.selectedFlight = null;
  document.getElementById('radar-sidebar').classList.add('hidden');
  highlightRadarMarker(prevHex, null);
  clearRadarRoute();
  renderFlightList();
}

function updateRadarSidebar() {
  if (!state.selectedFlight) return;
  const f = state.flights.find(flight => flight.hex === state.selectedFlight.hex);
  if (f) showRadarSidebar(f);
}

function clearRadarRoute() {
  if (state.radarRouteLayer) {
    state.map.removeLayer(state.radarRouteLayer);
    state.radarRouteLayer = null;
  }
}

async function updateRadarRoute() {
  if (!state.map) return;
  clearRadarRoute();
  if (!state.openskyRouteData || !state.selectedFlight || state.currentView !== 'radar') return;

  const f = state.selectedFlight;
  const layer = L.layerGroup().addTo(state.map);
  state.radarRouteLayer = layer;

  const key = (f.flight || '').trim().toUpperCase();
  const route = state.routeCache[key];

  if (route?.origin?.lat != null && route.origin.lon != null) {
    const label = route.origin.iata ? `${route.origin.iata}: ${route.origin.name}` : (route.origin.name || route.origin.icao || '');
    L.marker([route.origin.lat, route.origin.lon], {
      icon: L.divIcon({ className:'radar-airport-marker', html:'<div style="width:8px;height:8px;background:var(--success);border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px var(--success)"></div>', iconSize:[8,8], iconAnchor:[4,4] })
    }).addTo(layer).bindPopup(label);
  }

  if (route?.destination?.lat != null && route.destination.lon != null) {
    const label = route.destination.iata ? `${route.destination.iata}: ${route.destination.name}` : (route.destination.name || route.destination.icao || '');
    L.marker([route.destination.lat, route.destination.lon], {
      icon: L.divIcon({ className:'radar-airport-marker', html:'<div style="width:8px;height:8px;background:var(--danger);border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px var(--danger)"></div>', iconSize:[8,8], iconAnchor:[4,4] })
    }).addTo(layer).bindPopup(label);
  }

  if (route?.origin?.lat != null && route.origin.lon != null && route.destination?.lat != null && route.destination.lon != null) {
    L.polyline([[route.origin.lat, route.origin.lon], [route.destination.lat, route.destination.lon]], {
      color: THEME_COLORS[state.theme] || '#3b82f6',
      weight: 2, dashArray: '8,6', opacity: 0.4
    }).addTo(layer);
  }

  try {
    const openskyUrl = `/api/opensky-track/${f.hex}?client_id=${encodeURIComponent(state.openskyClientId)}&client_secret=${encodeURIComponent(state.openskyClientSecret)}`;
    const data = await fetchJSON(openskyUrl);
    if (state.selectedFlight?.hex !== f.hex || state.currentView !== 'radar') return;
    if (data?.trail?.length >= 2) {
      const coords = data.trail.map(p => [p.lat, p.lon]);
      L.polyline(coords, {
        color: THEME_COLORS[state.theme] || '#3b82f6',
        weight: 3, opacity: 0.85
      }).addTo(layer);
    }
  } catch (e) {}
}

function drawSpotterCompass(bearingDeg, elevationDeg) {
  const svg = document.getElementById('spotter-compass');
  const cx = 100, cy = 100, r = 85;
  let html = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border2)" stroke-width="2"/>`;
  for (let i = 0; i < 360; i += 30) {
    const rad = degToRad(i - 90);
    const x1 = cx + (r-6)*Math.cos(rad), y1 = cy + (r-6)*Math.sin(rad);
    const x2 = cx + r*Math.cos(rad), y2 = cy + r*Math.sin(rad);
    html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--fg3)" stroke-width="1"/>`;
  }
  const needleRad = degToRad(bearingDeg - 90);
  const nx = cx + 60*Math.cos(needleRad), ny = cy + 60*Math.sin(needleRad);
  html += `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="var(--danger)" stroke-width="3" stroke-linecap="round"/>`;
  html += `<circle cx="${cx}" cy="${cy}" r="4" fill="var(--accent)"/>`;

  ['N','E','S','W'].forEach((d,i) => {
    const angle = i * 90 - 90;
    const rad = degToRad(angle);
    const tx = cx + (r-18)*Math.cos(rad), ty = cy + (r-18)*Math.sin(rad);
    html += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" fill="var(--fg2)" font-size="10" font-weight="600">${d}</text>`;
  });

  svg.innerHTML = html;
  document.getElementById('spotter-elevation-label').textContent = `${elevationDeg.toFixed(1)}\u00B0`;
}

function predictFlyover(f) {
  if (!f.lat || !f.lon || !f.gs || !f.track || !state.position) return null;
  const distKm = f._distance;
  const speedKmh = f.gs * KTS_TO_KMH;
  if (speedKmh < 50 || distKm > 500) return null;

  const trackRad = degToRad(f.track);
  const myBearing = degToRad(f._bearing + 180);
  const angle = Math.abs(trackRad - myBearing);
  const crossAngle = Math.min(angle, Math.PI * 2 - angle);

  if (crossAngle > Math.PI / 3) return null;

  const minDistKm = distKm * Math.sin(crossAngle);
  const timeToMin = (distKm * Math.cos(crossAngle)) / speedKmh;
  const minutes = Math.round(timeToMin * 60);

  if (minutes < 0 || minutes > 60) return null;

  return { minutes, distance: formatDistance(minDistKm) };
}

function showDetailPanel(f) {
  document.getElementById('view-list').classList.remove('active');
  document.getElementById('view-details').classList.add('active');
  document.getElementById('view-radar').classList.remove('active');
  document.getElementById('view-stats').classList.remove('active');
  state.currentView = 'details';
  updateDetailPanel(f);
}

function updateDetailPanel(f) {
  const airline = getAirlineInfo(f);
  document.getElementById('detail-callsign').textContent = getFlightCallsign(f);
  document.getElementById('detail-airline').textContent = airline.name;
  document.getElementById('detail-type').textContent = f.t || '---';
  document.getElementById('detail-reg').textContent = f.r || '---';
  document.getElementById('detail-alt').textContent = formatAltitude(f.alt_baro, state.units);
  document.getElementById('detail-speed').textContent = formatSpeed(f.gs, state.units);
  document.getElementById('detail-heading').textContent = f.track != null ? `${Math.round(f.track)}\u00B0 ${bearingToCardinal(f.track)}` : '---';
  document.getElementById('detail-squawk').textContent = f.squawk || '---';
  document.getElementById('detail-category').textContent = f._categoryLabel || f.category || '---';
  document.getElementById('detail-icao').textContent = f.hex || '---';
  document.getElementById('detail-eta').textContent = '---';

  const logoWrap = document.getElementById('detail-airline-logo');
  logoWrap.src = getAirlineLogo(f.flight, f.r);
  logoWrap.alt = getAirlineInfo(f).name || 'Airline logo';
  logoWrap.onerror = function() { this.src = ''; };

  document.getElementById('detail-from-city').textContent = f.origin?.name || f.origin?.icao || '---';
  document.getElementById('detail-from-icao').textContent = f.origin?.icao || '';
  document.getElementById('detail-from-time').textContent = f.origin?.timezone ? new Date().toLocaleTimeString(state.lang === 'pl' ? 'pl-PL' : 'en-GB', { timeZone: f.origin.timezone, hour:'2-digit', minute:'2-digit' }) : '';
  document.getElementById('detail-to-city').textContent = f.destination?.name || f.destination?.icao || '---';
  document.getElementById('detail-to-icao').textContent = f.destination?.icao || '';
  document.getElementById('detail-to-time').textContent = f.destination?.timezone ? new Date().toLocaleTimeString(state.lang === 'pl' ? 'pl-PL' : 'en-GB', { timeZone: f.destination.timezone, hour:'2-digit', minute:'2-digit' }) : '';

  if (f.flagImg) {
    document.getElementById('detail-flag-from').src = f.flagImg.from;
    document.getElementById('detail-flag-from').alt = f.origin?.icao || 'Origin flag';
    document.getElementById('detail-flag-to').src = f.flagImg.to;
    document.getElementById('detail-flag-to').alt = f.destination?.icao || 'Destination flag';
  }

  const progressFill = document.getElementById('detail-progress-fill');
  const progressPct = document.getElementById('detail-progress-pct');
  progressFill.style.width = '0%';
  progressPct.textContent = '';

  if (f.lat && f.lon && f.origin?.lat && f.origin?.lon && f.destination?.lat && f.destination?.lon) {
    const totalDist = haversine(f.origin.lat, f.origin.lon, f.destination.lat, f.destination.lon);
    const flownDist = haversine(f.origin.lat, f.origin.lon, f.lat, f.lon);
    const pct = Math.min(100, Math.max(0, (flownDist / totalDist) * 100));
    progressFill.style.width = `${pct}%`;
    progressPct.textContent = `${Math.round(pct)}%`;
  }

  initDetailRouteMap(f);
}

function initDetailRouteMap(f) {
  const container = document.getElementById('detail-route-map');
  if (state.detailMap) { state.detailMap.remove(); state.detailMap = null; }

  state.detailMap = L.map(container, { zoomControl:false, attributionControl:false }).setView([f.lat || 50, f.lon || 14], 6);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom:18 }).addTo(state.detailMap);

  const coords = [];
  if (f.lat && f.lon) coords.push([f.lat, f.lon]);
  if (f.origin?.lat && f.origin?.lon) {
    coords.push([f.origin.lat, f.origin.lon]);
    L.marker([f.origin.lat, f.origin.lon], {
      icon: L.divIcon({ className:'airport-marker', html:'<div style="color:var(--success);font-size:16px">&#9992;</div>' })
    }).addTo(state.detailMap).bindPopup(f.origin.icao || '');
  }
  if (f.destination?.lat && f.destination?.lon) {
    coords.push([f.destination.lat, f.destination.lon]);
    L.marker([f.destination.lat, f.destination.lon], {
      icon: L.divIcon({ className:'airport-marker', html:'<div style="color:var(--danger);font-size:16px">&#9992;</div>' })
    }).addTo(state.detailMap).bindPopup(f.destination.icao || '');
  }

  if (coords.length >= 2) {
    L.polyline(coords, { color: THEME_COLORS[state.theme] || '#3b82f6', weight:2, dashArray:'8,6', opacity:0.8 }).addTo(state.detailMap);

    if (f.lat && f.lon) {
      const iconId = getCategoryIcon(f.category);
      const planeIcon = L.divIcon({
        className:'plane-marker',
        html:`<svg class="map-icon" width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" style="color:var(--accent);transform:rotate(${f.track || 0}deg)"><use href="icons.svg#${iconId}"/></svg>`
      });
      L.marker([f.lat, f.lon], { icon:planeIcon }).addTo(state.detailMap);
    }

    const bounds = L.latLngBounds(coords);
    if (f.lat && f.lon) bounds.extend([f.lat, f.lon]);
    state.detailMap.fitBounds(bounds.pad(0.2));
  }
}

function initRadarMap() {
  const container = document.getElementById('radar-map');
  if (state.map) return;

  state.map = L.map(container, {
    zoomControl: false, attributionControl: false,
    center: state.position ? [state.position.lat, state.position.lon] : [50, 14],
    zoom: 8
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; OpenStreetMap' }).addTo(state.map);

  L.control.zoom({ position: 'topright' }).addTo(state.map);

  if (state.position) {
    state.myLocationMarker = L.marker([state.position.lat, state.position.lon], {
      icon: L.divIcon({
        className:'my-location-marker',
        html:'<div style="width:12px;height:12px;background:var(--accent);border:2px solid white;border-radius:50%;box-shadow:0 0 10px var(--accent)"></div>'
      })
    }).addTo(state.map).bindPopup(t('radar.yourLocation'));
  }

  state.layerAirports = L.layerGroup().addTo(state.map);

  if (state.position) {
    state.radarCircle = L.circle([state.position.lat, state.position.lon], {
      radius: state.radius * NM_TO_KM * 1000,
      color: THEME_COLORS[state.theme] || '#3b82f6',
      fillColor: THEME_COLORS[state.theme] || '#3b82f6',
      fillOpacity: 0.03,
      weight: 1, dashArray: '6,4'
    }).addTo(state.map);
  }

  state.layerPlanes = L.layerGroup().addTo(state.map);

  state.map.on('click', () => {
    const prevHex = state.selectedFlight?.hex;
    state.selectedFlight = null;
    hideRadarSidebar();
    highlightRadarMarker(prevHex, null);
    clearRadarRoute();
    renderFlightList();
  });
}

function updateRadarMap() {
  if (!state.map) return;
  if (state.position && state.radarCircle) {
    state.radarCircle.setRadius(state.radius * NM_TO_KM * 1000);
  }

  const currentHexes = new Set();
  const radarFlights = state.hideSurface ? state.flights.filter(f => !isSurfaceFlight(f)) : state.flights;
  radarFlights.forEach(f => {
    if (f.lat == null || f.lon == null) return;
    currentHexes.add(f.hex);

    if (state.radarMarkers[f.hex]) {
      state.radarMarkers[f.hex].setLatLng([f.lat, f.lon]);
      const isSelected = state.selectedFlight?.hex === f.hex;
      state.radarMarkers[f.hex].setIcon(createPlaneIcon(f, isSelected));
      state.radarMarkers[f.hex].setZIndexOffset(isSelected ? 1000000 : 0);
    } else {
      const isSelected = state.selectedFlight?.hex === f.hex;
      const marker = L.marker([f.lat, f.lon], {
        icon: createPlaneIcon(f, isSelected),
        zIndexOffset: isSelected ? 1000000 : 0
      }).addTo(state.layerPlanes);
      marker.on('click', () => selectFlight(f));
      state.radarMarkers[f.hex] = marker;
    }

    if (!state.radarTrails[f.hex]) state.radarTrails[f.hex] = [];
    state.radarTrails[f.hex].push([f.lat, f.lon]);
    if (state.radarTrails[f.hex].length > 20) state.radarTrails[f.hex].shift();
  });

  Object.keys(state.radarMarkers).forEach(hex => {
    if (!currentHexes.has(hex)) {
      state.map.removeLayer(state.radarMarkers[hex]);
      delete state.radarMarkers[hex];
    }
  });

  document.getElementById('radar-flight-count').textContent = `${state.flights.length} aircraft`;
  document.getElementById('radar-source').textContent = state.source;
}

function updateStats() {
  const flights = state.flights;
  document.getElementById('stat-total').textContent = flights.length;
  document.getElementById('stat-unique').textContent = state.sessionFlights.size;

  const alts = flights.map(f => f.alt_baro).filter(a => a != null && a !== 'ground');
  document.getElementById('stat-avg-alt').textContent = alts.length > 0
    ? formatAltitude(Math.round(alts.reduce((a,b) => a+b, 0) / alts.length), state.units)
    : '---';

  const speeds = flights.map(f => f.gs).filter(s => s != null);
  document.getElementById('stat-max-speed').textContent = speeds.length > 0
    ? formatSpeed(Math.max(...speeds), state.units)
    : '---';

  const now = new Date();
  const hourKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
  state.sessionHourly[hourKey] = (state.sessionHourly[hourKey] || 0) + 1;
  drawHourlyChart();
  drawTopAirlines();
  drawDailyRecords();
  updateSessionInfo();
}

function drawHourlyChart() {
  const canvas = document.getElementById('hourly-chart');
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width - 32;
  canvas.height = 120;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const now = new Date();
  const hours = [];
  for (let i = 23; i >= 0; i--) {
    const h = new Date(now - i * 3600000);
    const key = `${h.getFullYear()}-${h.getMonth()}-${h.getDate()}-${h.getHours()}`;
    hours.push({ label: `${h.getHours()}:00`, value: state.sessionHourly[key] || 0 });
  }

  const maxVal = Math.max(1, ...hours.map(h => h.value));
  const barW = (canvas.width - 40) / 24;

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg3').trim() || '#64748b';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';

  hours.forEach((h, i) => {
    const x = 30 + i * barW;
    const barH = (h.value / maxVal) * (canvas.height - 30);
    const y = canvas.height - 20 - barH;

    ctx.fillStyle = THEME_COLORS[state.theme] || '#3b82f6';
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x + 2, y, barW - 4, barH);
    ctx.globalAlpha = 1;

    if (i % 4 === 0) {
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg3').trim() || '#64748b';
      ctx.fillText(h.label, x + barW / 2, canvas.height - 6);
    }
  });
}

function drawTopAirlines() {
  const container = document.getElementById('top-airlines');
  const counts = {};
  state.sessionFlights.forEach(({ flight: f }) => {
    const name = getAirlineName(f.ownOp, f.flight);
    if (name && name !== '---') counts[name] = (counts[name] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]).slice(0, 8);
  const maxCount = sorted[0]?.[1] || 1;

  container.innerHTML = sorted.map(([name, count], i) =>
    `<div class="airline-rank"><span class="rank-num">${i+1}</span><span style="flex:1;font-size:12px">${name}</span><div class="rank-bar" style="width:${(count/maxCount)*80}px"></div><span style="font-size:11px;color:var(--fg3)">${count}</span></div>`
  ).join('') || '<div style="color:var(--fg3);font-size:12px">---</div>';
}

function drawDailyRecords() {
  const container = document.getElementById('daily-records');
  const records = [];

  const maxFlights = Math.max(...Object.values(state.sessionHourly).map(v => v), 0);
  records.push({ label: 'Max/hr', value: maxFlights });

  let maxSpeedVal = 0, maxSpeedFlight = null;
  state.sessionFlights.forEach(({ flight: f }) => { if (f.gs && f.gs > maxSpeedVal) { maxSpeedVal = f.gs; maxSpeedFlight = f; } });
  if (maxSpeedVal) {
    const airline = maxSpeedFlight ? getAirlineInfo(maxSpeedFlight).name : '';
    const callsign = maxSpeedFlight ? getFlightCallsign(maxSpeedFlight) : '---';
    records.push({ label: 'Max speed', value: formatSpeed(maxSpeedVal, state.units), detail: `${callsign} \u2022 ${airline}` });
  }

  let maxAltVal = 0, maxAltFlight = null;
  state.sessionFlights.forEach(({ flight: f }) => { if (f.alt_baro && f.alt_baro !== 'ground' && f.alt_baro > maxAltVal) { maxAltVal = f.alt_baro; maxAltFlight = f; } });
  if (maxAltVal) {
    const airline = maxAltFlight ? getAirlineInfo(maxAltFlight).name : '';
    const callsign = maxAltFlight ? getFlightCallsign(maxAltFlight) : '---';
    records.push({ label: 'Max alt', value: formatAltitude(maxAltVal, state.units), detail: `${callsign} \u2022 ${airline}` });
  }

  records.push({ label: 'Total tracked', value: state.sessionFlights.size });

  container.innerHTML = records.map(r =>
    `<div class="record-item"><span style="color:var(--fg3)">${r.label}</span><span style="font-weight:600;font-family:var(--font-mono)">${r.value}</span>${r.detail ? `<span class="record-detail">${r.detail}</span>` : ''}</div>`
  ).join('');
}

function updateSessionInfo() {
  const start = state.sessionStart;
  document.getElementById('stat-session-start').textContent = start.toLocaleTimeString(state.lang === 'pl' ? 'pl-PL' : 'en-GB', { hour:'2-digit', minute:'2-digit' });

  const durMs = Date.now() - start.getTime();
  const durMin = Math.floor(durMs / 60000);
  const durH = Math.floor(durMin / 60);
  const remMin = durMin % 60;
  document.getElementById('stat-duration').textContent = durH > 0
    ? `${durH} ${t('stats.hours')} ${remMin} ${t('stats.minutes')}`
    : `${durMin} ${t('stats.minutes')}`;
}

async function fetchMETAR() {
  if (!state.position) return;
  try {
    const data = await fetchJSON(`/api/metar?lat=${state.position.lat}&lon=${state.position.lon}`);
    const list = Array.isArray(data) ? data : (data.data || data.metar || []);
    if (list.length > 0) {
      const metar = list[0];
      state.metarData = metar;
      document.getElementById('metar-display').textContent = metar.rawOb || metar.raw_text || metar.raw_METAR || JSON.stringify(metar).substring(0, 200);
    } else {
      document.getElementById('metar-display').textContent = t('weather.notAvailable');
    }
  } catch(e) {
    console.warn('METAR fetch error:', e.message);
    document.getElementById('metar-display').textContent = t('weather.notAvailable');
  }
}

function switchView(view) {
  if (view === 'radar') initRadarMap();
  if (view !== 'radar') hideRadarSidebar();

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  state.currentView = view;

  if (view === 'radar') { updateRadarMap(); setTimeout(() => { state.map?.invalidateSize(); if (state.selectedFlight) centerMapOnFlight(state.selectedFlight); }, 100); }
  if (view === 'stats') { drawHourlyChart(); fetchMETAR(); }
  if (view === 'list') renderFlightList();
}

function startRefresh() {
  state.refreshTimer = setInterval(fetchFlights, state.refreshRate * 1000);
}

function restartRefresh() {
  clearInterval(state.refreshTimer);
  startRefresh();
}

function updateSortIndicators() {
  document.querySelectorAll('#flight-table th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (arrow) arrow.remove();
    if (th.dataset.sort === state.sortKey) {
      th.insertAdjacentHTML('beforeend', `<span class="sort-arrow">${state.sortAsc ? '\u25B2' : '\u25BC'}</span>`);
    }
  });
}

function initNavigation() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  document.querySelectorAll('#flight-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) {
        state.sortAsc = !state.sortAsc;
      } else {
        state.sortKey = key;
        state.sortAsc = true;
      }
      updateSortIndicators();
      renderFlightList();
    });
  });
  updateSortIndicators();

  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-overlay').classList.remove('hidden');
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('settings-overlay').classList.add('hidden');
    saveSettings();
  });

  document.getElementById('settings-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) {
      e.currentTarget.classList.add('hidden');
      saveSettings();
    }
  });

  const tabs = document.querySelectorAll('.settings-tab');
  const sections = document.querySelectorAll('.settings-section[data-panel]');
  function switchTab(tabName) {
    tabs.forEach(tb => tb.classList.toggle('active', tb.dataset.tab === tabName));
    sections.forEach(s => s.classList.toggle('active', s.dataset.panel === tabName));
  }
  tabs.forEach(tb => tb.addEventListener('click', () => switchTab(tb.dataset.tab)));
  switchTab('general');

  document.getElementById('btn-back-to-list').addEventListener('click', () => {
    document.getElementById('view-details').classList.remove('active');
    document.getElementById('view-list').classList.add('active');
    state.currentView = 'list';
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'list'));
    renderFlightList();
  });

  document.getElementById('radar-sidebar-close').addEventListener('click', hideRadarSidebar);

  document.getElementById('radius-slider').addEventListener('input', e => {
    state.radius = parseInt(e.target.value);
    document.getElementById('radius-value').textContent = formatRadiusUnit(state.radius);
    document.getElementById('radar-radius-slider').value = state.radius;
    document.getElementById('radar-radius-value').textContent = formatRadiusUnit(state.radius);
    document.getElementById('range-badge').textContent = formatRadiusUnit(state.radius);
    if (state.radarCircle) state.radarCircle.setRadius(state.radius * NM_TO_KM * 1000);
    saveSettings();
  });

  document.getElementById('radar-radius-slider').addEventListener('input', e => {
    state.radius = parseInt(e.target.value);
    document.getElementById('radar-radius-value').textContent = formatRadiusUnit(state.radius);
    document.getElementById('radius-slider').value = state.radius;
    document.getElementById('radius-value').textContent = formatRadiusUnit(state.radius);
    document.getElementById('range-badge').textContent = formatRadiusUnit(state.radius);
    if (state.radarCircle) state.radarCircle.setRadius(state.radius * NM_TO_KM * 1000);
    saveSettings();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('radar-sidebar').classList.contains('hidden')) {
        hideRadarSidebar();
      }
      else if (!document.getElementById('settings-overlay').classList.contains('hidden')) {
        document.getElementById('settings-overlay').classList.add('hidden');
        saveSettings();
      }
    }
  });
}

function initGeolocation() {
  if (state.locationMode === 'manual' && state.manualLocation) {
    state.position = { lat: state.manualLocation.lat, lon: state.manualLocation.lon };
    updateLocationDisplay();
    fetchFlights();
    return;
  }
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        console.log(`Location: ${state.position.lat}, ${state.position.lon}`);
        if (state.map) {
          state.map.panTo([state.position.lat, state.position.lon]);
          if (state.myLocationMarker) state.myLocationMarker.setLatLng([state.position.lat, state.position.lon]);
        }
        fetchFlights();
      },
      err => {
        console.warn('Geolocation error:', err.message);
        state.position = { lat: 50.0, lon: 14.4 }; // Prague fallback
        toast(`${t('app.error')}: ${err.message}`, 'error');
        fetchFlights();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  } else {
    state.position = { lat: 50.0, lon: 14.4 };
    fetchFlights();
  }
}

async function loadTranslations() {
  try {
    const [en, pl] = await Promise.all([
      fetchJSON('lang/en.json'),
      fetchJSON('lang/pl.json')
    ]);
    state.translations.en = en;
    state.translations.pl = pl;
  } catch(e) {
    console.warn('Failed to load translations:', e.message);
  }
}

async function init() {
  await loadTranslations();
  initSettings();
  initNavigation();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateLocationDisplay, 5000);
  initGeolocation();
  startRefresh();

  window.addEventListener('resize', debounce(() => {
    if (state.map) state.map.invalidateSize();
    if (state.detailMap) state.detailMap.invalidateSize();
    drawHourlyChart();
  }, 250));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
