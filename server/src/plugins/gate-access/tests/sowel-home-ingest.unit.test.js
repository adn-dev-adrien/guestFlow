// specs/guest-app-home-automation.md rules 3-6 — the catalogue, the selection it is answered with, and the readings
// and series of the selected pairs only, overwritten in place.
const test = require('node:test');
const assert = require('node:assert/strict');

const { startHome, freshHome, CATALOG } = require('./homeFixtures');
const { parseCatalog } = require('../homePayloads');

const SELECTION = [{ equipmentId: 'wx', alias: 'temperature' }, { equipmentId: 't-sejour', alias: 'temperature' }];

test('rules 3-4 — the catalogue is stored whole and answered with the lodgings’ selection', async (t) => {
  const home = await startHome({ selection: () => SELECTION });
  t.after(home.close);
  const res = await home.call('PUT', '/public/v1/home/catalog', { equipments: CATALOG });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { selection: SELECTION });
  const stored = home.model.catalog();
  assert.deepEqual(stored.map((e) => e.id).sort(), ['l-chene', 't-sejour', 'wx']);
  assert.equal(stored.find((e) => e.id === 'l-chene').guestSwitchable, true);
  assert.equal(stored.find((e) => e.id === 'wx').guestSwitchable, false);
  assert.equal(home.model.channel().equipments, 3);
});

test('rule 13 — an equipment missing from the next catalogue is marked gone, and comes back when listed again', () => {
  const { model } = freshHome();
  // date-literal-ok: an injected clock — the model reads no « today »
  model.replaceCatalog(parseCatalog({ equipments: CATALOG }).value, new Date('2026-11-15T10:00:00Z'));
  // date-literal-ok: an injected clock — the model reads no « today »
  model.replaceCatalog(parseCatalog({ equipments: CATALOG.filter((e) => e.id !== 't-sejour') }).value, new Date('2026-11-15T11:00:00Z'));
  // date-literal-ok: an injected clock — the model reads no « today »
  assert.equal(model.catalog().find((e) => e.id === 't-sejour').goneAt, '2026-11-15T11:00:00.000Z');
  assert.equal(model.channel().equipments, 2);
  // date-literal-ok: an injected clock — the model reads no « today »
  model.replaceCatalog(parseCatalog({ equipments: CATALOG }).value, new Date('2026-11-15T12:00:00Z'));
  assert.equal(model.catalog().find((e) => e.id === 't-sejour').goneAt, null);
});

test('rule 3 — a light may be entrusted to guests, nothing else', () => {
  const sensor = { ...CATALOG[1], guestSwitchable: true };
  const parsed = parseCatalog({ equipments: [sensor] });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.field, 'equipments.0.guestSwitchable');
});

test('a single bad field refuses the whole catalogue, and nothing is stored', async (t) => {
  const home = await startHome();
  t.after(home.close);
  const bad = [...CATALOG, { id: 'gate', name: 'Portail', zonePath: '', type: 'gate', readings: [] }];
  const res = await home.call('PUT', '/public/v1/home/catalog', { equipments: bad });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.details.field, 'equipments.3.type');
  assert.equal(home.model.catalog().length, 0);
});

test('rules 5-6 — only selected pairs of a present equipment are stored; the rest is dropped', async (t) => {
  const home = await startHome({ selection: () => SELECTION });
  t.after(home.close);
  await home.call('PUT', '/public/v1/home/catalog', { equipments: CATALOG });
  const at = new Date().toISOString();
  const res = await home.call('POST', '/public/v1/home/readings', { readings: [
    { equipmentId: 'wx', alias: 'temperature', value: 8.6, unit: '°C', measuredAt: at },
    { equipmentId: 'wx', alias: 'rain_1h', value: 0.4, unit: 'mm', measuredAt: at },
    { equipmentId: 'unknown', alias: 'temperature', value: 20, unit: '°C', measuredAt: at },
  ] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { stored: 1, dropped: 2 });
  const [reading] = home.model.readings([{ equipmentId: 'wx', alias: 'temperature' }]);
  assert.equal(reading.value, 8.6);
  assert.equal(home.model.readings([{ equipmentId: 'wx', alias: 'rain_1h' }]).length, 0);
});

test('rule 5 — a reading overwrites the previous one and keeps 45 minutes of samples for the trend', () => {
  const { model } = freshHome();
  // date-literal-ok: an injected clock — the model reads no « today »
  model.replaceCatalog(parseCatalog({ equipments: CATALOG }).value, new Date('2026-11-15T10:00:00Z'));
  const pair = { equipmentId: 't-sejour', alias: 'temperature' };
  const push = (minute, value) => model.storeReadings(
    // date-literal-ok: an injected clock — the model reads no « today »
    [{ ...pair, value, unit: '°C', measuredAt: `2026-11-15T10:${String(minute).padStart(2, '0')}:00.000Z` }],
    [pair],
    // date-literal-ok: an injected clock — the model reads no « today »
    new Date(`2026-11-15T10:${String(minute).padStart(2, '0')}:05Z`),
  );
  push(0, 19);
  push(30, 20);
  push(50, 21);
  const [reading] = model.readings([pair]);
  assert.equal(reading.value, 21);
  assert.deepEqual(reading.samples.map((s) => s.value), [20, 21]);
});

test('rule 5 — series: 24 buckets at most, sorted, overwritten; an unselected series is dropped', async (t) => {
  const pair = { equipmentId: 'wx', alias: 'rain_1h' };
  const home = await startHome({ selection: () => [pair] });
  t.after(home.close);
  // date-literal-ok: an injected clock — the model reads no « today »
  const buckets = Array.from({ length: 24 }, (_, i) => ({ time: new Date(Date.UTC(2026, 10, 15, i)).toISOString(), value: i / 10 })).reverse();
  const res = await home.call('POST', '/public/v1/home/series', { series: [
    { ...pair, buckets },
    { equipmentId: 'm', alias: 'energy_hour', buckets: [] },
  ] });
  assert.deepEqual(res.body, { stored: 1, dropped: 1 });
  const [series] = home.model.series([pair]);
  assert.equal(series.buckets.length, 24);
  assert.equal(series.buckets[0].value, 0);
  const tooMany = await home.call('POST', '/public/v1/home/series', { series: [{ ...pair, buckets: [...buckets, buckets[0]] }] });
  assert.equal(tooMany.status, 400);
});

test('a negative rain or energy bucket is refused', async (t) => {
  const home = await startHome({ selection: () => [{ equipmentId: 'wx', alias: 'rain_1h' }] });
  t.after(home.close);
  const res = await home.call('POST', '/public/v1/home/series', { series: [
    { equipmentId: 'wx', alias: 'rain_1h', buckets: [{ time: new Date().toISOString(), value: -1 }] },
  ] });
  assert.equal(res.status, 400);
});
