(function() {
'use strict';

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
    const mapEl = state.map.getContainer();
    const mapRect = mapEl.getBoundingClientRect();
    let offsetX = 0;
    let offsetY = 0;

    ['radar-sidebar', 'airport-sidebar'].forEach(id => {
      const sidebar = document.getElementById(id);
      if (sidebar && !sidebar.classList.contains('hidden')) {
        const sbRect = sidebar.getBoundingClientRect();
        const overlapX = Math.max(0, Math.min(sbRect.right, mapRect.right) - Math.max(sbRect.left, mapRect.left));
        const overlapY = Math.max(0, Math.min(sbRect.bottom, mapRect.bottom) - Math.max(sbRect.top, mapRect.top));
        if (sbRect.left > mapRect.left && overlapX > 0) offsetX = overlapX / 2;
        if (sbRect.top > mapRect.top && overlapY > 0) offsetY = overlapY / 2;
      }
    });

    const size = state.map.getSize();
    const targetPx = [size.x / 2 - offsetX, size.y / 2 - offsetY];
    const planePx = state.map.latLngToContainerPoint([f.lat, f.lon]);
    state.map.panBy([planePx.x - targetPx[0], planePx.y - targetPx[1]], { animate: true });
  });
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
    L.marker([route.origin.lat, route.origin.lon], {
      icon: createAirportIcon('var(--success)')
    }).addTo(layer).on('click', () => showAirportSidebar(route.origin));
  }

  if (route?.destination?.lat != null && route.destination.lon != null) {
    L.marker([route.destination.lat, route.destination.lon], {
      icon: createAirportIcon('var(--danger)')
    }).addTo(layer).on('click', () => showAirportSidebar(route.destination));
  }

  try {
    const openskyUrl = `/api/opensky-track/${f.hex}?client_id=${encodeURIComponent(state.openskyClientId)}&client_secret=${encodeURIComponent(state.openskyClientSecret)}`;
    const data = await fetchJSON(openskyUrl);
    if (data.error) {
      console.error('[OpenSky]', data.error);
      state.openskyError = data.error;
      displayCachedCredits();
      return;
    }
    state.openskyError = null;
    if (data.creditsRemaining != null) state.openskyCreditsRemaining = parseInt(data.creditsRemaining);
    displayCachedCredits();
    if (state.selectedFlight?.hex !== f.hex || state.currentView !== 'radar') return;
    if (data?.trail?.length >= 2) {
      const coords = data.trail.map(p => [p.lat, p.lon]);
      L.polyline(coords, {
        color: THEME_COLORS[state.theme] || '#3b82f6',
        weight: 3, opacity: 0.85
      }).addTo(layer);
    }
  } catch (e) {
    console.error('[OpenSky]', e.message || 'network_error');
    state.openskyError = e.message || 'network_error';
    displayCachedCredits();
  }
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

function drawSidebarCompass(bearingDeg) {
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
  [t('spotter.north'),t('spotter.east'),t('spotter.south'),t('spotter.west')].forEach((d,i) => {
    const angle = i * 90 - 90;
    const rad = degToRad(angle);
    const tx = cx + (r-18)*Math.cos(rad), ty = cy + (r-18)*Math.sin(rad);
    html += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central" fill="var(--fg2)" font-size="10" font-weight="600">${d}</text>`;
  });
  svg.innerHTML = html;
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
  const routeArrowImg = getCategoryRouteArrow(f.category);
  routeEl.innerHTML = `
    <div class="rsb-route-from"><span class="rsb-route-icao">${fromIcao || '---'}</span><span class="rsb-route-city">${fromName}</span></div>
    <span class="rsb-route-arrow"><img src="route_arrow/${routeArrowImg}" alt="" class="rsb-route-plane"></span>
    <div class="rsb-route-to"><span class="rsb-route-icao">${toIcao || '---'}</span><span class="rsb-route-city">${toName}</span></div>
  `;

  document.getElementById('rsb-type').textContent = formatTypeCode(f.t);
  document.getElementById('rsb-reg').textContent = f.r || '---';
  document.getElementById('rsb-alt').textContent = formatAltitude(f.alt_baro, state.units);
  document.getElementById('rsb-speed').textContent = formatSpeed(f.gs, state.units);
  document.getElementById('rsb-heading').textContent = f.track != null ? `${Math.round(f.track)}\u00B0 ${bearingToCardinal(f.track)}` : '---';
  document.getElementById('rsb-squawk').textContent = f.squawk || '---';
  document.getElementById('rsb-category').textContent = f._categoryLabel || f.category || '---';
  document.getElementById('rsb-icao').textContent = f.hex || '---';
  document.getElementById('rsb-distance').textContent = f._distance != null ? formatDistance(f._distance) : '---';
  document.getElementById('rsb-bearing').textContent = f._bearing != null ? `${Math.round(f._bearing)}\u00B0 ${bearingToCardinal(f._bearing)}` : '---';

  drawSidebarCompass(f._bearing || 0);

  const groundDist = f._distance != null ? (state.rangeUnit === 'km' ? (f._distance >= 10 ? Math.round(f._distance) + ' km' : f._distance.toFixed(2) + ' km') : ((f._distance / NM_TO_KM) >= 10 ? Math.round(f._distance / NM_TO_KM) + ' NM' : (f._distance / NM_TO_KM).toFixed(2) + ' NM')) : '---';
  document.getElementById('rsb-ground-dist').textContent = `${t('main.groundDistance')}: ${groundDist}`;

  const pred = predictFlyover(f);
  const predEl = document.getElementById('rsb-prediction');
  if (pred) {
    predEl.textContent = `${t('spotter.flyover')} ~${pred.minutes} ${t('spotter.minutes')} ${t('spotter.at')} ${pred.distance}`;
  } else {
    predEl.textContent = '';
  }
}

function hideRadarSidebar() {
  const prevHex = state.selectedFlight?.hex;
  state.selectedFlight = null;
  document.getElementById('radar-sidebar').classList.add('hidden');
  highlightRadarMarker(prevHex, null);
  clearRadarRoute();
  state.layerTrails?.clearLayers();
  renderFlightList();
}

function updateRadarSidebar() {
  if (!state.selectedFlight) return;
  const f = state.flights.find(flight => flight.hex === state.selectedFlight.hex);
  if (f) showRadarSidebar(f);
}

function showAirportSidebar(a) {
  if (!a) return;
  const prevHex = state.selectedFlight?.hex;
  state.selectedFlight = null;
  highlightRadarMarker(prevHex, null);
  clearRadarRoute();
  document.getElementById('radar-sidebar').classList.add('hidden');
  const sb = document.getElementById('airport-sidebar');
  document.getElementById('asb-name').textContent = a.name || '---';
  document.getElementById('asb-icao').textContent = a.icao || '---';
  document.getElementById('asb-iata').textContent = a.iata || '---';
  document.getElementById('asb-country').textContent = a.country || '---';
  document.getElementById('asb-lat').textContent = a.lat != null ? a.lat.toFixed(4) + '\u00B0' : '---';
  document.getElementById('asb-lon').textContent = a.lon != null ? a.lon.toFixed(4) + '\u00B0' : '---';
  if (state.position && a.lat != null && a.lon != null) {
    const d = haversine(state.position.lat, state.position.lon, a.lat, a.lon);
    document.getElementById('asb-dist').textContent = formatDistance(d);
    const brg = bearing(state.position.lat, state.position.lon, a.lat, a.lon);
    document.getElementById('asb-bearing').textContent = `${Math.round(brg)}\u00B0 ${bearingToCardinal(brg)}`;
  } else {
    document.getElementById('asb-dist').textContent = '---';
    document.getElementById('asb-bearing').textContent = '---';
  }
  const flightsHere = state.flights.filter(f => {
    const key = (f.flight || '').trim().toUpperCase();
    const route = state.routeCache[key];
    if (!route) return false;
    return (route.origin?.icao === a.icao || route.origin?.iata === a.iata ||
            route.destination?.icao === a.icao || route.destination?.iata === a.iata);
  });
  document.getElementById('asb-flights').textContent = flightsHere.length;
  sb.classList.remove('hidden');
  fetchAirportMETAR(a.lat, a.lon, a.icao);
}

function hideAirportSidebar() {
  document.getElementById('airport-sidebar').classList.add('hidden');
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

  createMyLocationMarker();
  state.layerAirports = L.layerGroup().addTo(state.map);
  createRadarCircle();

  state.layerPlanes = L.layerGroup().addTo(state.map);
  state.layerTrails = L.layerGroup().addTo(state.map);

  state.map.on('click', () => {
    const prevHex = state.selectedFlight?.hex;
    state.selectedFlight = null;
    hideRadarSidebar();
    hideAirportSidebar();
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
      marker.on('click', (e) => { L.DomEvent.stopPropagation(e); selectFlight(f); });
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

  state.layerTrails.clearLayers();
  if (state.openskyRouteData && state.selectedFlight) {
    const hex = state.selectedFlight.hex;
    const trail = state.radarTrails[hex];
    if (trail && trail.length >= 2) {
      L.polyline(trail, {
        color: THEME_COLORS[state.theme] || '#3b82f6',
        weight: 3, opacity: 0.7
      }).addTo(state.layerTrails);
    }
  }

  document.getElementById('radar-flight-count').textContent = `${state.flights.length} ${t('main.aircraft')}`;
  document.getElementById('radar-source').textContent = state.source;
}

Object.assign(window, {
  highlightRadarMarker, centerMapOnFlight,
  clearRadarRoute, updateRadarRoute,
  predictFlyover, drawSidebarCompass,
  showRadarSidebar, hideRadarSidebar, updateRadarSidebar,
  showAirportSidebar, hideAirportSidebar,
  initRadarMap, updateRadarMap
});

})();
