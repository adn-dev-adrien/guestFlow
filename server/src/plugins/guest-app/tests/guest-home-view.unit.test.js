// specs/guest-app-home-automation.md rules 18-20, 23 — the guest's « Domotique » page as the server writes it:
// rounded, formatted, dated, scaled. The client computes nothing.
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHomeView, number, power, hourly } = require('../homeView');
const { validateHomeBlocks } = require('../homeBlocksValidation');
const { selectionOf } = require('../homeRoles');
const { CATALOG, GRANJA_BLOCKS, readingsAt } = require('./homeFixtures');

// date-literal-ok: an injected clock — the model reads no « today »
const NOW = new Date('2026-11-15T20:30:00Z');
const blocks = () => validateHomeBlocks(GRANJA_BLOCKS, CATALOG, (() => { let n = 0; return () => `item${String(n += 1).padStart(2, '0')}`; })()).blocks;
const view = (over = {}) => buildHomeView({ blocks: blocks(), catalog: CATALOG, readings: readingsAt(NOW), series: [], now: NOW, lang: 'fr', ...over });
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
  assert.deepEqual(v.blocks.map((b) => b.kind), ['outdoor', 'rooms', 'lights', 'rain', 'energy']);
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

test('rule 20 — stale readings are dated and muted; past 6 h they are hidden; the header says when the house last spoke', () => {
  const stale = view({ readings: readingsAt(NOW, 40 * 60 * 1000) });
  assert.equal(block(stale, 'outdoor').state, 'stale');
  assert.equal(block(stale, 'outdoor').at, 'à 20 h 50');
  assert.equal(stale.live, false);
  assert.equal(stale.updated, 'à 20 h 50');

  const gone = view({ readings: readingsAt(NOW, 7 * 60 * 60 * 1000) });
  const room = block(gone, 'rooms').items[0];
  assert.deepEqual([room.state, room.temperature, room.trend], ['unavailable', null, null]);
  assert.equal(block(gone, 'lights').items[0].on, null);
});

test('rule 18 — trend: against a sample at least 25 min older, flat within 0.3 °C, none without history', () => {
  const at = (min) => new Date(NOW.getTime() - min * 60 * 1000).toISOString();
  const withSamples = (samples, value = 21.4) => readingsAt(NOW).map((r) => (r.equipmentId === 't-sejour' && r.alias === 'temperature'
    ? { ...r, value, measuredAt: at(1), samples } : r));
  const trendOf = (samples, value) => block(view({ readings: withSamples(samples, value) }), 'rooms').items[0].trend;
  assert.equal(trendOf([{ at: at(35), value: 20.5 }]), 'up');
  assert.equal(trendOf([{ at: at(35), value: 22.5 }]), 'down');
  assert.equal(trendOf([{ at: at(35), value: 21.3 }]), 'flat');
  assert.equal(trendOf([{ at: at(10), value: 18 }]), null);
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
