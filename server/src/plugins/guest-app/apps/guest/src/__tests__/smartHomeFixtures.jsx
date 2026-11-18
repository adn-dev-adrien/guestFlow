// Shared fixtures of the « Domotique » suites (specs/guest-app-home-automation.md). Not a test file: the `/home`
// payload as the server writes it, and the stay session that shows the tile.
import { ME_STAY, baseRoutes } from './guestFixtures';

export const ME_HOME = { ...ME_STAY, tiles: [...ME_STAY.tiles, { key: 'home', label: 'Domotique', order: 4 }] };

const bars = Array.from({ length: 24 }, (_, i) => (i > 15 && i < 19 ? 0.5 : (i === 23 ? 0.25 : 0)));

export const HOME = {
  live: true,
  updated: 'il y a 1 min',
  blocks: [
    { kind: 'outdoor', temperature: '8,5', min: '4', max: '12,5', humidity: '82 %', wind: '12 km/h', rain: '2,3 mm aujourd’hui', state: 'fresh' },
    { kind: 'rooms', items: [
      { id: 'r1', label: 'Séjour', temperature: '21,4', min: '19,8', max: '22,1', humidity: '48 %', state: 'fresh' },
      { id: 'r2', label: 'Mezzanine', temperature: null, min: null, max: null, humidity: null, state: 'unavailable' },
    ] },
    { kind: 'lights', items: [
      { id: 'l1', label: 'Le chêne', on: false, status: 'Éteint', pilotable: true, state: 'fresh' },
      { id: 'l2', label: 'Terrasse', on: true, status: 'Allumé', pilotable: false, state: 'fresh' },
    ] },
    { kind: 'rain', today: '2,3 mm', lastHour: '0,4 mm', last24h: '3,1 mm', summary: '2,3 mm aujourd’hui', bars, state: 'fresh' },
    { kind: 'energy', power: '740 W', today: '6,8 kWh', curve: bars.map((v) => (v === 0 ? 0.3 : v)), state: 'fresh' },
    { kind: 'grid', power: '160 W', direction: 'export', label: 'Renvoyé au réseau', state: 'fresh' },
  ],
};

export const homeRoutes = (over = {}) => baseRoutes({ 'GET /me': ME_HOME, 'GET /home': HOME, ...over });
