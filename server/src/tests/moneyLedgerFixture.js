// Shared fixture of the round-22 money suites: the auditor's two properties (300 € a night, 20 € per extra guest per
// night, tourist tax 1,20 € per adult and night, one without acompte and one with), the platform modes, and the moves a
// fiche makes through the real controllers: create, save, payment mark, cancel, refund.
//
// Requires `process.env.DB_PATH = ':memory:'` to be set by the test file BEFORE requiring this module.

const {
  db, controller, respond, inDays, seed, stayBody, rowOf, mark, ADMIN,
} = require('./ledgerFixture');
const refundsController = require('../controllers/refundsController');
const cancellationController = require('../controllers/reservationCancellationController');
const { todayIso } = require('../utils/localDate');
const { refreshDirectChannels } = require('../utils/platformNameFormat');

const TODAY = todayIso();
const NO_ACOMPTE = 3;
const WITH_ACOMPTE = 5;
const PLATFORM = { reversed: 'CanalRev', remitted: 'CanalPlat', owner: 'CanalOwner', ownReversed: 'CanalPropre' };
const S = { balancePaid: true, balancePaidDate: TODAY };
const C = { complementPaid: true, complementPaidDate: TODAY };
const D = { depositPaid: true, depositPaidDate: TODAY };
const forced = (amount = 50, description = 'Forcée') => ({ customKey: description, description, amount, offered: false, inComplement: 1 });
const free = (amount = 100, description = 'Libre', inComplement = 0) => ({ customKey: description, description, amount, offered: false, inComplement });

let seeded = false;
function seedMoney() {
  if (seeded) return;
  seeded = true;
  seed();
  const property = db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled,
      depositPercent, defaultCautionAmount, balanceDaysBefore, basePriceIncludedGuests, extraGuestPrice, extraGuestPriceUnit)
    VALUES (?, ?, 8, 'per_day_per_person', 1.2, ?, 30, 0, 7, 2, 20, 'per_night')`);
  const rule = db.prepare("INSERT INTO pricing_rules (propertyId, label, pricePerNight) VALUES (?, 'Standard', 300)");
  [[NO_ACOMPTE, 'Sans acompte', 0], [WITH_ACOMPTE, 'Avec acompte', 1]].forEach(([id, name, deposit]) => { property.run(id, name, deposit); rule.run(id); });
  const platform = db.prepare(`INSERT INTO platforms (name, collectsTouristTax, touristTaxRemittedByPlatform, platformTakesDeposit, countsAsDirect)
    VALUES (?, ?, ?, ?, ?)`);
  platform.run(PLATFORM.reversed, 1, 0, 0, 0);
  platform.run(PLATFORM.remitted, 1, 1, 0, 0);
  platform.run(PLATFORM.owner, 0, 0, 0, 0);
  platform.run(PLATFORM.ownReversed, 1, 0, 1, 1);
  refreshDirectChannels(db);
}

seedMoney();

// Two nights, each stay on a week of its own, so the suites never collide on availability.
let slot = 0;
function fiche(propertyId, platform, extra = {}) {
  seedMoney();
  const start = 400 + 7 * slot;
  slot += 1;
  const body = stayBody({
    propertyId, platform, startDate: inDays(start), endDate: inDays(start + 2),
    customOptions: [], resources: [], forceMinNights: true, forceChangeover: true, forceMaxNights: true, ...extra,
  });
  const res = respond();
  controller.create({ body, user: ADMIN }, res);
  if (res.statusCode !== 200) throw new Error(`create failed: ${JSON.stringify(res.body)}`);
  return { id: Number(res.body.id), body };
}

async function put(stay, over = {}) {
  stay.body = { ...stay.body, ...over };
  const res = respond();
  await controller.update({ params: { id: stay.id }, body: { ...stay.body, forceOverpayment: true }, user: ADMIN }, res);
  if (res.statusCode !== 200) throw new Error(`save failed: ${JSON.stringify(res.body)}`);
  return res;
}

function pay(id, ...marks) {
  for (const body of marks) {
    const res = mark(id, body);
    if (res.statusCode !== 200) throw new Error(`mark failed: ${JSON.stringify(res.body)}`);
  }
}

// specs/reservation-payment-ledger.md rule 68 (D20, 2026-11-06) — no path marks the end-of-stay complement before the
// check-out. A stay that holds one collected anyway is a row stored before D20, never rewritten: the suites that judge
// such a row write it as it is stored.
function storedEndOfStayPaid(id, { date = TODAY, cash = false } = {}) {
  db.prepare('UPDATE reservations SET endOfStayComplementPaid = 1, endOfStayComplementPaidDate = ?, endOfStayComplementPaidCash = ? WHERE id = ?')
    .run(date, cash ? 1 : 0, Number(id));
}

async function cancel(id) {
  const res = respond();
  await cancellationController.cancel({ params: { id }, body: { reason: 't' }, user: ADMIN }, res);
  if (res.statusCode !== 200) throw new Error(`cancel failed: ${JSON.stringify(res.body)}`);
}

const register = (id) => refundsController.buildRegister(Number(id)).payload;
/** `{ line key → what it offers }`. */
const offered = (id) => Object.fromEntries(register(id).refundableLines.map((line) => [line.key, line.refundableTtc]));
const keyOf = (id, label) => {
  const line = register(id).refundableLines.find((l) => l.label === label);
  return line ? line.key : null;
};

function refund(id, lines, method = 'transfer') {
  const res = respond();
  refundsController.create({ params: { id }, body: { refundDate: TODAY, method, reason: 'p', lines } }, res);
  return res;
}

/** Everything the register offers, given back: the book money by transfer, the caisse interne's in the caisse interne. */
function giveAll(id) {
  const lines = register(id).refundableLines;
  const book = lines.map((l) => ({ key: l.key, amountTtc: Math.round((l.refundableTtc - (l.cashTtc || 0)) * 100) / 100 })).filter((l) => l.amountTtc > 0);
  const cash = lines.filter((l) => l.cashTtc > 0).map((l) => ({ key: l.key, amountTtc: l.cashTtc }));
  const results = [];
  if (book.length) results.push(refund(id, book));
  if (cash.length) results.push(refund(id, cash, 'internal'));
  for (const res of results) if (res.statusCode !== 201) throw new Error(`refund failed: ${JSON.stringify(res.body)}`);
  return results;
}

function ficheView(id) {
  const res = respond();
  controller.getById({ params: { id }, user: ADMIN }, res);
  return res.body;
}

/** The stay's total minus what its paid buckets hold minus what the ledger still asks for: what nobody claims. */
function unclaimed(id) {
  const stay = ficheView(id);
  const paid = (stay.depositPaid ? stay.depositAmount : 0) + (stay.balancePaid ? stay.balanceAmount : 0) + (stay.complementPaid ? stay.complementAmount : 0);
  return Math.round((stay.finalPrice + stay.touristTaxTotal - paid - stay.ledger.remaining) * 100) / 100;
}

module.exports = {
  db, controller, respond, inDays, rowOf, mark, ADMIN, TODAY, NO_ACOMPTE, WITH_ACOMPTE, PLATFORM, S, C, D, forced, free,
  seedMoney, fiche, put, pay, storedEndOfStayPaid, cancel, register, offered, keyOf, refund, giveAll, ficheView, unclaimed,
};
