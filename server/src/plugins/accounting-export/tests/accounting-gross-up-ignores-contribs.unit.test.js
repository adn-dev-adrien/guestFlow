// specs/accounting-books-the-money-collected.md rule 12 — a reservation of the `clientGrossAmount` era
// (Gîtes de France #13: 706 € solde net, 907,20 € paid by the guest, no entered commission) captures
// per-line contribs from its stored NET solde the day its balance is ticked. Used as-is, they left the
// 201,20 € of commission out of the credits and the export pushed it onto the last credit, the VAT line:
// `CDAUSQU D706 | 622600 D201,20 | 70600000 C641,82 | 44571100 C265,38` — 41 % of VAT (review 2026-10-19).

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const { __test: { buildEntry }, create: createAccountingModel } = require('../accountingModel');
const { entryToRows } = require('../accountingExport');

const COMMISSION_CONTEXT = {
  defaultAccount: '622600',
  vatRateCommission: 20,
  vatRate: 10,
  platformByName: new Map([['gitesdefrance', { commissionAccountNumber: '', hasVatOnCommission: 0 }]]),
};
const NO_DESTINATION = { preArrivalOptions: 0, preArrivalResources: 0, complementOptions: 0, complementResources: 0 };

const linesOf = (entry) => entryToRows(entry).map((r) => `${r[6]} ${r[7] ? `D${r[7]}` : `C${r[8]}`}`);

function grossEraRow(overrides = {}) {
  return {
    id: 13, firstName: 'Test', lastName: 'Gites', propertyName: 'Gîte', platform: 'GitesDeFrance',
    depositAmount: 0, depositPaid: 0, depositPaidDate: null,
    balanceAmount: 706, balancePaid: 1, balancePaidDate: '2026-10-19',
    complementAmount: 0, complementPaid: 0, complementPaidDate: null, endOfStayComplementAmount: 0,
    finalPrice: 706, totalPrice: 782.4, touristTaxTotal: 0, touristTaxInComplement: 0,
    clientGrossAmount: 907.2, platformCommissionAmount: null, acompteCommissionAmount: null,
    accommodationAcompteContribTtc: 0, accommodationSoldeContribTtc: 706,
    touristTaxAcompteContribTtc: 0, touristTaxSoldeContribTtc: 0,
    ...overrides,
  };
}
const perLine = (hasContribs) => ({
  optionLines: [], customOptionLines: [], resourceLines: [], hasContribs,
  accommodationTtcCurrent: 706, optionsTtc: 0, resourcesTtc: 0, destinations: NO_DESTINATION,
});
const NO_CONTRIBS = {
  accommodationAcompteContribTtc: null, accommodationSoldeContribTtc: null,
  touristTaxAcompteContribTtc: null, touristTaxSoldeContribTtc: null,
};

test('rule 12 — a gross-up entry with contribs books its VAT at the rate, not the commission residue', () => {
  const entry = buildEntry(grossEraRow(), 'balance', perLine(true), COMMISSION_CONTEXT, { collectedOnArrival: false });
  assert.deepEqual(linesOf(entry), [
    'CGITES D706', '622600 D201.2', '70600000 C824.73', '44571100 C82.47',
  ]);
});

test('rule 12 — the gross-up entry is the one the same stay books without captured contribs', () => {
  const withContribs = linesOf(buildEntry(grossEraRow(), 'balance', perLine(true), COMMISSION_CONTEXT, { collectedOnArrival: false }));
  const withoutContribs = linesOf(buildEntry(grossEraRow(NO_CONTRIBS), 'balance', perLine(false), COMMISSION_CONTEXT, { collectedOnArrival: false }));
  assert.deepEqual(withContribs, withoutContribs);
});

test('rule 12 — contribs keep driving an entry that is not grossed up', () => {
  const row = grossEraRow({ clientGrossAmount: null, platformCommissionAmount: 201.2, balanceAmount: 706 });
  const entry = buildEntry(row, 'balance', perLine(true), COMMISSION_CONTEXT, { collectedOnArrival: false });
  assert.equal(entry.fraction, 1);
  assert.deepEqual(linesOf(entry), ['CGITES D504.8', '622600 D201.2', '70600000 C641.82', '44571100 C64.18']);
});

// End to end on the boot schema: the balance ticked through the payment controller (which captures the
// contribs), then the month's journal.
test('rule 12 — ticking the solde of a clientGrossAmount-era stay keeps the journal at 10 % VAT', () => {
  const db = require('../../../database');
  const controller = require('../../../controllers/reservationsController');

  db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
              VALUES (1, 'Gîte', 12, 'per_day_per_person', 0, 0)`).run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Test', 'Gites')").run();
  const id = db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, platform, totalPrice, discountPercent, finalPrice,
       customPrice, depositAmount, depositDisabled, balanceAmount, touristTaxTotal, clientGrossAmount, kind)
      VALUES (1, 1, '2026-09-25', '2026-09-28', 10, 'GitesDeFrance', 782.4, 0, 706, 706, 0, 1, 706, 0, 907.2, 'reservation')`)
    .run().lastInsertRowid;

  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.updatePayment({ params: { id: String(id) }, body: { balancePaid: true, balancePaidDate: '2026-10-19' }, user: { role: 'admin', roles: ['admin'] } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));

  const [entry] = createAccountingModel(db).encaissementsByMonth({ month: 10, year: 2026 })
    .filter((e) => Number(e.reservationId) === Number(id));
  assert.ok(entry, 'the solde is in the journal');
  const lines = linesOf(entry);
  assert.ok(lines.includes('70600000 C824.73'), lines.join(' | '));
  assert.ok(lines.includes('44571100 C82.47'), lines.join(' | '));
});
