// specs/pricing-components.md §3 rules 79, 94 (stabilisation loop t13, S13-1, 2026-11-17) — a free (custom) line the fiche posts back names
// its row (`customOptionId`) and takes THAT row's identity whatever its new text. Before, a renamed unpaid line written by a priced save
// (delete + insert) matched its row only when the label was unchanged: it lost its `lineId`, moment and sale date, and a discounted one its
// discount (the guest paid 2 € more with nothing asked); a swap of two labels traded the two lines' identities and discounts.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const at = (id, offset) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T12:00:00`);
const COLUMNS = 'id, description, amount, lineId, collectAt, collectAtDefault, soldAt, discountCents';
const lineOf = (id, lineId) => db.prepare(`SELECT ${COLUMNS} FROM reservation_custom_options WHERE reservationId = ? AND lineId = ?`).get(id, lineId);
const byLabel = (id, label) => db.prepare(`SELECT ${COLUMNS} FROM reservation_custom_options WHERE reservationId = ? AND description = ?`).get(id, label);
const identity = (line) => ({ lineId: line.lineId, collectAt: line.collectAt, collectAtDefault: line.collectAtDefault, soldAt: line.soldAt, discountCents: line.discountCents || 0 });

// Three days before the arrival the sale panel sells two unpaid free lines, « Bois » 15 € and « Pain » 6 €; the fiche is saved the day before.
function twoSoldLines(platform, { discount } = {}) {
  const id = stay(3);
  if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  const sold = at(id, -3);
  for (const [label, amount] of [['Bois', 15], ['Pain', 6]]) {
    assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label, amount }], { now: sold }).status, 200);
  }
  if (discount) {
    const ref = `custom:${byLabel(id, discount).lineId}`;
    assert.equal(extraSale.changeLine(id, ref, { discount: { amount: 2 } }, { now: sold }).status, 200);
  }
  return { id, now: at(id, -1), bois: byLabel(id, 'Bois'), pain: byLabel(id, 'Pain') };
}

const edited = (id, edit) => {
  const body = storedBody(id);
  body.customOptions = body.customOptions.flatMap((line) => edit(line) ?? []);
  return body;
};
const named = (line, stored) => Number(line.customOptionId) === stored.id;

test('S13-1 — a renamed line whose amount changes keeps its number, moment and sale date, direct and platform', () => {
  for (const platform of ['direct', 'Booking']) {
    const { id, now, bois } = twoSoldLines(platform);
    const body = edited(id, (line) => (named(line, bois) ? { ...line, description: 'Bois sec', amount: 18 } : line));
    const saved = ctrl.performUpdate(id, body, { now });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const after = byLabel(id, 'Bois sec');
    assert.equal(after.amount, 18, platform);
    assert.deepEqual(identity(after), identity(bois), platform);
    assert.ok(bois.collectAt && bois.soldAt, 'the sold line had a moment and a sale date to keep');
  }
});

test('S13-1 — a line renamed in a save that re-prices another line keeps its identity', () => {
  const { id, now, bois, pain } = twoSoldLines('direct');
  const body = edited(id, (line) => {
    if (named(line, bois)) return { ...line, description: 'Bois sec' };
    if (named(line, pain)) return { ...line, amount: 7 };
    return line;
  });
  assert.equal(ctrl.performUpdate(id, body, { now }).status, 200);
  assert.deepEqual(identity(byLabel(id, 'Bois sec')), identity(bois));
  assert.deepEqual(identity(byLabel(id, 'Pain')), identity(pain));
});

test('S13-1 — a discounted line renamed keeps its discount; the total does not move', () => {
  for (const restatePricing of [false, true]) {
    const { id, now, bois } = twoSoldLines('direct', { discount: 'Bois' });
    assert.equal(bois.discountCents, 200);
    const before = Number(row(id).finalPrice);
    const body = { ...edited(id, (line) => (named(line, bois) ? { ...line, description: 'Bois sec' } : line)), restatePricing };
    assert.equal(ctrl.performUpdate(id, body, { now }).status, 200);
    assert.deepEqual(identity(byLabel(id, 'Bois sec')), identity(bois), `restatePricing ${restatePricing}`);
    assert.equal(Number(row(id).finalPrice), before, `restatePricing ${restatePricing}`);
  }
});

test('S13-1 — two lines swapping their labels each keep their own row, the discount stays on its line', () => {
  const { id, now, bois, pain } = twoSoldLines('direct', { discount: 'Pain' });
  const before = Number(row(id).finalPrice);
  const body = edited(id, (line) => {
    if (named(line, bois)) return { ...line, description: 'Pain' };
    if (named(line, pain)) return { ...line, description: 'Bois' };
    return line;
  });
  const saved = ctrl.performUpdate(id, { ...body, restatePricing: true }, { now });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const [wasBois, wasPain] = [lineOf(id, bois.lineId), lineOf(id, pain.lineId)];
  assert.deepEqual([wasBois.description, wasBois.amount, wasBois.discountCents || 0], ['Pain', 15, 0]);
  assert.deepEqual([wasPain.description, wasPain.amount, wasPain.discountCents], ['Bois', 6, 200]);
  assert.equal(Number(row(id).finalPrice), before);
});

test('S13-1 — a line renamed onto the label of a line removed in the same save keeps its own row; only the removed line\'s money leaves', () => {
  for (const discount of ['Bois', 'Pain']) {
    const { id, now, bois, pain } = twoSoldLines('direct', { discount });
    const before = Number(row(id).finalPrice);
    const body = edited(id, (line) => {
      if (named(line, pain)) return null;
      if (named(line, bois)) return { ...line, description: 'Pain' };
      return line;
    });
    const saved = ctrl.performUpdate(id, { ...body, restatePricing: true }, { now });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(lineOf(id, pain.lineId), undefined, discount);
    const kept = lineOf(id, bois.lineId);
    assert.deepEqual([kept.description, identity(kept)], ['Pain', identity(bois)], discount);
    const removedNet = 6 - (pain.discountCents || 0) / 100;
    assert.equal(Number(row(id).finalPrice), Math.round((before - removedNet) * 100) / 100, discount);
  }
});

test('S13-1 — a renamed line and a NEW line under its old label: the renamed line keeps its row, the new one is a line of its own', () => {
  const { id, now, bois } = twoSoldLines('direct', { discount: 'Bois' });
  const body = edited(id, (line) => (named(line, bois) ? { ...line, description: 'Bois sec' } : line));
  body.customOptions.push({ description: 'Bois', amount: 10, offered: false, inComplement: 0 });
  const saved = ctrl.performUpdate(id, { ...body, restatePricing: true }, { now });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(identity(byLabel(id, 'Bois sec')), identity(bois));
  const fresh = byLabel(id, 'Bois');
  assert.notEqual(fresh.lineId, bois.lineId);
  assert.equal(fresh.discountCents || 0, 0);
});
