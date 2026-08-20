(function() {
'use strict';

function updateDetailPanel(f) {
  const airline = getAirlineInfo(f);
  document.getElementById('detail-callsign').textContent = getFlightCallsign(f);
  document.getElementById('detail-airline').textContent = airline.name;
  document.getElementById('detail-type').textContent = formatTypeCode(f.t);
  document.getElementById('detail-reg').textContent = f.r || '---';
  document.getElementById('detail-alt').textContent = formatAltitude(f.alt_baro, state.units);
  document.getElementById('detail-speed').textContent = formatSpeed(f.gs, state.units);
  document.getElementById('detail-heading').textContent = f.track != null ? `${Math.round(f.track)}\u00B0 ${bearingToCardinal(f.track)}` : '---';
  document.getElementById('detail-squawk').textContent = f.squawk || '---';
  document.getElementById('detail-category').textContent = f._categoryLabel || f.category || '---';
  document.getElementById('detail-icao').textContent = f.hex || '---';
  document.getElementById('detail-eta').textContent = '---';

  document.getElementById('detail-from-city').textContent = f.origin?.name || f.origin?.icao || '---';
  document.getElementById('detail-from-icao').textContent = f.origin?.icao || '';
  document.getElementById('detail-from-time').textContent = f.origin?.timezone ? new Date().toLocaleTimeString(state.lang === 'pl' ? 'pl-PL' : 'en-GB', { timeZone: f.origin.timezone, hour:'2-digit', minute:'2-digit' }) : '';
  document.getElementById('detail-to-city').textContent = f.destination?.name || f.destination?.icao || '---';
  document.getElementById('detail-to-icao').textContent = f.destination?.icao || '';
  document.getElementById('detail-to-time').textContent = f.destination?.timezone ? new Date().toLocaleTimeString(state.lang === 'pl' ? 'pl-PL' : 'en-GB', { timeZone: f.destination.timezone, hour:'2-digit', minute:'2-digit' }) : '';

  if (f.flagImg) {
    document.getElementById('detail-flag-from').src = f.flagImg.from;
    document.getElementById('detail-flag-from').alt = f.origin?.icao || t('main.originFlag');
    document.getElementById('detail-flag-to').src = f.flagImg.to;
    document.getElementById('detail-flag-to').alt = f.destination?.icao || t('main.destinationFlag');
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
      icon: createAirportIcon('var(--success)')
    }).addTo(state.detailMap).on('click', () => showAirportSidebar(f.origin));
  }
  if (f.destination?.lat && f.destination?.lon) {
    coords.push([f.destination.lat, f.destination.lon]);
    L.marker([f.destination.lat, f.destination.lon], {
      icon: createAirportIcon('var(--danger)')
    }).addTo(state.detailMap).on('click', () => showAirportSidebar(f.destination));
  }

  if (coords.length >= 2) {
    L.polyline(coords, { color: THEME_COLORS[state.theme] || '#3b82f6', weight:2, dashArray:'8,6', opacity:0.8 }).addTo(state.detailMap);

    if (f.lat && f.lon) {
      const iconId = getCategoryIcon(f.category);
      const rotate = NON_ROTATING_ICONS.has(iconId) ? 0 : (f.track || 0);
      const color = getCssVar('--accent');
      const svg = applySvgColor(SVG_ICON_CACHE[iconId], color);
      const planeIcon = L.divIcon({
        className:'plane-marker',
        html: svg ? `<div style="transform:rotate(${rotate}deg);width:30px;height:30px;">${svg}</div>` : `<img src="map_planes_icons/${iconId}.svg" style="transform:rotate(${rotate}deg);width:30px;height:30px;">`
      });
      L.marker([f.lat, f.lon], { icon:planeIcon }).addTo(state.detailMap);
    }

    const bounds = L.latLngBounds(coords);
    if (f.lat && f.lon) bounds.extend([f.lat, f.lon]);
    state.detailMap.fitBounds(bounds.pad(0.2));
  }
}

async function fetchAirportMETAR(lat, lon, icao) {
  const group = document.querySelector('.asb-metar-group');
  const rawEl = document.getElementById('asb-metar-raw');
  const descEl = document.getElementById('asb-metar-desc');
  const icaoEl = document.getElementById('asb-metar-icao');
  if (!lat || !lon) {
    group.classList.add('hidden');
    return;
  }
  icaoEl.textContent = icao || '';
  try {
    const data = await fetchJSON(`/api/metar?lat=${lat}&lon=${lon}`);
    const list = Array.isArray(data) ? data : (data.data || data.metar || []);
    const metar = list.find(m => (m.icao || '').toUpperCase() === (icao || '').toUpperCase()) || list[0];
    if (metar) {
      const raw = metar.rawOb || metar.raw_text || metar.raw_METAR || '';
      rawEl.textContent = raw;
      descEl.innerHTML = parseMETARDescription(raw);
      group.classList.remove('hidden');
    } else {
      rawEl.textContent = '---';
      descEl.innerHTML = `<span class="asb-metar-none">${t('weather.notAvailable')}</span>`;
      group.classList.remove('hidden');
    }
  } catch(e) {
    console.warn('Airport METAR error:', e.message);
    rawEl.textContent = '---';
    descEl.innerHTML = `<span class="asb-metar-none">${t('weather.notAvailable')}</span>`;
    group.classList.remove('hidden');
  }
}

function parseWeather(code) {
  const prefixMap = { '-': t('metar.light'), '+': t('metar.heavy'), VC: t('metar.vicinity') };
  const weatherMap = {
    DZ: t('metar.drizzle'), RA: t('metar.rain'), SN: t('metar.snow'), SG: t('metar.snowGrains'),
    IC: t('metar.iceCrystals'), PL: t('metar.icePellets'), GR: t('metar.hail'), GS: t('metar.smallHail'),
    BR: t('metar.mist'), FG: t('metar.fog'), FU: t('metar.smoke'), DU: t('metar.dust'),
    SA: t('metar.sand'), HZ: t('metar.haze'), PO: t('metar.dustWhirls'), SQ: t('metar.squall'),
    FC: t('metar.funnelCloud'), SS: t('metar.sandstorm'), DS: t('metar.duststorm'),
    SH: t('metar.showers'), TS: t('metar.thunderstorm'), FZ: t('metar.freezing')
  };
  let prefix = '';
  let w = code;
  for (const [k, v] of Object.entries(prefixMap)) {
    if (w.startsWith(k)) { prefix = v; w = w.slice(k.length); break; }
  }
  const desc = weatherMap[w] || weatherMap[w.slice(0, 2)] || null;
  if (!desc) return null;
  return prefix ? `${prefix} ${desc}` : desc;
}

function parseMETARDescription(raw) {
  if (!raw) return `<span class="asb-metar-none">${t('weather.notAvailable')}</span>`;
  const lines = [];
  const parts = raw.replace(/^METAR\s+/i, '').split(/\s+/);
  const metric = state.units === 'metric';

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (/^\d{5}Z$/.test(p)) continue;
    if (i < 3 && /^[A-Z]{4}$/.test(p)) continue;
    if (p === 'NIL' || p === 'AUTO' || p === 'COR' || p === 'NSC' || p === 'RMK') continue;
    if (p.startsWith('RMK')) break;

    if (/^(VRB|\d{3})(\d{2})(G\d{2})?(KT|MPS|KMH)$/.test(p)) {
      const m = p.match(/^(VRB|\d{3})(\d{2})(G\d{2})?(KT|MPS|KMH)$/);
      const dir = m[1] === 'VRB' ? t('metar.variable') : `${m[1]}\u00B0`;
      let spd = parseInt(m[2]);
      let gust = m[3] ? parseInt(m[3].slice(1)) : null;
      let unit = 'kt';
      if (metric && m[4] === 'KT') { spd = Math.round(spd * KTS_TO_KMH); gust = gust ? Math.round(gust * KTS_TO_KMH) : null; unit = 'km/h'; }
      else if (m[4] === 'MPS') unit = 'm/s';
      else if (m[4] === 'KMH') unit = 'km/h';
      let wind = `${t('metar.wind')} ${t('metar.from')} ${dir} ${t('metar.at')} ${spd} ${unit}`;
      if (gust) wind += `, ${t('metar.gusts')} ${gust} ${unit}`;
      lines.push(wind);
      continue;
    }

    if (/^\d{4}$/.test(p) && parseInt(p) < 9999) {
      const vis = parseInt(p);
      lines.push(`${t('metar.visibility')}: ${vis} ${t('metar.meters')}`);
      continue;
    }
    if (/^\d{4}(NDV)?$/.test(p) && parseInt(p) === 9999) {
      lines.push(`${t('metar.visibility')}: \u226510 ${t('metar.km')}`);
      continue;
    }
    if (p === 'CAVOK') { lines.push(t('metar.cavok')); continue; }

    if (/^(-|\+|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ|DZ|RA|SN|SG|IC|PL|GR|GS|BR|FG|FU|DU|SA|HZ|PO|SQ|FC|SS|DS)$/.test(p) ||
        /^(-|\+|VC)?(MI|PR|BC|DR|BL)?(DZ|RA|SN|SG|IC|PL|GR|GS|BR|FG|FU|DU|SA|HZ|PO|SQ|FC|SS|DS)$/.test(p)) {
      const w = parseWeather(p);
      if (w) lines.push(w);
      continue;
    }

    if (/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/.test(p)) {
      const m = p.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/);
      const coverMap = { FEW: t('metar.few'), SCT: t('metar.scattered'), BKN: t('metar.broken'), OVC: t('metar.overcast'), VV: t('metar.verticalVisibility') };
      let cover = coverMap[m[1]] || m[1];
      const heightFt = parseInt(m[2]) * 100;
      const heightVal = metric ? Math.round(heightFt * FT_TO_M) : heightFt;
      const heightUnit = metric ? 'm' : t('metar.feet');
      let cloud = `${cover} ${t('metar.at')} ${heightVal} ${heightUnit}`;
      if (m[3] === 'CB') cloud += ` (${t('metar.cb')})`;
      else if (m[3] === 'TCU') cloud += ` (${t('metar.tcu')})`;
      lines.push(cloud);
      continue;
    }

    if (/^(M?\d{2})\/(M?\d{2})?$/.test(p)) {
      const m = p.match(/^(M?\d{2})\/(M?\d{2})?$/);
      const parseT = (v) => v.startsWith('M') ? `-${v.slice(1)}` : v;
      const temp = parseT(m[1]);
      const dew = m[2] ? parseT(m[2]) : null;
      let tLine = `${t('metar.temperature')}: ${temp}\u00B0C`;
      if (dew) tLine += `, ${t('metar.dewPoint')}: ${dew}\u00B0C`;
      lines.push(tLine);
      continue;
    }

    if (/^Q(\d{4})$/.test(p)) {
      const m = p.match(/^Q(\d{4})$/);
      lines.push(`${t('metar.pressure')}: ${m[1]} ${t('metar.hpa')}`);
      continue;
    }
    if (/^A(\d{4})$/.test(p)) {
      const m = p.match(/^A(\d{4})$/);
      if (metric) {
        const hpa = Math.round(parseInt(m[1]) / 100 * INHG_TO_HPA);
        lines.push(`${t('metar.pressure')}: ${hpa} ${t('metar.hpa')}`);
      } else {
        lines.push(`${t('metar.pressure')}: ${m[1]} inHg`);
      }
      continue;
    }
  }

  if (lines.length === 0) return `<span class="asb-metar-none">${t('weather.notAvailable')}</span>`;
  return lines.map(l => `<div class="asb-metar-line">${l}</div>`).join('');
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
  records.push({ label: t('stats.maxPerHour'), value: maxFlights });

  let maxSpeedVal = 0, maxSpeedFlight = null;
  state.sessionFlights.forEach(({ flight: f }) => { if (f.gs && f.gs > maxSpeedVal) { maxSpeedVal = f.gs; maxSpeedFlight = f; } });
  if (maxSpeedVal) {
    const airline = maxSpeedFlight ? getAirlineInfo(maxSpeedFlight).name : '';
    const callsign = maxSpeedFlight ? getFlightCallsign(maxSpeedFlight) : '---';
    records.push({ label: t('stats.maxSpeedRecord'), value: formatSpeed(maxSpeedVal, state.units), detail: `${callsign} \u2022 ${airline}` });
  }

  let maxAltVal = 0, maxAltFlight = null;
  state.sessionFlights.forEach(({ flight: f }) => { if (f.alt_baro && f.alt_baro !== 'ground' && f.alt_baro > maxAltVal) { maxAltVal = f.alt_baro; maxAltFlight = f; } });
  if (maxAltVal) {
    const airline = maxAltFlight ? getAirlineInfo(maxAltFlight).name : '';
    const callsign = maxAltFlight ? getFlightCallsign(maxAltFlight) : '---';
    records.push({ label: t('stats.maxAltRecord'), value: formatAltitude(maxAltVal, state.units), detail: `${callsign} \u2022 ${airline}` });
  }

  records.push({ label: t('stats.totalTracked'), value: state.sessionFlights.size });

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

Object.assign(window, {
  updateDetailPanel, initDetailRouteMap,
  fetchAirportMETAR, parseMETARDescription, parseWeather,
  updateStats, drawHourlyChart, drawTopAirlines, drawDailyRecords, updateSessionInfo
});

})();
