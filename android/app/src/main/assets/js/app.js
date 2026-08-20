(function() {
'use strict';

function switchView(view) {
  if (view === 'radar') initRadarMap();
  if (view !== 'radar') { hideRadarSidebar(); hideAirportSidebar(); }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  state.currentView = view;
  document.getElementById('view-details').classList.remove('active');
  if (window.innerHeight <= window.innerWidth) {
    document.getElementById('details-backdrop').classList.remove('active');
  }

  if (view === 'radar') {
    updateRadarMap();
    if (state.selectedFlight) showRadarSidebar(state.selectedFlight);
    setTimeout(() => {
      state.map?.invalidateSize();
      if (state.selectedFlight) centerMapOnFlight(state.selectedFlight);
    }, 100);
  }
  if (view === 'stats') { drawHourlyChart(); }
  if (view === 'list') renderFlightList();
}

function startRefresh() {
  state.refreshTimer = setInterval(fetchFlights, state.refreshRate * 1000);
}

function restartRefresh() {
  clearInterval(state.refreshTimer);
  startRefresh();
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
    if (document.getElementById('view-details').classList.contains('active')) {
      document.getElementById('view-details').classList.remove('active');
      document.getElementById('details-backdrop').classList.remove('active');
      const prev = state._prevView || 'list';
      document.getElementById(`view-${prev}`).classList.add('active');
      state.currentView = prev;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === prev));
      if (prev === 'radar') { updateRadarMap(); state.map?.invalidateSize(); }
      if (prev === 'list') renderFlightList();
    }
    document.getElementById('settings-overlay').classList.remove('hidden');
    if (state.openskyClientId.trim() && state.openskyClientSecret.trim()) displayCachedCredits();
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
    if (window.innerHeight > window.innerWidth) {
      state.currentView = 'list';
    } else {
      document.getElementById('details-backdrop').classList.remove('active');
      document.getElementById('view-list').classList.add('active');
      state.currentView = 'list';
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'list'));
      renderFlightList();
    }
  });
  document.getElementById('details-backdrop').addEventListener('click', () => {
    document.getElementById('view-details').classList.remove('active');
    document.getElementById('details-backdrop').classList.remove('active');
    state.currentView = 'list';
  });

  document.getElementById('radar-sidebar-close').addEventListener('click', hideRadarSidebar);
  document.getElementById('airport-sidebar-close').addEventListener('click', hideAirportSidebar);

  document.getElementById('radius-slider').addEventListener('input', e => {
    state.radius = parseInt(e.target.value);
    document.getElementById('radius-value').textContent = formatRadiusUnit(state.radius);
    document.getElementById('radar-radius-slider').value = state.radius;
    document.getElementById('radar-radius-value').textContent = formatRadiusUnit(state.radius);
    if (state.radarCircle) state.radarCircle.setRadius(state.radius * NM_TO_KM * 1000);
    applyRadiusFilter();
    saveSettings();
  });

  document.getElementById('radar-radius-slider').addEventListener('input', e => {
    state.radius = parseInt(e.target.value);
    document.getElementById('radar-radius-value').textContent = formatRadiusUnit(state.radius);
    document.getElementById('radius-slider').value = state.radius;
    document.getElementById('radius-value').textContent = formatRadiusUnit(state.radius);
    if (state.radarCircle) state.radarCircle.setRadius(state.radius * NM_TO_KM * 1000);
    applyRadiusFilter();
    saveSettings();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      handleBack();
    }
  });
}

function handleBack() {
  try {
    if (!document.getElementById('airport-sidebar').classList.contains('hidden')) {
      hideAirportSidebar();
      return true;
    }
  } catch(_) {}
  try {
    if (!document.getElementById('radar-sidebar').classList.contains('hidden')) {
      hideRadarSidebar();
      return true;
    }
  } catch(_) {}
  try {
    if (!document.getElementById('settings-overlay').classList.contains('hidden')) {
      document.getElementById('settings-overlay').classList.add('hidden');
      saveSettings();
      return true;
    }
  } catch(_) {}
  try {
    if (document.getElementById('view-details').classList.contains('active')) {
      document.getElementById('view-details').classList.remove('active');
      if (window.innerHeight > window.innerWidth) {
        state.currentView = 'list';
      } else {
        document.getElementById('details-backdrop').classList.remove('active');
        document.getElementById('view-list').classList.add('active');
        state.currentView = 'list';
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === 'list'));
        renderFlightList();
      }
      return true;
    }
  } catch(_) {}
  return false;
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
  preloadSvgIcons();
  initSettings();
  updateLocationStatus('waiting');
  buildCompassTicks();
  initNavigation();
  updateClock();
  setInterval(updateClock, 1000);
  setInterval(updateLocationDisplay, 5000);
  initGeolocation();
  startDeviceCompass();
  startRefresh();

  window.addEventListener('resize', debounce(() => {
    document.documentElement.classList.toggle('portrait', window.innerHeight > window.innerWidth);
    if (state.currentView === 'details' && window.innerHeight > window.innerWidth) {
      const prev = state._prevView || 'list';
      document.getElementById(`view-${prev}`).classList.add('active');
    }
    if (state.map) state.map.invalidateSize();
    if (state.detailMap) state.detailMap.invalidateSize();
    drawHourlyChart();
  }, 250));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.currentView === 'radar' && state.selectedFlight) {
      state.map?.invalidateSize();
      centerMapOnFlight(state.selectedFlight);
    }
  });
  document.documentElement.classList.toggle('portrait', window.innerHeight > window.innerWidth);
  switchView(state.currentView);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.t = t;
window.handleBack = handleBack;
window.state = state;
window.fetchFlights = fetchFlights;
window.applyNativePosition = applyNativePosition;
window.updateLocationStatus = updateLocationStatus;

})();
