// specs/pricing-components.md §3 rules 49, 57 — an article may name a downstream booking (`articleFulfilment`): the registry declares an adapter once, asks it
// only while its owner is live, turns a throwing adapter into a refusal, and `extraSale` confirms the booking inside the sale transaction, before the line is
// written — a taken slot refuses the sale (409 SLOT_TAKEN) and leaves nothing behind. The bath adapter is run through the same cases by the hourly-resources
// plugin's own `bath-fulfilment-contract`.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const registry = require('../plugins/sdk/registry');
const articles = require('../utils/pricing/articles');
const fulfilment = require('../utils/pricing/articleFulfilment');
const extraSale = require('../utils/extraSale');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');

const adapter = (over = {}) => ({
  calls: [], reserve(draft) { this.calls.push(['reserve', draft.resourceId]); return { hold: { id: 'h1', expiresAt: null } }; },
  confirm(hold) { this.calls.push(['confirm', hold && hold.id]); return { ok: true }; },
  release(hold, reason) { this.calls.push(['release', reason]); },
  ...over,
});
let seq = 0;
const newId = () => { seq += 1; return `test-slot-${seq}`; };

test('rule 49 — an adapter lacking a member is refused, an id belongs to one owner (which may declare it again when reloaded)', () => {
  const id = newId();
  assert.throws(() => fulfilment.register(id, { reserve() {}, confirm() {} }), /lacks "release"/);
  fulfilment.register(id, adapter(), { owner: 'one' });
  assert.throws(() => fulfilment.register(id, adapter(), { owner: 'two' }), (err) => err.code === 'DUPLICATE_FULFILMENT');
  assert.throws(() => fulfilment.register(id, adapter()), (err) => err.code === 'DUPLICATE_FULFILMENT');
  fulfilment.register(id, adapter(), { owner: 'one' });
  fulfilment.unregister(id);
});

test('rule 49 — reserve, confirm and release go to the adapter while its owner is live, and to nobody once it is not', () => {
  const id = newId();
  let alive = true;
  const bath = adapter();
  fulfilment.register(id, bath, { owner: 'x', isLive: () => alive });
  assert.deepEqual(fulfilment.reserve(id, { resourceId: 7 }), { hold: { id: 'h1', expiresAt: null } });
  assert.deepEqual(fulfilment.confirm(id, { id: 'h1' }, {}, null), { ok: true });
  fulfilment.release(id, { id: 'h1' }, 'line cancelled');
  assert.deepEqual(bath.calls, [['reserve', 7], ['confirm', 'h1'], ['release', 'line cancelled']]);
  alive = false;
  assert.deepEqual(fulfilment.reserve(id, { resourceId: 7 }), { hold: null });
  assert.deepEqual(fulfilment.confirm(id, null, {}, null), { ok: true });
  assert.equal(bath.calls.length, 3, 'a plugin that is off is not asked');
  fulfilment.unregister(id);
});

test('rule 49 — an adapter that throws refuses, it never lets the error reach the sale', () => {
  const id = newId();
  fulfilment.register(id, adapter({ reserve() { throw new Error('planning down'); }, confirm() { throw new Error('planning down'); } }));
  assert.equal(fulfilment.reserve(id, {}).refusal.code, 'FULFILMENT_FAILED');
  assert.equal(fulfilment.confirm(id, { id: 'h' }, {}, null).refusal.code, 'FULFILMENT_FAILED');
  fulfilment.unregister(id);
});

test('rule 49 — a resource sold by the hour on a planning names the hourly-slot adapter; any other article names none', () => {
  const hourly = articles.makeArticle({ id: 1, name: 'Bain', price: 30, priceType: 'per_hour', showsPlanningCard: 1 }, { kind: 'resource' });
  assert.equal(fulfilment.fulfilmentOf(hourly), 'hourly-slot');
  assert.equal(fulfilment.fulfilmentOf(articles.makeArticle({ id: 2, name: 'Sauna', price: 30, priceType: 'per_hour', showsPlanningCard: 0 }, { kind: 'resource' })), null);
  assert.equal(fulfilment.fulfilmentOf(articles.makeArticle({ id: 3, title: 'Panier', price: 5, priceType: 'per_stay' })), null);
});

// ── extraSale: the booking is confirmed inside the sale transaction ────────────────────────────────────────────────
db.prepare("INSERT INTO properties (id, name, maxGuests, depositEnabled) VALUES (9251, 'Bain', 8, 0)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (9251, 'Camille', 'Bain')").run();
db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (9251, 'Standard', 100)").run();
const resourceId = Number(db.prepare(`INSERT INTO resources (name, price, priceType, showsPlanningCard, slotDuration, openTime, closeTime)
  VALUES ('Bain nordique', 30, 'per_hour', 1, 60, '10:00', '22:00')`).run().lastInsertRowid);
db.prepare('INSERT INTO resource_properties (resourceId, propertyId) VALUES (?, 9251)').run(resourceId);
// A live plugin that owns the `per_hour` price type, as hourly-resources is: its family prices one hour at 30 €.
registry.configure({ isActive: () => true, allows: () => true });
registry.ensure('hourly-resources').priceLineContributor = { id: 'hourly-resources', priceTypes: ['per_hour'], priceLine: () => null };
articles.registerFamily('hourly', {
  id: 'hourly', priceTypes: ['per_hour'], configSchema: [], validate: () => [],
  price: () => ({ quantity: 1, unitPrice: 30, billedUnits: 1, totalPrice: 30, components: [] }), describe: () => ({ label: '', detail: '' }),
}, { owner: 'hourly-resources', isLive: () => true });

function stay() {
  const startDate = addDaysToIsoDate(todayIso(), 30);
  return Number(db.prepare(`INSERT INTO reservations (propertyId, clientId, startDate, endDate, platform, adults, totalPrice, finalPrice, kind, checkInTime)
    VALUES (9251, 9251, ?, ?, 'direct', 2, 300, 300, 'reservation', '15:00')`).run(startDate, addDaysToIsoDate(startDate, 3)).lastInsertRowid);
}
const request = (id) => [{ articleRef: `resource:${resourceId}`, quantity: 1, sessions: [{ date: addDaysToIsoDate(todayIso(), 31), start: '18:00', end: '19:00' }] }];

test('rules 49, 57 — a slot that is taken refuses the sale before anything is written, with SLOT_TAKEN', () => {
  const taken = adapter({
    reserve() { return { hold: { id: 'h-taken', expiresAt: null } }; },
    confirm() { return { refusal: { code: 'SLOT_TAKEN', message: 'Ce créneau n’est plus disponible.' } }; },
  });
  fulfilment.register('hourly-slot', taken, { owner: 'test', isLive: () => true });
  try {
    const id = stay();
    const result = extraSale.sell(id, request(id), { payment: 'later' });
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.code, 'SLOT_TAKEN');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources WHERE reservationId = ?').get(id).n, 0);
    assert.equal(db.prepare('SELECT finalPrice FROM reservations WHERE id = ?').get(id).finalPrice, 300);
  } finally { fulfilment.unregister('hourly-slot'); }
});

test('rules 49, 57 — the quote lists the slot that is not free in its refusals and writes nothing; a free slot is confirmed in the sale', () => {
  const seen = [];
  const bath = adapter({
    reserve(draft) { seen.push(['reserve', draft.sessions.length]); return draft.sessions[0].start === '23:00' ? { refusal: { code: 'SLOT_TAKEN', message: 'pris' } } : { hold: { id: 'h-ok', expiresAt: null } }; },
    confirm(hold, line) { seen.push(['confirm', line.resourceId]); return { ok: true }; },
  });
  fulfilment.register('hourly-slot', bath, { owner: 'test', isLive: () => true });
  try {
    const id = stay();
    const quoted = extraSale.quote(id, request(id));
    assert.deepEqual(quoted.refusals, []);
    const late = [{ articleRef: `resource:${resourceId}`, quantity: 1, sessions: [{ date: addDaysToIsoDate(todayIso(), 31), start: '23:00', end: '24:00' }] }];
    assert.deepEqual(extraSale.quote(id, late).refusals.map((r) => [r.articleRef, r.code]), [[`resource:${resourceId}`, 'SLOT_TAKEN']]);
    const sold = extraSale.sell(id, request(id), { payment: 'later' });
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    assert.deepEqual(seen.filter(([step]) => step === 'confirm'), [['confirm', resourceId]]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_resources WHERE reservationId = ?').get(id).n, 1);
  } finally { fulfilment.unregister('hourly-slot'); }
});
