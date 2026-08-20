(function() {
'use strict';

let compassLastHeading = null;
let deviceCompassTimer = null;
let jsLocationAcquired = false;

function updateCompass(heading) {
  const dial = document.getElementById('compass-dial');
  if (!dial || heading == null) return;
  if (compassLastHeading == null) {
    compassLastHeading = heading;
  } else {
    let diff = heading - compassLastHeading;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    compassLastHeading += diff;
  }
  dial.style.transform = `rotate(${compassLastHeading}deg)`;
}

function buildCompassTicks() {
  const dial = document.getElementById('compass-dial');
  if (!dial || dial.querySelector('.compass-tick')) return;
  for (let i = 0; i < 360; i += 30) {
    if (i % 90 === 0) continue;
    const tick = document.createElement('div');
    tick.className = 'compass-tick' + (i % 90 === 30 || i % 90 === 60 ? ' major' : '');
    tick.style.transform = `rotate(${i}deg)`;
    dial.appendChild(tick);
  }
}

function updateCompassVisibility() {
  const compass = document.getElementById('compass-mini');
  if (!compass) return;
  const show = state.locationMode === 'auto' && state.position != null;
  compass.classList.toggle('hidden', !show);
}

function updateLocationStatus(type, duration=3000) {
  let el = document.getElementById('location-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'location-status';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--bg2,rgba(13,17,23,0.9));color:var(--fg2,#aaa);padding:8px 18px;border-radius:20px;font-size:13px;z-index:9999;backdrop-filter:blur(8px);border:1px solid var(--border2,rgba(255,255,255,0.1));white-space:nowrap;pointer-events:none;transition:opacity .3s;';
    document.body.appendChild(el);
  }
  if (type === 'clear') { el.style.display = 'none'; el.style.opacity = '0'; return; }
  let text = '';
  if (type === 'waiting') {
    text = state.locationMode === 'auto' ? t('main.locationWaiting') : t('main.locationManual');
  } else if (type === 'ok') {
    text = t('main.locationOk');
  }
  el.textContent = text;
  el.style.display = '';
  el.style.opacity = '1';
  if (duration > 0) setTimeout(() => { el.style.opacity = '0'; }, duration);
}

function startDeviceCompass() {
  if (deviceCompassTimer) return;
  deviceCompassTimer = setInterval(() => {
    updateCompassVisibility();
    if (state.locationMode !== 'auto' || state.position == null) return;
    if (typeof AndroidLocation !== 'undefined') {
      const heading = AndroidLocation.getDeviceHeading();
      if (heading >= 0 && heading !== state.deviceHeading) {
        state.deviceHeading = heading;
        updateCompass(state.deviceHeading);
      }
    }
  }, 500);
}

function createMyLocationMarker() {
  if (!state.map || !state.position || state.myLocationMarker) return;
  state.myLocationMarker = L.marker([state.position.lat, state.position.lon], {
    icon: L.divIcon({
      className:'my-location-marker',
      html:'<div style="width:12px;height:12px;background:var(--accent);border:2px solid white;border-radius:50%;box-shadow:0 0 10px var(--accent)"></div>'
    })
  }).addTo(state.map).bindPopup(t('radar.yourLocation'));
}

function createRadarCircle() {
  if (!state.map || !state.position || state.radarCircle) return;
  state.radarCircle = L.circle([state.position.lat, state.position.lon], {
    radius: state.radius * NM_TO_KM * 1000,
    color: THEME_COLORS[state.theme] || '#3b82f6',
    fillColor: THEME_COLORS[state.theme] || '#3b82f6',
    fillOpacity: 0.03,
    weight: 1, dashArray: '6,4'
  }).addTo(state.map);
}

function applyNativePosition(lat, lon) {
  state.position = { lat, lon };
  updateLocationDisplay();
  updateCompassVisibility();
  if (state.map) {
    if (!state._mapCentered) {
      state.map.setView([lat, lon], Math.max(state.map.getZoom(), 10));
      state._mapCentered = true;
    }
    if (state.myLocationMarker) state.myLocationMarker.setLatLng([lat, lon]);
    else createMyLocationMarker();
    if (state.radarCircle) state.radarCircle.setLatLng([lat, lon]);
    else createRadarCircle();
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

function applyManualPosition(lat, lon, name) {
  state.position = { lat, lon };
  updateLocationDisplay();
  updateCompassVisibility();
  updateLocationStatus('waiting');
  if (state.map) {
    state.map.panTo([lat, lon]);
    if (state.myLocationMarker) state.myLocationMarker.setLatLng([lat, lon]);
    if (state.radarCircle) {
      state.radarCircle.setLatLng([lat, lon]);
    }
  }
  fetchFlights();
}

function initGeolocation() {
  if (state.locationMode === 'manual' && state.manualLocation) {
    state.position = { lat: state.manualLocation.lat, lon: state.manualLocation.lon };
    updateLocationDisplay();
    updateLocationStatus('waiting');
    fetchFlights();
    return;
  }
  if (state.locationMode === 'auto') updateLocationStatus('waiting');
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        state.position = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        console.log(`Location: ${state.position.lat}, ${state.position.lon}`);
        updateLocationDisplay();
        updateCompassVisibility();
        if (!jsLocationAcquired) {
          jsLocationAcquired = true;
          updateLocationStatus('ok', 3000);
        }
        if (state.map) {
          state.map.panTo([state.position.lat, state.position.lon]);
          if (state.myLocationMarker) state.myLocationMarker.setLatLng([state.position.lat, state.position.lon]);
          else createMyLocationMarker();
          if (state.radarCircle) state.radarCircle.setLatLng([state.position.lat, state.position.lon]);
          else createRadarCircle();
        }
        fetchFlights();
      },
      err => {
        console.warn('Geolocation error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  } else {
    console.warn('Geolocation API not available; waiting for native location');
  }
}

async function searchCity(query) {
  const resultsContainer = document.getElementById('city-search-results');
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=8&addressdetails=1&accept-language=${state.lang}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'I Like Planes/1.0' } });
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

Object.assign(window, {
  updateCompass, buildCompassTicks, updateCompassVisibility,
  startDeviceCompass, updateLocationStatus,
  createMyLocationMarker, createRadarCircle,
  applyNativePosition, updateLocationDisplay, applyManualPosition,
  initGeolocation, searchCity, selectCity
});

})();
