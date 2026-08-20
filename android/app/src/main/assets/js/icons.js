(function() {
'use strict';

const SVG_ICON_CACHE = {};

const MAP_ICON_MAP = {
  A1: 'surface_ground_vehicle', D1: 'surface_ground_vehicle',
  S1: 'surface_ground_vehicle', S2: 'surface_ground_vehicle', S3: 'surface_ground_vehicle',
  A7: 'helicopter', C4: 'helicopter', L5: 'helicopter',
  A6: 'heavy_wide_body_airliner',
  A4: 'large_jet', C2: 'large_jet',
  A5: 'high_vortex',
  A3: 'medium_aircraft', B4: 'drop_plane',
  C3: 'medium_aircraft', L2: 'medium_aircraft', L4: 'medium_aircraft',
  A2: 'small_light_aircraft', B1: 'glider', L1: 'small_light_aircraft',
  L3: 'seaplane', L6: 'glider',
  B2: 'balloon', C6: 'balloon', L7: 'balloon',
  B3: 'parachutist',
  B5: 'ultralight', C1: 'small_light_aircraft', C5: 'glider'
};

const NON_ROTATING_ICONS = new Set(['surface_ground_vehicle', 'balloon', 'parachutist']);

const ROUTE_ARROW_MAP = {
  A1: 'Surface Ground Vehicle.png', D1: 'Surface Ground Vehicle.png',
  S1: 'Surface Ground Vehicle.png', S2: 'Surface Ground Vehicle.png', S3: 'Surface Ground Vehicle.png',
  A7: 'Helicopter.png', C4: 'Helicopter.png', L5: 'Helicopter.png',
  A6: 'Heavy Wide-Body Airliner.png',
  A4: 'Large Jet.png', C2: 'Large Jet.png',
  A5: 'High Vortex.png',
  A3: 'Medium Aircraft.png', B4: 'Medium Aircraft.png',
  C3: 'Medium Aircraft.png', L2: 'Medium Aircraft.png', L4: 'Medium Aircraft.png',
  A2: 'Small Light Aircraft.png', B1: 'Small Light Aircraft.png', B2: 'Small Light Aircraft.png',
  B3: 'Small Light Aircraft.png', B5: 'Small Light Aircraft.png',
  C1: 'Small Light Aircraft.png', C5: 'Small Light Aircraft.png', C6: 'Small Light Aircraft.png',
  L1: 'Small Light Aircraft.png', L3: 'Small Light Aircraft.png',
  L6: 'Small Light Aircraft.png', L7: 'Small Light Aircraft.png'
};

const SURFACE_CATEGORIES = new Set(['A1', 'D1', 'S1', 'S2', 'S3']);

async function preloadSvgIcons() {
  const icons = ['unknown','balloon','drop_plane','glider','heavy_wide_body_airliner','helicopter','high_vortex','large_jet','lighter_than_air','medium_aircraft','military_fighter_jet','parachutist','seaplane','small_light_aircraft','surface_ground_vehicle','tilt_rotor','ultralight'];
  await Promise.all(icons.map(async name => {
    try {
      const res = await fetch(`map_planes_icons/${name}.svg`);
      SVG_ICON_CACHE[name] = await res.text();
    } catch(e) {}
  }));
}

function getCategoryIcon(cat) {
  if (!cat) return 'unknown';
  const key = typeof cat === 'number' ? `A${cat}` : cat;
  return MAP_ICON_MAP[key] || 'unknown';
}

function getCategoryRouteArrow(cat) {
  if (!cat) return 'Small Light Aircraft.png';
  const key = typeof cat === 'number' ? `A${cat}` : cat;
  return ROUTE_ARROW_MAP[key] || 'Small Light Aircraft.png';
}

function isSurfaceFlight(f) {
  if (!f.category) return false;
  const key = typeof f.category === 'number' ? `A${f.category}` : f.category;
  return SURFACE_CATEGORIES.has(key);
}

function getVisibleFlights() {
  const flights = state.hideSurface ? state.flights.filter(f => !isSurfaceFlight(f)) : state.flights;
  return flights.slice(0, MAX_DISPLAYED);
}

const CATEGORIES = {
  'A0':'category.noInfo','A1':'category.surface','A2':'category.light','A3':'category.small',
  'A4':'category.large','A5':'category.highVortex','A6':'category.heavy','A7':'category.rotorcraft',
  'B0':'category.noInfo','B1':'category.glider','B2':'category.lighterThanAir',
  'B3':'category.parachutist','B4':'category.dropPlane','B5':'category.ultralight',
  'C0':'category.noInfo','C1':'category.poweredLift','C2':'category.jet',
  'C3':'category.unknown','C4':'category.helicopter','C5':'category.glider','C6':'category.lighterThanAir',
  'D0':'category.noInfo','D1':'category.surface','D2':'category.emergency',
  'L1':'category.landplaneSingle','L2':'category.landplaneMulti',
  'L3':'category.amphibianSingle','L4':'category.amphibianMulti',
  'L5':'category.helicopter','L6':'category.glider','L7':'category.lighterThanAir',
  'S1':'category.surfaceShip','S2':'category.emergencySurface','S3':'category.surfaceSupport'
};

function decodeCategory(cat) {
  if (!cat) return '';
  const key = typeof cat === 'number' ? `A${cat}` : cat;
  const langKey = CATEGORIES[key];
  return langKey ? t(langKey) : cat;
}

function createPlaneIcon(f, selected) {
  const iconId = getCategoryIcon(f.category);
  const size = selected ? 33 : 24;
  const rotate = NON_ROTATING_ICONS.has(iconId) ? 0 : (f.track || 0);
  const color = selected ? getCssVar('--danger') : getCssVar('--accent');
  const svg = applySvgColor(SVG_ICON_CACHE[iconId], color);
  return L.divIcon({
    className: `radar-plane${selected ? ' radar-plane-selected' : ''}`,
    html: svg ? `<div style="transform:rotate(${rotate}deg);transition:transform .5s;width:${size}px;height:${size}px;">${svg}</div>` : `<img src="map_planes_icons/${iconId}.svg" style="transform:rotate(${rotate}deg);transition:transform .5s;width:${size}px;height:${size}px;">`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

function createAirportIcon(color) {
  const c = color || '#facc15';
  return L.divIcon({
    className: 'airport-tower-marker',
    html: `<svg width="20" height="24" viewBox="0 0 20 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="6" y="20" width="8" height="2" rx="1" fill="${c}" opacity="0.6"/>
      <polygon points="8,20 9,10 11,10 12,20" fill="${c}" opacity="0.8"/>
      <line x1="10" y1="10" x2="10" y2="20" stroke="${c}" stroke-width="0.5" opacity="0.4"/>
      <polygon points="5,10 4,6 16,6 15,10" fill="${c}"/>
      <polygon points="4,6 2,2 18,2 16,6" fill="${c}" opacity="0.85"/>
      <rect x="3" y="3" width="3" height="3" rx="0.5" fill="#fff" opacity="0.7"/>
      <rect x="7" y="3" width="3" height="3" rx="0.5" fill="#fff" opacity="0.5"/>
      <rect x="11" y="3" width="3" height="3" rx="0.5" fill="#fff" opacity="0.5"/>
      <rect x="15" y="3" width="2" height="3" rx="0.5" fill="#fff" opacity="0.7"/>
      <line x1="10" y1="2" x2="10" y2="0" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="10" cy="0" r="1" fill="${c}"/>
    </svg>`,
    iconSize: [20, 24],
    iconAnchor: [10, 24],
    popupAnchor: [0, -20]
  });
}

Object.assign(window, {
  SVG_ICON_CACHE, MAP_ICON_MAP, NON_ROTATING_ICONS, ROUTE_ARROW_MAP, SURFACE_CATEGORIES,
  preloadSvgIcons, getCategoryIcon, getCategoryRouteArrow,
  isSurfaceFlight, getVisibleFlights, decodeCategory,
  createPlaneIcon, createAirportIcon
});

})();
