// specs/pricing/pricing-components.md §3 rule 94 (« a new free line whose label exists gets « (2) »; its discount, its payment and its removal stay its
// own ») — invariant harness of the stabilisation loop t16 (sale `pb.js`, made permanent by the sale fixer, 2026-11-17). Every path that writes
// free lines × every label variant:
//   I1 a booking never holds two free rows of one key (`extraLineKey`: trimmed, lower-cased, inner spaces collapsed);
//   I2 every posted line with a label and an amount is stored, and nothing else (a blank or 0 € line is no line, never a « (2) »);
//   I3 the preview of the same lines prices the stored keys (new booking, devis, stored stay);
//   I5 identity: a renamed row keeps its lineId / moment / sale date / discount; a line removed and typed again in one save is a NEW row
//      (fresh lineId, no discount) — S16-3 b; a paid line cannot leave that way (409 LINE_PAID);
//   SAS: a re-run that changes only an item's case keeps its row (S16-3 c).
// Members found failing in t16: S16-3 a (a 0 € line counted by the numbering: a lone « Ménage (2) »), b (remove + re-add handed the removed
// row's lineId and discount to the new line), c (SAS re-run with a case change re-created the row).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const devisModel = require('../models/devisModel');
const reservations = require('../models/reservationsModel');
const { storedBody } = require('../utils/stayOrderLines');
const { extraLineKey } = require('../utils/pricing/storedLines');
const { withNow } = require('../utils/localDate');

const cents = (x) => Math.round(Number(x || 0) * 100);
const key = (d) => extraLineKey({ isCustom: true, description: d });
const call = (fn, body, params = {}) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, set() { return this; }, setHeader() {}, end() { resolve({ status: this.statusCode }); } };
  Promise.resolve(fn({ body, params, query: {}, user: { role: 'admin', id: 1 }, headers: {} }, res)).catch(reject);
});
const rowsOf = (id) => db.prepare('SELECT id, lineId, description, amount, offered, discountCents, collectAt, soldAt, sasArrivalOrigin FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(id);
// A line typed on the fiche: no stored row, `newLine` (client `customOptionsPayload`).
const lineOf = ([description, amount], i) => ({ customKey: `custom_${i + 1}`, description, amount, offered: false, inComplement: 0, newLine: true });
const pvPriced = (quote) => (quote.optionLines || []).filter((l) => l.isCustom).map((l) => `${l.key}:${cents(l.totalPrice)}`).sort();
const stPriced = (id) => rowsOf(id).filter((r) => !r.offered).map((r) => `${key(r.description)}:${cents(r.amount) - Number(r.discountCents || 0)}`).sort();
const noDuplicateKey = (id) => {
  const keys = rowsOf(id).map((r) => key(r.description));
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], `I1 ${JSON.stringify(rowsOf(id).map((r) => r.description))}`);
};
const savepoint = async (fn) => {
  db.exec('SAVEPOINT pb');
  try { await fn(); } finally { db.exec('ROLLBACK TO pb'); db.exec('RELEASE pb'); }
};

const VARIANTS = {
  same: [['Ménage', 20], ['Ménage', 20]],
  caseSpace: [['Ménage', 20], ['  mÉnage  ', 20]],
  triple: [['Ménage', 20], ['Ménage', 20], ['Ménage', 20]],
  typedNum: [['Ménage (2)', 20], ['Ménage', 20], ['Ménage', 20]],
  innerSpace: [['Bois  sec', 10], ['bois sec', 10]],
  blank: [['', 10], ['', 10]],
  blankMix: [['', 10], ['Ménage', 20], ['   ', 10], ['Ménage', 20]],
  zeroFirst: [['Ménage', 0], ['Ménage', 20]],
  zeroLast: [['Ménage', 20], ['Ménage', 0]],
  distinct: [['Ménage', 20], ['Bois', 10]],
};
const expectedCount = (v) => VARIANTS[v].filter(([d, a]) => String(d).trim() && a > 0).length;

const dates = (() => { const s = row(stay(60)); return [s.startDate, s.endDate]; })();
const newBooking = (lines, extra = {}) => ({
  propertyId: 9701, clientId: 9701, startDate: dates[0], endDate: dates[1], adults: 2, children: 0, teens: 0, babies: 0, singleBeds: 0, doubleBeds: 1,
  babyBeds: 0, platform: 'direct', checkInTime: '15:00', checkOutTime: '10:00', options: [], selectedOptions: [], resources: [], selectedResources: [],
  customOptions: lines, ...extra,
});
db.prepare('DELETE FROM reservations WHERE startDate = ?').run(dates[0]);

for (const variant of Object.keys(VARIANTS)) {
  test(`new booking × ${variant}: creation, its preview, the devis write and its conversion store one row per key, as previewed`, async () => {
    const lines = () => VARIANTS[variant].map(lineOf);
    await savepoint(async () => {
      const preview = await call(ctrl.calculatePrice, newBooking(lines()));
      const created = await call(ctrl.create, newBooking(lines()));
      const id = created.body && (created.body.id || created.body.reservationId);
      assert.ok(id, JSON.stringify(created.body));
      noDuplicateKey(id);
      assert.equal(rowsOf(id).length, expectedCount(variant), 'I2 create');
      assert.deepEqual(pvPriced(preview.body), stPriced(id), 'I3 create');
    });
    await savepoint(async () => {
      const made = devisModel.create(newBooking(lines(), { kind: 'devis' }));
      assert.ok(made.ok, JSON.stringify(made));
      const devisId = made.data.id;
      const preview = await call(ctrl.calculatePrice, newBooking(lines(), { devisId }));
      noDuplicateKey(devisId);
      assert.equal(rowsOf(devisId).length, expectedCount(variant), 'I2 devis');
      assert.deepEqual(pvPriced(preview.body), stPriced(devisId), 'I3 devis');
      const converted = devisModel.convertToReservation(devisId);
      if (converted.data && converted.data.reservationId) noDuplicateKey(converted.data.reservationId);
    });
  });
}

// Stored stays: a free « Bois » 15 € sold from the sale panel at J-3 and discounted 2 € (its identity is visible), then a fiche gesture at a moment.
const MOMENTS = { pre: { offset: -3, checkIn: 0 }, mid: { offset: 1, checkIn: 1 }, after: { offset: 5, checkIn: 1, unlock: true } };
const GESTURES = {
  addSame: (b) => b.customOptions.push(lineOf(['Bois', 10], 90)),
  addCase: (b) => b.customOptions.push(lineOf(['  BOIS ', 10], 90)),
  addTypedNum: (b) => b.customOptions.push(lineOf(['Bois (2)', 10], 90), lineOf(['Bois', 10], 91)),
  addTwoSame: (b) => b.customOptions.push(lineOf(['Pain', 4], 90), lineOf(['pain', 4], 91)),
  addZero: (b) => b.customOptions.push(lineOf(['Pain', 0], 90), lineOf(['Pain', 4], 91)),
  rename: (b) => { b.customOptions = b.customOptions.map((x) => (x.description === 'Bois' ? { ...x, description: 'Bûches' } : x)); },
  renameCase: (b) => { b.customOptions = b.customOptions.map((x) => (x.description === 'Bois' ? { ...x, description: 'BOIS' } : x)); },
  renameSwap: (b) => { b.customOptions = b.customOptions.map((x) => (x.description === 'Bois' ? { ...x, description: 'Bûches' } : x)); b.customOptions.push(lineOf(['Bois', 10], 90)); },
  removeAddSame: (b) => { b.customOptions = b.customOptions.filter((x) => x.description !== 'Bois'); b.customOptions.push(lineOf(['Bois', 10], 90)); },
};
const RENAMES = new Set(['rename', 'renameCase', 'renameSwap']);

for (const [moment, m] of Object.entries(MOMENTS)) {
  for (const [gesture, apply] of Object.entries(GESTURES)) {
    test(`stored stay × ${moment} × ${gesture}: one row per key, previewed as stored, identity kept by its row only`, async (t) => {
      for (const priced of [false, true]) {
        await savepoint(async () => {
          const id = stay(20);
          const start = row(id).startDate;
          t.mock.timers.enable({ apis: ['Date'], now: new Date(`${addDaysToIsoDate(start, -3)}T12:00:00`).getTime() });
          try {
            assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Bois', amount: 15 }], { now: new Date() }).status, 200);
            const sold = rowsOf(id).find((r) => r.description === 'Bois');
            assert.equal(extraSale.changeLine(id, `custom:${sold.lineId}`, { discount: { amount: 2 } }, { now: new Date() }).status, 200);
            const bois = rowsOf(id).find((r) => r.description === 'Bois');
            t.mock.timers.setTime(new Date(`${addDaysToIsoDate(start, m.offset)}T12:00:00`).getTime());
            db.prepare('UPDATE reservations SET checkInDone = ? WHERE id = ?').run(m.checkIn, id);
            const body = storedBody(id);
            apply(body);
            if (priced) body.restatePricing = true;
            const preview = await call(ctrl.calculatePrice, JSON.parse(JSON.stringify({
              ...body, selectedOptions: body.options, selectedResources: body.resources, reservationId: id, ...(m.unlock ? { unlockPast: true } : {}),
            })));
            const saved = ctrl.performUpdate(id, JSON.parse(JSON.stringify(body)), { now: new Date(), unlockPast: Boolean(m.unlock) });
            if (saved.status !== 200) {
              // The started fiche refuses a rename (its lines are keyed by their text there) or a lowered arrival line.
              assert.ok(['ARRIVAL_LINE_RENAME', 'ARRIVAL_EXTRAS_FROZEN', 'UNLOCKED_PRICE_CHANGED'].includes(saved.body && saved.body.code), JSON.stringify(saved.body));
              return;
            }
            noDuplicateKey(id);
            assert.deepEqual(pvPriced(preview.body), stPriced(id), 'I3');
            const after = rowsOf(id);
            const same = after.find((r) => r.lineId === bois.lineId);
            if (gesture === 'removeAddSame') {
              assert.equal(same, undefined, 'the removed row is gone');
              const fresh = after.find((r) => key(r.description) === 'custom:bois');
              assert.ok(fresh && fresh.lineId !== bois.lineId, 'the re-typed line is a new line');
              assert.equal(Number(fresh.discountCents || 0), 0, 'the removed line\'s discount left with it');
              assert.equal(cents(fresh.amount), 1000);
              return;
            }
            assert.ok(same, 'the Bois row keeps its lineId');
            assert.deepEqual([same.discountCents, same.collectAt, same.soldAt], [bois.discountCents, bois.collectAt, bois.soldAt], 'I5 facts');
            if (RENAMES.has(gesture)) assert.notEqual(same.description, 'Bois');
            for (const other of after.filter((r) => r.lineId !== bois.lineId)) assert.equal(Number(other.discountCents || 0), 0, 'a new row carries no discount');
          } finally {
            t.mock.timers.reset();
          }
        });
      }
    });
  }
}

test('S16-3 b — a PAID free line removed and typed again in one save is refused (LINE_PAID): the new line never inherits its money', async (t) => {
  await savepoint(async () => {
    const id = stay(20);
    t.mock.timers.enable({ apis: ['Date'], now: new Date(`${addDaysToIsoDate(row(id).startDate, -3)}T12:00:00`).getTime() });
    try {
      const sold = extraSale.sell(id, [{ articleRef: 'custom', label: 'Ménage', amount: 20 }], { now: new Date(), source: 'shop', paid: { amountCents: 2000, ref: 'card-t16' }, orderRef: 'order:t16' });
      assert.equal(sold.status, 200, JSON.stringify(sold.body));
      const before = rowsOf(id);
      const body = storedBody(id);
      body.customOptions = body.customOptions.filter((x) => x.description !== 'Ménage');
      body.customOptions.push(lineOf(['Ménage', 20], 90));
      const saved = ctrl.performUpdate(id, body, { now: new Date() });
      assert.equal(saved.status, 409, JSON.stringify(saved.body));
      assert.equal(saved.body.code, 'LINE_PAID');
      assert.deepEqual(rowsOf(id), before, 'nothing written');
    } finally {
      t.mock.timers.reset();
    }
  });
});

test('rule 19 — a caller that names neither the row nor a new line (raw API, an older form) is still matched by its text', async (t) => {
  await savepoint(async () => {
    const id = stay(20);
    t.mock.timers.enable({ apis: ['Date'], now: new Date(`${addDaysToIsoDate(row(id).startDate, -3)}T12:00:00`).getTime() });
    try {
      assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Bois', amount: 15 }], { now: new Date() }).status, 200);
      const bois = rowsOf(id)[0];
      const body = storedBody(id);
      body.customOptions = [{ customKey: 'legacy', description: 'Bois', amount: 15, offered: false, inComplement: 0 }];
      assert.equal(ctrl.performUpdate(id, body, { now: new Date() }).status, 200);
      assert.deepEqual(rowsOf(id).map((r) => r.lineId), [bois.lineId]);
    } finally {
      t.mock.timers.reset();
    }
  });
});

test('S16-3 c — an arrival SAS re-run that changes only the case of its items keeps their rows (same lineId), as the fiche does', async (t) => {
  await savepoint(async () => {
    const id = stay(20);
    const s = row(id);
    const door = new Date(`${s.startDate}T15:00:00`);
    t.mock.timers.enable({ apis: ['Date'], now: door.getTime() });
    try {
      db.prepare('UPDATE reservations SET checkInDone = 0, arrivalSasDoneAt = NULL WHERE id = ?').run(id);
      withNow(door, () => reservations.commitArrivalSas(id, { complementItems: [{ label: 'Drap', amount: 8 }, { label: 'drap', amount: 8 }] }));
      const first = rowsOf(id).filter((r) => r.sasArrivalOrigin === 1);
      assert.deepEqual(first.map((r) => r.description), ['Drap', 'drap (2)']);
      withNow(door, () => reservations.commitArrivalSas(id, { complementItems: [{ label: 'DRAP', amount: 8 }, { label: 'drap', amount: 8 }] }));
      const second = rowsOf(id).filter((r) => r.sasArrivalOrigin === 1);
      assert.deepEqual(second.map((r) => r.lineId), first.map((r) => r.lineId));
      assert.deepEqual(second.map((r) => r.description), ['DRAP', 'drap (2)']);
      noDuplicateKey(id);
    } finally {
      t.mock.timers.reset();
    }
  });
});
