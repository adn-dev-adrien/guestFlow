// specs/reconciliation-assisted-matching.md rules 1–4 and 10 — the credits a fiche's linking dialog lists:
// available only, plausible first, nothing cut off, searched on the server. Fictional data only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, addReservation, credit, build, reset, dayAt, frShort } = require('./reconciliationFixture');
const { parseSearch } = require('../reconciliation/ficheCredits');

test.beforeEach(() => { reset(); });

// An acompte of 300 due 2026-10-14 and a solde of 700 due 2026-11-01.
const stay = (over = {}) => addReservation({
  depositAmount: 300, depositDueDate: dayAt(-9), balanceAmount: 700, finalPrice: 1000, balanceDueDate: dayAt(9), ...over,
});
const at = (day) => `${day}T09:00:00.000Z`;
const load = (controller, id, q = '', offset = 0) => controller.ficheCredits({ reservationId: id, q, offset }).body;

test('rule 1 — only credits with money left are listed; a partly used one says what remains', () => {
  const id = stay();
  const other = addReservation({ clientId: 2, balanceAmount: 400, finalPrice: 400 });
  const { controller, transactions, model } = build();
  transactions.upsertMany([
    credit('free', 30000, { settledAt: at(dayAt(-8)) }),
    credit('used', 45000, { settledAt: at(dayAt(-8)) }),
    credit('full', 10000, { settledAt: at(dayAt(-8)) }),
    credit('outside', 12345, { settledAt: at(dayAt(-8)) }),
    credit('usd', 9900, { settledAt: at(dayAt(-8)), currency: 'USD' }),
  ], { bankAccountId: 'acc-1' });
  model.addLine({ transactionId: 'used', reservationId: other, ledgerKey: 'balance', amountCents: 33000 });
  model.addLine({ transactionId: 'full', reservationId: other, ledgerKey: 'balance', amountCents: 10000 });
  model.markOutside('outside');
  const body = load(controller, id);
  const ids = [...body.likely, ...body.others.items].map((c) => c.transactionId).sort();
  assert.deepEqual(ids, ['free', 'used']);
  const used = [...body.likely, ...body.others.items].find((c) => c.transactionId === 'used');
  assert.equal(used.remainingCents, 12000);
  assert.equal(used.partlyUsed, true);
  assert.match(used.partlyUsedLabel, /reste 120,00 € sur 450,00 €/);
});

test('rule 2 — plausible = within 15 days of an anchor AND an amount within 5 € or the client name; exact first', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([
    credit('exact', 30000, { settledAt: at(dayAt(-9)), counterpartyName: 'ACME' }),
    credit('near', 30350, { settledAt: at(dayAt(-11)), counterpartyName: 'ACME' }),
    credit('named', 18000, { settledAt: at(dayAt(-3)), counterpartyName: 'M. DUPONT' }),
    credit('toofar', 30000, { settledAt: at(dayAt(58)), counterpartyName: 'ACME' }),
    credit('wrongamount', 41000, { settledAt: at(dayAt(-9)), counterpartyName: 'ACME' }),
    credit('bothrcpt', 100000, { settledAt: at(dayAt(7)), counterpartyName: 'ACME' }),
  ], { bankAccountId: 'acc-1' });
  const body = load(controller, id);
  assert.deepEqual(body.likely.map((c) => c.transactionId), ['exact', 'bothrcpt', 'near', 'named']);
  assert.deepEqual(body.likely[0].reasons, ['exact']);
  assert.deepEqual(body.likely.find((c) => c.transactionId === 'near').reasons, ['amount']);
  assert.deepEqual(body.likely.find((c) => c.transactionId === 'named').reasons, ['name']);
  assert.deepEqual(body.others.items.map((c) => c.transactionId).sort(), ['toofar', 'wrongamount']);
  assert.equal(body.likely[0].fitsKey, `${id}|deposit`, 'a credit that fits two échéances lands on the earliest due');
});

test('rule 2 — a name of two letters never makes a credit plausible', () => {
  db.prepare("INSERT OR IGNORE INTO clients (id, firstName, lastName) VALUES (3, 'Ana', 'Li')").run();
  const id = stay({ clientId: 3 });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('li', 17700, { settledAt: at(dayAt(-8)), counterpartyName: 'LI SARL' })], { bankAccountId: 'acc-1' });
  assert.equal(load(controller, id).likely.length, 0);
});

test('rule 3 — no 40-credit cap and no window: a March credit reaches the fiche of a March acompte', () => {
  const id = addReservation({ startDate: dayAt(18), endDate: dayAt(20), depositAmount: 300, depositDueDate: dayAt(-223), balanceAmount: 700, finalPrice: 1000 });
  const { controller, transactions } = build({ startDate: dayAt(-295) });
  const many = [credit('march', 30000, { settledAt: at(dayAt(-225)), counterpartyName: 'ACME' })];
  for (let i = 0; i < 70; i += 1) many.push(credit(`late-${i}`, 5000 + i, { settledAt: at(dayAt(-130 + i)) }));
  transactions.upsertMany(many, { bankAccountId: 'acc-1' });
  const body = load(controller, id);
  assert.equal(body.likely[0].transactionId, 'march');
  assert.equal(body.others.total, 70);
  assert.equal(body.others.items.length, 50, '50 per page');
  assert.equal(load(controller, id, '', 50).others.items.length, 20, 'the next page holds the rest');
});

test('rule 4 — search tokens: date, amount, integer amount, text, AND, an invalid date reads as text', () => {
  assert.deepEqual(parseSearch('12/03 596,58 596 dupont 12/13 2026-03-12 12/03/2026').map((t) => t.kind),
    ['date', 'amount', 'amount', 'text', 'text', 'date', 'date']);
  const id = stay();
  const { controller, transactions } = build();
  // `c` falls on the same jj/mm as `a`, one year earlier (never a 29 February, which a year earlier lacks).
  const aDay = dayAt(-225).endsWith('-02-29') ? dayAt(-226) : dayAt(-225);
  const cDay = `${Number(aDay.slice(0, 4)) - 1}${aDay.slice(4)}`;
  transactions.upsertMany([
    credit('a', 59658, { settledAt: at(aDay), counterpartyName: 'ALPHA' }),
    credit('b', 59600, { settledAt: at(dayAt(-194)), counterpartyName: 'BETA Éric' }),
    credit('c', 12000, { settledAt: at(cDay), counterpartyName: 'GAMMA', reference: 'loyer' }),
  ], { bankAccountId: 'acc-1' });
  const ids = (q) => { const b = load(controller, id, q); return [...b.likely, ...b.others.items].map((c) => c.transactionId).sort(); };
  assert.deepEqual(ids(frShort(aDay)), ['a', 'c'], 'jj/mm matches any year');
  assert.deepEqual(ids(`${frShort(aDay)}/${aDay.slice(0, 4)}`), ['a']);
  assert.deepEqual(ids(dayAt(-194)), ['b']);
  assert.deepEqual(ids('596,58'), ['a']);
  assert.deepEqual(ids('596'), ['a', 'b'], 'an integer matches 596,00 to 596,99');
  assert.deepEqual(ids('eric'), ['b'], 'case and accents are ignored');
  assert.deepEqual(ids('596 alpha'), ['a'], 'every token must match');
  assert.deepEqual(ids('12/13'), [], 'no such date: text, matches nothing, no error');
  assert.deepEqual(load(controller, id, '12/13').query.tokens, [{ kind: 'text', value: '12/13' }]);
});

test('rule 4 — the search covers both groups', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([
    credit('exact', 30000, { settledAt: at(dayAt(-7)), counterpartyName: 'ACME' }),
    credit('far', 70000, { settledAt: at(dayAt(-249)), counterpartyName: 'ACME' }),
  ], { bankAccountId: 'acc-1' });
  const b = load(controller, id, '700');
  assert.equal(b.likely.length, 0);
  assert.deepEqual(b.others.items.map((c) => c.transactionId), ['far']);
});

test('rule 2 — a credit the matcher proposes to another fiche is flagged « proposedElsewhere »', () => {
  const mine = stay();
  const other = addReservation({ clientId: 2, balanceAmount: 412.34, finalPrice: 412.34, balanceDueDate: dayAt(-5) });
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 41234, { settledAt: at(dayAt(-4)), counterpartyName: 'M. ROSSI' })], { bankAccountId: 'acc-1' });
  const all = [...load(controller, mine).likely, ...load(controller, mine).others.items];
  assert.equal(all.find((c) => c.transactionId === 't1').proposedElsewhere, true);
  assert.ok(other);
});

test('rule 10 — the fiche block no longer ships the credits', () => {
  const id = stay();
  const { controller, transactions } = build();
  transactions.upsertMany([credit('t1', 30000, { settledAt: at(dayAt(-7)) })], { bankAccountId: 'acc-1' });
  const block = controller.buildFicheBlock({ id });
  assert.ok(block.lines.length > 0);
  assert.equal('credits' in block, false);
});

test('rule 1 — a reservation outside the scope or unknown is refused', () => {
  const past = addReservation({ startDate: dayAt(-83), endDate: dayAt(-81) });
  const { controller } = build();
  assert.equal(controller.ficheCredits({ reservationId: past }).body.code, 'RESERVATION_OUT_OF_SCOPE');
  assert.equal(controller.ficheCredits({ reservationId: 999999 }).status, 404);
});

test('rules 2, 39 — a credit the matcher proposes to this fiche is always plausible, even 27 days after the échéance', () => {
  const id = addReservation({ platform: 'Booking', platformGrossAmount: 500, platformPayoutAmount: 420, finalPrice: 500, balanceAmount: 500, depositAmount: 0, balanceDueDate: dayAt(-52), startDate: dayAt(-64), endDate: dayAt(-62) });
  const { controller, transactions } = build({ startDate: dayAt(-295) });
  transactions.upsertMany([credit('p', 42000, { settledAt: at(dayAt(-25)), counterpartyName: 'BOOKING.COM B.V.', reference: 'NO.Z/ID.9' })], { bankAccountId: 'acc-1' });
  const body = load(controller, id);
  assert.deepEqual(body.likely.map((c) => c.transactionId), ['p']);
  assert.deepEqual(body.likely[0].reasons, ['proposal']);
});
