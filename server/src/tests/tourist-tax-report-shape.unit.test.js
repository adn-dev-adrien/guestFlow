// specs/tourist-tax-report-v2.md §3 rules 6, 7, 8, 9, 10 and 11 — the report's shaping, pure: a row of ours keeps the
// extraction's figures and adds its exempt persons, a platform's row is told apart, the declaration filter, the
// register spread in whole cents and whole persons so it adds up to the list, and the totals of the sticky bar.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildTouristTaxReport, ourStayRow, platformStayRow, nightRegister, reportTotals, distribute,
} = require('../utils/touristTaxReport');

const Y = new Date().getFullYear() + 1;
const day = (d) => `${Y}-07-${String(d).padStart(2, '0')}`;

// An extraction row, as financeModel.getTouristTaxRows returns it.
const extractionRow = (over = {}) => ({
  reservationId: 1, propertyId: 1, propertyName: 'Granja', reservationName: 'Camille Registre',
  startDate: day(4), endDate: day(7), lastNightDate: day(6), touristTaxDeclaredAt: null, declarable: true,
  adults: 2, children: 1, nightsCount: 3, adultNights: 6, taxRate: 1.65, taxAmount: 9.9,
  refundedTaxNights: 0, refundedTaxAmount: 0, accommodationAmount: 400, includedServicesDeduction: 0,
  nightPricePerOccupantHt: null, ...over,
});

test('rule 7: a row of ours keeps the extraction figures and counts its minors as exempt, babies included', () => {
  const row = ourStayRow(extractionRow(), { babies: 1, platformLabel: 'Direct' });
  assert.deepEqual(row, {
    key: '1', reservationId: 1, propertyId: 1, propertyName: 'Granja', reservationName: 'Camille Registre',
    platformLabel: 'Direct', startDate: day(4), endDate: day(7), remittedBy: 'us', addedGuestsRow: false, noGuestAdded: false,
    nightsCount: 3, persons: 4, taxedPersons: 2, exemptPersons: 2, taxedPersonNights: 6, exemptPersonNights: 6,
    taxAmount: 9.9, refundedTaxNights: 0, refundedTaxAmount: 0, touristTaxDeclaredAt: null, declared: false, declarable: true,
    nightPricePerOccupantHt: null, accommodationAmount: 400,
  });
  const declared = ourStayRow(extractionRow({ touristTaxDeclaredAt: `${day(10)} 09:00:00` }));
  assert.equal(declared.declared, true);
  assert.equal(declared.exemptPersons, 1);
});

test('rule 7: a row of added guests is the added adults alone, no minor exempted twice; « nobody added » counts nobody', () => {
  const added = ourStayRow(extractionRow({ addedGuestsRow: true, adults: 1, children: 0, adultNights: 3, taxAmount: 4.95 }), { babies: 2 });
  assert.deepEqual([added.key, added.persons, added.taxedPersons, added.exemptPersons, added.exemptPersonNights], ['1-added', 1, 1, 0, 0]);
  const nobody = ourStayRow(extractionRow({ addedGuestsRow: true, noGuestAdded: true, adults: null, children: null, adultNights: 0, taxAmount: 1.2 }));
  assert.deepEqual([nobody.noGuestAdded, nobody.persons, nobody.taxedPersonNights, nobody.taxAmount], [true, 0, 0, 1.2]);
});

test('rule 6: a platform row is its own: no tick, its minors exempt, its person-nights from its nights', () => {
  const row = platformStayRow({
    reservationId: 9, propertyId: 2, propertyName: 'Estiva', reservationName: 'Sam Plateforme', platformLabel: 'Airbnb',
    startDate: day(6), endDate: day(9), nightsCount: 3, adults: 2, children: 1, teens: 1, babies: 0, taxAmount: 5.28,
  });
  assert.deepEqual([row.key, row.remittedBy, row.declarable, row.declared, row.touristTaxDeclaredAt], ['9-platform', 'platform', false, false, null]);
  assert.deepEqual([row.persons, row.taxedPersons, row.exemptPersons, row.taxedPersonNights, row.exemptPersonNights], [4, 2, 2, 6, 6]);
});

test('rule 10: distribute splits a whole amount into whole shares that add up to it', () => {
  assert.deepEqual(distribute(10, 3), [4, 3, 3]);
  assert.deepEqual(distribute(990, 3), [330, 330, 330]);
  assert.deepEqual(distribute(1, 4), [1, 0, 0, 0]);
  assert.deepEqual(distribute(0, 2), [0, 0]);
  assert.deepEqual(distribute(5, 0), []);
  for (const [total, parts] of [[12345, 7], [1, 1], [99, 100]]) {
    assert.equal(distribute(total, parts).reduce((s, n) => s + n, 0), total);
  }
});

test('rules 9 and 10: the register is one entry per night, its sums equal the list totals to the cent', () => {
  const rows = [
    ourStayRow(extractionRow({ taxAmount: 10, adults: 2, adultNights: 6 }), { babies: 0 }),
    // Overlaps the first: the night of the 5th holds both stays.
    ourStayRow(extractionRow({ reservationId: 2, startDate: day(5), endDate: day(7), nightsCount: 2, adults: 3, children: 0, adultNights: 6, taxAmount: 0.01 })),
    // One night refunded: only its first two nights stay in the register.
    ourStayRow(extractionRow({ reservationId: 3, startDate: day(10), endDate: day(13), nightsCount: 2, adultNights: 4, children: 0, taxAmount: 6.6, refundedTaxNights: 1, refundedTaxAmount: 3.3 })),
    // A row of added guests: the stay counts once, its adults on top.
    ourStayRow(extractionRow({ reservationId: 3, addedGuestsRow: true, startDate: day(10), endDate: day(13), nightsCount: 2, adults: 1, children: 0, adultNights: 2, taxAmount: 3.3 })),
  ];
  const register = nightRegister(rows);
  assert.deepEqual(register.map((n) => n.date), [day(4), day(5), day(6), day(10), day(11)]);
  assert.deepEqual(register[0], { date: day(4), staysCount: 1, persons: 3, taxedPersons: 2, exemptPersons: 1, taxAmount: 3.34 });
  assert.deepEqual(register[1], { date: day(5), staysCount: 2, persons: 6, taxedPersons: 5, exemptPersons: 1, taxAmount: 3.34 });
  assert.deepEqual(register[2], { date: day(6), staysCount: 2, persons: 6, taxedPersons: 5, exemptPersons: 1, taxAmount: 3.33 });
  assert.deepEqual(register[3], { date: day(10), staysCount: 1, persons: 3, taxedPersons: 3, exemptPersons: 0, taxAmount: 4.95 });

  const totals = reportTotals(rows, []);
  const sum = (pick) => register.reduce((s, n) => s + pick(n), 0);
  assert.equal(sum((n) => n.staysCount), totals.nights);
  assert.equal(sum((n) => n.taxedPersons), totals.taxedPersonNights);
  assert.equal(sum((n) => n.exemptPersons), totals.exemptPersonNights);
  assert.equal(Math.round(sum((n) => n.taxAmount * 100)), Math.round(totals.amount * 100));
  assert.deepEqual([totals.staysCount, totals.nights, totals.amount], [3, 7, 19.91]);
});

test('rule 10: a stay whose main row was filtered out still counts its nights once, through its own row', () => {
  const rows = [ourStayRow(extractionRow({ reservationId: 5, addedGuestsRow: true, adults: 1, children: 0, adultNights: 3, taxAmount: 4.95 }))];
  const totals = reportTotals(rows, []);
  assert.deepEqual([totals.staysCount, totals.nights], [1, 3]);
  assert.equal(nightRegister(rows).reduce((s, n) => s + n.staysCount, 0), 3);
});

test('rules 8 and 11: the filter, the order and the bar', () => {
  const declaredRow = ourStayRow(extractionRow({ reservationId: 1, startDate: day(8), endDate: day(10), nightsCount: 2, adultNights: 4, taxAmount: 6.6, touristTaxDeclaredAt: `${day(12)} 08:00:00` }));
  const todoRow = ourStayRow(extractionRow({ reservationId: 2, startDate: day(2), propertyName: 'Estiva', taxAmount: 3.31 }));
  const platformRow = platformStayRow({ reservationId: 3, propertyId: 2, propertyName: 'Estiva', reservationName: 'X', platformLabel: 'Airbnb', startDate: day(5), endDate: day(7), nightsCount: 2, adults: 2, taxAmount: 3.52 });

  const all = buildTouristTaxReport({ ourRows: [declaredRow, todoRow], platformRows: [platformRow], declaration: 'all' });
  assert.deepEqual(all.stays.map((r) => r.key), ['2', '3-platform', '1']);
  assert.deepEqual(
    [all.totals.amount, all.totals.declaredAmount, all.totals.remainingAmount, all.totals.allDeclared],
    [9.91, 6.6, 3.31, false],
  );
  assert.deepEqual([all.totals.platformRemittedStaysCount, all.totals.platformRemittedAmount], [1, 3.52]);
  assert.deepEqual([all.totals.rowsCount, all.totals.declaredRowsCount, all.totals.toDeclareRowsCount], [2, 1, 1]);
  assert.ok(!all.nights.some((n) => n.date === day(6) && n.staysCount > 1), 'the platform stay is not in the register');

  const todo = buildTouristTaxReport({ ourRows: [declaredRow, todoRow], platformRows: [platformRow], declaration: 'todo' });
  assert.deepEqual(todo.stays.map((r) => r.key), ['2']);
  assert.deepEqual([todo.totals.amount, todo.totals.declaredAmount, todo.totals.platformRemittedStaysCount], [3.31, 0, 1]);

  const done = buildTouristTaxReport({ ourRows: [declaredRow, todoRow], platformRows: [platformRow], declaration: 'done' });
  assert.deepEqual(done.stays.map((r) => r.key), ['1']);
  assert.deepEqual([done.totals.remainingAmount, done.totals.allDeclared], [0, true]);

  const empty = buildTouristTaxReport({ ourRows: [], platformRows: [], declaration: 'all' });
  assert.deepEqual(empty.stays, []);
  assert.deepEqual(empty.nights, []);
  assert.deepEqual(empty.totals, {
    staysCount: 0, rowsCount: 0, declaredRowsCount: 0, toDeclareRowsCount: 0, persons: 0, taxedPersons: 0, exemptPersons: 0,
    nights: 0, taxedPersonNights: 0, exemptPersonNights: 0, amount: 0, declaredAmount: 0, remainingAmount: 0,
    allDeclared: false, platformRemittedStaysCount: 0, platformRemittedAmount: 0,
  });
});

test('rule 11: sums run in cents, so float drift never shows in the bar', () => {
  const rows = [0.1, 0.2, 0.7].map((taxAmount, i) => ourStayRow(extractionRow({ reservationId: i + 1, taxAmount })));
  const totals = reportTotals(rows, []);
  assert.equal(totals.amount, 1);
  assert.equal(totals.remainingAmount, 1);
});
