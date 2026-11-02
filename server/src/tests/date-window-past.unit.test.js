// specs/reservations-backend-mvc.md rule 13, second reading (Adrien's decision of 2026-11-02) — the date window
// is [today − 5 years, today + 5 years], the Europe/Paris day, and the backend enforces it on every date an
// operator enters: « Date trop ancienne : 5 ans au plus. » on the past side. Each path below accepts
// today − 5 years and refuses the day before, accepts today + 5 years and refuses the day after, writes
// nothing when it refuses, and never re-judges a date the row already stores.
// Also cites specs/establishment-closures.md rule 18 and specs/finance-dashboard-redesign.md rule 51 (their
// past readings of 2026-11-02).
process.env.DB_PATH = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./reservationSaveFixture');
const devisController = require('../controllers/devisController');
const dashboardController = require('../controllers/dashboardController');
const icalDateDriftModel = require('../models/icalDateDriftModel');
const { todayIso } = require('../utils/localDate');
const { addDaysToIsoDate } = require('../utils/devisHelpers');
const {
  PAST_HORIZON_MESSAGE, HORIZON_MESSAGE, horizonStart, horizonEnd, dateBeforeHorizon, dateWindowMessage,
  entryDateMessage, rangesWindowMessage, stayDatesRefusal,
} = require('../utils/stayDates');
const { validateRange } = require('../utils/establishmentClosuresValidation');
const { resolveWindow } = require('../utils/financeWindow');
const { validateCollectionDate, validateArrivalPaymentDate } = require('../utils/arrivalPaymentDate');
const installmentPlan = require('../utils/installmentPlan');
const { validateRefundPayload } = require('../utils/refunds');
const { validateDraft, validateApprovalCompensation, validateReceipt } = require('../utils/cancellationCompensations');
const { createController: createCompensationsController } = require('../controllers/cancellationCompensationsController');
const calendarNotesController = require('../controllers/calendarNotesController');
const { buildController: buildSequenceController } = require('../controllers/emailSequenceController');
const { buildController: buildEmailsController } = require('../controllers/emailsController');
const { createTariffChangeJournalModel } = require('../models/tariffChangeJournalModel');
const propertiesModel = require('../models/propertiesModel');
const closures = require('./closureConflictsFixture');
const finance = require('./financeDashboardFixture');

const TODAY = todayIso();
const S = horizonStart();
const H = horizonEnd();
const before = addDaysToIsoDate(S, -1);
const after = addDaysToIsoDate(H, 1);
const s = (n) => addDaysToIsoDate(S, n);
const TOO_OLD = { error: PAST_HORIZON_MESSAGE, code: 'INVALID_STAY_DATES' };

function call(handler, req) {
  const res = f.respond();
  const out = handler({ user: f.ADMIN, params: {}, query: {}, ...req }, res);
  return out && typeof out.then === 'function' ? out.then(() => res) : res;
}

function assertTooOld(res, field) {
  assert.equal(res.statusCode, 400, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ...TOO_OLD, field });
}

const count = (sql, ...args) => f.db.prepare(sql).get(...args).n;

test.before(() => f.seed());

test('rule 13: the window starts today − 5 years (29 February → 28) and ends today + 5 years', () => {
  assert.equal(PAST_HORIZON_MESSAGE, 'Date trop ancienne : 5 ans au plus.');
  assert.equal(S, `${Number(TODAY.slice(0, 4)) - 5}${TODAY.slice(4)}`.replace(/-02-29$/, '-02-28'));
  const leapYear = Number(TODAY.slice(0, 4)) + (4 - (Number(TODAY.slice(0, 4)) % 4)) % 4;
  assert.equal(horizonStart(`${leapYear}-02-29`), `${leapYear - 5}-02-28`);
  assert.equal(dateBeforeHorizon(S), false);
  assert.equal(dateBeforeHorizon(before), true);
  assert.equal(dateWindowMessage(S), null);
  assert.equal(dateWindowMessage(before), PAST_HORIZON_MESSAGE);
  assert.equal(dateWindowMessage(H), null);
  assert.equal(dateWindowMessage(after), HORIZON_MESSAGE);
  assert.equal(entryDateMessage(S), null);
  assert.equal(entryDateMessage(before), PAST_HORIZON_MESSAGE);
  assert.equal(entryDateMessage(after), HORIZON_MESSAGE);
  assert.equal(entryDateMessage(before, { stored: before }), null);
  assert.equal(entryDateMessage(`${s(0)}T09:30:00.000Z`, { timestamp: true }), null);
  for (const bad of ['', 'hier', `${TODAY.slice(0, 4)}-02-30`, `${TODAY.slice(0, 4)}-13-01`, null]) assert.equal(entryDateMessage(bad), 'Date invalide.');
  assert.equal(rangesWindowMessage([{ startDate: S, endDate: H }]), null);
  assert.equal(rangesWindowMessage([{ startDate: before, endDate: s(5) }]), PAST_HORIZON_MESSAGE);
  assert.equal(rangesWindowMessage([{ startDate: before, endDate: s(5) }], { stored: [{ startDate: before, endDate: s(5) }] }), null);
  assert.equal(stayDatesRefusal(S, s(3)), null);
  assert.deepEqual(stayDatesRefusal(before, s(3)), { status: 400, ...TOO_OLD, field: 'startDate' });
  assert.deepEqual(stayDatesRefusal(s(-5), before), { status: 400, ...TOO_OLD, field: 'startDate' });
  assert.equal(stayDatesRefusal(before, s(3), { stored: { startDate: before, endDate: s(3) } }), null);
});

test('rule 13: calculate-price quotes from today − 5 years and refuses one day earlier', async () => {
  const ok = await call(f.controller.calculatePrice, { body: f.stayBody({ startDate: S, endDate: s(3) }) });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assertTooOld(await call(f.controller.calculatePrice, { body: f.stayBody({ startDate: before, endDate: s(3) }) }), 'startDate');
});

// A new stay in the past is refused anyway (« Impossible de réserver dans le passé. »): the window answers first.
test('rule 13: POST /reservations refuses an arrival before the window with the window message, writes nothing', () => {
  const n = count("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'reservation'");
  assertTooOld(f.create(f.stayBody({ startDate: before, endDate: s(2) })), 'startDate');
  assert.equal(count("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'reservation'"), n);
  assert.equal(f.create(f.stayBody({ startDate: S, endDate: s(2) })).body.error, 'Impossible de réserver dans le passé.');
});

// A stay of the past, moved there in the database: its fiche is edited with « Modifier le passé ».
function pastStay(startDate, endDate, offset) {
  const id = f.createStay({ startDate: f.inDays(offset), endDate: f.inDays(offset + 3) });
  f.db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(startDate, endDate, id);
  return id;
}

test('rule 13: PUT /reservations/:id refuses an arrival moved before the window and keeps a stored one', async () => {
  const id = pastStay(s(20), s(23), 600);
  assertTooOld(await f.save(id, { startDate: before }, { unlockPast: true }), 'startDate');
  assert.equal(f.rowOf(id).startDate, s(20));
  const moved = await f.save(id, { startDate: S }, { unlockPast: true });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  f.db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(addDaysToIsoDate(S, -30), addDaysToIsoDate(S, -27), id);
  const kept = await f.save(id, { notes: 'Arrivée tardive' }, { unlockPast: true });
  assert.equal(kept.statusCode, 200, JSON.stringify(kept.body));
  assert.equal(f.rowOf(id).startDate, addDaysToIsoDate(S, -30));
});

test('rule 13: an iCal date drift before the window is refused and stays pending; on today − 5 years it is approved', () => {
  const id = pastStay(s(40), s(43), 620);
  const drift = (newStartDate, newEndDate) => icalDateDriftModel.recordPending({
    reservationId: id, previousStartDate: f.rowOf(id).startDate, previousEndDate: f.rowOf(id).endDate, newStartDate, newEndDate,
  }).id;
  const refusedId = drift(before, s(3));
  assertTooOld(call(dashboardController.approveIcalDateDrift, { params: { id: String(refusedId) } }), 'startDate');
  assert.equal(f.rowOf(id).startDate, s(40));
  assert.equal(f.db.prepare('SELECT acknowledgedAt FROM ical_date_drift_alerts WHERE id = ?').get(refusedId).acknowledgedAt, null);
  call(dashboardController.rejectIcalDateDrift, { params: { id: String(refusedId) } });
  const ok = call(dashboardController.approveIcalDateDrift, { params: { id: String(drift(S, s(3))) } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(f.rowOf(id).startDate, S);
});

test('rule 13: POST and PUT /devis refuse an arrival before the window and a validUntil outside it', () => {
  f.seed();
  assertTooOld(call(devisController.create, { body: f.stayBody({ startDate: before, endDate: s(2) }) }), 'startDate');
  const n = count("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'");
  for (const validUntil of [before, after]) {
    const refused = call(devisController.create, { body: f.stayBody({ startDate: f.inDays(300), endDate: f.inDays(303), validUntil }) });
    assert.equal(refused.statusCode, 400, JSON.stringify(refused.body));
    assert.equal(refused.body.field, 'validUntil');
  }
  assert.equal(count("SELECT COUNT(*) AS n FROM reservations WHERE kind = 'devis'"), n);
  const created = call(devisController.create, { body: f.stayBody({ startDate: S, endDate: s(2) }) });
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  const id = created.body.id;
  assertTooOld(call(devisController.update, { params: { id: String(id) }, body: f.stayBody({ startDate: before, endDate: s(2) }) }), 'startDate');
  assert.equal(f.rowOf(id).startDate, S);
  const refusedValidity = call(devisController.update, { params: { id: String(id) }, body: f.stayBody({ startDate: S, endDate: s(2), validUntil: after }) });
  assert.equal(refusedValidity.statusCode, 400, JSON.stringify(refusedValidity.body));
  assert.equal(refusedValidity.body.error, HORIZON_MESSAGE);
});

test('establishment-closures.md rule 18 (past reading of 2026-11-02): a closure may start on today − 5 years, not the day before', () => {
  assert.equal(validateRange(S, s(10)), null);
  assert.equal(validateRange(before, s(10)), PAST_HORIZON_MESSAGE);
  assert.equal(validateRange(before, s(10), { stored: { startDate: before, endDate: s(10) } }), null);
  const { controller } = closures.seedClosures();
  const refused = closures.call(controller.create, { body: { propertyId: 2, startDate: before, endDate: s(5) } });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(refused.body, { error: PAST_HORIZON_MESSAGE, code: 'INVALID_RANGE' });
  assert.equal(closures.call(controller.conflicts, { query: { propertyId: 2, startDate: before, endDate: s(5) } }).statusCode, 400);
  const ok = closures.call(controller.create, { body: { propertyId: 2, startDate: S, endDate: s(5) } });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const moved = closures.call(controller.update, { params: { id: ok.body.id }, body: { propertyId: 2, startDate: before, endDate: s(5) } });
  assert.equal(moved.body.error, PAST_HORIZON_MESSAGE);
});

test('finance-dashboard-redesign.md rule 51 (past reading of 2026-11-02): a custom window may start on today − 5 years, not the day before', () => {
  const exercise = { key: finance.THIS_YEAR, label: `${finance.THIS_YEAR}`, from: `${finance.THIS_YEAR}-01-01`, to: `${finance.THIS_YEAR}-12-31` };
  assert.equal(resolveWindow({ exercise, kind: 'custom', from: S, to: s(30), today: TODAY }).ok, true);
  assert.deepEqual(resolveWindow({ exercise, kind: 'custom', from: before, to: s(30), today: TODAY }), { ok: false, error: PAST_HORIZON_MESSAGE });
  const { dashboard } = finance.freshDb();
  assert.deepEqual(dashboard.getDashboard({ fiscalYear: finance.THIS_YEAR, period: 'custom', from: before, to: s(30) }), { ok: false, status: 400, error: PAST_HORIZON_MESSAGE });
  assert.equal(dashboard.getDashboard({ fiscalYear: finance.THIS_YEAR, period: 'custom', from: S, to: s(30) }).ok, true);
});

test('rule 13: a payment mark, an arrival payment and an installment payment date — today − 5 years accepted, the day before refused', () => {
  assert.deepEqual(validateCollectionDate(S, { today: TODAY }), { ok: true, date: S });
  assert.deepEqual(validateCollectionDate(before, { today: TODAY }), { ok: false, reason: PAST_HORIZON_MESSAGE });
  assert.equal(validateArrivalPaymentDate(before, { today: TODAY }).reason, PAST_HORIZON_MESSAGE);
  const id = f.createStay();
  const mark = (depositPaidDate) => call(f.controller.updatePayment, { params: { id: String(id) }, body: { depositPaid: true, depositPaidDate } });
  const refused = mark(before);
  assert.equal(refused.statusCode, 400, JSON.stringify(refused.body));
  assert.deepEqual(refused.body, { error: PAST_HORIZON_MESSAGE, code: 'INVALID_PAYMENT_DATE', field: 'depositPaidDate' });
  assert.equal(Number(f.rowOf(id).depositPaid), 0);
  const ok = mark(S);
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.equal(String(f.rowOf(id).depositPaidDate).slice(0, 10), S);
});

test('specs/mid-stay-notes.md + rule 13: re-dating a settled note before the window is refused, its stored date kept', () => {
  const id = f.createStay({ startDate: f.inDays(640), endDate: f.inDays(643) });
  const notes = [{ id: 1, paidDate: before, total: 10, items: [] }];
  f.db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?').run(JSON.stringify(notes), id);
  const redate = (paidDate) => call(f.controller.updatePayment, { params: { id: String(id) }, body: { adjustMidStayNote: { id: 1, paidDate } } });
  const refused = redate(addDaysToIsoDate(before, -1));
  assert.equal(refused.statusCode, 400, JSON.stringify(refused.body));
  assert.deepEqual(refused.body, { error: PAST_HORIZON_MESSAGE, code: 'INVALID_PAYMENT_DATE', field: 'paidDate' });
  assert.equal(JSON.parse(f.rowOf(id).midStaySettledNotes)[0].paidDate, before);
  const future = redate(addDaysToIsoDate(TODAY, 1));
  assert.equal(future.statusCode, 400, JSON.stringify(future.body));
  assert.notEqual(redate(before).statusCode, 400);
});

test('specs/direct-installments.md rule 11 + rule 13: an installment due date is a real day, not past the horizon', () => {
  const plan = [{ id: 1, number: 1, dueDate: TODAY }, { id: 2, number: 2, dueDate: addDaysToIsoDate(H, -10) }];
  const validate = (dueDate) => installmentPlan.validateDate({ installments: plan, index: 1, dueDate, today: TODAY, startDate: addDaysToIsoDate(H, 30) });
  assert.equal(validate(H), null);
  assert.equal(validate(after), 'Échéance 2 : date trop lointaine : 5 ans au plus.');
  assert.equal(validate(`${Number(TODAY.slice(0, 4)) + 1}-02-30`), 'Échéance 2 : date invalide.');
});

test('rule 13: a refund date — today − 5 years accepted, the day before refused, an impossible day refused', () => {
  const judge = (refundDate) => validateRefundPayload({ refundDate, method: 'transfer', lines: [] }, { refundableLines: [], today: TODAY });
  assert.notEqual(judge(S).code, 'REFUND_INVALID_DATE');
  assert.deepEqual([judge(before).code, judge(before).error], ['REFUND_INVALID_DATE', PAST_HORIZON_MESSAGE]);
  assert.equal(judge(`${TODAY.slice(0, 4)}-02-30`).code, 'REFUND_INVALID_DATE');
});

test('cancellation-compensation + rule 13: draft, approval and receipt dates in the window; a stored date kept', () => {
  const draft = (over) => validateDraft({ platform: 'Booking', expectedAmount: 10, ...over }, { today: TODAY });
  assert.equal(draft({ startDate: S, endDate: s(2), expectedDate: H }).ok, true);
  assert.deepEqual(draft({ startDate: before, endDate: s(2) }), { ok: false, error: PAST_HORIZON_MESSAGE, field: 'startDate' });
  assert.deepEqual(draft({ expectedDate: after }), { ok: false, error: HORIZON_MESSAGE, field: 'expectedDate' });
  assert.equal(validateDraft({ platform: 'Booking', startDate: before }, { stored: { startDate: before }, today: TODAY }).ok, true);
  assert.deepEqual(validateApprovalCompensation({ expectedAmount: 5, expectedDate: after }), { ok: false, error: HORIZON_MESSAGE, field: 'expectedDate' });
  assert.equal(validateApprovalCompensation({ expectedAmount: 5, expectedDate: H }).ok, true);
  assert.equal(validateReceipt({ receivedAmount: 5, receivedDate: S }, TODAY).ok, true);
  assert.equal(validateReceipt({ receivedAmount: 5, receivedDate: before }, TODAY).error, 'RECEIVED_DATE_TOO_OLD');

  const rows = new Map();
  const model = {
    create: (v) => { const row = { id: rows.size + 1, status: 'pending', ...v }; rows.set(row.id, row); return row; },
    getById: (id) => rows.get(Number(id)) || null,
    update: (id, v) => { rows.set(Number(id), { ...rows.get(Number(id)), ...v }); return { data: rows.get(Number(id)) }; },
  };
  const controller = createCompensationsController(model, { today: () => TODAY });
  const refused = call(controller.create, { body: { platform: 'Booking', startDate: before } });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(refused.body, { error: PAST_HORIZON_MESSAGE, field: 'startDate' });
  assert.equal(rows.size, 0);
  rows.set(1, { id: 1, status: 'pending', platform: 'Booking', startDate: before });
  assert.equal(call(controller.update, { params: { id: '1' }, body: { platform: 'Booking', startDate: before, notes: 'relu' } }).statusCode, 200);
  assert.equal(call(controller.update, { params: { id: '1' }, body: { platform: 'Booking', startDate: addDaysToIsoDate(before, -1) } }).statusCode, 400);
});

test('rule 13: a calendar note is written on a real day in the window; a stored note keeps being edited or cleared', () => {
  f.seed();
  const put = (date, note) => call(calendarNotesController.upsert, { params: { propertyId: '1', date }, body: { note } });
  for (const date of [before, after, 'abc', `${TODAY.slice(0, 4)}-02-30`]) {
    const res = put(date, 'Peinture');
    assert.equal(res.statusCode, 400, date);
  }
  assert.equal(put(before, 'Peinture').body.error, PAST_HORIZON_MESSAGE);
  assert.equal(count('SELECT COUNT(*) AS n FROM calendar_notes WHERE propertyId = 1'), 0);
  assert.equal(put(S, 'Peinture').statusCode, 200);
  assert.equal(put(H, 'Peinture').statusCode, 200);
  f.db.prepare("INSERT INTO calendar_notes (propertyId, date, note) VALUES (1, ?, 'Ancienne')").run(before);
  assert.equal(put(before, 'Ancienne relue').statusCode, 200);
  assert.equal(put(before, '').statusCode, 200);
  assert.equal(count('SELECT COUNT(*) AS n FROM calendar_notes WHERE propertyId = 1 AND date = ?', before), 0);
});

test('rule 13: the email simulations take a window inside the date window only', () => {
  const sequence = buildSequenceController({ database: f.db, ledger: null, settingsModel: null, templatesModel: null });
  const refused = call(sequence.simulation, { query: { from: before, to: s(10) } });
  assert.equal(refused.statusCode, 400);
  assert.deepEqual(refused.body, { error: 'INVALID_RANGE', message: PAST_HORIZON_MESSAGE });
  assert.equal(call(sequence.simulation, { query: { from: addDaysToIsoDate(H, -10), to: after } }).body.message, HORIZON_MESSAGE);
  assert.equal(call(sequence.simulation, { query: { from: `${TODAY.slice(0, 4)}-02-30`, to: s(10) } }).body.error, 'INVALID_RANGE');

  const listed = [];
  const emails = buildEmailsController({ database: f.db, templatesModel: { list: () => [] }, logModel: { listPending: (q) => { listed.push(q.today); return []; } } });
  assert.deepEqual(call(emails.pending, { query: { today: before } }).body, { error: PAST_HORIZON_MESSAGE, field: 'today' });
  assert.equal(call(emails.pending, { query: { today: after } }).statusCode, 400);
  assert.deepEqual(listed, []);
  assert.equal(call(emails.pending, { query: { today: S } }).statusCode, 200);
  assert.deepEqual(listed, [S]);
});

test('rule 13: a manual tariff journal entry is dated in the window', () => {
  const journal = createTariffChangeJournalModel(f.db);
  assert.deepEqual(journal.insert({ propertyId: 1, kind: 'platforms', occurredAt: before }), { error: PAST_HORIZON_MESSAGE });
  assert.deepEqual(journal.insert({ propertyId: 1, kind: 'platforms', occurredAt: `${after} 10:00` }), { error: HORIZON_MESSAGE });
  assert.equal(journal.insert({ propertyId: 1, kind: 'platforms', occurredAt: S }).error, undefined);
  assert.equal(journal.insert({ propertyId: 1, kind: 'platforms', occurredAt: H }).error, undefined);
});

test('rule 13: a season date range is entered in the window; a range kept as stored saves', () => {
  f.seed();
  const add = (startDate, endDate) => propertiesModel.addPricingRule(1, { label: 'Fenêtre', pricePerNight: 90, dateRanges: [{ startDate, endDate }] });
  assert.deepEqual(add(before, s(10)), { error: PAST_HORIZON_MESSAGE, status: 400 });
  assert.deepEqual(add(addDaysToIsoDate(H, -10), after), { error: HORIZON_MESSAGE, status: 400 });
  assert.equal(add('abc', s(10)).error, 'Dates invalides.');
  const created = add(S, s(10));
  assert.equal(created.error, undefined, JSON.stringify(created));
  const ruleId = Number(created.data.id);
  f.db.prepare('UPDATE pricing_rules SET dateRanges = ?, startDate = ?, endDate = ? WHERE id = ?')
    .run(JSON.stringify([{ startDate: before, endDate: s(10) }]), before, s(10), ruleId);
  const kept = propertiesModel.updatePricingRule(1, ruleId, { label: 'Fenêtre', pricePerNight: 95, dateRanges: [{ startDate: before, endDate: s(10) }] });
  assert.equal(kept.error, undefined, JSON.stringify(kept));
  const moved = propertiesModel.updatePricingRule(1, ruleId, { label: 'Fenêtre', pricePerNight: 95, dateRanges: [{ startDate: addDaysToIsoDate(before, -1), endDate: s(10) }] });
  assert.equal(moved.error, PAST_HORIZON_MESSAGE);
  assert.deepEqual(propertiesModel.assignDateRangeToSeason(1, { startDate: before, endDate: s(3), minNights: 1, target: { mode: 'new' } }), { error: PAST_HORIZON_MESSAGE, status: 400 });
  f.db.prepare('DELETE FROM pricing_rules WHERE id = ?').run(ruleId);
});
