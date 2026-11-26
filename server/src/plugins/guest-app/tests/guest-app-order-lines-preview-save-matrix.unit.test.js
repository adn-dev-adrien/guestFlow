// specs/pricing/pricing-components.md rule 94 reading S14-3 (« the preview prices as the save ») and guest-app rule 110 a — invariant harness of the
// stabilisation loop t16 (apps ga16, made permanent by the sale fixer, 2026-11-17). A stay holding APP-ORDERED lines (a pre-arrival order:
// beer `order:1`, an evening supplement free line `order:2` with its `fulfilmentRef`) is previewed then saved over every platform mode ×
// stay moment × fiche mutation; an accepted save stores exactly the preview's figures.
// The saves refused ARRIVAL_EXTRAS_FROZEN (offering or removing an app line once the arrival is validated) write nothing, and the fiche never
// sends them: the line the mutation touches is frozen by the fiche's own `editLock` (its switch / « Supprimer » are disabled) — the offer of
// an option is the sale panel's line action, which judges itself. Raw API only (status-sale t16 « ga16 »).
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, beer, stay, row, addDaysToIsoDate } = require('../../../tests/saleRound1Fixtures');
const extraSale = require('../../../utils/extraSale');
const ctrl = require('../../../controllers/reservationsController');
const { storedBody } = require('../../../utils/stayOrderLines');

const FIELDS = ['finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'endOfStayComplementAmount'];
const cents = (v) => Math.round(Number(v || 0) * 100);
const figures = (src) => Object.fromEntries(FIELDS.map((f) => [f, cents(src[f])]));
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const call = (handler, body, params = {}) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(p) { resolve({ status: this.statusCode, body: p }); return this; }, set() { return this; }, setHeader() {} };
  Promise.resolve(handler({ body, params, query: {}, user: { role: 'admin', id: 1 }, headers: {} }, res)).catch(reject);
});
const LABEL = 'Supplément soirée bain';
const MOMENTS = {
  pre: { time: '12:00', offset: -2, checkIn: 0 },
  late: { time: '18:00', offset: 0, checkIn: 0 },
  validated: { time: '18:00', offset: 0, checkIn: 1 },
  d1: { time: '12:00', offset: 1, checkIn: 1 },
};
const isBeer = (o) => Number(o.optionId) === beer;
const isSupp = (c) => c.description === LABEL;
const MUTATIONS = {
  none: (b) => b,
  beerPlus: (b) => ({ ...b, options: b.options.map((o) => (isBeer(o) ? { ...o, quantity: Number(o.quantity) + 1 } : o)) }),
  suppPlus: (b) => ({ ...b, customOptions: b.customOptions.map((c) => (isSupp(c) ? { ...c, amount: Number(c.amount) + 5 } : c)) }),
  repeatLabel: (b) => ({ ...b, customOptions: [...b.customOptions, { description: LABEL, amount: 15, offered: false, inComplement: 0 }] }),
  beerOffered: (b) => ({ ...b, options: b.options.map((o) => (isBeer(o) ? { ...o, offered: true } : o)) }),
  suppRemoved: (b) => ({ ...b, customOptions: b.customOptions.filter((c) => !isSupp(c)) }),
};
// The line each mutation touches, as the fiche's lock names it.
const FROZEN_BY_LOCK = {
  beerOffered: (lock) => Boolean((lock.arrivalLines || {})[`opt:${beer}`]),
  suppRemoved: (lock, id) => (lock.frozenCustomOptionIds || []).map(Number)
    .includes(Number(db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ? AND description = ?').get(id, LABEL).id)),
};

let refused = 0;
for (const platform of ['direct', 'Booking']) for (const [moment, m] of Object.entries(MOMENTS)) for (const [mut, apply] of Object.entries(MUTATIONS)) {
  test(`${platform} × ${moment} × ${mut}: the save stores the preview's figures, or refuses a gesture the fiche locks`, async (t) => {
    const id = stay(20);
    if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
    // A booked 300 € direct stay stores its balance (the raw fixture row holds 0).
    db.prepare('UPDATE reservations SET balanceAmount = 300 WHERE id = ?').run(id);
    const orderAt = at(id, '12:00', -3);
    assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 2 }], { now: orderAt, source: 'shop', orderRef: 'order:1' }).status, 200);
    const sold = extraSale.sell(id, [{ articleRef: 'custom', label: LABEL, amount: 20, fulfilmentRef: 'evening:resource:1' }], { now: orderAt, source: 'shop', orderRef: 'order:2' });
    assert.equal(sold.status, 200, JSON.stringify(sold.body));
    if (m.checkIn) db.prepare('UPDATE reservations SET checkInDone = 1 WHERE id = ?').run(id);
    const now = at(id, m.time, m.offset);
    t.mock.timers.enable({ apis: ['Date'], now: now.getTime() });
    const body = JSON.parse(JSON.stringify(apply(storedBody(id))));
    const pv = await call(ctrl.calculatePrice, JSON.parse(JSON.stringify({ ...body, selectedOptions: body.options, selectedResources: body.resources, reservationId: id })));
    assert.equal(pv.status, 200, JSON.stringify(pv.body));
    const lock = (await call(ctrl.getById, undefined, { id: String(id) })).body.editLock || {};
    const before = figures(row(id));
    const saved = ctrl.performUpdate(id, body, { now });
    if (saved.status === 200) {
      assert.deepEqual(figures({ ...pv.body, endOfStayComplementAmount: pv.body.endOfStayComplementTotal }), figures(row(id)));
      return;
    }
    assert.equal(saved.body && saved.body.code, 'ARRIVAL_EXTRAS_FROZEN', JSON.stringify(saved.body));
    assert.deepEqual(figures(row(id)), before, 'a refused save writes nothing');
    assert.ok(FROZEN_BY_LOCK[mut] && FROZEN_BY_LOCK[mut](lock, id), `${mut}: the fiche locks the line it would change`);
    refused += 1;
  });
}

test.after(() => {
  // The matrix keeps its refusals: offering or removing an app line once the arrival is validated (2 platforms × 2 moments × 2 mutations).
  assert.equal(refused, 8);
});
