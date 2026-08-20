(function() {
'use strict';

const NM_TO_KM = 1.852;
const KM_TO_MI = 0.621371;
const FT_TO_M = 0.3048;
const KTS_TO_KMH = 1.852;
const INHG_TO_HPA = 33.8639;
const EARTH_R_KM = 6371;
const MAX_TRACKED = 80;
const MAX_DISPLAYED = 40;

const THEMES = ['default','dark','light','ocean','forest','sunset','cyber','radar'];
const THEME_COLORS = {
  default:'#3b82f6', dark:'#4dabf7', light:'#2563eb',
  ocean:'#00b4d8', forest:'#4ade80', sunset:'#f97316',
  cyber:'#e040fb', radar:'#00ff41'
};

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

const getCssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const applySvgColor = (svgText, color) => {
  if (!svgText) return '';
  return svgText.replace(/currentColor/g, color);
};

const degToRad = (d) => d * Math.PI / 180;
const radToDeg = (r) => r * 180 / Math.PI;

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
  const dirs = [t('spotter.north'),t('spotter.northEast'),t('spotter.east'),t('spotter.southEast'),t('spotter.south'),t('spotter.southWest'),t('spotter.west'),t('spotter.northWest')];
  return dirs[Math.round(b / 45) % 8];
}

function formatAltitude(alt, unit) {
  if (alt == null || alt === 'ground') return t('main.gnd');
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

const debounce = (fn, ms) => {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
};

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

function formatTypeCode(code) {
  if (!code || code.includes('_')) return t('category.unknown') || '---';
  return code;
}

const AIRLINES = {
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
  'CSA':'Czech Airlines'
};

function getAirlineName(ownOp, flight) {
  if (ownOp) return ownOp;
  const icao = flight?.substring(0, 3);
  return AIRLINES[icao] || icao || '---';
}

const getAirlineInfo = (f) => {
  const name = getAirlineName(f.ownOp, f.flight);
  const icao = (f.flight || '').substring(0, 3);
  return { name, icao };
};

const getFlightCallsign = (f) => f.flight || f.hex.toUpperCase();

Object.assign(window, {
  NM_TO_KM, KM_TO_MI, FT_TO_M, KTS_TO_KMH, INHG_TO_HPA, EARTH_R_KM,
  MAX_TRACKED, MAX_DISPLAYED, THEMES, THEME_COLORS,
  h, getCssVar, applySvgColor, degToRad, radToDeg,
  haversine, bearing, bearingToCardinal,
  formatAltitude, formatSpeed, formatDistance, formatRange, formatRadiusUnit,
  debounce, fetchJSON, toast, formatTypeCode,
  getAirlineName, getAirlineInfo, getFlightCallsign
});

})();
