// specs/outside-booking-sas.md rule 41 (end-review verification V-4) — a document's open obligation (a link paid after the reste moved) is served with
// its words to the administrator, on the counter's list (any day) and on the document, and closes like a stay's « À rembourser » row: settled or
// cancelled, only once, written in the document's history; once closed the document stops claiming that money. The reception never reaches it.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const standaloneSale = require('../utils/standaloneSale');
const links = require('../utils/standaloneSaleLinks');
const sales = require('../models/standaloneSalesModel');
const controller = require('../controllers/standaloneSalesController');
const enforceRoleAccess = require('../middleware/enforceRoleAccess');

const beer = Number(db.prepare("INSERT INTO options (title, price, priceType, sellableExternally, vatClass) VALUES ('Bière', 6.5, 'per_stay', 1, 'drinks')").run().lastInsertRowid);
sales.setExternalRate('drinks', 20);

// A counter sale of 13 € paid in cash, then a 13 € link paid anyway: the surplus is an obligation row (what settlePaidLink writes).
function owingSale() {
  const sold = standaloneSale.sell({ lines: [{ articleRef: `option:${beer}`, quantity: 2 }], customer: { email: 'client@exemple.fr' } }).document;
  const id = sold.document.id;
  standaloneSale.pay(id, { tenders: [{ method: 'cash', amountCents: 1300 }] });
  const link = db.prepare("INSERT INTO payment_links (reservationId, saleRef, type, amountCents, status, paidAt) VALUES (NULL, ?, 'complement', 1300, 'paid', '2026-11-15')") // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
    .run(sales.documentRef(id)).lastInsertRowid;
  assert.equal(links.settlePaidLink({ link: { id: Number(link), saleRef: sales.documentRef(id), amountCents: 1300 }, paidDate: '2026-11-15' }).effect, 'standalone-sale-refund-owed'); // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
  return id;
}
const call = (method, req) => {
  const out = { status: 200, body: null };
  const res = { status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } };
  controller[method]({ query: {}, body: {}, params: {}, user: { email: 'admin@exemple.fr' }, ...req }, res);
  return out;
};

test('V-4 — the open obligation is served with its words, on the document and on the counter list whatever the day; nothing is counted twice', () => {
  const id = owingSale();
  db.prepare("UPDATE standalone_sales SET soldAt = '2026-01-02T10:00:00.000Z' WHERE id = ?").run(id); // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
  const doc = standaloneSale.documentOf(id);
  assert.equal(doc.totals.refundOwedCents, 1300);
  assert.equal(doc.totals.refundUnheldCents, 0, 'the row holds the whole surplus');
  assert.deepEqual(doc.refundObligations.map((r) => [r.amountCents, r.label, r.detail]), [[1300, '13,00 € à rembourser', 'Lien payé après un changement du reste']]);
  const list = call('list', { query: { day: '2026-11-15' } }).body; // date-literal-ok — fixture rows written by raw SQL and read back by key, no write path checks them against today
  assert.equal(list.sales.some((row) => row.id === id), false, 'not sold that day');
  const owed = list.owed.find((row) => row.id === id);
  assert.deepEqual(owed.refundObligations.map((r) => [r.amountCents, r.label]), [[1300, '13,00 € à rembourser']]);
});

test('V-4 — « Marquer remboursé » closes the row once; the document and the list stop claiming it, the history says it', () => {
  const id = owingSale();
  const [row] = standaloneSale.documentOf(id).refundObligations;
  assert.equal(call('closeObligation', { params: { id: String(id), oid: String(row.id) }, body: { status: 'paid' } }).status, 400);
  assert.equal(call('closeObligation', { params: { id: String(id + 999), oid: String(row.id) }, body: { status: 'settled' } }).status, 404);
  const closed = call('closeObligation', { params: { id: String(id), oid: String(row.id) }, body: { status: 'settled' } });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.deepEqual(closed.body.document.refundObligations, []);
  assert.equal(closed.body.document.totals.refundOwedCents, 0);
  assert.deepEqual(closed.body.sale.refundObligations, []);
  assert.equal(closed.body.document.history.at(-1).text, '13,00 € remboursés');
  assert.deepEqual(db.prepare('SELECT status, settledBy FROM standalone_sale_obligations WHERE id = ?').get(row.id), { status: 'settled', settledBy: 'admin@exemple.fr' });
  assert.equal(call('closeObligation', { params: { id: String(id), oid: String(row.id) }, body: { status: 'settled' } }).status, 409);
  assert.equal(call('list', {}).body.owed.some((r) => r.id === id), false);
});

test('V-4 — « rien à rembourser » closes it as cancelled', () => {
  const id = owingSale();
  const [row] = standaloneSale.documentOf(id).refundObligations;
  const closed = call('closeObligation', { params: { id: String(id), oid: String(row.id) }, body: { status: 'cancelled' } });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.document.history.at(-1).text, '13,00 € : rien à rembourser');
  assert.equal(closed.body.document.totals.refundOwedCents, 0);
});

test('V-4 — the reception reaches neither the list nor the close action; the administrator does', () => {
  const guard = (roles, method, path) => {
    let passed = false;
    let code = null;
    enforceRoleAccess({ user: { roles }, method, path }, { status(c) { code = c; return this; }, json() { return this; } }, () => { passed = true; });
    return passed ? 200 : code;
  };
  assert.equal(guard(['reception'], 'GET', '/standalone-sales'), 403);
  assert.equal(guard(['reception'], 'PATCH', '/standalone-sales/1/obligations/1'), 403);
  assert.equal(guard(['admin'], 'PATCH', '/standalone-sales/1/obligations/1'), 200);
});
