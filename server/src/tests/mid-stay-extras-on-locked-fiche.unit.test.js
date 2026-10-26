// specs/mid-stay-extras-on-locked-fiche.md — extras sold on a locked fiche (stay in progress).
//
// Two layers: the pure rules (`midStayExtrasWindow.js`) and the real controller + pricing engine on the
// boot schema (DB_PATH=:memory:), because the money assertions (rule 11: the arrival complement never
// moves, the mid-stay part lands in the end-of-stay complement) only mean something end to end.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  midStayExtrasWindow, isMidStayExtrasWindowOpen, arrivalLineFloors, arrivalExtrasViolations, buildEditLock,
} = require('../utils/midStayExtrasWindow');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { getTodayIsoDate } = require('../utils/reservationHelpers');

const TODAY = '2026-07-11';
const baseRow = (over = {}) => ({
  kind: 'reservation', startDate: '2026-07-10', endOfStayComplementPaid: 0, endOfStayComplementPaidCash: 0, ...over,
});

// ── Pure rules ───────────────────────────────────────────────────────────────

// specs/mid-stay-extras-on-locked-fiche.md rules 1, 4
test('window — open during the stay and after departure while the end-of-stay complement is uncollected', () => {
  assert.equal(isMidStayExtrasWindowOpen(baseRow(), TODAY), true);
  assert.equal(isMidStayExtrasWindowOpen(baseRow({ startDate: TODAY }), TODAY), true);
  // Long after departure: the window is not bounded by endDate, only by the collection.
  assert.equal(isMidStayExtrasWindowOpen(baseRow({ startDate: '2026-05-01', endDate: '2026-05-04' }), TODAY), true);
});

// specs/mid-stay-extras-on-locked-fiche.md rules 1, 4
test('window — closed once the end-of-stay complement is collected, by card or in cash', () => {
  for (const flag of ['endOfStayComplementPaid', 'endOfStayComplementPaidCash']) {
    assert.deepEqual(midStayExtrasWindow(baseRow({ [flag]: 1 }), TODAY), {
      locked: true, extrasEditable: false, extrasClosedReason: 'endOfStayCollected',
    });
  }
});

// specs/mid-stay-extras-on-locked-fiche.md rule 1
test('window — a future fiche is not locked, a cancelled or devis row never opens it', () => {
  assert.deepEqual(midStayExtrasWindow(baseRow({ startDate: '2026-07-12' }), TODAY), {
    locked: false, extrasEditable: false, extrasClosedReason: null,
  });
  assert.equal(isMidStayExtrasWindowOpen(baseRow({ kind: 'cancelled' }), TODAY), false);
  assert.equal(isMidStayExtrasWindowOpen(baseRow({ kind: 'devis' }), TODAY), false);
});

const BASELINE = { 'opt:12': 30, 'res:3': 20, 'custom:bouteille de vin': 15 };
const BEFORE = [
  { optionId: 12, quantity: 2, totalPrice: 30, offered: 0 },
  { resourceId: 3, quantity: 1, totalPrice: 20, offered: 0 },
  { isCustom: true, title: 'Bouteille de vin', quantity: 1, totalPrice: 15, offered: 0 },
];

test('floors — minQuantity is the arrival amount over the amount per unit, rounded up', () => {
  assert.deepEqual(arrivalLineFloors(BASELINE, BEFORE), {
    'opt:12': { minQuantity: 2, frozen: true, reason: 'arrival' },
    'res:3': { minQuantity: 1, frozen: true, reason: 'arrival' },
    'custom:bouteille de vin': { minQuantity: 1, frozen: true, reason: 'arrival' },
  });
  // 3 units now, 2 were sold at arrival (30 of the 45 now billed) → the third is mid-stay.
  const grown = [{ optionId: 12, quantity: 3, totalPrice: 45, offered: 0 }];
  assert.deepEqual(arrivalLineFloors({ 'opt:12': 30 }, grown), { 'opt:12': { minQuantity: 2, frozen: true, reason: 'arrival' } });
  // Never below one unit while the key is present.
  assert.equal(arrivalLineFloors({ 'opt:12': 4 }, [{ optionId: 12, quantity: 2, totalPrice: 30, offered: 0 }])['opt:12'].minQuantity, 1);
});

test('floors — no baseline (guest not arrived) freezes nothing; an offered line present before is frozen', () => {
  assert.deepEqual(arrivalLineFloors(null, BEFORE), {});
  const offered = [{ optionId: 5, quantity: 2, totalPrice: 0, offered: 1 }];
  assert.deepEqual(arrivalLineFloors({}, offered), { 'opt:5': { minQuantity: 2, frozen: true, reason: 'offered' } });
});

test('violations — removing, reducing, offering or un-offering a frozen line is refused; a mid-stay line is free', () => {
  const keep = BEFORE;
  assert.deepEqual(arrivalExtrasViolations(BASELINE, BEFORE, keep), []);
  assert.deepEqual(arrivalExtrasViolations(BASELINE, BEFORE, keep.slice(1)), [{ key: 'opt:12', reason: 'removed' }]);
  assert.deepEqual(
    arrivalExtrasViolations(BASELINE, BEFORE, [{ ...BEFORE[0], quantity: 1, totalPrice: 15 }, ...keep.slice(1)]),
    [{ key: 'opt:12', reason: 'reduced' }],
  );
  assert.deepEqual(
    arrivalExtrasViolations(BASELINE, BEFORE, [{ ...BEFORE[0], offered: 1, totalPrice: 0 }, ...keep.slice(1)]),
    [{ key: 'opt:12', reason: 'offered' }],
  );
  assert.deepEqual(
    arrivalExtrasViolations(BASELINE, BEFORE, [BEFORE[0], BEFORE[1], { ...BEFORE[2], totalPrice: 5 }]),
    [{ key: 'custom:bouteille de vin', reason: 'reduced' }],
  );
  // Raising a frozen line and selling something new are both fine.
  assert.deepEqual(arrivalExtrasViolations(BASELINE, BEFORE, [
    { optionId: 12, quantity: 5, totalPrice: 75, offered: 0 }, BEFORE[1], BEFORE[2], { optionId: 99, quantity: 1, totalPrice: 8, offered: 0 },
  ]), []);
  // Removing a line sold during the stay (absent from the baseline) is how a typo is corrected.
  const withMidStay = [...BEFORE, { optionId: 99, quantity: 1, totalPrice: 8, offered: 0 }];
  assert.deepEqual(arrivalExtrasViolations(BASELINE, withMidStay, BEFORE), []);
});

test('editLock payload — floors per arrival line, nothing frozen once the window is closed', () => {
  const open = buildEditLock(baseRow(), TODAY, BASELINE, BEFORE);
  assert.equal(open.locked, true);
  assert.equal(open.extrasEditable, true);
  assert.equal(open.extrasClosedReason, null);
  assert.equal(open.arrivalLines['opt:12'].minQuantity, 2);
  const closed = buildEditLock(baseRow({ endOfStayComplementPaid: 1 }), TODAY, BASELINE, BEFORE);
  assert.deepEqual([closed.extrasEditable, closed.extrasClosedReason, closed.arrivalLines, closed.frozenCustomOptionIds], [false, 'endOfStayCollected', {}, []]);
});

// ── Controller + engine on the boot schema ───────────────────────────────────

const db = require('../database');
const model = require('../models/reservationsModel');
const controller = require('../controllers/reservationsController');

const ADMIN = { role: 'admin', roles: ['admin'] };
const isoPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

db.prepare(`INSERT INTO properties (id, name, maxGuests, touristTaxMode, touristTaxPerDayPerPerson, depositEnabled)
            VALUES (1, 'Gîte', 8, 'per_day_per_person', 0, 0)`).run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
db.prepare("INSERT INTO options (id, title, price, priceType) VALUES (101, 'Ménage', 40, 'per_stay'), (102, 'Bois', 10, 'per_stay'), (103, 'Linge de lit', 15, 'per_stay')").run();
db.prepare('UPDATE options SET countsAsBedLinen = 1 WHERE id = 103').run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 101), (1, 102), (1, 103)').run();
db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, propertyId) VALUES (201, 'Vélo', 3, 12, 'per_stay', 1)").run();
db.prepare("INSERT INTO resources (id, name, quantity, price, priceType, propertyId) VALUES (202, 'Bain', 1, 30, 'per_hour', 1)").run();
db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, 202, 30, 60)').run();
db.prepare("INSERT INTO options (id, title, price, priceType, showsPlanningCard) VALUES (104, 'Petit-déjeuner', 10, 'per_person', 1)").run();
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 104)').run();

// A stay that started yesterday and ends in 3 days, 4 nights at 100 €, already checked in. It carries a
// « Ménage » x1 (40 €) and a custom « Bouteille de vin » (15 €) sold at arrival.
function seedStay({ platform = 'direct', endOfStayPaid = 0, checkedIn = 1, balancePaid = 0 } = {}) {
  const id = Number(db.prepare(`INSERT INTO reservations
      (propertyId, clientId, startDate, endDate, adults, children, teens, babies, platform, totalPrice,
       discountPercent, finalPrice, depositAmount, balanceAmount, depositDisabled, touristTaxTotal, kind,
       checkInDone, checkInTime, checkOutTime, singleBeds, doubleBeds, babyBeds, endOfStayComplementPaid,
       cautionAmount, balanceDueDate, balancePaid)
      VALUES (1, 1, ?, ?, 2, 0, 0, 0, ?, 400, 0, 455, 0, 455, 1, 0, 'reservation', ?, '16:00', '10:00', 0, 0, 0, ?, 500, ?, ?)`)
    .run(isoPlus(-1), isoPlus(3), platform, checkedIn, endOfStayPaid, isoPlus(-1), balancePaid).lastInsertRowid);
  for (let i = -1; i < 3; i += 1) {
    db.prepare("INSERT INTO reservation_nights (reservationId, date, seasonLabel, pricingMode, price) VALUES (?, ?, 'Base', 'night', 100)")
      .run(id, isoPlus(i));
  }
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, inComplement)
              VALUES (?, 101, 1, 40, 1, 'per_stay', 40, 0, 0)`).run(id);
  db.prepare("INSERT INTO reservation_custom_options (reservationId, description, amount, offered, inComplement) VALUES (?, 'Bouteille de vin', 15, 0, 0)")
    .run(id);
  return id;
}

function put(id, edit, { user = ADMIN } = {}) {
  const body = toUpdateBody(model.getByIdWithDetails(id));
  edit(body);
  return controller.performUpdate(String(id), body, { unlockPast: user.roles.includes('admin') && body.unlockPast === true });
}

const optionIds = (id) => db.prepare('SELECT optionId FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(id).map((r) => r.optionId);
const customLabels = (id) => db.prepare('SELECT description FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id).map((r) => r.description);
const resourceRows = (id) => db.prepare('SELECT resourceId, quantity FROM reservation_resources WHERE reservationId = ?').all(id);
const money = (id) => db.prepare(`SELECT depositAmount, balanceAmount, complementAmount, endOfStayComplementAmount, startDate, endDate, adults
                                    FROM reservations WHERE id = ?`).get(id);
const endOfStayOf = (id) => Number(money(id).endOfStayComplementAmount);

test('a no-op save on a started stay still passes and captures the arrival baseline', () => {
  const id = seedStay();
  const result = put(id, () => {});
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(JSON.parse(model.getArrivalExtrasBaseline(id)), { 'opt:101': 40, 'custom:bouteille de vin': 15 });
});

test('GET editLock — locked, editable, and the floor of each arrival line (rule 13)', () => {
  const id = seedStay();
  put(id, () => {});
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.getById({ params: { id: String(id) }, user: ADMIN }, res);
  assert.deepEqual(res.body.editLock, {
    locked: true,
    extrasEditable: true,
    extrasClosedReason: null,
    arrivalLines: {
      'opt:101': { minQuantity: 1, frozen: true, reason: 'arrival' },
      'custom:bouteille de vin': { minQuantity: 1, frozen: true, reason: 'arrival' },
    },
    frozenCustomOptionIds: db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').all(id).map((r) => r.id),
  });
});

// specs/mid-stay-extras-on-locked-fiche.md rules 5, 9
test('adding a catalogue option during the stay is saved and goes to the end-of-stay complement only', () => {
  const id = seedStay();
  put(id, () => {});
  const before = money(id);
  const result = put(id, (b) => { b.options.push({ optionId: 102, quantity: 1 }); });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(optionIds(id), [101, 102]);
  const after = money(id);
  assert.equal(endOfStayOf(id), 10);
  // Rule 11 — nothing that was already announced moves because of a sale made inside the window.
  assert.deepEqual(
    [after.depositAmount, after.balanceAmount, after.complementAmount],
    [before.depositAmount, before.balanceAmount, before.complementAmount],
  );
  assert.deepEqual([after.startDate, after.endDate, after.adults], [before.startDate, before.endDate, before.adults]);
});

// specs/mid-stay-extras-on-locked-fiche.md rule 5
test('adding a custom line and a resource during the stay lands in the end-of-stay complement', () => {
  const id = seedStay();
  put(id, () => {});
  const result = put(id, (b) => {
    b.customOptions.push({ customKey: 'new', description: 'Bière', amount: 3, offered: false });
    b.resources.push({ resourceId: 201, quantity: 2, offered: false, sessions: [] });
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(customLabels(id), ['Bouteille de vin', 'Bière']);
  assert.deepEqual(resourceRows(id), [{ resourceId: 201, quantity: 2 }]);
  assert.equal(endOfStayOf(id), 27);
});

// specs/mid-stay-extras-on-locked-fiche.md rule 7
test('removing a line sold during the stay is saved and the end-of-stay complement goes back down', () => {
  const id = seedStay();
  put(id, () => {});
  put(id, (b) => { b.options.push({ optionId: 102, quantity: 1 }); });
  assert.equal(endOfStayOf(id), 10);
  const result = put(id, (b) => { b.options = b.options.filter((o) => o.optionId !== 102); });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(optionIds(id), [101]);
  assert.equal(endOfStayOf(id), 0);
});

// specs/mid-stay-extras-on-locked-fiche.md rules 6, 9
test('removing or reducing a line sold at arrival is refused with ARRIVAL_EXTRAS_FROZEN, and nothing is written', () => {
  const id = seedStay();
  put(id, () => {});
  const removed = put(id, (b) => { b.options = []; });
  assert.equal(removed.status, 400);
  assert.equal(removed.body.code, 'ARRIVAL_EXTRAS_FROZEN');
  assert.equal(removed.body.error, 'Une prestation vendue à l\'arrivée ne peut être ni retirée ni réduite.');
  const customRemoved = put(id, (b) => { b.customOptions = []; });
  assert.equal(customRemoved.body.code, 'ARRIVAL_EXTRAS_FROZEN');
  assert.deepEqual(optionIds(id), [101]);
  assert.deepEqual(customLabels(id), ['Bouteille de vin']);
});

// specs/mid-stay-extras-on-locked-fiche.md rule 6
test('increasing a line sold at arrival is saved, only the added units go to the end-of-stay complement', () => {
  const id = seedStay();
  put(id, () => {});
  const result = put(id, (b) => { b.options.find((o) => o.optionId === 101).quantity = 3; });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(db.prepare('SELECT quantity FROM reservation_options WHERE reservationId = ? AND optionId = 101').get(id).quantity, 3);
  assert.equal(endOfStayOf(id), 80);
  // …and the third save cannot go back under the arrival quantity (1), but can come down to it.
  assert.equal(put(id, (b) => { b.options.find((o) => o.optionId === 101).quantity = 1; }).status, 200);
  assert.equal(endOfStayOf(id), 0);
});

// specs/mid-stay-extras-on-locked-fiche.md rule 8
test('the payload cannot move the « Forcer en complément » routing of a line inside the window', () => {
  const id = seedStay();
  put(id, () => {});
  const result = put(id, (b) => {
    b.options.find((o) => o.optionId === 101).inComplement = 1;
    b.customOptions[0].inComplement = 1;
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(db.prepare('SELECT inComplement FROM reservation_options WHERE reservationId = ? AND optionId = 101').get(id).inComplement, 0);
  assert.equal(db.prepare('SELECT inComplement FROM reservation_custom_options WHERE reservationId = ?').get(id).inComplement, 0);
});

// specs/mid-stay-extras-on-locked-fiche.md rules 8, 9
test('changing dates or guests together with an option is refused as PAST_RESERVATION_LOCKED', () => {
  const id = seedStay();
  put(id, () => {});
  const dates = put(id, (b) => { b.endDate = isoPlus(5); b.options.push({ optionId: 102, quantity: 1 }); });
  assert.equal(dates.status, 400);
  assert.equal(dates.body.code, 'PAST_RESERVATION_LOCKED');
  const guests = put(id, (b) => { b.adults = 4; b.options.push({ optionId: 102, quantity: 1 }); });
  assert.equal(guests.body.code, 'PAST_RESERVATION_LOCKED');
  assert.deepEqual(optionIds(id), [101]);
});

// specs/mid-stay-extras-on-locked-fiche.md rules 4, 9
test('an extras change after the end-of-stay complement is collected is refused as MID_STAY_EXTRAS_CLOSED', () => {
  const id = seedStay({ endOfStayPaid: 1 });
  const result = put(id, (b) => { b.options.push({ optionId: 102, quantity: 1 }); });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'MID_STAY_EXTRAS_CLOSED');
  assert.equal(result.body.error, 'Complément de fin de séjour déjà encaissé : décocher « payé » ou déverrouiller la fiche.');
  assert.deepEqual(optionIds(id), [101]);
  // …while a save that leaves the extras alone is still accepted, as before.
  assert.equal(put(id, () => {}).status, 200);
});

test('a linen option added during the stay lets the bed counts move; sold at arrival, it freezes them', () => {
  const added = seedStay();
  put(added, () => {});
  const ok = put(added, (b) => { b.options.push({ optionId: 103, quantity: 1 }); b.singleBeds = 1; b.doubleBeds = 1; });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(db.prepare('SELECT singleBeds, doubleBeds FROM reservations WHERE id = ?').get(added), { singleBeds: 1, doubleBeds: 1 });

  const frozen = seedStay();
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
              VALUES (?, 103, 1, 15, 1, 'per_stay', 15, 0)`).run(frozen);
  db.prepare('UPDATE reservations SET singleBeds = 2, doubleBeds = 0 WHERE id = ?').run(frozen);
  put(frozen, () => {});
  const kept = put(frozen, (b) => { b.singleBeds = 0; b.doubleBeds = 3; });
  assert.equal(kept.status, 200, JSON.stringify(kept.body));
  assert.deepEqual(db.prepare('SELECT singleBeds, doubleBeds FROM reservations WHERE id = ?').get(frozen), { singleBeds: 2, doubleBeds: 0 });
});

// specs/mid-stay-extras-on-locked-fiche.md rule 2
test('the stay lock is the server clock: a fiche that has not started is not locked', () => {
  const id = seedStay();
  db.prepare('UPDATE reservations SET startDate = ? WHERE id = ?').run(isoPlus(2), id);
  assert.equal(model.getEditLock(id, { today: getTodayIsoDate() }).locked, false);
});

test('rule 12 — a sale inside the window is traced in reservation_history like any option edit', () => {
  const id = seedStay();
  put(id, () => {});
  put(id, (b) => { b.options.push({ optionId: 102, quantity: 1 }); });
  const entries = db.prepare("SELECT changedFields FROM reservation_history WHERE reservationId = ? ORDER BY id").all(id)
    .flatMap((row) => JSON.parse(row.changedFields));
  assert.ok(entries.some((change) => change.field === 'optionsSignature'), JSON.stringify(entries));
});

// ── Review fixes ─────────────────────────────────────────────────────────────

const snapshot = (id) => JSON.stringify({
  row: db.prepare('SELECT * FROM reservations WHERE id = ?').get(id),
  options: db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(id),
  resources: db.prepare('SELECT * FROM reservation_resources WHERE reservationId = ? ORDER BY resourceId').all(id),
  customs: db.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id),
  history: db.prepare('SELECT COUNT(*) AS n FROM reservation_history WHERE reservationId = ?').get(id).n,
});

// specs/mid-stay-extras-on-locked-fiche.md rule 10
test('S1 — a locked fiche never checked in still freezes what it carries (no baseline yet)', () => {
  const id = seedStay({ checkedIn: 0, balancePaid: 1 });
  assert.equal(model.getArrivalExtrasBaseline(id), null);
  const lock = model.getEditLock(id, { today: getTodayIsoDate() });
  assert.equal(lock.arrivalLines['opt:101'].minQuantity, 1);
  const result = put(id, (b) => { b.options = []; });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'ARRIVAL_EXTRAS_FROZEN');
  assert.equal(money(id).balanceAmount, 455);
  assert.deepEqual(optionIds(id), [101]);
});

test('S2 — fewer served persons on a per-person card option sold at arrival is refused', () => {
  const id = seedStay();
  db.prepare("UPDATE reservations SET adults = 2 WHERE id = ?").run(id);
  const occ = JSON.stringify([-1, 0, 1].map((d) => ({ date: isoPlus(d), time: '09:00' })));
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered, cardOccurrences, cardPersons)
              VALUES (?, 104, 3, 10, 6, 'per_person', 60, 0, ?, NULL)`).run(id, occ);
  put(id, () => {});
  assert.equal(JSON.parse(model.getArrivalExtrasBaseline(id))['opt:104'], 60);
  assert.equal(model.getEditLock(id, { today: getTodayIsoDate() }).arrivalLines['opt:104'].lockedOccurrences.length, 3);
  const result = put(id, (b) => { b.options.find((o) => o.optionId === 104).cardPersons = 1; });
  assert.equal(result.status, 400, JSON.stringify(result.body));
  assert.equal(result.body.code, 'ARRIVAL_EXTRAS_FROZEN');
  assert.equal(db.prepare('SELECT totalPrice FROM reservation_options WHERE reservationId = ? AND optionId = 104').get(id).totalPrice, 60);
  // Adding a morning is the normal use: it is accepted.
  const more = put(id, (b) => {
    const line = b.options.find((o) => o.optionId === 104);
    line.cardOccurrences = [...line.cardOccurrences, { date: isoPlus(2), time: '09:00' }];
    line.quantity = 4;
  });
  assert.equal(more.status, 200, JSON.stringify(more.body));
});

test('S2 — an hourly resource with a free first hour cannot lose hours sold at arrival', () => {
  const id = seedStay();
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
              VALUES (?, 202, 2, 30, 1, 'per_hour', 30, 0)`).run(id);
  put(id, () => {});
  const result = put(id, (b) => { b.resources.find((r) => r.resourceId === 202).quantity = 1; });
  assert.equal(result.status, 400, JSON.stringify(result.body));
  assert.equal(result.body.code, 'ARRIVAL_EXTRAS_FROZEN');
});

test('S3 — a refused resource leaves the row, the options and the resources untouched', () => {
  const id = seedStay();
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
              VALUES (?, 201, 1, 12, 1, 'per_stay', 12, 0)`).run(id);
  const other = seedStay();
  db.prepare(`INSERT INTO reservation_resources (reservationId, resourceId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered)
              VALUES (?, 201, 2, 12, 2, 'per_stay', 24, 0)`).run(other);
  put(id, () => {});
  const before = snapshot(id);
  const result = put(id, (b) => {
    b.options.push({ optionId: 102, quantity: 1 });
    b.resources.find((r) => r.resourceId === 201).quantity = 3;
  });
  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(snapshot(id), before);
});

test('S4 — a routing-only change on a collected fiche stays PAST_RESERVATION_LOCKED; a devis never reports a collection', () => {
  const id = seedStay({ endOfStayPaid: 1 });
  const result = put(id, (b) => { b.options.find((o) => o.optionId === 101).inComplement = 1; });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'PAST_RESERVATION_LOCKED');
});

test('S5 — an unextended arrival line floors at its stored quantity; an extended one at the arrival share', () => {
  const lines = [{ optionId: 12, quantity: 3, totalPrice: 31.5, offered: 0 }];
  assert.equal(arrivalLineFloors({ 'opt:12': 31.5 }, lines)['opt:12'].minQuantity, 3);
  // 3 units billed 45, 30 sold at arrival → 2 units' worth, whole units.
  assert.equal(arrivalLineFloors({ 'opt:12': 30 }, [{ optionId: 12, quantity: 3, totalPrice: 45, offered: 0 }])['opt:12'].minQuantity, 2);
  // Whole units only, rounded up: never a fractional floor on a non-hourly line.
  assert.equal(arrivalLineFloors({ 'opt:12': 20.01 }, [{ optionId: 12, quantity: 3, totalPrice: 30, offered: 0 }])['opt:12'].minQuantity, 3);
  // Hourly resources keep fractions.
  assert.equal(arrivalLineFloors({ 'res:3': 30 }, [{ resourceId: 3, quantity: 3, totalPrice: 45, offered: 0, hourly: true }])['res:3'].minQuantity, 2);
});

test('S6 — bed counts only move when a bed-linen option not sold at arrival comes with the payload', () => {
  const id = seedStay();
  put(id, () => {});
  const result = put(id, (b) => { b.singleBeds = 3; b.doubleBeds = 2; b.options.push({ optionId: 102, quantity: 1 }); });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.deepEqual(db.prepare('SELECT singleBeds, doubleBeds FROM reservations WHERE id = ?').get(id), { singleBeds: 0, doubleBeds: 0 });
  const history = db.prepare('SELECT changedFields FROM reservation_history WHERE reservationId = ?').all(id)
    .flatMap((row) => JSON.parse(row.changedFields)).map((change) => change.field);
  assert.ok(!history.includes('singleBeds') && !history.includes('doubleBeds'), history.join());
});

test('S7 — editLock tells why a line is frozen and which persisted custom lines are', () => {
  const id = seedStay();
  db.prepare("INSERT INTO reservation_options (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, offered) VALUES (?, 102, 1, 0, 1, 'per_stay', 0, 1)").run(id);
  put(id, () => {});
  const lock = model.getEditLock(id, { today: getTodayIsoDate() });
  assert.equal(lock.arrivalLines['opt:101'].reason, 'arrival');
  assert.equal(lock.arrivalLines['opt:102'].reason, 'offered');
  const wine = db.prepare("SELECT id FROM reservation_custom_options WHERE reservationId = ? AND description = 'Bouteille de vin'").get(id).id;
  assert.deepEqual(lock.frozenCustomOptionIds, [wine]);
});
