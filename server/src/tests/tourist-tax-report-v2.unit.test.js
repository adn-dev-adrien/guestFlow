// specs/tourist-tax-report-v2.md §3 rules 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 and 15 — the tourist-tax report over
// any period, through the real controllers: the same rows as the monthly extraction, a quarter or a year as the union
// of its months, a custom window by day, the stays a platform remits itself shown apart, the exempt persons, the
// declaration filter, the « Par nuit » register adding up to the list, the CSV of the selection, and the refusals.
// Each test owns a quarter of its own, far enough ahead, and moves the clock past it.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, C, fiche, put, pay, refund,
} = require('./moneyLedgerFixture');
const financeController = require('../controllers/financeController');
const reportController = require('../controllers/touristTaxReportController');
const { quoteStoredReservation } = require('../utils/storedReservationQuote');
const { addDays } = require('../utils/dateDays');
const { formatNumber } = require('../utils/csv').__test;

const pad2 = (n) => String(n).padStart(2, '0');

// Quarter k after the current one: its key and its three months.
let quarterSlot = 1;
function nextQuarter() {
  const now = new Date();
  const first = Math.floor(now.getMonth() / 3) * 3 + 3 * quarterSlot;
  quarterSlot += 1;
  const d = new Date(now.getFullYear(), first, 1);
  const y = d.getFullYear();
  const q = Math.floor(d.getMonth() / 3) + 1;
  const months = [0, 1, 2].map((i) => `${y}-${pad2((q - 1) * 3 + 1 + i)}`);
  return { key: `${y}-Q${q}`, year: y, months, after: q === 4 ? `${y + 1}-01` : `${y}-${pad2(q * 3 + 1)}` };
}

const clockAt = (t, iso) => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${iso}T12:00:00`).getTime() });
};

function monthly(month) {
  const res = respond();
  financeController.touristTax({ query: { month } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}
function report(query) {
  const res = respond();
  reportController.getReport({ query }, res);
  return res;
}
function ok(query) {
  const res = report(query);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}
function csv(query) {
  const res = respond();
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.send = (body) => { res.body = body; return res; };
  reportController.getReportCsv({ query }, res);
  return res;
}
function tick(id, declared = true, addedGuests = false) {
  const res = respond();
  financeController.setTouristTaxDeclared({ params: { reservationId: id }, body: { declared, addedGuests } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
}
const paidStay = (propertyId, startDate, endDate, extra = {}, platform = 'direct') => {
  const stay = fiche(propertyId, platform, { startDate, endDate, ...extra });
  pay(stay.id, S);
  return stay;
};
const ours = (data) => data.stays.filter((r) => r.remittedBy === 'us');
const keyOfRow = (r) => `${r.reservationId}${r.addedGuestsRow ? '-added' : ''}`;
const sumCents = (rows, pick) => Math.round(rows.reduce((s, r) => s + Math.round(pick(r) * 100), 0)) / 100;

test('rules 1 and 2: a month reads the very rows of the monthly extraction, whose payload is unchanged', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const a = paidStay(NO_ACOMPTE, `${m}-04`, `${m}-07`);
  const b = paidStay(WITH_ACOMPTE, `${m}-10`, `${m}-12`, { adults: 3 });
  clockAt(t, `${q.after}-10`);

  const legacy = monthly(m);
  // The monthly contract, key for key: nothing added, nothing renamed.
  assert.deepEqual(Object.keys(legacy), ['month', 'from', 'toExclusive', 'reservations', 'byProperty', 'totals']);
  assert.deepEqual(Object.keys(legacy.totals), ['reservationsCount', 'rentedNights', 'adultNights', 'taxAmount', 'accommodationAmount']);
  assert.deepEqual(Object.keys(legacy.reservations[0]), [
    'reservationId', 'propertyId', 'propertyName', 'reservationName', 'startDate', 'endDate', 'lastNightDate',
    'touristTaxDeclaredAt', 'declarable', 'adults', 'children', 'nightsCount', 'adultNights', 'taxRate', 'taxAmount',
    'refundedTaxNights', 'refundedTaxAmount', 'accommodationAmount', 'includedServicesDeduction', 'nightPricePerOccupantHt',
  ]);

  const data = ok({ period: 'month', month: m });
  assert.equal(data.window.kind, 'month');
  assert.equal(data.window.from, `${m}-01`);
  assert.equal(data.window.toExclusive, legacy.toExclusive);
  assert.deepEqual(ours(data).map(keyOfRow).sort(), legacy.reservations.map(keyOfRow).sort());
  for (const row of legacy.reservations) {
    const mine = data.stays.find((r) => r.reservationId === row.reservationId);
    assert.equal(mine.taxAmount, row.taxAmount);
    assert.equal(mine.nightsCount, row.nightsCount);
    assert.equal(mine.taxedPersons, row.adults);
    assert.equal(mine.taxedPersonNights, row.adultNights);
    assert.equal(mine.touristTaxDeclaredAt, row.touristTaxDeclaredAt);
    assert.equal(mine.declarable, row.declarable);
  }
  assert.equal(data.totals.amount, legacy.totals.taxAmount);
  assert.equal(data.totals.nights, legacy.totals.rentedNights);
  assert.equal(data.totals.taxedPersonNights, legacy.totals.adultNights);
  assert.equal(data.totals.staysCount, legacy.totals.reservationsCount);
  assert.ok([a.id, b.id].every((id) => data.stays.some((r) => r.reservationId === id)));
  // The period defaults to a month.
  assert.deepEqual(ok({ month: m }).totals, data.totals);
  // Rule 15: the pickers offer the month read, and open on the month before the server's.
  assert.equal(data.choices.months[0].value, q.after);
  assert.ok(data.choices.months.some((c) => c.value === m));
  assert.ok(data.choices.quarters.some((c) => c.value === q.key));
  assert.equal(data.choices.defaultMonth, data.choices.months[1].value);
});

test('rule 3: a quarter and a year are the union of their months, under the same attribution', (t) => {
  const q = nextQuarter();
  const [m1, m2, m3] = q.months;
  paidStay(NO_ACOMPTE, `${m1}-05`, `${m1}-08`);
  // Last night on the 1st's eve: the stay belongs to m1, not to m2 (stay-end rule).
  paidStay(WITH_ACOMPTE, `${m1}-27`, `${m2}-01`);
  paidStay(NO_ACOMPTE, `${m2}-10`, `${m2}-13`, { children: 1 });
  paidStay(WITH_ACOMPTE, `${m3}-20`, `${m3}-22`);
  // Unpaid: in no month, so in no quarter.
  fiche(NO_ACOMPTE, 'direct', { startDate: `${m3}-24`, endDate: `${m3}-26` });
  clockAt(t, `${q.after}-10`);

  const months = q.months.map(monthly);
  const quarter = ok({ period: 'quarter', quarter: q.key });
  assert.equal(quarter.window.from, `${m1}-01`);
  assert.equal(quarter.window.toExclusive, `${q.after}-01`);
  assert.match(quarter.window.label, new RegExp(`^T\\d ${q.year} \\(`));
  const union = months.flatMap((mo) => mo.reservations);
  assert.deepEqual(ours(quarter).map(keyOfRow).sort(), union.map(keyOfRow).sort());
  assert.equal(quarter.totals.amount, sumCents(months, (mo) => mo.totals.taxAmount));
  assert.equal(quarter.totals.nights, months.reduce((s, mo) => s + mo.totals.rentedNights, 0));
  assert.equal(quarter.totals.taxedPersonNights, months.reduce((s, mo) => s + mo.totals.adultNights, 0));
  assert.equal(quarter.totals.staysCount, 4);

  const year = ok({ period: 'year', year: String(q.year) });
  assert.equal(year.window.label, `Année ${q.year}`);
  for (const row of ours(quarter)) assert.ok(year.stays.some((r) => r.key === row.key), `year holds ${row.key}`);
});

test('rule 4: a custom window reads attribution days, both ends included', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const inside = paidStay(NO_ACOMPTE, `${m}-03`, `${m}-06`); // last night the 5th
  const edge = paidStay(WITH_ACOMPTE, `${m}-12`, `${m}-15`); // last night the 14th
  const outside = paidStay(NO_ACOMPTE, `${m}-14`, `${m}-16`); // last night the 15th
  clockAt(t, `${q.after}-10`);

  const data = ok({ period: 'custom', from: `${m}-05`, to: `${m}-14` });
  const ids = data.stays.map((r) => r.reservationId);
  assert.ok(ids.includes(inside.id));
  assert.ok(ids.includes(edge.id));
  assert.ok(!ids.includes(outside.id));
  assert.equal(data.window.label, `du 05/${m.slice(5)}/${m.slice(0, 4)} au 14/${m.slice(5)}/${m.slice(0, 4)}`);
  assert.equal(data.window.futureExcluded, false);
  assert.ok(!ok({ period: 'custom', from: `${m}-06`, to: `${m}-14` }).stays.some((r) => r.reservationId === inside.id));
});

test('rule 5: a future month is refused; a window running past the current month stops at its end, and says so', (t) => {
  const q = nextQuarter();
  const [m1, m2] = q.months;
  const now = paidStay(NO_ACOMPTE, `${m1}-03`, `${m1}-05`);
  const later = paidStay(NO_ACOMPTE, `${m2}-03`, `${m2}-05`);
  clockAt(t, `${m1}-20`);

  assert.deepEqual(report({ period: 'month', month: m2 }).body, { error: 'Les mois futurs ne sont pas autorisés.' });
  assert.equal(report({ period: 'month', month: m2 }).statusCode, 400);
  assert.deepEqual(report({ period: 'custom', from: `${m2}-01`, to: `${m2}-10` }).body, { error: 'Les mois futurs ne sont pas autorisés.' });

  const quarter = ok({ period: 'quarter', quarter: q.key });
  assert.equal(quarter.window.futureExcluded, true);
  assert.equal(quarter.window.coveredTo, addDays(`${m2}-01`, -1));
  assert.equal(quarter.window.coveredToExclusive, `${m2}-01`);
  assert.equal(quarter.today, `${m1}-20`);
  assert.equal(quarter.currentMonth, m1);
  const ids = quarter.stays.map((r) => r.reservationId);
  assert.ok(ids.includes(now.id));
  assert.ok(!ids.includes(later.id));
  assert.equal(ok({ period: 'month', month: m1 }).window.futureExcluded, false);
});

test('rule 5: every refusal is a 400 with its French reason, never a clamp', (t) => {
  const q = nextQuarter();
  clockAt(t, `${q.after}-10`);
  const [m] = q.months;
  const cases = [
    [{ period: 'month', month: `${q.year}-13` }, 'Mois invalide. Format attendu: YYYY-MM.'],
    [{ period: 'month' }, 'Mois invalide. Format attendu: YYYY-MM.'],
    [{ period: 'month', month: [m, m] }, 'Mois invalide. Format attendu: YYYY-MM.'],
    [{ period: 'quarter', quarter: `${q.year}-Q5` }, 'Trimestre invalide. Format attendu: YYYY-Qn.'],
    [{ period: 'year', year: '26' }, 'Année invalide. Format attendu: YYYY.'],
    [{ period: 'week' }, 'Période inconnue.'],
    [{ period: 'custom', from: `${q.year}-02-30`, to: `${m}-10` }, 'Deux dates à choisir.'],
    [{ period: 'custom', from: `${m}-10` }, 'Deux dates à choisir.'],
    [{ period: 'custom', from: `${m}-10`, to: `${m}-09` }, 'La date de début doit précéder la date de fin.'],
    [{ period: 'month', month: m, propertyId: '999' }, 'Logement inconnu.'],
    [{ period: 'month', month: m, propertyId: '3abc' }, 'Logement inconnu.'],
    [{ period: 'month', month: m, declaration: 'maybe' }, 'Statut de déclaration inconnu.'],
  ];
  for (const [query, error] of cases) {
    const res = report(query);
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.deepEqual(res.body, { error }, JSON.stringify(query));
  }
  const wide = report({ period: 'custom', from: `${q.year - 2}-01-01`, to: `${q.year}-01-31` });
  assert.equal(wide.statusCode, 400);
  assert.equal(wide.body.error, 'Période trop longue : 750 jours au plus.');
  const badView = csv({ period: 'month', month: m, view: 'grid' });
  assert.equal(badView.statusCode, 400);
  assert.deepEqual(badView.body, { error: 'Vue inconnue.' });
});

test('rule 6: a stay whose platform remits the tax itself is shown apart, read from the mode, and never in what we remit', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const direct = paidStay(NO_ACOMPTE, `${m}-02`, `${m}-04`);
  const reversed = paidStay(NO_ACOMPTE, `${m}-06`, `${m}-08`, { platformGrossAmount: 700 }, PLATFORM.reversed);
  // Never paid: the platform's tax is still the platform's, no payment of ours gates it.
  const remitted = fiche(NO_ACOMPTE, PLATFORM.remitted, { startDate: `${m}-10`, endDate: `${m}-13` });
  clockAt(t, `${q.after}-10`);

  const data = ok({ period: 'month', month: m });
  const row = data.stays.find((r) => r.reservationId === remitted.id);
  assert.equal(row.remittedBy, 'platform');
  assert.equal(row.key, `${remitted.id}-platform`);
  assert.equal(row.declarable, false);
  assert.equal(row.declared, false);
  assert.equal(row.platformLabel, PLATFORM.remitted);
  assert.equal(row.nightsCount, 3);
  const quote = quoteStoredReservation(db, db.prepare('SELECT * FROM reservations WHERE id = ?').get(remitted.id));
  assert.equal(row.taxAmount, quote.touristTaxOriginalTotal);
  assert.ok(row.taxAmount > 0);
  assert.equal(data.totals.platformRemittedStaysCount, 1);
  assert.equal(data.totals.platformRemittedAmount, row.taxAmount);

  assert.equal(data.stays.find((r) => r.reservationId === reversed.id).remittedBy, 'us');
  assert.equal(data.stays.find((r) => r.reservationId === direct.id).platformLabel, 'Direct');
  assert.equal(data.totals.staysCount, 2);
  assert.equal(data.totals.amount, sumCents(ours(data), (r) => r.taxAmount));
  assert.ok(!monthly(m).reservations.some((r) => r.reservationId === remitted.id));
  // Not in the register, which is what WE declare.
  assert.equal(data.nights.reduce((s, n) => s + n.staysCount, 0), data.totals.nights);
  assert.ok(!data.nights.some((n) => n.date === `${m}-12`));
});

test('rule 7: the minors are counted apart as exempt, the amount untouched', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const family = paidStay(NO_ACOMPTE, `${m}-05`, `${m}-08`, { adults: 2, children: 1, teens: 1, babies: 1, forceCapacity: true });
  const adultsOnly = paidStay(WITH_ACOMPTE, `${m}-05`, `${m}-08`, { adults: 2 });
  clockAt(t, `${q.after}-10`);

  const data = ok({ period: 'month', month: m });
  const row = data.stays.find((r) => r.reservationId === family.id);
  const twin = data.stays.find((r) => r.reservationId === adultsOnly.id);
  assert.deepEqual(
    { persons: row.persons, taxed: row.taxedPersons, exempt: row.exemptPersons, taxedN: row.taxedPersonNights, exemptN: row.exemptPersonNights },
    { persons: 5, taxed: 2, exempt: 3, taxedN: 6, exemptN: 9 },
  );
  assert.equal(row.taxAmount, twin.taxAmount);
  assert.equal(row.taxAmount, monthly(m).reservations.find((r) => r.reservationId === family.id).taxAmount);
  assert.deepEqual(
    { persons: data.totals.persons, taxed: data.totals.taxedPersons, exempt: data.totals.exemptPersons, exemptN: data.totals.exemptPersonNights },
    { persons: 7, taxed: 4, exempt: 3, exemptN: 9 },
  );
});

test('rules 8 and 11: the declaration filter splits the rows; declared, remaining and « all declared » follow the ticks', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const first = paidStay(NO_ACOMPTE, `${m}-02`, `${m}-04`);
  const second = paidStay(WITH_ACOMPTE, `${m}-02`, `${m}-05`);
  fiche(NO_ACOMPTE, PLATFORM.remitted, { startDate: `${m}-10`, endDate: `${m}-12` });
  clockAt(t, `${q.after}-10`);
  tick(first.id);

  const all = ok({ period: 'month', month: m });
  const firstRow = all.stays.find((r) => r.reservationId === first.id);
  const secondRow = all.stays.find((r) => r.reservationId === second.id);
  assert.equal(firstRow.declared, true);
  assert.ok(firstRow.touristTaxDeclaredAt);
  assert.equal(all.totals.declaredAmount, firstRow.taxAmount);
  assert.equal(all.totals.remainingAmount, secondRow.taxAmount);
  assert.equal(all.totals.amount, sumCents([firstRow, secondRow], (r) => r.taxAmount));
  assert.equal(all.totals.declaredRowsCount, 1);
  assert.equal(all.totals.toDeclareRowsCount, 1);
  assert.equal(all.totals.allDeclared, false);
  assert.equal(all.stays.length, 3);

  const todo = ok({ period: 'month', month: m, declaration: 'todo' });
  assert.deepEqual(todo.stays.map((r) => r.reservationId), [second.id]);
  assert.equal(todo.filters.declaration, 'todo');
  assert.equal(todo.totals.amount, secondRow.taxAmount);
  assert.equal(todo.totals.declaredAmount, 0);
  // The platform's stays are not ours to tick: out of a filtered list, still told apart in the bar.
  assert.equal(todo.totals.platformRemittedStaysCount, 1);

  const done = ok({ period: 'month', month: m, declaration: 'done' });
  assert.deepEqual(done.stays.map((r) => r.reservationId), [first.id]);
  assert.equal(done.totals.remainingAmount, 0);
  assert.equal(done.totals.allDeclared, true);

  tick(second.id);
  assert.equal(ok({ period: 'month', month: m }).totals.allDeclared, true);
  assert.equal(ok({ period: 'month', month: m, declaration: 'todo' }).totals.allDeclared, false);
});

test('rule 12: the logement filter narrows rows, register and totals; the payload lists every logement', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  paidStay(NO_ACOMPTE, `${m}-02`, `${m}-04`);
  const other = paidStay(WITH_ACOMPTE, `${m}-02`, `${m}-05`);
  fiche(NO_ACOMPTE, PLATFORM.remitted, { startDate: `${m}-10`, endDate: `${m}-12` });
  clockAt(t, `${q.after}-10`);

  const data = ok({ period: 'month', month: m, propertyId: String(WITH_ACOMPTE) });
  assert.equal(data.filters.propertyId, WITH_ACOMPTE);
  assert.deepEqual(data.stays.map((r) => r.reservationId), [other.id]);
  assert.equal(data.totals.platformRemittedStaysCount, 0);
  assert.equal(data.nights.length, 3);
  assert.ok(data.properties.some((p) => p.id === NO_ACOMPTE) && data.properties.some((p) => p.id === WITH_ACOMPTE));
  assert.equal(ok({ period: 'month', month: m, propertyId: '' }).filters.propertyId, null);
});

test('rules 9 and 10: the register has one entry per occupied night and adds up to the list, refunded and added rows included', async (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const a = paidStay(NO_ACOMPTE, `${m}-02`, `${m}-05`, { children: 1 });
  const b = paidStay(WITH_ACOMPTE, `${m}-03`, `${m}-06`, { adults: 3 });
  const refunded = paidStay(NO_ACOMPTE, `${m}-10`, `${m}-13`);
  assert.equal(refund(refunded.id, [{ key: 'touristTax', amountTtc: 2.4 }]).statusCode, 201);
  const added = fiche(NO_ACOMPTE, PLATFORM.ownReversed, { startDate: `${m}-20`, endDate: `${m}-22`, platformGrossAmount: 600 });
  await put(added, { adults: 3 });
  pay(added.id, S);
  clockAt(t, `${q.after}-10`);
  tick(added.id);
  pay(added.id, { ...C, complementPaidDate: `${m}-25` });

  const data = ok({ period: 'month', month: m });
  const ownRow = data.stays.find((r) => r.reservationId === added.id && r.addedGuestsRow);
  assert.ok(ownRow, 'the added guests have a row of their own');
  assert.equal(ownRow.key, `${added.id}-added`);
  assert.equal(ownRow.exemptPersons, 0);
  const refundedRow = data.stays.find((r) => r.reservationId === refunded.id);
  assert.equal(refundedRow.nightsCount, 2);
  assert.equal(refundedRow.refundedTaxNights, 1);

  const register = data.nights;
  const sum = (pick) => register.reduce((s, n) => s + pick(n), 0);
  assert.equal(sum((n) => n.staysCount), data.totals.nights);
  assert.equal(sum((n) => n.taxedPersons), data.totals.taxedPersonNights);
  assert.equal(sum((n) => n.exemptPersons), data.totals.exemptPersonNights);
  assert.equal(sum((n) => n.persons), data.totals.taxedPersonNights + data.totals.exemptPersonNights);
  assert.equal(sumCents(register, (n) => n.taxAmount), data.totals.amount);
  assert.equal(data.totals.staysCount, 4);
  assert.equal(data.totals.nights, 3 + 3 + 2 + 2);

  // One entry per night, in order; the night two stays share counts both; the refunded night has left.
  assert.deepEqual(register.map((n) => n.date), [...register.map((n) => n.date)].sort());
  assert.equal(new Set(register.map((n) => n.date)).size, register.length);
  const third = register.find((n) => n.date === `${m}-03`);
  assert.equal(third.staysCount, 2);
  assert.equal(third.taxedPersons, 5);
  assert.equal(third.exemptPersons, 1);
  assert.ok(register.some((n) => n.date === `${m}-11`));
  assert.ok(!register.some((n) => n.date === `${m}-12`));
  // The night of the stay with added guests counts the stay once and every adult.
  const night = register.find((n) => n.date === `${m}-20`);
  assert.equal(night.staysCount, 1);
  assert.equal(night.taxedPersons, 3);
  assert.ok(a && b);
});

test('rule 13: the CSV exports the selection on screen, list or register, with its total line', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  const stay = paidStay(NO_ACOMPTE, `${m}-02`, `${m}-04`, { children: 1 });
  fiche(NO_ACOMPTE, PLATFORM.remitted, { startDate: `${m}-10`, endDate: `${m}-12` });
  clockAt(t, `${q.after}-10`);
  tick(stay.id);
  const data = ok({ period: 'month', month: m });

  const list = csv({ period: 'month', month: m });
  assert.equal(list.statusCode, 200);
  assert.equal(list.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(list.headers['content-disposition'], `attachment; filename="taxe-de-sejour-${m}-01_${data.window.to}.csv"`);
  const lines = list.body.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Statut;Séjour;Logement;Canal;Arrivée;Départ;Nuits;Personnes;Taxées;Exonérées;Nuitées taxées;Nuitées exonérées;Montant');
  assert.equal(lines.length, 1 + data.stays.length + 1);
  assert.match(lines[1], /^Déclarée le \d\d\/\d\d\/\d{4};Camille Registre;Sans acompte;Direct;/);
  assert.match(lines[2], /^Reversée par la plateforme;/);
  assert.equal(lines.at(-1), `Total à reverser;1 séjour;;;;;2;3;2;1;4;2;${formatNumber(data.totals.amount)}`);

  const nights = csv({ period: 'month', month: m, view: 'night', declaration: 'done' });
  assert.match(nights.headers['content-disposition'], /-par-nuit\.csv"$/);
  const rows = nights.body.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(rows[0], 'Nuit du;Séjours;Personnes;Taxées;Exonérées;Montant');
  assert.equal(rows.length, 1 + 2 + 1);
  assert.match(rows[1], new RegExp(`^02/${m.slice(5)}/${m.slice(0, 4)};1;3;2;1;`));
  assert.match(rows.at(-1), /^Total à reverser;2;6;4;2;/);

  const refused = csv({ period: 'month', month: `${q.year}-13` });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(refused.body, { error: 'Mois invalide. Format attendu: YYYY-MM.' });
});

test('rule 14: the report never writes, and reading it twice gives the same payload', (t) => {
  const q = nextQuarter();
  const [m] = q.months;
  paidStay(NO_ACOMPTE, `${m}-02`, `${m}-04`);
  clockAt(t, `${q.after}-10`);
  const before = db.prepare('SELECT id, updatedAt, touristTaxTotal, touristTaxDeclaredAt FROM reservations ORDER BY id').all();
  const once = ok({ period: 'quarter', quarter: q.key });
  const twice = ok({ period: 'quarter', quarter: q.key });
  assert.deepEqual(once, twice);
  assert.deepEqual(db.prepare('SELECT id, updatedAt, touristTaxTotal, touristTaxDeclaredAt FROM reservations ORDER BY id').all(), before);
});
