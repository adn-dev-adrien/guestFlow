// specs/guest-app-home-automation.md rules 18, 19, 23, 25, 27-29 — the guest's « Domotique » page as the server writes
// it: Sowel's values rounded, formatted, dated, scaled — none derived. The client computes nothing.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHomeView, number, power, hourly } = require('../homeView');
const { validateHomeBlocks } = require('../homeBlocksValidation');
const { selectionOf } = require('../homeRoles');
const { CATALOG, GRANJA_BLOCKS, readingsAt } = require('./homeFixtures');

// date-literal-ok: an injected clock — the model reads no « today »
const NOW = new Date('2026-11-15T20:30:00Z');
const blocks = () => validateHomeBlocks(GRANJA_BLOCKS, CATALOG, (() => { let n = 0; return () => `item${String(n += 1).padStart(2, '0')}`; })()).blocks;
const POLLED = new Date(NOW.getTime() - 30 * 1000).toISOString();
const view = (over = {}) => buildHomeView({ blocks: blocks(), catalog: CATALOG, readings: readingsAt(NOW), series: [], lastPollAt: POLLED, now: NOW, lang: 'fr', ...over });
const block = (v, kind) => v.blocks.find((b) => b.kind === kind);

test('rule 19 — rounding: half a degree on the hero, a tenth in rooms, 10 W under 1 kW, a tenth of kWh and mm', () => {
  assert.equal(number(8.6, 0.5, 'fr'), '8,5');
  assert.equal(number(12, 0.5, 'fr'), '12');
  assert.equal(number(21.44, 0.1, 'fr'), '21,4');
  assert.equal(number(21, 0.1, 'fr'), '21,0');
  assert.equal(number(21.44, 0.1, 'en'), '21.4');
  assert.equal(power(744, 'fr'), '740 W');
  assert.equal(power(2310, 'fr'), '2,3 kW');
});

test('rule 18 — the page in order, every value written for the guest', () => {
  const v = view();
  assert.deepEqual(v.blocks.map((b) => b.kind), ['outdoor', 'rooms', 'lights', 'rain', 'energy', 'grid']);
  const outdoor = block(v, 'outdoor');
  assert.deepEqual(
    [outdoor.temperature, outdoor.min, outdoor.max, outdoor.humidity, outdoor.wind, outdoor.rain, outdoor.state],
    ['8,5', '4', '12,5', '82 %', '12 km/h', '2,3 mm aujourd’hui', 'fresh'],
  );
  const [sejour, chambre] = block(v, 'rooms').items;
  assert.deepEqual([sejour.label, sejour.temperature, sejour.humidity], ['Séjour', '21,4', '48 %']);
  assert.equal(chambre.humidity, null);
  assert.deepEqual(block(v, 'rain').today, '2,3 mm');
  assert.deepEqual([block(v, 'energy').power, block(v, 'energy').today], ['740 W', '6,8 kWh']);
  assert.equal(v.live, true);
  assert.equal(v.updated, 'il y a 1 min');
});

test('rule 23 — a light’s state comes from the house, and only an entrusted light is pilotable', () => {
  const [chene, salon] = block(view(), 'lights').items;
  assert.deepEqual([chene.on, chene.status, chene.pilotable], [false, 'Éteint', true]);
  // Studio could not save « Pilotable » on the salon lamp, and the view would not honour it anyway.
  assert.deepEqual([salon.on, salon.status, salon.pilotable], [true, 'Allumé', false]);
});

test('rule 23 — a switch the house confirmed after its last reading is the state; an older one is not', () => {
  const after = new Date(NOW.getTime() - 10 * 1000).toISOString();
  const before = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
  const chene = (confirmed) => block(view({ confirmed }), 'lights').items[0];
  assert.deepEqual([chene([{ equipmentId: 'l-chene', value: 'on', answeredAt: after }]).on, chene([{ equipmentId: 'l-chene', value: 'on', answeredAt: after }]).status], [true, 'Allumé']);
  assert.equal(chene([{ equipmentId: 'l-chene', value: 'on', answeredAt: before }]).on, false);
});

test('rule 27 — the house is live while it polled within 2 min, whatever the age of an unchanged value', () => {
  // A thermometer that reported 40 min ago and has not changed since is as current as Sowel itself.
  const quiet = view({ readings: readingsAt(NOW, 40 * 60 * 1000) });
  assert.equal(block(quiet, 'outdoor').state, 'fresh');
  assert.equal(block(quiet, 'outdoor').at, undefined);
  assert.equal(quiet.live, true);
  assert.equal(quiet.updated, 'il y a 1 min');
});

test('rule 27 — a silent house: values muted and dated with its last poll; past 6 h a value is hidden', () => {
  const silent = view({ lastPollAt: new Date(NOW.getTime() - 40 * 60 * 1000).toISOString() });
  assert.equal(block(silent, 'outdoor').state, 'stale');
  assert.equal(block(silent, 'outdoor').at, 'à 20 h 50');
  assert.equal(silent.live, false);
  assert.equal(silent.updated, 'à 20 h 50');
  assert.equal(view({ lastPollAt: null }).updated, null);

  const gone = view({ readings: readingsAt(NOW, 7 * 60 * 60 * 1000) });
  const room = block(gone, 'rooms').items[0];
  assert.deepEqual([room.state, room.temperature, room.min], ['unavailable', null, null]);
  assert.equal(block(gone, 'lights').items[0].on, null);
});

test('rule 25 — no trend; rule 28 — a room shows Sowel’s day min/max, and nothing when Sowel has none', () => {
  const [sejour, chambre] = block(view(), 'rooms').items;
  assert.equal('trend' in sejour, false);
  assert.deepEqual([sejour.min, sejour.max], ['19,8', '22,1']);
  assert.deepEqual([chambre.min, chambre.max], [null, null]);
});

test('rule 25 — rain: only Sowel’s own cumuls, never summed from the bars', () => {
  const noToday = readingsAt(NOW).filter((r) => r.alias !== 'rain_today');
  const hour = 60 * 60 * 1000;
  const end = Math.floor(NOW.getTime() / hour) * hour;
  const series = [{ equipmentId: 'wx', alias: 'rain_1h', buckets: [{ time: new Date(end).toISOString(), value: 1.2 }] }];
  const v = view({ readings: noToday, series });
  assert.deepEqual([block(v, 'rain').today, block(v, 'rain').summary, block(v, 'rain').lastHour], [null, null, '0,4 mm']);
  assert.equal(block(v, 'outdoor').rain, undefined);
});

test('rule 29 — « Réseau »: Sowel’s signed power, shown unsigned with its direction', () => {
  const withGrid = (watts) => block(view({ readings: readingsAt(NOW).map((r) => (r.equipmentId === 'edf' ? { ...r, value: watts } : r)) }), 'grid');
  assert.deepEqual(['power', 'direction', 'label'].map((k) => withGrid(-161.2)[k]), ['160 W', 'export', 'Renvoyé au réseau']);
  assert.deepEqual(['power', 'direction', 'label'].map((k) => withGrid(2310)[k]), ['2,3 kW', 'import', 'Consommé du réseau']);
  assert.deepEqual(['power', 'direction', 'label'].map((k) => withGrid(-4)[k]), ['0 W', 'balanced', 'Équilibre']);
  assert.deepEqual(['power', 'direction'].map((k) => withGrid(0)[k]), ['0 W', 'balanced']);
  const missing = block(view({ readings: readingsAt(NOW).filter((r) => r.equipmentId !== 'edf') }), 'grid');
  assert.deepEqual([missing.power, missing.direction, missing.state], [null, null, 'unavailable']);
});

test('rule 18 — 24 hourly bars ending this hour, scaled on their maximum; a missing hour is null', () => {
  const hour = 60 * 60 * 1000;
  const end = Math.floor(NOW.getTime() / hour) * hour;
  const buckets = [{ time: new Date(end).toISOString(), value: 0.4 }, { time: new Date(end - 2 * hour).toISOString(), value: 1.6 }];
  const { scaled } = hourly({ buckets }, NOW);
  assert.equal(scaled.length, 24);
  assert.deepEqual(scaled.slice(-3), [1, null, 0.25]);
  assert.equal(scaled[0], null);
});

test('rule 13 — a block whose equipment is gone from the catalogue is not shown', () => {
  // date-literal-ok: an injected clock — the model reads no « today »
  const catalog = CATALOG.map((e) => (e.id === 'm-granja' ? { ...e, goneAt: '2026-11-14T10:00:00.000Z' } : e));
  assert.equal(block(view({ catalog }), 'energy'), undefined);
});

test('English: the decimal point and the English phrases', () => {
  const v = view({ lang: 'en' });
  assert.equal(block(v, 'outdoor').temperature, '8.5');
  assert.equal(block(v, 'lights').items[1].status, 'On');
  assert.equal(block(v, 'grid').label, 'Sent to the grid');
  assert.equal(v.updated, '1 min ago');
});

test('rule 4 — the selection: the roles of the switched-on blocks only', () => {
  const saved = blocks().map((b) => (b.kind === 'energy' ? { ...b, on: false } : b));
  const pairs = selectionOf([saved], CATALOG).map((p) => `${p.equipmentId}.${p.alias}`);
  assert.ok(pairs.includes('wx.temperature'));
  assert.ok(pairs.includes('wx.rain_1h'));
  assert.ok(pairs.includes('l-chene.state'));
  assert.ok(!pairs.some((p) => p.startsWith('m-granja.')));
});
