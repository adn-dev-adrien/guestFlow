// specs/reservation-save-keeps-pricing.md rule 19 (audit R21-M1) — a priced save rewrites the custom lines
// (DELETE + INSERT), and their stored contribs used to be lost: the sum of the contribs no longer matched the paid
// amount, the export fell back to the stored-money split, and revenue moved between 706 accounts on entries already
// booked. Catalogue options keep theirs through the engine's locked lines, so they are the control.
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { optionalPlugin, skipWithout } = require('../plugins/sdk/testing');
const {
  db, controller, createStay, inDays, seed, rowOf, mark,
} = require('./ledgerFixture');
const model = require('../models/reservationsModel');
const { toUpdateBody } = require('../utils/reservationUpdateBody');
const { matchStoredCustomLines } = require('../utils/storedCustomLines');
const { cancelReservation } = require('../utils/cancelReservation');
const { collectedByLine } = require('../utils/refunds');
const { todayIso } = require('../utils/localDate');

const { create: accountingModel } = optionalPlugin(() => require('../plugins/accounting-export/accountingModel'));
const { create: accountingController } = optionalPlugin(() => require('../plugins/accounting-export/controller'));

const accounting = { skip: skipWithout(['accounting-export']) };
const TODAY = todayIso();
const OPTION = 50;
const free = (description, amount, inComplement = 0) => ({ customKey: description, description, amount, offered: false, inComplement });

seed();
db.prepare("INSERT INTO options (id, title, priceType, price) VALUES (?, 'Panier', 'per_stay', 100)").run(OPTION);
db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, ?)').run(OPTION);

function csvOfToday() {
  let sent = '';
  const res = { setHeader() {}, status() { return res; }, send(b) { sent = Buffer.from(b).toString('latin1'); return res; } };
  accountingController(accountingModel(db)).salesCsv({ query: { year: Number(TODAY.slice(0, 4)), month: Number(TODAY.slice(5, 7)) } }, res);
  return sent;
}
const customs = (id) => db.prepare('SELECT description, amount, inComplement, acompteContribTtc AS a, soldeContribTtc AS s FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(id);
const customOf = (id, description) => customs(id).find((line) => line.description === description);
// What the fiche and every server caller post: never a contrib.
const bodyOf = (id, edit) => {
  const body = { ...toUpdateBody(model.getByIdWithDetails(id)), forceOverpayment: true };
  if (edit) edit(body);
  return body;
};
const save = (id, edit, opts = {}) => {
  const result = controller.performUpdate(String(id), bodyOf(id, edit), opts);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result;
};
const paySolde = (id) => assert.equal(mark(id, { balancePaid: true, balancePaidDate: TODAY }).statusCode, 200);
const payAcompte = (id) => assert.equal(mark(id, { depositPaid: true, depositPaidDate: TODAY }).statusCode, 200);
const addLine = (body) => body.customOptions.push(free('Ajout', 20, null));
// A fiche whose stay has started: sold ahead, then moved back so the stays of this suite never overlap.
let startedSlot = 0;
function startedStay(over) {
  const id = createStay(over);
  startedSlot += 1;
  const start = -10 * startedSlot;
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(inDays(start), inDays(start + 3), id);
  db.prepare('SELECT rowid AS row FROM reservation_nights WHERE reservationId = ? ORDER BY date').all(id)
    .forEach((night, index) => db.prepare('UPDATE reservation_nights SET date = ? WHERE rowid = ?').run(inDays(start + index), night.row));
  return id;
}

test('rule 19 — solde only: the paid line keeps its contrib and the journal stays byte-identical', accounting, () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);
  assert.equal(customOf(id, 'Ligne libre').s, 100);
  const before = csvOfToday();

  save(id, addLine);

  assert.equal(customOf(id, 'Ligne libre').s, 100);
  assert.deepEqual([customOf(id, 'Ajout').a, customOf(id, 'Ajout').s], [null, null], 'a line never paid has no contrib');
  assert.equal(rowOf(id).complementAmount, 20, 'the addition goes to the complement');
  assert.equal(csvOfToday(), before);
});

test('rule 19 — control: the same save on a catalogue option leaves the journal byte-identical', accounting, () => {
  const id = createStay({ depositDisabled: 1, options: [{ optionId: OPTION, quantity: 1 }] });
  paySolde(id);
  const contrib = db.prepare('SELECT soldeContribTtc AS s FROM reservation_options WHERE reservationId = ?').get(id).s;
  const before = csvOfToday();

  save(id, addLine);

  assert.equal(db.prepare('SELECT soldeContribTtc AS s FROM reservation_options WHERE reservationId = ?').get(id).s, contrib);
  assert.equal(csvOfToday(), before);
});

test('rule 19 — acompte then solde: neither entry moves, and the two contribs add up to the line', accounting, () => {
  const id = createStay({ customOptions: [free('Ligne libre', 100)] });
  payAcompte(id);
  const acompte = customOf(id, 'Ligne libre').a;
  assert.ok(acompte > 0);
  const before = csvOfToday();

  save(id, addLine);
  assert.equal(customOf(id, 'Ligne libre').a, acompte);
  assert.equal(csvOfToday(), before, 'the booked acompte entry');

  paySolde(id);
  const line = customOf(id, 'Ligne libre');
  assert.equal(line.a, acompte);
  assert.equal(Math.round((line.a + line.s) * 100), 10000);
  const afterSolde = csvOfToday();

  save(id, (body) => { body.customOptions.find((c) => c.description === 'Ajout').amount = 30; });
  assert.deepEqual(customOf(id, 'Ligne libre'), line);
  assert.equal(csvOfToday(), afterSolde, 'both entries');
});

test('rule 19 — a line renamed in a priced save keeps its contrib, matched by its id', accounting, () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);
  const before = csvOfToday();

  save(id, (body) => {
    body.customOptions.find((c) => c.description === 'Ligne libre').description = 'Ligne renommée';
    addLine(body);
  });

  assert.equal(customOf(id, 'Ligne renommée').s, 100);
  assert.equal(csvOfToday(), before);
});

test('rule 19 — without an id (or with a stale one) the line is matched by its text', () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);

  save(id, (body) => { delete body.customOptions[0].customOptionId; addLine(body); });
  assert.equal(customOf(id, 'Ligne libre').s, 100);

  save(id, (body) => { body.customOptions[0].customOptionId = 999999; body.customOptions[1].amount = 25; });
  assert.equal(customOf(id, 'Ligne libre').s, 100);
});

test('rule 19 — two lines with the same text: each stored row is consumed once', () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Bois', 40), free('Bois', 60)] });
  paySolde(id);
  assert.deepEqual(customs(id).map((line) => line.s), [40, 60]);

  save(id, (body) => { for (const line of body.customOptions) delete line.customOptionId; addLine(body); });

  assert.deepEqual(customs(id).filter((line) => line.description === 'Bois').map((line) => line.s), [40, 60]);
});

test('rule 19 — a new line sharing a paid line\'s text does not take its contrib', () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Bois', 40)] });
  paySolde(id);

  save(id, (body) => { body.customOptions.unshift(free('Bois', 15, null)); });

  const byAmount = Object.fromEntries(customs(id).map((line) => [line.amount, line.s]));
  assert.deepEqual(byAmount, { 15: null, 40: 40 });
});

test('rule 19 — a line removed takes its contrib with it, the others keep theirs', () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Gardée', 100), free('Retirée', 60)] });
  paySolde(id);
  const collected = rowOf(id).balanceAmount;

  save(id, (body) => { body.customOptions = body.customOptions.filter((c) => c.description === 'Gardée'); });

  assert.deepEqual(customs(id).map((line) => [line.description, line.s]), [['Gardée', 100]]);
  assert.equal(rowOf(id).balanceAmount, collected, 'the paid solde is what it collected');
});

test('rule 19 — « Utiliser les tarifs actuels » keeps it too: a free line has no tariff to refresh', accounting, () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);
  const before = csvOfToday();

  save(id, (body) => { body.refreshPricingToCurrent = true; });

  assert.equal(customOf(id, 'Ligne libre').s, 100);
  assert.equal(csvOfToday(), before);
});

test('rule 19 — a line that grows keeps its contrib and the growth goes to the complement, like an option', accounting, () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);
  const before = csvOfToday();

  save(id, (body) => { body.customOptions[0].amount = 120; });

  assert.equal(customOf(id, 'Ligne libre').s, 100);
  assert.equal(rowOf(id).complementAmount, 20);
  assert.equal(csvOfToday(), before);
});

test('rule 19 — a paid line forced to the complement drops its contrib, like an option', () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);

  save(id, (body) => { body.customOptions[0].inComplement = 1; });

  assert.deepEqual([customOf(id, 'Ligne libre').inComplement, customOf(id, 'Ligne libre').s], [1, null]);
});

test('rule 19 — a contrib in the request is never read: the stored one stands, or none', () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);

  save(id, (body) => {
    Object.assign(body.customOptions[0], { soldeContribTtc: 999, acompteContribTtc: 999 });
    body.customOptions.push({ ...free('Ajout', 20, null), soldeContribTtc: 20, acompteContribTtc: 20 });
  });

  assert.deepEqual([customOf(id, 'Ligne libre').a, customOf(id, 'Ligne libre').s], [null, 100]);
  assert.deepEqual([customOf(id, 'Ajout').a, customOf(id, 'Ajout').s], [null, null]);
});

test('rule 19 — the trop-perçu of a lowered line reads the same whether or not a priced save came first', () => {
  const lowered = (edited) => {
    const id = createStay({ depositDisabled: 1, customOptions: [free('Libre A', 100), free('Libre B', 60)] });
    paySolde(id);
    if (edited) save(id, (body) => { body.customOptions.find((c) => c.description === 'Libre B').amount = 70; });
    const result = controller.performUpdate(String(id), bodyOf(id, (body) => {
      body.customOptions.find((c) => c.description === 'Libre A').amount = 40;
      delete body.forceOverpayment;
    }), {});
    assert.equal(result.status, 409, JSON.stringify(result.body));
    assert.equal(result.body.code, 'OVERPAID');
    return result.body.overpaymentLines;
  };
  const line = (amountTtc, dueTtc) => [{ bucket: 'options', label: 'Prestations complémentaires', amountTtc, collectedTtc: 160, dueTtc }];
  assert.deepEqual(lowered(false), line(60, 100));
  assert.deepEqual(lowered(true), line(50, 110), 'what the line collected survives the first save');
});

test('rule 19 — the mid-stay window of a started fiche keeps the contrib of a paid line', accounting, () => {
  const id = startedStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);
  assert.equal(customOf(id, 'Ligne libre').s, 100);
  const before = csvOfToday();

  save(id, addLine);

  assert.equal(customOf(id, 'Ligne libre').s, 100);
  assert.ok(customOf(id, 'Ajout'), 'the mid-stay sale is written');
  assert.equal(csvOfToday(), before);
});

test('rule 19 — the window pins each line to its own stored row, whatever the payload says and whichever line comes first', () => {
  const id = startedStay({ depositDisabled: 1, customOptions: [free('Payée', 100), free('Forcée', 30, 1)] });
  paySolde(id);

  save(id, (body) => {
    for (const line of body.customOptions) line.inComplement = line.description === 'Forcée' ? 0 : 1;
    body.customOptions.push(free('Payée', 15, null));
    body.customOptions.reverse();
  });

  const byAmount = Object.fromEntries(customs(id).map((line) => [line.amount, line]));
  assert.equal(byAmount[30].inComplement, 1, 'a forced line stays forced');
  assert.deepEqual([byAmount[100].inComplement, byAmount[100].s], [0, 100], 'the paid row keeps its routing and its contrib');
  assert.equal(byAmount[15].s, null, 'the new line sharing its text takes nothing');
});

test('rule 19 — the admin unlock of a started fiche keeps it too', () => {
  const id = startedStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);

  // D21 (2026-11-06): the unlocked fiche keeps its final price, so the priced save lowers the nights by the line.
  const finalPrice = rowOf(id).finalPrice;
  save(id, (body) => {
    addLine(body);
    body.customPrice = finalPrice - body.customOptions.reduce((sum, line) => sum + line.amount, 0);
  }, { unlockPast: true });

  assert.equal(rowOf(id).finalPrice, finalPrice);
  assert.equal(customOf(id, 'Ligne libre').s, 100);
});

test('rule 19 — the dry run of a plugin writes nothing and leaves the contrib', () => {
  const id = createStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);
  const before = customs(id);

  const preview = controller.performUpdate(String(id), bodyOf(id, addLine), { dryRun: true });

  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(customs(id), before);
});

test('rule 19 — a SAS commit, replayed, never touches the contrib of a paid free line', accounting, () => {
  const id = startedStay({ depositDisabled: 1, customOptions: [free('Ligne libre', 100)] });
  paySolde(id);
  const before = csvOfToday();

  model.commitArrivalSas(id, { complementItems: [{ label: 'Draps', amount: 12, qty: 1 }] });
  assert.equal(customOf(id, 'Ligne libre').s, 100);
  assert.equal(customOf(id, 'Draps').inComplement, 1);
  assert.equal(customOf(id, 'Draps').s, null);

  model.commitArrivalSas(id, { complementItems: [{ label: 'Serviettes', amount: 9, qty: 1 }] });
  assert.equal(customOf(id, 'Ligne libre').s, 100);
  assert.equal(customOf(id, 'Draps'), undefined);
  assert.equal(csvOfToday(), before);

  save(id, addLine);
  assert.equal(customOf(id, 'Ligne libre').s, 100);
  assert.equal(customOf(id, 'Serviettes').s, null);
  assert.equal(csvOfToday(), before);
});

test('rule 19 — each line of a cancelled stay offers what it collected, priced save or not', () => {
  const collected = (edited) => {
    const id = createStay({ depositDisabled: 1, options: [{ optionId: OPTION, quantity: 1 }], customOptions: [free('Ligne libre', 100)] });
    paySolde(id);
    if (edited) save(id, addLine);
    const full = model.getByIdWithDetails(id);
    return { lines: collectedByLine({ reservation: rowOf(id), options: full.options }), id };
  };
  const control = collected(false);
  const edited = collected(true);
  const key = Object.keys(control.lines).find((k) => k.startsWith('custom:'));
  const { [key]: paidLine, ...others } = edited.lines;
  assert.equal(paidLine, 100);
  const { [key]: controlLine, ...controlOthers } = control.lines;
  assert.equal(controlLine, 100);
  assert.deepEqual(
    Object.fromEntries(Object.entries(others).filter(([k]) => !k.startsWith('custom:'))),
    Object.fromEntries(Object.entries(controlOthers).filter(([k]) => !k.startsWith('custom:'))),
  );
  cancelReservation({
    database: db, reservationsModel: model,
    refundsModel: require('../models/refundsModel').createModel(db),
    compensationsModel: require('../models/cancellationCompensationsModel').buildModel(db),
    paymentLinksModel: require('../models/paymentLinksModel').buildModel(db),
    installmentsModel: null,
  }, edited.id, { today: TODAY, vatRate: 10, reason: 'Annulation' });
  assert.equal(customOf(edited.id, 'Ligne libre').s, 100, 'a cancellation leaves the contrib');
});

test('rule 19 — matching: id first over every line, then text, each row once', () => {
  const stored = [
    { id: 5, description: 'Bois', v: 'a' },
    { id: 6, description: 'Bois', v: 'b' },
    { id: 7, description: 'Vin', v: 'c' },
  ];
  const ofPosted = (posted) => matchStoredCustomLines(posted, stored).map((row) => (row ? row.v : null));

  assert.deepEqual(ofPosted([{ description: 'bois ' }, { customOptionId: 5, description: 'Bois' }]), ['b', 'a']);
  assert.deepEqual(ofPosted([{ customOptionId: 7, description: 'Bois' }, { description: 'Vin' }]), ['c', null]);
  assert.deepEqual(ofPosted([{ description: 'Bois' }, { description: 'Bois' }, { description: 'Bois' }]), ['a', 'b', null]);
  assert.deepEqual(ofPosted([{ customOptionId: 42, description: 'Thé' }]), [null]);
  assert.deepEqual(ofPosted([{ description: '   ' }]), [null], 'a blank text matches nothing');
  assert.deepEqual(matchStoredCustomLines([{ description: '' }], [{ id: 1, description: '' }]), [null]);
});

test('rule 19 — a body with no custom line list still saves', () => {
  const id = createStay({ depositDisabled: 1 });
  paySolde(id);
  const result = controller.performUpdate(String(id), bodyOf(id, (body) => { delete body.customOptions; }), {});
  assert.equal(result.status, 200, JSON.stringify(result.body));
});
