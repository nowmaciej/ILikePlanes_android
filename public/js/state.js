(function() {
'use strict';

const state = {
  lang: 'en',
  theme: 'default',
  nightMode: false,
  units: 'metric',
  radius: 250,
  rangeUnit: 'nm',
  refreshRate: 8,
  hideSurface: false,
  deviceHeading: 0,
  localReceiver: false,
  receiverUrl: '',
  faKey: '',
  openskyClientId: '',
  openskyClientSecret: '',
  openskyRouteData: false,
  openskyCreditsRemaining: null,
  openskyError: null,
  radarRouteLayer: null,
  position: null,
  locationMode: 'auto',
  manualLocation: null,
  flights: [],
  _allFlights: [],
  _prevView: null,
  selectedFlight: null,
  currentView: 'radar',
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
  layerTrails: null,
  translations: { en: {}, pl: {} },
  routeCache: {},
  sortKey: 'distance',
  sortAsc: true
};

let t = (key) => {
  const parts = key.split('.');
  let v = state.translations[state.lang];
  for (const p of parts) { v = v?.[p]; }
  return v || '';
};

function loadSettings() {
  const saved = (key, def) => localStorage.getItem(`frl-${key}`) ?? def;
  state.lang = saved('lang', 'en');
  state.theme = saved('theme', 'default');
  state.nightMode = saved('night', 'false') === 'true';
  state.units = saved('units', 'metric');
  state.radius = parseInt(saved('radius', '16'));
  state.rangeUnit = saved('range-unit', 'km');
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
    if (val) el.textContent = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    const val = t(key);
    if (val) el.placeholder = val;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    const val = t(key);
    if (val) el.title = val;
  });
  displayCachedCredits();
}

function updateOpenSkyRouteDisabled() {
  const hasCreds = state.openskyClientId.trim() !== '' && state.openskyClientSecret.trim() !== '';
  const toggle = document.getElementById('setting-opensky-route');
  toggle.disabled = !hasCreds;
  if (!hasCreds && state.openskyRouteData) {
    state.openskyRouteData = false;
    toggle.checked = false;
    saveSettings();
  }
  const info = document.getElementById('opensky-credits-info');
  const getKey = document.getElementById('opensky-get-key');
  if (hasCreds) {
    info.classList.remove('hidden');
    getKey.classList.add('hidden');
  } else {
    info.classList.add('hidden');
    getKey.classList.remove('hidden');
  }
}

function displayCachedCredits() {
  const rowEl = document.getElementById('opensky-credits-row');
  const labelEl = document.getElementById('opensky-credits-label');
  const remainingEl = document.getElementById('opensky-credits-remaining');
  const barEl = document.getElementById('opensky-credits-bar-fill');
  const tierEl = document.getElementById('opensky-credits-tier');
  if (!labelEl || !remainingEl || !barEl || !tierEl) return;

  if (state.openskyError) {
    labelEl.textContent = t('settings.apiError');
    remainingEl.textContent = t('settings.apiErrorClick');
    remainingEl.style.color = 'var(--danger)';
    barEl.style.width = '0%';
    tierEl.textContent = '';
    rowEl.classList.add('opensky-credits-error');
    rowEl.onclick = () => { remainingEl.textContent = state.openskyError; };
    return;
  }

  rowEl.classList.remove('opensky-credits-error');
  rowEl.onclick = null;
  labelEl.textContent = t('settings.apiCredits');
  remainingEl.style.color = '';
  const rem = state.openskyCreditsRemaining;
  if (rem == null) { remainingEl.textContent = '---'; barEl.style.width = '0%'; tierEl.textContent = ''; return; }
  let limit = 400;
  if (rem >= 10000) limit = 14400;
  else if (rem >= 5000) limit = 8000;
  else if (rem >= 3000) limit = 4000;
  remainingEl.textContent = `${rem} / ${limit}`;
  const pct = limit > 0 ? (rem / limit * 100) : 0;
  barEl.style.width = pct + '%';
  barEl.style.background = pct > 50 ? 'var(--success)' : pct > 20 ? 'var(--warning)' : 'var(--danger)';
  let tier = t('settings.tierAnonymous');
  if (limit >= 14400) tier = t('settings.tierLicensed');
  else if (limit >= 8000) tier = t('settings.tierActiveFeeder');
  else if (limit >= 4000) tier = t('settings.tierStandard');
  tierEl.textContent = `${t('main.tier')}: ${tier}`;
  tierEl.style.color = 'var(--fg3)';
}

function updateClock() {
  const now = new Date();
  const el = document.getElementById('clock');
  if (el) el.textContent = now.toLocaleTimeString(state.lang === 'pl' ? 'pl-PL' : 'en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function initSettings() {
  loadSettings();
  applyLanguage(state.lang);
  applyTheme(state.theme);
  applyNightMode(state.nightMode);
  updateCompassVisibility();

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
  updateOpenSkyRouteDisabled();
  document.getElementById('radius-slider').value = state.radius;
  document.getElementById('radius-value').textContent = formatRadiusUnit(state.radius);
  document.getElementById('radar-radius-slider').value = state.radius;
  document.getElementById('radar-radius-value').textContent = formatRadiusUnit(state.radius);
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
    updateOpenSkyRouteDisabled();
  });
  document.getElementById('setting-opensky-client-secret').addEventListener('input', e => {
    state.openskyClientSecret = e.target.value; saveSettings();
    updateOpenSkyRouteDisabled();
  });
  document.getElementById('setting-opensky-route').addEventListener('change', e => {
    state.openskyRouteData = e.target.checked; saveSettings();
    if (state.selectedFlight && state.currentView === 'radar') updateRadarRoute();
  });
  document.getElementById('setting-hide-surface').addEventListener('change', e => {
    state.hideSurface = e.target.checked; saveSettings(); renderFlightList(); updateFlightCount();
    if (state.currentView === 'radar') updateRadarMap();
  });

  const locMode = document.getElementById('setting-location-mode');
  const manualSection = document.getElementById('manual-location-section');
  locMode.value = state.locationMode;
  manualSection.classList.toggle('hidden', state.locationMode === 'auto');
  updateLocationDisplay();

  locMode.addEventListener('change', e => {
    state.locationMode = e.target.value;
    manualSection.classList.toggle('hidden', state.locationMode === 'auto');
    updateCompassVisibility();
    saveSettings();
    if (state.locationMode === 'manual' && state.manualLocation) {
      applyManualPosition(state.manualLocation.lat, state.manualLocation.lon, state.manualLocation.name);
    } else if (state.locationMode === 'auto') {
      initGeolocation();
    } else {
      updateLocationStatus('waiting');
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

Object.assign(window, {
  state, t,
  loadSettings, saveSettings,
  applyTheme, applyNightMode, applyLanguage,
  updateOpenSkyRouteDisabled, displayCachedCredits,
  updateClock, initSettings
});

})();
