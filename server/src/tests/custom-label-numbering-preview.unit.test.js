// specs/pricing-components.md §3 rule 94 (stabilisation loop t14, S14-1 and S14-2, 2026-11-17) — a new free line repeating a label is
// numbered « (2) » on every path. The save numbered it, the price preview did not: a new « Bois » beside a discounted « Bois » read the stored
// line's discount and moment, so the fiche showed 2 € less than the save stored and could route the new line to another bucket (S14-1). The
// creation did not number at all: two « Ménage » shared one key, and a 2 € line discount on one took 4 € off the stay (S14-2).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate, todayIso } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const at = (id, offset) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T12:00:00`);
const linesOf = (id) => db.prepare('SELECT id, description, amount, lineId, discountCents FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id);
const cents = (value) => Math.round(Number(value || 0) * 100);

const call = (handler, body) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    set() { return this; },
    setHeader() {},
  };
  Promise.resolve(handler({ body, params: {}, query: {}, user: { role: 'admin', id: 1 }, headers: {} }, res)).catch(reject);
});

// Three days before the arrival the sale panel sells « Bois » 15 € and « Pain » 6 €, « Bois » discounted 2 € by the line API.
function discountedBois(platform) {
  const id = stay(3);
  if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  const sold = at(id, -3);
  for (const [label, amount] of [['Bois', 15], ['Pain', 6]]) {
    assert.equal(extraSale.sell(id, [{ articleRef: 'custom', label, amount }], { now: sold }).status, 200);
  }
  const bois = linesOf(id).find((line) => line.description === 'Bois');
  assert.equal(extraSale.changeLine(id, `custom:${bois.lineId}`, { discount: { amount: 2 } }, { now: sold }).status, 200);
  // The line API rewrites the rows: the fiche names the line by its row as it stands after the discount.
  return { id, bois: linesOf(id).find((line) => line.lineId === bois.lineId), now: at(id, -1) };
}

async function previewThenSave(id, body, now) {
  const preview = await call(ctrl.calculatePrice, JSON.parse(JSON.stringify({
    ...body, selectedOptions: body.options, selectedResources: body.resources, reservationId: id,
  })));
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const saved = ctrl.performUpdate(id, body, { now });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const stored = row(id);
  const fields = ['finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount'];
  return {
    preview: Object.fromEntries(fields.map((field) => [field, cents(preview.body[field])])),
    stored: Object.fromEntries(fields.map((field) => [field, cents(stored[field])])),
    previewLines: (preview.body.optionLines || []).filter((line) => line.isCustom).map((line) => [line.title, line.key]),
  };
}

test('S14-1 — a new line repeating a discounted label: the preview prices « Bois (2) » as the save stores it', async () => {
  for (const platform of ['direct', 'Booking']) {
    const { id, now } = discountedBois(platform);
    const body = storedBody(id);
    body.customOptions.push({ description: 'Bois', amount: 10, offered: false, inComplement: 0 });
    const { preview, stored, previewLines } = await previewThenSave(id, body, now);
    assert.deepEqual(preview, stored, platform);
    // Priced under its number, echoed with the text the operator typed (the fiche writes the title back into its field).
    assert.deepEqual(previewLines.at(-1), ['Bois', 'custom:bois (2)'], platform);
    const fresh = linesOf(id).find((line) => line.description === 'Bois (2)');
    assert.equal(fresh.amount, 10, platform);
    assert.equal(fresh.discountCents || 0, 0, platform);
  }
});

test('S14-1 — a line renamed onto a new label plus a new line under that label: preview = save', async () => {
  const { id, bois, now } = discountedBois('direct');
  const body = storedBody(id);
  body.customOptions = body.customOptions.map((line) => (Number(line.customOptionId) === bois.id ? { ...line, description: 'Bois sec' } : line));
  body.customOptions.push({ description: 'Bois sec', amount: 10, offered: false, inComplement: 0 });
  const { preview, stored } = await previewThenSave(id, body, now);
  assert.deepEqual(preview, stored);
  const renamed = linesOf(id).find((line) => line.lineId === bois.lineId);
  assert.deepEqual([renamed.description, renamed.discountCents], ['Bois sec', 200]);
  assert.equal(linesOf(id).find((line) => line.description === 'Bois sec (2)').discountCents || 0, 0);
});

test('S14-1 — a fresh fiche previews two lines of one label under the keys the creation stores', async () => {
  const start = addDaysToIsoDate(todayIso(), 30);
  const preview = await call(ctrl.calculatePrice, {
    propertyId: 9701, startDate: start, endDate: addDaysToIsoDate(start, 3), adults: 2,
    customOptions: [{ description: 'Ménage', amount: 20 }, { description: 'Ménage', amount: 20 }],
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(preview.body.optionLines.filter((line) => line.isCustom).map((line) => [line.title, line.key]), [['Ménage', 'custom:ménage'], ['Ménage', 'custom:ménage (2)']]);
});

test('S14-2 — a stay created with two lines of one label numbers the second; a line discount takes exactly its amount off', async () => {
  const start = addDaysToIsoDate(todayIso(), 40);
  const created = await call(ctrl.create, {
    propertyId: 9701, clientId: 9701, startDate: start, endDate: addDaysToIsoDate(start, 3), adults: 2, platform: 'direct',
    customOptions: [{ description: 'Ménage', amount: 20 }, { description: 'Ménage', amount: 20 }, { description: 'ménage', amount: 5 }],
  });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));
  const id = Number(created.body.id);
  assert.deepEqual(linesOf(id).map((line) => line.description), ['Ménage', 'Ménage (2)', 'ménage (3)']);
  const before = cents(row(id).finalPrice);
  const second = linesOf(id)[1];
  assert.equal(extraSale.changeLine(id, `custom:${second.lineId}`, { discount: { amount: 2 } }, { now: new Date() }).status, 200);
  assert.equal(cents(row(id).finalPrice), before - 200);
  assert.deepEqual(linesOf(id).map((line) => line.discountCents || 0), [0, 200, 0]);
});
