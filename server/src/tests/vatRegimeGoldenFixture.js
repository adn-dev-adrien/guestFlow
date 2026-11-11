/**
 * The VAT golden database (specs/vat-optional-mode.md rule 23). Not a test file.
 *
 * Solio's six stays (`productisationGoldenFixture`) completed into a database every VAT reader has
 * something to read in: stored prices from the engine, a proportional tourist tax at L'Estiva (the one
 * place where the rate moves a TTC figure), platform commissions, payments spread over several months,
 * an installment plan, a refund, a cancellation, a frozen and a declared tourist tax, two devis.
 *
 * The clock is frozen on first load: the fixture, the capture and the prod-copy script all read the
 * same "today".
 */

const { buildSolioDb, STAYS } = require('./productisationGoldenFixture');

const FROZEN_NOW = new Date('2027-10-20T10:00:00+02:00');

let frozen = false;
function freezeClock(at = FROZEN_NOW) {
  if (frozen) return;
  frozen = true;
  const RealDate = Date;
  const instant = at.getTime();
  class FrozenDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(instant);
      else super(...args);
    }

    static now() { return instant; }
  }
  global.Date = FrozenDate;
}

function insert(db, table, row) {
  const cols = Object.keys(row);
  const info = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(row);
  return Number(info.lastInsertRowid);
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

function storeQuote(db, id, extra = {}) {
  const { calculateReservationQuote } = require('../utils/pricing');
  const { buildReservationEngineInput } = require('../utils/reservationEngineInput');
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const quote = calculateReservationQuote(buildReservationEngineInput(db, row));
  if (quote.error) throw new Error(`fixture quote ${id}: ${quote.error}`);
  db.prepare(`UPDATE reservations SET totalPrice = ?, finalPrice = ?, depositAmount = ?, depositDueDate = ?,
      balanceAmount = ?, balanceDueDate = ?, touristTaxRate = ?, touristTaxTotal = ? WHERE id = ?`).run(
    quote.totalPrice, quote.finalPrice, quote.depositAmount, quote.depositDueDate,
    quote.balanceAmount, quote.balanceDueDate, quote.touristTaxRate, quote.touristTaxTotal, id,
  );
  if (Object.keys(extra).length) {
    const sets = Object.keys(extra).map((k) => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE reservations SET ${sets} WHERE id = @id`).run({ ...extra, id });
  }
  return quote;
}

/** Must be called once per process: `database.js` is a module singleton. */
function buildVatGoldenDb() {
  freezeClock();
  const db = buildSolioDb();

  db.prepare("UPDATE properties SET touristTaxMode = 'per_day_per_person', touristTaxPerDayPerPerson = 1.5 WHERE id = 1").run();
  db.prepare(`UPDATE properties SET touristTaxMode = 'percentage_accommodation', touristTaxPercentage = 5,
    touristTaxDepartmentPercentage = 10 WHERE id = 2`).run();
  db.prepare("UPDATE platforms SET commissionPercent = 15, hasVatOnCommission = 1, commissionAccountNumber = '62270000' WHERE name = 'airbnb'").run();
  db.prepare("UPDATE platforms SET commissionPercent = 17, hasVatOnCommission = 1, commissionAccountNumber = '62270000' WHERE name = 'booking'").run();
  db.prepare("UPDATE platforms SET commissionPercent = 20, hasVatOnCommission = 0 WHERE name = 'gites-de-france'").run();
  db.prepare('UPDATE app_settings SET fiscalYearEndMonth = 12').run();

  const quotes = {};
  for (const stay of STAYS) quotes[stay.id] = storeQuote(db, stay.id);

  // Platform stays: the guest's gross and the platform's commission, as the intake plugins store them.
  for (const [id, pct] of [[102, 15], [104, 17], [105, 20], [103, 0]]) {
    const q = quotes[id];
    db.prepare(`UPDATE reservations SET clientGrossAmount = ?, platformGrossAmount = ?, platformCommissionAmount = ?,
        acompteCommissionAmount = 0 WHERE id = ?`)
      .run(q.finalPrice, q.finalPrice, round2((q.finalPrice * pct) / 100), id);
  }

  // Money collected, spread over several months: deposits, soldes, a platform solde, a complement.
  db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2027-03-05', balancePaid = 1, balancePaidDate = '2027-06-20' WHERE id = 101").run();
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2027-09-15', depositPaid = 1, depositPaidDate = '2027-08-02' WHERE id = 102").run();
  db.prepare("UPDATE reservations SET depositPaid = 1, depositPaidDate = '2027-04-10', complementPaid = 1, complementPaidDate = '2027-05-16' WHERE id = 103").run();
  db.prepare("UPDATE reservations SET balancePaid = 1, balancePaidDate = '2027-08-01' WHERE id = 104").run();

  // One installment plan on the direct L'Estiva stay (the plan replaces the acompte and the solde).
  const installments = require('../models/installmentsModel');
  const target = Math.round((quotes[106].finalPrice + quotes[106].touristTaxTotal) * 100);
  const first = Math.round(target / 2);
  db.prepare('UPDATE reservations SET depositAmount = 0, balanceAmount = 0 WHERE id = 106').run();
  installments.replacePlan(106, [
    { number: 1, dueDate: '2027-04-02', amountCents: first },
    { number: 2, dueDate: '2027-05-20', amountCents: target - first },
  ], target);
  const plan = installments.listFor(106);
  installments.markPaid(plan[0].id, { paidDate: '2027-04-02', method: 'card' });
  installments.markPaid(plan[1].id, { paidDate: '2027-05-20', method: 'card' });

  // A frozen tourist tax and a declared one, at L'Estiva (proportional).
  db.prepare(`UPDATE reservations SET touristTaxFrozenAt = '2027-05-17 08:00:00', touristTaxFrozenBaseHt = 150,
      touristTaxFrozenOccupants = 3, touristTaxFrozenUnitAmount = 0.62 WHERE id = 103`).run();
  db.prepare("UPDATE reservations SET touristTaxDeclaredAt = '2027-07-04 09:00:00' WHERE id = 106").run();

  // A direct stay with only its acompte collected, then cancelled afterwards by the capture; and one
  // already cancelled with the compensation booked.
  const direct = (row) => {
    const id = insert(db, 'reservations', {
      kind: 'reservation', clientId: 1, createdAt: '2027-03-02 10:00:00', finalPrice: 1,
      checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct', adults: 2, children: 0, babies: 0,
      doubleBeds: 1, singleBeds: 0, ...row,
    });
    return id;
  };
  const upcoming = direct({ id: 108, propertyId: 1, startDate: '2027-09-04', endDate: '2027-09-09', reservationNumber: 'GF-2027-108' });
  storeQuote(db, upcoming, { depositPaid: 1, depositPaidDate: '2027-05-25' });
  const cancelled = direct({ id: 109, propertyId: 2, startDate: '2027-07-20', endDate: '2027-07-24', reservationNumber: 'GF-2027-109' });
  storeQuote(db, cancelled, { depositPaid: 1, depositPaidDate: '2027-05-10', kind: 'cancelled', cancelledAt: '2027-05-30 11:00:00' });
  insert(db, 'cancellation_compensations', {
    reservationId: cancelled, propertyId: 2, propertyName: "L'Estiva", platform: 'direct', clientFirstName: 'Camille',
    clientLastName: 'Martin', startDate: '2027-07-20', endDate: '2027-07-24', cancelledStayAmount: 700, expectedAmount: 200,
    receivedAmount: 200, receivedDate: '2027-05-30', status: 'received', origin: 'cancellation',
  });

  // A refund on the first stay, two lines (the refundable lines come from the engine of the day).
  const refunds = require('../models/refundsModel');
  refunds.create(101, {
    refundDate: '2027-06-25', method: 'transfer', totalTtc: 110, reason: 'Geste commercial',
    lines: [
      { lineKey: 'accommodation', label: 'Hébergement', bucket: 'accommodation', quantity: 1, unitPrice: 100, amountTtc: 100, vatRate: 10 },
      { lineKey: 'touristTax', label: 'Taxe de séjour', bucket: 'touristTax', quantity: null, unitPrice: null, amountTtc: 10, vatRate: 0 },
    ],
  });

  // Two devis: a draft in French at La Granja, a sent one in English at L'Estiva (proportional tax).
  const devis = (row, optionIds) => {
    const id = insert(db, 'reservations', {
      kind: 'devis', clientId: 1, createdAt: '2027-05-28 09:00:00', finalPrice: 1, adults: 2, children: 0, babies: 0,
      doubleBeds: 1, singleBeds: 0, checkInTime: '16:00', checkOutTime: '10:00', platform: 'direct', ...row,
    });
    for (const optionId of optionIds) {
      const o = db.prepare('SELECT price FROM options WHERE id = ?').get(optionId);
      insert(db, 'reservation_options', { reservationId: id, optionId, quantity: 1, unitPrice: o.price, totalPrice: o.price });
    }
    storeQuote(db, id);
    return id;
  };
  devis({
    id: 201, propertyId: 1, startDate: '2027-10-15', endDate: '2027-10-19', devisNumber: '2027-05-201',
    devisStatus: 'draft', validUntil: '2027-07-15', pdfLanguage: 'fr',
  }, [1, 4]);
  devis({
    id: 202, propertyId: 2, startDate: '2027-08-06', endDate: '2027-08-10', devisNumber: '2027-05-202',
    devisStatus: 'sent', validUntil: '2027-06-30', pdfLanguage: 'en', adults: 3,
  }, [4]);

  return db;
}

module.exports = { buildVatGoldenDb, freezeClock, FROZEN_NOW };
