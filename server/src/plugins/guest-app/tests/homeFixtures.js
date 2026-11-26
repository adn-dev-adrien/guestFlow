// Shared fixtures for the « Domotique » suites of the guest app (specs/guest-app/guest-app-home-automation.md). Not a test file.
// The house's data is a fake `homeData` provider in memory: the guest app never reads the connector's tables.

const CATALOG = Object.freeze([
  { id: 'wx', name: 'Station Netatmo', zonePath: 'Extérieur', type: 'weather', guestSwitchable: false, goneAt: null, readings: [
    { alias: 'temperature', category: 'temperature_outdoor', unit: '°C' },
    { alias: 'temperature_min_today', category: 'temperature_outdoor', unit: '°C' },
    { alias: 'temperature_max_today', category: 'temperature_outdoor', unit: '°C' },
    { alias: 'humidity', category: 'humidity_outdoor', unit: '%' },
    { alias: 'wind_strength', category: 'wind', unit: 'km/h' },
    { alias: 'rain_1h', category: 'rain', unit: 'mm' },
    { alias: 'rain_today', category: 'rain', unit: 'mm' },
  ] },
  { id: 't-sejour', name: 'Thermomètre séjour', zonePath: 'La Granja › Séjour', type: 'sensor', guestSwitchable: false, goneAt: null, readings: [
    { alias: 'temperature', category: 'temperature', unit: '°C' },
    { alias: 'temperature_min_today', category: 'temperature', unit: '°C' },
    { alias: 'temperature_max_today', category: 'temperature', unit: '°C' },
    { alias: 'humidity', category: 'humidity', unit: '%' },
  ] },
  { id: 't-ch1', name: 'Thermomètre chambre', zonePath: 'La Granja › Chambre', type: 'sensor', guestSwitchable: false, goneAt: null, readings: [
    { alias: 'temperature', category: 'temperature', unit: '°C' },
  ] },
  { id: 'm-granja', name: 'Sous-compteur', zonePath: 'La Granja', type: 'energy_meter', guestSwitchable: false, goneAt: null, readings: [
    { alias: 'power', category: 'power', unit: 'W' },
    { alias: 'energy_day', category: 'energy', unit: 'Wh' },
    { alias: 'energy_hour', category: 'energy', unit: 'Wh' },
  ] },
  { id: 'edf', name: 'EDF', zonePath: 'Domaine', type: 'main_energy_meter', guestSwitchable: false, goneAt: null, readings: [
    { alias: 'power', category: 'power', unit: 'W' },
    { alias: 'energy_day', category: 'energy', unit: 'Wh' },
  ] },
  { id: 'l-chene', name: 'Éclairage du chêne', zonePath: 'Extérieur › Jardin', type: 'light_onoff', guestSwitchable: true, goneAt: null, readings: [
    { alias: 'state', category: 'light_state', unit: null },
  ] },
  { id: 'l-salon', name: 'Lampe salon', zonePath: 'Maison › Salon', type: 'light_onoff', guestSwitchable: false, goneAt: null, readings: [
    { alias: 'state', category: 'light_state', unit: null },
  ] },
]);

/** The six blocks as Studio would send them for La Granja. */
const GRANJA_BLOCKS = Object.freeze([
  { kind: 'outdoor', on: true, equipmentId: 'wx' },
  { kind: 'rooms', on: true, items: [{ label: 'Séjour', equipmentId: 't-sejour' }, { label: 'Chambre', equipmentId: 't-ch1' }] },
  { kind: 'lights', on: true, items: [{ label: 'Le chêne', equipmentId: 'l-chene', pilotable: true }, { label: 'Salon', equipmentId: 'l-salon', pilotable: false }] },
  { kind: 'rain', on: true, equipmentId: 'wx' },
  { kind: 'energy', on: true, equipmentId: 'm-granja' },
  { kind: 'grid', on: true, equipmentId: 'edf' },
]);

/** Readings of every role, measured `ageMs` before `now`. */
function readingsAt(now, ageMs = 60 * 1000) {
  const measuredAt = new Date(now.getTime() - ageMs).toISOString();
  const r = (equipmentId, alias, value, unit) => ({ equipmentId, alias, value, unit, measuredAt });
  return [
    r('wx', 'temperature', 8.6, '°C'), r('wx', 'temperature_min_today', 4.1, '°C'), r('wx', 'temperature_max_today', 12.3, '°C'),
    r('wx', 'humidity', 82, '%'), r('wx', 'wind_strength', 12, 'km/h'), r('wx', 'rain_1h', 0.4, 'mm'), r('wx', 'rain_today', 2.3, 'mm'),
    r('t-sejour', 'temperature', 21.44, '°C'), r('t-sejour', 'temperature_min_today', 19.84, '°C'),
    r('t-sejour', 'temperature_max_today', 22.06, '°C'), r('t-sejour', 'humidity', 48, '%'), r('t-ch1', 'temperature', 19.2, '°C'),
    r('m-granja', 'power', 744, 'W'), r('m-granja', 'energy_day', 6840, 'Wh'), r('edf', 'power', -161.2, 'W'),
    r('l-chene', 'state', 'OFF', null), r('l-salon', 'state', 'ON', null),
  ];
}

/** A `homeData` provider in memory, with the queue the connector would hold. */
function fakeHome({ catalog = CATALOG, readings = [], series = [], lastPollAt = null, confirmed = [] } = {}) {
  const state = { catalog: catalog.map((e) => ({ ...e })), readings, series, lastPollAt, commands: [], confirmed };
  const pick = (list, pairs) => list.filter((x) => pairs.some((p) => p.equipmentId === x.equipmentId && p.alias === x.alias));
  return {
    state,
    channel: () => ({ lastPollAt: state.lastPollAt, lastCatalogAt: null, equipments: state.catalog.length }),
    catalog: () => state.catalog,
    readings: (pairs) => pick(state.readings, pairs),
    series: (pairs) => pick(state.series, pairs),
    queueCommand: (command) => {
      const queued = { id: state.commands.length + 1, ...command, state: 'pending', reason: null };
      state.commands.push(queued);
      return queued;
    },
    command: (id) => state.commands.find((c) => c.id === id) || null,
    confirmed: (ids) => state.confirmed.filter((c) => ids.includes(c.equipmentId)),
  };
}

module.exports = { CATALOG, GRANJA_BLOCKS, readingsAt, fakeHome };
