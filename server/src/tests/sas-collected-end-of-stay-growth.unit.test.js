// specs/recall-unpaid-arrival-complement-at-checkout.md rule 11 (audit R26 H1) — an end-of-stay complement collected outside the
// departure SAS (fiche tick, single payment, D9 growth paid before arrival) is closed: the departure SAS refuses, preview and
// commit, a run that would raise it, 409 END_OF_STAY_ALREADY_COLLECTED, nothing written. A lowering, an unchanged total and an
// end of stay the SAS settled itself pass. specs/sas-breakfast-and-catering-upsell.md rule 17 — the same refusal for a sale at
// the arrival SAS on a collected arrival complement, which would land on that closed end of stay and be billed nowhere.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  db, respond, ADMIN, TODAY, inDays, rowOf, NO_ACOMPTE, S, C, forced, fiche, put, pay, storedEndOfStayPaid, register,
} = require('./moneyLedgerFixture');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');

const sasController = optionalPlugin(() => require('../plugins/sas/controller'));
const SAS = { skip: skipWithout(['sas']) };
const CODE = 'END_OF_STAY_ALREADY_COLLECTED';
const PAID_ON = inDays(-1);

const SHEET = db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Drap R26', 3, 'bed')").run().lastInsertRowid;
const MEAL = (() => {
  const id = db.prepare(`INSERT INTO options (title, price, priceType, category, displayToClient, autoEnabled, showsPlanningCard)
    VALUES ('Planche R26', 17, 'per_stay', 'Restauration', 1, 0, 0)`).run().lastInsertRowid;
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (?, ?)').run(NO_ACOMPTE, id);
  return Number(id);
})();

function call(side, id, body) {
  const res = respond();
  sasController[side]({ params: { id: String(id) }, body, user: ADMIN }, res);
  return res;
}
const departurePreview = (id, body) => call('previewDeparture', id, body);
const departure = (id, body) => call('commitDeparture', id, body);
const arrivalPreview = (id, body) => call('previewArrival', id, body);
const arrival = (id, body) => call('commitArrival', id, body);

const started = (stay) => {
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(inDays(-2), TODAY, stay.id);
  return stay;
};

// Solde and arrival complement paid, one adult more (D9: 42,40 € on the end of stay), the end of stay collected outside the
// departure SAS — since D20 (reservation-payment-ledger rule 68) a row stored before the check-out rule, never rewritten.
async function endOfStayPaidElsewhere({ cash = false } = {}) {
  const stay = fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] });
  pay(stay.id, S, C);
  await put(stay, { adults: 3 });
  storedEndOfStayPaid(stay.id, { date: PAID_ON, cash });
  const row = rowOf(stay.id);
  assert.equal(row.endOfStayComplementAmount, 42.4);
  assert.equal(row.endOfStayComplementPaidAtDeparture, 0);
  return started(stay);
}

const ADD_SHEET = { missingItems: [{ itemId: SHEET, qty: 1 }] };

for (const settled of [true, false, undefined]) {
  test(`departure SAS adding a sheet on an end of stay paid on the fiche (complementsSettled ${settled}): refused, nothing written`, SAS, async () => {
    const stay = await endOfStayPaidElsewhere();
    const before = rowOf(stay.id);
    const collected = register(stay.id).collectedTtc;
    const preview = departurePreview(stay.id, ADD_SHEET);
    assert.equal(preview.statusCode, 409, JSON.stringify(preview.body));
    assert.equal(preview.body.code, CODE);
    assert.equal(preview.body.error, 'Complément de fin de séjour déjà encaissé : le décocher sur la fiche avant d’ajouter des frais.');
    const res = departure(stay.id, { ...ADD_SHEET, ...(settled === undefined ? {} : { complementsSettled: settled }) });
    assert.equal(res.statusCode, 409, JSON.stringify(res.body));
    assert.equal(res.body.code, CODE);
    assert.deepEqual(rowOf(stay.id), before);
    assert.equal(register(stay.id).collectedTtc, collected);
  });
}

test('the same in the caisse interne: refused', SAS, async () => {
  const stay = await endOfStayPaidElsewhere({ cash: true });
  assert.equal(departurePreview(stay.id, ADD_SHEET).body.code, CODE);
  assert.equal(departure(stay.id, { ...ADD_SHEET, complementsSettled: true }).body.code, CODE);
});

test('an unchanged departure on an end of stay paid on the fiche passes, the stamp kept', SAS, async () => {
  const stay = await endOfStayPaidElsewhere();
  const preview = departurePreview(stay.id, {});
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.endOfStayTotal ?? preview.body.grandTotal, 42.4);
  const res = departure(stay.id, { complementsSettled: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const row = rowOf(stay.id);
  assert.equal(row.endOfStayComplementAmount, 42.4);
  assert.equal(row.endOfStayComplementPaidDate, PAID_ON);
  assert.equal(row.endOfStayComplementPaidAtDeparture, 0);
});

test('a lowering passes: a stored line offered', SAS, async () => {
  const stay = await endOfStayPaidElsewhere();
  const preview = departurePreview(stay.id, {});
  const stored = preview.body.lines.filter((l) => l.offerable && l.key && l.key.startsWith('stored:'));
  assert.ok(stored.length > 0, JSON.stringify(preview.body.lines));
  const body = { storedLines: stored.map((l) => ({ key: l.key, offered: true })) };
  assert.equal(departurePreview(stay.id, body).statusCode, 200);
  const res = departure(stay.id, { ...body, complementsSettled: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.ok(rowOf(stay.id).endOfStayComplementAmount < 42.4);
});

test('an end of stay the departure SAS settled itself still grows on a re-run', SAS, async () => {
  const stay = started(fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] }));
  pay(stay.id, S);
  assert.equal(arrival(stay.id, {}).statusCode, 200);
  assert.equal(departure(stay.id, { ...ADD_SHEET, complementsSettled: true }).statusCode, 200);
  assert.equal(rowOf(stay.id).endOfStayComplementPaidAtDeparture, 1);
  const twoSheets = { missingItems: [{ itemId: SHEET, qty: 2 }] };
  assert.equal(departurePreview(stay.id, twoSheets).statusCode, 200);
  const res = departure(stay.id, { ...twoSheets, complementsSettled: true });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 6);
});

test('an end of stay not paid: the departure SAS adds its charges, as before', SAS, async () => {
  const stay = started(fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] }));
  pay(stay.id, S);
  assert.equal(arrival(stay.id, {}).statusCode, 200);
  const res = departure(stay.id, { ...ADD_SHEET, complementsSettled: false });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 3);
});

// The arrival branch the auditor left UNVERIFIED: complement collected before check-in, end of stay collected too.
const SALE = { soldOptions: [{ optionId: MEAL, units: 1 }] };

test('arrival SAS selling a prestation while both complements are collected: refused, nothing written', SAS, async () => {
  const stay = await endOfStayPaidElsewhere();
  db.prepare('UPDATE reservations SET arrivalSasDoneAt = NULL, checkInDone = 0 WHERE id = ?').run(stay.id);
  const before = rowOf(stay.id);
  const preview = arrivalPreview(stay.id, SALE);
  assert.equal(preview.statusCode, 409, JSON.stringify(preview.body));
  assert.equal(preview.body.code, CODE);
  assert.equal(preview.body.error, 'Complément de fin de séjour déjà encaissé : le décocher sur la fiche avant de vendre une prestation.');
  const res = arrival(stay.id, SALE);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.code, CODE);
  assert.deepEqual(rowOf(stay.id), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(stay.id, MEAL).n, 0);
});

test('arrival SAS with no sale on the same stay passes', SAS, async () => {
  const stay = await endOfStayPaidElsewhere();
  assert.equal(arrivalPreview(stay.id, {}).statusCode, 200);
  assert.equal(arrival(stay.id, { soldOptions: [] }).statusCode, 200);
});

test('arrival SAS sale on a collected complement with the end of stay open: billed on the end of stay, as before', SAS, async () => {
  const stay = started(fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] }));
  pay(stay.id, S, C);
  const res = arrival(stay.id, SALE);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 17);
});

// specs/sas-breakfast-and-catering-upsell.md rule 17, reading of 2026-11-06 (audit R26 LOW 2), completed 2026-11-12
// (specs/arrival-departure-sas.md rule 36): a re-opened arrival SAS that would DROP or LOWER a sale whose money sits in the collected
// end-of-stay complement is refused too (the collected money would stay with nothing behind it); the sale put back is therefore
// unreachable.
const REFUSAL = 'Complément de fin de séjour déjà encaissé : le décocher sur la fiche avant de retirer une prestation.';
async function collectedSale() {
  const stay = started(fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] }));
  pay(stay.id, S, C);
  assert.equal(arrival(stay.id, SALE).statusCode, 200);
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 17);
  storedEndOfStayPaid(stay.id);
  return stay;
}

test('R26 LOW 2 (specs/arrival-departure-sas.md rule 36): a sale dropped on a re-opened arrival SAS while the end of stay is collected is refused, nothing written', SAS, async () => {
  const stay = await collectedSale();
  const before = rowOf(stay.id);
  const preview = arrivalPreview(stay.id, { soldOptions: [] });
  assert.equal(preview.statusCode, 409, JSON.stringify(preview.body));
  assert.equal(preview.body.code, CODE);
  assert.equal(preview.body.error, REFUSAL);
  const res = arrival(stay.id, { soldOptions: [] });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, REFUSAL);
  assert.deepEqual(rowOf(stay.id), before, 'nothing written, finalPrice included');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reservation_options WHERE reservationId = ? AND optionId = ?').get(stay.id, MEAL).n, 1);
});

test('R26 LOW 2 (specs/arrival-departure-sas.md rule 36): a sale LOWERED on a re-opened arrival SAS while the end of stay is collected is refused, nothing written', SAS, async () => {
  const stay = started(fiche(NO_ACOMPTE, 'direct', { customOptions: [forced(20)] }));
  pay(stay.id, S, C);
  const TWO = { soldOptions: [{ optionId: MEAL, units: 2 }] };
  assert.equal(arrival(stay.id, TWO).statusCode, 200);
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 34);
  storedEndOfStayPaid(stay.id);
  const before = rowOf(stay.id);
  const res = arrival(stay.id, SALE);
  assert.equal(res.statusCode, 409, JSON.stringify(res.body));
  assert.equal(res.body.error, REFUSAL);
  assert.deepEqual(rowOf(stay.id), before);
});

test('specs/arrival-departure-sas.md rule 36: the same sale sent again on that collected end of stay is not a removal: it passes', SAS, async () => {
  const stay = await collectedSale();
  assert.equal(arrival(stay.id, SALE).statusCode, 200);
  assert.equal(rowOf(stay.id).endOfStayComplementAmount, 17);
});
