// specs/mixed-method-payments.md rules 56 and 58 (verification R35b, findings 2-4) — the edges of the closing refund:
// a live stay given back in full closes like a cancelled one (rule 56 as worded since R35c); a 20 % indemnity's VAT stays
// out of the sale legs; a negative closing leg is a credit, the tourist tax's included; a payment dated after the refund is
// not read by it; and a stay paid with ONE method closes too from the month after the install (rule 58), while a refund
// before that cutoff keeps its lines, so a month the accountant may hold keeps its cents.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, TODAY, inDays, rowOf, mark, NO_ACOMPTE, WITH_ACOMPTE, S, D, free, forced, fiche, register, cancel, giveAll, refund, respond,
} = require('./moneyLedgerFixture');
const refundsController = require('../controllers/refundsController');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const { create: createAccountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { entryToStructured } = optionalPlugin(() => require('../plugins/accounting-export/accountingExport'));
const { firstOfNextMonth } = optionalPlugin(() => require('../plugins/accounting-export/settings'));
const BOOKS = { skip: skipWithout(['accounting-export']) };

const cents = (euros) => Math.round(Number(euros) * 100);
const round2 = (n) => Math.round(n * 100) / 100;
const card = (amountCents) => ({ method: 'card', amountCents, internal: false });
const cashIn = (amountCents) => ({ method: 'cash', amountCents, internal: true });
const monthOf = (iso) => { const [year, month] = iso.split('-').map(Number); return { year, month }; };

function setPlugin(key, value) {
  db.prepare('DELETE FROM plugin_settings WHERE plugin_id = ? AND key = ?').run('accounting-export', key);
  if (value != null) db.prepare('INSERT INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)').run('accounting-export', key, value);
}
// The one-method closing starts on `from` (rule 58); the migration stores the first day of the month after the install.
const closingFrom = (from) => setPlugin('stayClosingFrom', from);
const THIS_MONTH = `${TODAY.slice(0, 7)}-01`;

const refundEntries = (id, day = TODAY) => createAccountingModel(db).refundsByMonth(monthOf(day)).filter((e) => Number(e.reservationId) === Number(id));

function booksOf(id) {
  const model = createAccountingModel(db);
  const net = {};
  for (const e of [...model.encaissementsByMonth(monthOf(TODAY)), ...model.refundsByMonth(monthOf(TODAY)), ...model.compensationsByMonth(monthOf(TODAY))]) {
    if (Number(e.reservationId) !== Number(id)) continue;
    const structured = entryToStructured(e);
    assert.ok(structured.balanced, JSON.stringify(structured.lines));
    for (const l of structured.lines) net[l.compte] = round2((net[l.compte] || 0) + Number(l.debit || 0) - Number(l.credit || 0));
  }
  return Object.fromEntries(Object.entries(net).filter(([, v]) => Math.abs(v) >= 0.005));
}

function splitSolde(id) {
  const bal = cents(rowOf(id).balanceAmount);
  const m = mark(id, { ...S, expectedAmountCents: bal, tenders: [cashIn(7001), card(bal - 7001 - 1333)], shortfall: { kind: 'waived' } });
  assert.equal(m.statusCode, 200, JSON.stringify(m.body));
}

test('rule 56 — a LIVE split stay given back in full: the refund emptying its books closes them', BOOKS, () => {
  closingFrom(null);
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(33.33, 'Panier')] });
  splitSolde(stay.id);
  const lines = register(stay.id).refundableLines
    .map((l) => ({ key: l.key, amountTtc: round2(l.availableTtc ?? l.refundableTtc) })).filter((l) => l.amountTtc > 0);
  assert.equal(refund(stay.id, lines).statusCode, 201);
  const entries = refundEntries(stay.id);
  assert.equal(entries.length, 1);
  assert.ok(entries[0].closing, 'the live full refund closes');
  assert.deepEqual(booksOf(stay.id), {});
});

test('rule 56 — acompte kept, a split complement given back, the indemnity at 20 %: its VAT stays apart, the books close at 0', BOOKS, async () => {
  closingFrom(null);
  setPlugin('vatRateCancellationCompensation', '20');
  try {
    const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [forced(80), free(21.11, 'Panier', 1)] });
    assert.equal(mark(stay.id, D).statusCode, 200);
    const cpl = cents(rowOf(stay.id).complementAmount);
    const m = mark(stay.id, { complementPaid: true, complementPaidDate: TODAY, expectedAmountCents: cpl, tenders: [cashIn(2001), card(cpl - 2001 - 777)], shortfall: { kind: 'waived' } });
    assert.equal(m.statusCode, 200, JSON.stringify(m.body));
    await cancel(stay.id);
    giveAll(stay.id);
    assert.equal(refundEntries(stay.id).filter((e) => e.closing).length, 1, 'one refund closes the books');
    assert.deepEqual(booksOf(stay.id), {});
  } finally {
    setPlugin('vatRateCancellationCompensation', null);
  }
});

test('rule 56 — a negative closing leg (VAT, tourist tax) is written in the credit column, the entry balanced', BOOKS, () => {
  const entry = {
    direction: 'refund', paidDate: TODAY, reservationId: 1, client: { firstName: 'Test', lastName: 'Voyageur' }, encaissementTtc: 100,
    buckets: [], taxTtc: 0,
    closing: [
      { account: '70600000', role: 'revenue', ratePercent: 10, amount: 90.94 },
      { account: '70600010', role: 'revenue', ratePercent: 10, amount: 9.09 },
      { account: '44571100', role: 'vat', ratePercent: 10, amount: -0.02 },
      { account: '46710000', role: 'touristTax', ratePercent: null, amount: -0.01 },
    ],
  };
  const structured = entryToStructured(entry);
  assert.ok(structured.balanced, JSON.stringify(structured.lines));
  const line = (compte) => structured.lines.find((l) => l.compte === compte);
  assert.equal(Number(line('44571100').credit), 0.02);
  assert.ok(!Number(line('44571100').debit));
  assert.ok(line('46710000'), 'a negative tourist-tax leg is written');
  assert.equal(Number(line('46710000').credit), 0.01);
  assert.ok(!Number(line('46710000').debit));
  assert.equal(Number(line('70600000').debit), 90.94);
});

test('rule 56 — a payment dated after the refund is not read by its closing', BOOKS, () => {
  closingFrom(`${Number(TODAY.slice(0, 4)) - 1}-01-01`);
  try {
    const stay = fiche(WITH_ACOMPTE, 'direct');
    assert.equal(mark(stay.id, { depositPaid: true, depositPaidDate: inDays(-10) }).statusCode, 200);
    const deposit = Number(rowOf(stay.id).depositAmount);
    const res = respond();
    refundsController.create({ params: { id: stay.id }, body: { refundDate: inDays(-5), method: 'transfer', reason: 'r', lines: [{ key: 'accommodation', amountTtc: deposit }] } }, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(mark(stay.id, { balancePaid: true, balancePaidDate: inDays(-1) }).statusCode, 200);
    const [entry] = refundEntries(stay.id, inDays(-5));
    assert.ok(entry && entry.closing, 'the acompte given back whole closes what the books held on its day');
    const closed = entry.closing.reduce((sum, leg) => sum + cents(leg.amount), 0);
    assert.equal(closed, cents(deposit), 'the solde paid after it is not in the closing');
  } finally {
    closingFrom(null);
  }
});

// One method, extras: refunded live in full, then cancelled — the case that kept 44571100 +0,01 / 70600000 −0,01.
async function oneMethodGivenBack() {
  const stay = fiche(WITH_ACOMPTE, 'direct', { customOptions: [free(33.33, 'Panier')] });
  assert.equal(mark(stay.id, D).statusCode, 200);
  assert.equal(mark(stay.id, S).statusCode, 200);
  const lines = register(stay.id).refundableLines
    .map((l) => ({ key: l.key, amountTtc: round2(l.availableTtc ?? l.refundableTtc) })).filter((l) => l.amountTtc > 0);
  assert.equal(refund(stay.id, lines).statusCode, 201);
  await cancel(stay.id);
  return stay;
}

test('rule 58 — a stay paid with one method closes its books from the cutoff on: every account at exactly 0', BOOKS, async () => {
  closingFrom(THIS_MONTH);
  try {
    const stay = await oneMethodGivenBack();
    assert.equal(refundEntries(stay.id).filter((e) => e.closing).length, 1);
    assert.deepEqual(booksOf(stay.id), {});
  } finally {
    closingFrom(null);
  }
});

test('rule 58 — before the cutoff (a month the accountant may hold) a one-method refund keeps its lines', BOOKS, async () => {
  closingFrom(firstOfNextMonth(new Date()));
  try {
    const stay = await oneMethodGivenBack();
    assert.ok(refundEntries(stay.id).every((e) => e.closing === undefined));
    assert.deepEqual(booksOf(stay.id), { 44571100: 0.01, 70600000: -0.01 }, 'the cent rounded apart stays where it was exported');
  } finally {
    closingFrom(null);
  }
});

test('rule 58 — a split stay closes whatever the cutoff (rule 56 unchanged)', BOOKS, async () => {
  closingFrom(firstOfNextMonth(new Date()));
  try {
    const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [free(33.33, 'Panier')] });
    splitSolde(stay.id);
    await cancel(stay.id);
    giveAll(stay.id);
    assert.deepEqual(booksOf(stay.id), {});
  } finally {
    closingFrom(null);
  }
});

test('rule 58 — the migration stores the first day of the month after the install, once; an erased store reads the fallback', BOOKS, () => {
  const Database = require('better-sqlite3');
  const { readStayClosingFrom, storeStayClosingFrom, STAY_CLOSING_FALLBACK } = require('../plugins/accounting-export/settings');
  const store = new Database(':memory:');
  store.exec('CREATE TABLE plugin_settings (plugin_id TEXT, key TEXT, value TEXT, updated_at TEXT, PRIMARY KEY (plugin_id, key))');
  assert.equal(readStayClosingFrom(store), STAY_CLOSING_FALLBACK);
  const installed = new Date();
  storeStayClosingFrom(store, installed);
  assert.equal(readStayClosingFrom(store), firstOfNextMonth(installed));
  storeStayClosingFrom(store, new Date(installed.getFullYear() + 1, installed.getMonth(), 1));
  assert.equal(readStayClosingFrom(store), firstOfNextMonth(installed), 'a later start never moves it');
});
