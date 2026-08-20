(function() {
'use strict';

function calcElevation(altFt, distKm) {
  if (altFt == null || !distKm || distKm < 0.1) return 0;
  const altKm = altFt * FT_TO_M / 1000;
  return radToDeg(Math.atan2(altKm, distKm));
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

async function fetchFlights() {
  if (!state.position) return;
  const { lat, lon } = state.position;
  try {
    if (state.localReceiver && state.receiverUrl) {
      try {
        const localData = await fetchJSON(`${state.receiverUrl}/data/aircraft.json`);
        state.flights = (localData.aircraft || []).map(normalizeLocalData);
        state.source = 'local';
        processFlights();
        return;
      } catch(e) {
        console.log('Local receiver failed, falling back to internet');
      }
    }
    const data = await fetchJSON(`/api/flights?lat=${lat}&lon=${lon}&radius=${state.radius}`);
    state.flights = data.flights || [];
    state.source = data.source || '---';
    processFlights();
  } catch(err) {
    console.warn('Fetch failed, keeping last state:', err.message);
  }
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

  state._allFlights = state.flights.slice();
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

function applyRadiusFilter() {
  if (!state._allFlights || state._allFlights.length === 0) return;
  const filtered = state._allFlights.filter(f => f._distance != null && f._distance <= state.radius * NM_TO_KM);
  state.flights = filtered.slice(0, MAX_TRACKED);
  updateStats();
  renderFlightList();
  if (state.currentView === 'radar') updateRadarMap();
  if (state.selectedFlight) {
    const stillSelected = state.flights.find(f => f.hex === state.selectedFlight.hex);
    if (stillSelected) {
      state.selectedFlight = stillSelected;
      if (state.currentView === 'radar') updateRadarSidebar();
      updateDetailPanel(stillSelected);
    } else {
      state.selectedFlight = null;
      if (state.currentView === 'radar') hideRadarSidebar();
    }
  }
  updateFlightCount();
}

async function fetchRoute(callsign) {
  const key = (callsign || '').trim().toUpperCase();
  if (!key) return null;
  if (state.routeCache[key] !== undefined) {
    return state.routeCache[key];
  }
  try {
    const data = await fetchJSON(`/api/route/${key}`);
    state.routeCache[key] = data;
    return data;
  } catch (e) {
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
      L.marker([a.lat, a.lon], {
        icon: createAirportIcon('#facc15')
      }).addTo(state.layerAirports).on('click', () => showAirportSidebar(a));
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

function updateFlightCount() {
  const visible = getVisibleFlights();
  document.getElementById('flight-count').textContent = `${visible.length} / ${state.flights.length} ${t('list.trackCount')}`;
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
    row.appendChild(h('td', { text: formatTypeCode(f.t) }));
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
  hideAirportSidebar();
  renderFlightList();
  updateCompass(state.deviceHeading);
  if (state.currentView === 'radar') {
    showRadarSidebar(f);
    highlightRadarMarker(prevHex, f.hex);
    updateRadarRoute();
    state.layerTrails?.clearLayers();
    const trail = state.radarTrails[f.hex];
    if (trail && trail.length >= 2) {
      L.polyline(trail, {
        color: THEME_COLORS[state.theme] || '#3b82f6',
        weight: 3, opacity: 0.7
      }).addTo(state.layerTrails);
    }
  }
  centerMapOnFlight(f);

  if (f.flight) {
    fetchRoute(f.flight).then(route => {
      if (state.selectedFlight?.hex === f.hex) {
        updateAirportMarkers();
        if (state.currentView === 'radar') {
          updateRadarSidebar();
          updateRadarRoute();
          centerMapOnFlight(state.selectedFlight);
        }
        renderFlightList();
      }
    });
  }
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

Object.assign(window, {
  calcElevation, normalizeLocalData,
  fetchFlights, processFlights, applyRadiusFilter,
  fetchRoute, fetchRoutesBatch, getRouteDisplay,
  updateAirportMarkers, getSortValue, sortFlights,
  updateSortIndicators, updateFlightCount, renderFlightList, selectFlight
});

})();
