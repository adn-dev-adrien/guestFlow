// specs/pricing-components.md §3 rule 94 reading (stabilisation loop t14, S14-3, 2026-11-17) — the price preview routes a stored stay's lines
// as its save does: on the stored payment flags (never the request's) and, on a locked fiche, through the window's pins. Before, a fiche
// posting a stale « solde non payé » previewed a new line in the paid solde that the save put in the arrival complement, and a started stay
// previewed a line moved to the complement that the save kept where it was stored.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, beer, stay, row, todayIso, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const FIELDS = ['finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount'];
const cents = (value) => Math.round(Number(value || 0) * 100);
const figures = (source) => Object.fromEntries(FIELDS.map((field) => [field, cents(source[field])]));
const customRouting = (id) => db.prepare('SELECT description, COALESCE(inComplement, 0) AS inComplement FROM reservation_custom_options WHERE reservationId = ? ORDER BY id')
  .all(id).map((line) => `${line.description}:${line.inComplement}`);
const NEW_LINE = { description: 'Ajout', amount: 10, offered: false, inComplement: 0 };

const call = (handler, body, params = {}) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    set() { return this; },
    setHeader() {},
  };
  Promise.resolve(handler({ body, params, query: {}, user: { role: 'admin', id: 1 }, headers: {} }, res)).catch(reject);
});

async function previewThenSave(id, body, { unlockPast = false } = {}) {
  const preview = await call(ctrl.calculatePrice, JSON.parse(JSON.stringify({
    ...body, selectedOptions: body.options, selectedResources: body.resources, reservationId: id, ...(unlockPast ? { unlockPast: true } : {}),
  })));
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const saved = ctrl.performUpdate(id, body, { unlockPast });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  return { preview: figures(preview.body), stored: figures(row(id)) };
}

function withPlatform(id, platform) {
  if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
  return id;
}

// A beer sold before the arrival, then the stay starts (the fiche locks): the line sits in its pre-arrival bucket.
function startedWithEarlySale(platform) {
  const id = withPlatform(stay(3), platform);
  assert.equal(extraSale.sell(id, [{ articleRef: `option:${beer}`, quantity: 1 }], { now: new Date() }).status, 200);
  const start = addDaysToIsoDate(todayIso(), -1);
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ?, balanceDueDate = ?, checkInDone = 1 WHERE id = ?').run(start, addDaysToIsoDate(start, 3), start, id);
  return id;
}

test('S14-3 — unlocked fiche, solde paid, the fiche posts stale flags: a new line is previewed in the bucket the save stores it in', async () => {
  for (const platform of ['direct', 'Booking']) {
    const id = withPlatform(stay(5), platform);
    db.prepare('UPDATE reservations SET balanceAmount = finalPrice WHERE id = ?').run(id);
    const paid = await call(ctrl.updatePayment, { balancePaid: true, balancePaidDate: todayIso() }, { id });
    assert.ok(paid.status < 300, JSON.stringify(paid.body));
    const body = { ...storedBody(id), depositPaid: false, balancePaid: false };
    body.customOptions.push({ ...NEW_LINE });
    const { preview, stored } = await previewThenSave(id, body);
    assert.deepEqual(preview, stored, platform);
  }
});

test('S14-3 — locked fiche (stay started): a line the fiche moves and a new line are previewed with the window\'s routing', async () => {
  for (const platform of ['direct', 'Booking']) {
    const id = startedWithEarlySale(platform);
    const body = storedBody(id);
    body.options = body.options.map((line) => (Number(line.optionId) === beer ? { ...line, inComplement: line.inComplement ? 0 : 1 } : line));
    body.customOptions.push({ ...NEW_LINE });
    const before = customRouting(id);
    const { preview, stored } = await previewThenSave(id, body);
    assert.deepEqual(preview, stored, platform);
    assert.equal(customRouting(id).length, before.length + 1, platform);
  }
});

test('S14-3 — admin-unlocked started stay: the window is skipped by the preview as by the save (a line moved, the price kept)', async () => {
  for (const platform of ['direct', 'Booking']) {
    const id = startedWithEarlySale(platform);
    const body = storedBody(id);
    body.options = body.options.map((line) => (Number(line.optionId) === beer ? { ...line, inComplement: line.inComplement ? 0 : 1 } : line));
    const { preview, stored } = await previewThenSave(id, body, { unlockPast: true });
    assert.deepEqual(preview, stored, platform);
  }
});
