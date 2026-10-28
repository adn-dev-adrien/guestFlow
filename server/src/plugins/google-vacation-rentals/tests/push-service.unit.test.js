// specs/google-vacation-rentals-feed.md rules 10-16, §7 « Diff », « pricing.changed → one debounced
// run », « Simulation mode never calls fetch ». The state is hand-built; the snapshot, the log and the
// client are the real ones.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const silent = console.log;
console.log = () => {};
const db = require('../../../database');
const { applyPluginSchema } = require('../../sdk/testing');
console.log = silent;
const { buildModel } = require('../model');
const { createSettings } = require('../settings');
const { createGoogleClient } = require('../googleClient');
const { createPushService, DEBOUNCE_MS } = require('../pushService');
const { memoryStore, DEFAULTS } = require('./memoryStore');

applyPluginSchema(db, 'google-vacation-rentals');

const PROPERTIES = [{ id: 1, name: 'La Granja' }, { id: 2, name: 'L’Estiva' }];

function rate(checkin, nights, guests, euros) {
  return { checkin, nights, guests, amountCents: euros * 100, beforeTaxCents: euros * 100 - 240 };
}
function day(date, inventory = 1) {
  return { date, inventory, minLos: 2, maxLos: null, closedToArrival: 0, closedToDeparture: 0, closed: 0 };
}
function stateOf(rates, days) {
  return {
    rates: new Map(rates.map((r) => [`${r.checkin}|${r.nights}|${r.guests}`, r])),
    days: new Map(days.map((d) => [d.date, d])),
    sizes: [1, 2],
    quotes: rates.length,
  };
}
const BASE_RATES = [rate('2027-03-06', 2, 1, 640), rate('2027-03-06', 2, 2, 642), rate('2027-03-07', 2, 1, 640), rate('2027-03-07', 2, 2, 642)];
const BASE_DAYS = [day('2027-03-06'), day('2027-03-07'), day('2027-03-08')];

// A fresh world per test: its own data directory, settings, fetch stub, timers.
function world({ values = {}, respond = () => ({ status: 200, body: '<RS><Success/></RS>' }), now = () => new Date('2027-03-01T04:10:00') } = {}) {
  db.exec('DELETE FROM gvr_rate_snapshot; DELETE FROM gvr_day_snapshot; DELETE FROM gvr_push_log;');
  const store = memoryStore({
    properties: JSON.stringify({ 1: { enabled: true, hotelCode: 'solio-la-granja' }, 2: { enabled: true, hotelCode: 'solio-estiva' } }),
    ...values,
  }, DEFAULTS);
  const settings = createSettings({ store, listProperties: () => PROPERTIES });
  const model = buildModel(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gvr-'));
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init.body });
    const r = respond(url, init.body);
    return { status: r.status, text: async () => r.body };
  };
  const client = createGoogleClient({ mode: settings.mode, dataDir: () => dir, fetchImpl });
  const w = {
    store, settings, model, dir, calls, state: stateOf(BASE_RATES, BASE_DAYS), loads: [], timers: [],
  };
  const timers = {
    setTimeout: (fn, ms) => { const t = { fn, ms }; w.timers.push(t); return t; },
    clearTimeout: (t) => { w.timers = w.timers.filter((x) => x !== t); },
  };
  w.push = createPushService({
    settings,
    model,
    client,
    loadState: async (property, opts) => { w.loads.push({ id: property.id, ...opts }); return w.state; },
    capacityOf: () => 14,
    today: () => '2027-03-01',
    now,
    timers,
    log: { error: () => {} },
  });
  return w;
}

test('rule 15 — simulation: every message is written to the data directory, fetch is never called', async () => {
  const w = world();
  const [run] = await w.push.runAll({ propertyId: 1, full: true, reason: 'full' });
  assert.equal(run.result, 'simulated');
  assert.equal(w.calls.length, 0, 'nothing leaves the server');
  const files = fs.readdirSync(path.join(w.dir, 'simulation', 'property-1'));
  assert.deepEqual(files, ['001-property-data.xml', '002-inventory.xml', '003-restrictions.xml', '004-rates-1.xml']);
  assert.match(fs.readFileSync(path.join(w.dir, 'simulation', 'property-1', '004-rates-1.xml'), 'utf8'), /HotelCode="solio-la-granja"/);
  assert.equal(w.model.countRates(1), 4, 'the snapshot holds what « was sent »');
  const [logged] = w.model.listLog(1);
  assert.equal(logged.result, 'simulated');
  assert.equal(logged.rates, 4);
});

test('rule 10 — an unchanged state sends nothing; one changed price sends one rate message, its stay only', async () => {
  const w = world({ values: { mode: 'envoi', partnerId: 'solio_partner' } });
  await w.push.runProperty(1, { full: true, reason: 'full' });
  w.calls.length = 0;
  const same = await w.push.runProperty(1, { reason: 'pricing' });
  assert.equal(same.result, 'unchanged');
  assert.equal(w.calls.length, 0);

  w.state = stateOf([...BASE_RATES.slice(0, 3), rate('2027-03-07', 2, 2, 700)], BASE_DAYS);
  const changed = await w.push.runProperty(1, { reason: 'pricing' });
  assert.equal(changed.result, 'ok');
  assert.equal(w.calls.length, 1);
  assert.match(w.calls[0].url, /\/travel\/hotels\/uploads\/ota\/hotel_rate_amount_notif$/);
  // Every party size of the changed stay travels together; the unchanged stay does not.
  assert.match(w.calls[0].body, /Start="2027-03-07"/);
  assert.doesNotMatch(w.calls[0].body, /Start="2027-03-06"/);
  assert.match(w.calls[0].body, /AmountAfterTax="700.00"[^>]*NumberOfGuests="2"/);
  assert.match(w.calls[0].body, /AmountAfterTax="640.00"[^>]*NumberOfGuests="1"/);
  assert.equal(w.model.rateSnapshot(1).get('2027-03-07|2|2'), 70000);
});

test('rule 6 — a night that becomes booked sends inventory and restrictions, not the prices', async () => {
  const w = world({ values: { mode: 'envoi', partnerId: 'solio_partner' } });
  await w.push.runProperty(1, { full: true, reason: 'full' });
  w.calls.length = 0;
  w.state = stateOf(BASE_RATES.slice(0, 2), [day('2027-03-06'), day('2027-03-07', 0), day('2027-03-08')]);
  const run = await w.push.runProperty(1, { reason: 'availability' });
  assert.deepEqual(w.calls.map((c) => c.url.split('/uploads/')[1]), ['ota/hotel_inv_count_notif', 'ota/hotel_avail_notif']);
  assert.match(w.calls[0].body, /Start="2027-03-07" End="2027-03-07"[\s\S]*Count="0"/);
  assert.equal(run.rates, 0);
  // The stays no longer sold leave the snapshot, so they are priced again once free.
  assert.equal(w.model.countRates(1), 2);
  assert.ok(w.loads[w.loads.length - 1].reuse instanceof Map, 'a reservation run reuses the amounts already sent');
});

test('rule 14 — a failed send leaves its part of the snapshot unchanged, and Google\'s answer is kept', async () => {
  const w = world({
    values: { mode: 'envoi', partnerId: 'solio_partner' },
    respond: (url) => (url.endsWith('hotel_rate_amount_notif')
      ? { status: 200, body: '<RS><Errors><Error Type="3" Code="392">Invalid hotel code</Error></Errors></RS>' }
      : { status: 200, body: '<RS><Success/></RS>' }),
  });
  const run = await w.push.runProperty(1, { reason: 'manual' });
  assert.equal(run.result, 'error');
  assert.equal(run.failed, 4);
  assert.equal(w.model.countRates(1), 0, 'no rate committed');
  assert.equal(w.model.daySnapshot(1).size, 3, 'the days Google accepted are committed');
  const logged = w.model.lastLog(1);
  assert.equal(logged.httpStatus, 200);
  assert.match(logged.googleBody, /Invalid hotel code/);
  assert.equal(w.model.lastError().id, logged.id);
  w.calls.length = 0;
  await w.push.runProperty(1, { reason: 'manual' });
  assert.equal(w.calls.length, 1, 'the next run sends the rates again, and only them');
});

test('rule 14 — a timeout or a network error is a failure with its message, never thrown', async () => {
  const w = world({ values: { mode: 'envoi', partnerId: 'solio_partner' } });
  const client = createGoogleClient({ mode: () => 'envoi', dataDir: () => w.dir, fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  const res = await client.send({ path: 'ota/hotel_avail_notif', xml: '<x/>', folder: 'p', file: 'f.xml' });
  assert.deepEqual({ ok: res.ok, errors: res.errors }, { ok: false, errors: ['ECONNRESET'] });
  const slow = createGoogleClient({
    mode: () => 'envoi',
    dataDir: () => w.dir,
    timeoutMs: 5,
    fetchImpl: (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  });
  const timedOut = await slow.send({ path: 'ota/hotel_avail_notif', xml: '<x/>', folder: 'p', file: 'f.xml' });
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.errors[0], /Délai dépassé/);
});

test('rule 12 — pricing.changed: one debounced run per property; two events within 30 s, one run', async () => {
  const w = world({ values: { partnerId: 'solio_partner' } });
  w.push.schedule(1, 'pricing');
  w.push.schedule(1, 'pricing');
  assert.equal(w.timers.length, 1);
  assert.equal(w.timers[0].ms, DEBOUNCE_MS.pricing);
  assert.equal(DEBOUNCE_MS.pricing, 30000);
  w.timers[0].fn();
  await w.push.runProperty(1, { reason: 'noop-wait' });
  assert.deepEqual(w.loads.map((l) => l.id), [1, 1], 'the debounced run, then the awaited one');
  assert.equal(w.loads[0].reuse, null, 'a price change recomputes every amount');
});

test('rule 11 — a reservation run is due within a minute; a price change joining it makes it a pricing run', () => {
  const w = world({ values: { partnerId: 'solio_partner' } });
  w.push.schedule(2, 'availability');
  assert.ok(w.timers[0].ms <= 60000);
  assert.equal(w.push.pendingKind(2), 'availability');
  w.push.schedule(2, 'pricing');
  assert.equal(w.timers.length, 1);
  assert.equal(w.push.pendingKind(2), 'pricing');
});

test('rule 12 — null means every enabled property; a disabled one is never scheduled', () => {
  const w = world({ values: { partnerId: 'solio_partner', properties: JSON.stringify({ 1: { enabled: true }, 2: { enabled: false } }) } });
  assert.deepEqual(w.push.schedule(null, 'pricing'), [1]);
  assert.deepEqual(w.push.schedule(2, 'pricing'), []);
});

test('rule 2 — without a partner id no trigger fires, but a manual run works (simulation)', async () => {
  const w = world();
  assert.deepEqual(w.push.schedule(1, 'pricing'), []);
  assert.equal(w.timers.length, 0);
  assert.equal(await w.push.nightlyTick(), false);
  const [run] = await w.push.runAll({ propertyId: 1 });
  assert.equal(run.result, 'simulated');
});

test('rule 13 — the hourly job runs the full re-send at the configured hour, once a day', async () => {
  let clock = new Date('2027-03-01T04:10:00');
  const w = world({ values: { partnerId: 'solio_partner' }, now: () => clock });
  assert.equal(await w.push.nightlyTick(), true);
  assert.deepEqual(w.loads.map((l) => l.id), [1, 2]);
  assert.ok(w.model.listLog(5).every((r) => r.full === 1 && r.reason === 'nightly'));
  clock = new Date('2027-03-01T04:50:00');
  assert.equal(await w.push.nightlyTick(), false, 'already done today');
  // The job ticks every hour: only the configured one runs the re-send.
  for (let h = 5; h < 24; h += 1) {
    clock = new Date(`2027-03-01T${String(h).padStart(2, '0')}:10:00`);
    assert.equal(await w.push.nightlyTick(), false, `not the hour (${h}h)`);
  }
  for (let h = 0; h < 4; h += 1) {
    clock = new Date(`2027-03-02T${String(h).padStart(2, '0')}:10:00`);
    assert.equal(await w.push.nightlyTick(), false, `not the hour (${h}h)`);
  }
  clock = new Date('2027-03-02T04:05:00');
  assert.equal(await w.push.nightlyTick(), true);
});

test('rule 17 of the removal spec — a plugin switched off and on again re-sends everything at its next tick', async () => {
  let clock = new Date('2027-03-01T10:10:00');
  const w = world({ values: { partnerId: 'solio_partner' }, now: () => clock });
  assert.equal(await w.push.nightlyTick(), false, 'the first tick of a process has nothing to compare to');
  clock = new Date('2027-03-01T11:10:00');
  assert.equal(await w.push.nightlyTick(), false, 'an hourly cadence is no silence');
  assert.equal(w.loads.length, 0);
  // Switched off at 11:30: its ticks and its triggers are skipped. Back on, the next tick is at 15:10.
  w.state = stateOf([...BASE_RATES.slice(0, 3), rate('2027-03-07', 2, 2, 700)], BASE_DAYS);
  clock = new Date('2027-03-01T15:10:00');
  assert.equal(await w.push.nightlyTick(), true);
  assert.deepEqual(w.loads.map((l) => l.id), [1, 2]);
  assert.ok(w.model.listLog(5).every((r) => r.full === 1 && r.reason === 'catch-up'));
  assert.equal(w.model.rateSnapshot(1).get('2027-03-07|2|2'), 70000, 'the price changed while off reached the snapshot');
  clock = new Date('2027-03-01T16:10:00');
  assert.equal(await w.push.nightlyTick(), false);
});

test('runs of a property never overlap', async () => {
  const w = world();
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const push = createPushService({
    settings: w.settings,
    model: w.model,
    client: { beginRun: () => {}, send: async () => ({ ok: true, status: null, warnings: [], errors: [] }) },
    loadState: async (property, { reuse }) => {
      order.push(`start-${reuse ? 'b' : 'a'}`);
      if (!reuse) await gate;
      order.push(`end-${reuse ? 'b' : 'a'}`);
      return w.state;
    },
    capacityOf: () => 14,
    today: () => '2027-03-01',
    log: { error: () => {} },
  });
  const a = push.runProperty(1, { reason: 'pricing' });
  const b = push.runProperty(1, { reason: 'availability' });
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.deepEqual(order, ['start-a']);
  release();
  await Promise.all([a, b]);
  assert.deepEqual(order, ['start-a', 'end-a', 'start-b', 'end-b']);
});
