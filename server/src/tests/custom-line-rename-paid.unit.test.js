// specs/pricing-components.md §3 rule 123 (stabilisation loop t11, S11-1, 2026-11-17) — a free (custom) line is keyed by its label, and so is
// the money that paid it (a card note, a platform stay's collected arrival complement). Renamed in the fiche, the line kept its `lineId` but
// the note's key no longer found it: the arrival recap listed the line as still to pay while the commit asked nothing. The save is now
// refused (409 LINE_PAID_RENAMED, « Ligne déjà payée : son libellé ne change pas. ») and the fiche's lock names those lines
// (`editLock.paidCustomOptionIds`) so their label is greyed.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const reservationsModel = require('../models/reservationsModel');
const { storedBody } = require('../utils/stayOrderLines');

const respond = () => ({ statusCode: 200, body: null, status(s) { this.statusCode = s; return this; }, json(b) { this.body = b; return this; } });
const call = (handler, params, body) => { const res = respond(); handler({ params, body, query: {}, user: { id: 1, role: 'admin' } }, res); return res; };
const at = (id, time, offset) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);
const RENAMED = 'Ligne déjà payée : son libellé ne change pas.';
const labels = (id) => db.prepare('SELECT description FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id).map((r) => r.description);
const renamed = (id, from, to) => {
  const body = storedBody(id);
  body.customOptions = body.customOptions.map((c) => (c.description === from ? { ...c, description: to } : c));
  return body;
};
const paidIds = (id, now) => {
  const lock = reservationsModel.getEditLock(id, { today: now.toISOString().slice(0, 10), nowTime: '12:00', now });
  return lock.paidCustomOptionIds;
};
const idOf = (id, label) => Number(db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ? AND description = ?').get(id, label).id);

// A stay three days ahead, settled, with a free line « Ménage » 20 € ordered in the app and paid by card (a note before the arrival), and an
// unpaid free line « Bois » 12 € beside it.
function cardPaidCustom(platform) {
  const id = stay(3);
  if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  const now = at(id, '12:00', -3);
  assert.equal(ctrl.performUpdate(id, { ...storedBody(id), restatePricing: true }, { now }).status, 200);
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2026-01-01' WHERE id = ?").run(id); // date-literal-ok: a paid flag's date, never read by the judgment
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Bois', amount: 12 }], { now }).status, 200);
  const requests = [{ articleRef: 'custom', label: 'Ménage', amount: 20 }];
  const sold = extraSale.sell(id, requests, { now, source: 'shop', paid: { amountCents: 2000, ref: 'card-1' }, orderRef: 'order:1' });
  assert.equal(sold.status, 200, JSON.stringify(sold.body));
  return { id, now };
}

test('S11-1 — a card-paid free line renamed in the fiche is refused 409 LINE_PAID_RENAMED, direct and platform; nothing moves', () => {
  for (const platform of ['direct', 'Booking']) {
    const { id, now } = cardPaidCustom(platform);
    const before = row(id);
    const saved = ctrl.performUpdate(id, renamed(id, 'Ménage', 'Ménage soir'), { now });
    assert.deepEqual([saved.status, saved.body.code, saved.body.error], [409, 'LINE_PAID_RENAMED', RENAMED], platform);
    // The priced save (lines rewritten) answers the same.
    const priced = ctrl.performUpdate(id, { ...renamed(id, 'Ménage', 'Ménage soir'), restatePricing: true }, { now });
    assert.deepEqual([priced.status, priced.body.code], [409, 'LINE_PAID_RENAMED'], platform);
    assert.ok(labels(id).includes('Ménage') && !labels(id).includes('Ménage soir'));
    assert.deepEqual([row(id).finalPrice, row(id).complementAmount], [before.finalPrice, before.complementAmount]);
  }
});

test('S11-1 — the unpaid free line beside it, and a case-only change of the paid one, still save; the lock names the paid line only', () => {
  const { id, now } = cardPaidCustom('direct');
  assert.deepEqual(paidIds(id, now), [idOf(id, 'Ménage')]);
  const unpaid = ctrl.performUpdate(id, renamed(id, 'Bois', 'Bois de chauffe'), { now });
  assert.equal(unpaid.status, 200, JSON.stringify(unpaid.body));
  const sameKey = ctrl.performUpdate(id, renamed(id, 'Ménage', 'ménage'), { now });
  assert.equal(sameKey.status, 200, JSON.stringify(sameKey.body));
  assert.deepEqual(paidIds(id, now), [idOf(id, 'ménage')]);
});

test('S11-1 — a platform stay\'s collected arrival complement names its free line: renaming it is refused, the lock names it', () => {
  const id = stay(20);
  db.prepare("UPDATE reservations SET platform = 'Booking' WHERE id = ?").run(id);
  const body = storedBody(id);
  body.customOptions = [...(body.customOptions || []), { customKey: 'custom_1', description: 'Ménage', amount: 20, offered: false, inComplement: 1 }];
  assert.equal(ctrl.performUpdate(id, { ...body, restatePricing: true }).status, 200);
  assert.equal(call(ctrl.updatePayment, { id: String(id) }, { balancePaid: true, balancePaidDate: todayIso() }).statusCode, 200);
  assert.equal(call(ctrl.updatePayment, { id: String(id) }, { complementPaid: true, complementPaidDate: todayIso() }).statusCode, 200);
  assert.ok(JSON.parse(row(id).complementPaidSplit).lines.some((l) => l.key === 'custom:ménage'));
  const now = at(id, '12:00', -2);
  assert.deepEqual(paidIds(id, now), [idOf(id, 'Ménage')]);
  const saved = ctrl.performUpdate(id, renamed(id, 'Ménage', 'Ménage soir'), { now });
  assert.deepEqual([saved.status, saved.body.code], [409, 'LINE_PAID_RENAMED']);
  assert.ok(labels(id).includes('Ménage'));
});

// Loop t12 S12-1 — a rename onto another free line's label is refused 409 LINE_LABEL_TAKEN, paid or not; a NEW line keeps « (2) » (rule 94).
const TAKEN = 'Libellé déjà utilisé sur ce séjour.';

test('S12-1 — an unpaid line renamed onto the paid line\'s label, or onto an unpaid line\'s, is refused 409 LINE_LABEL_TAKEN; nothing written', () => {
  const { id, now } = cardPaidCustom('direct');
  assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label: 'Fagots', amount: 5 }], { now }).status, 200);
  const before = [labels(id), row(id).finalPrice];
  for (const target of ['Ménage', ' ménage ', 'Fagots']) {
    const saved = ctrl.performUpdate(id, renamed(id, 'Bois', target), { now });
    assert.deepEqual([saved.status, saved.body.code, saved.body.error], [409, 'LINE_LABEL_TAKEN', TAKEN], target);
    const priced = ctrl.performUpdate(id, { ...renamed(id, 'Bois', target), restatePricing: true }, { now });
    assert.deepEqual([priced.status, priced.body.code], [409, 'LINE_LABEL_TAKEN'], target);
  }
  assert.deepEqual([labels(id), row(id).finalPrice], before);
  assert.equal(ctrl.performUpdate(id, renamed(id, 'Bois', 'Bois sec'), { now }).status, 200);
});

test('S12-1 — a NEW free line under an existing label is numbered « (2) », not refused', () => {
  const { id, now } = cardPaidCustom('direct');
  const body = storedBody(id);
  body.customOptions = [...body.customOptions, { description: 'Ménage', amount: 10, offered: false, inComplement: 0 }];
  const saved = ctrl.performUpdate(id, { ...body, restatePricing: true }, { now });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.ok(labels(id).includes('Ménage (2)'), labels(id).join('|'));
});
