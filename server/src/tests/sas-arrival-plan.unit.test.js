// specs/sas-arrival-total-server-side.md §3.1, §3.2, §3.5 — the arrival plan: one computation shared by
// the preview and the commit. Figures reused from the SAS fixtures (sasFixtures.jsx and the specs they
// cite): a 5 € pillowcase, an 80 € ménage, a 20 € « Panier gourmand », a 16 × 5 € dinner with 4,80 € of
// tourist tax, 40 € of added guests, 4 × 8 € breakfasts, 2 × 25 € + 17 € of restauration.

process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database');
const model = require('../models/reservationsModel');
const {
  upsellOutcome, arrivalComplementAfter, isUnifiable, totalDiffered,
} = require('../utils/arrivalSasPlan');

db.prepare("INSERT INTO properties (id, name, maxGuests) VALUES (1, 'Gîte fictif', 6)").run();
db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Alex', 'Exemple')").run();
const PILLOW = Number(db.prepare("INSERT INTO linen_priced_items (label, price, category) VALUES ('Taie d''oreiller', 5, 'bed')").run().lastInsertRowid);
const CLEANING = Number(db.prepare("INSERT INTO options (title, priceType, price, autoOptionType) VALUES ('Ménage', 'per_stay', 80, 'cleaning')").run().lastInsertRowid);
const PANIER = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Panier gourmand', 'per_stay', 20)").run().lastInsertRowid);
const DINNER = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Repas du soir', 'per_stay', 5)").run().lastInsertRowid);
const BREAKFAST = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Petit déjeuner', 'per_stay', 8)").run().lastInsertRowid);
const MEAL = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Le repas des trappeurs', 'per_stay', 25)").run().lastInsertRowid);
const BOARD = Number(db.prepare("INSERT INTO options (title, priceType, price) VALUES ('Planche S', 'per_stay', 17)").run().lastInsertRowid);

let nextId = 100;
function stay(columns = {}) {
  const id = nextId++;
  const cols = {
    id, kind: 'reservation', clientId: 1, propertyId: 1, startDate: '2027-07-10', endDate: '2027-07-12',
    platform: 'direct', adults: 2, complementAmount: 0, ...columns,
  };
  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO reservations (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map((k) => cols[k]));
  return id;
}
const inComplement = (id, optionId, units, unitPrice, extra = {}) => db.prepare(`INSERT INTO reservation_options
  (reservationId, optionId, quantity, unitPrice, billedUnits, priceType, totalPrice, inComplement, offered, sasArrivalOrigin)
  VALUES (?, ?, ?, ?, ?, 'per_stay', ?, 1, ?, ?)`).run(id, optionId, units, unitPrice, units, extra.offered ? 0 : units * unitPrice, extra.offered ? 1 : 0, extra.sas ? 1 : 0);
const amountOf = (id) => db.prepare('SELECT complementAmount FROM reservations WHERE id = ?').get(id).complementAmount;

// The commit's own input, as the SAS controller builds it from a draft.
const draft = (id, over = {}) => ({
  complementItems: model.resolveSasArrivalItems(id, { linenItems: over.linenItems, keptLines: over.keptLines }),
  cleaningAdded: over.cleaningAdded,
  cleaningOffered: Boolean(over.cleaningOffered),
  bathLinenAdded: undefined,
  bathLinenOffered: false,
  soldOptions: over.soldOptions,
  offeredExtras: over.offeredExtras,
});

// ── the pure arithmetic ─────────────────────────────────────────────────────────────────────────────

test('rule 1 — the stored complement: previous SAS lines out, this run in, offers applied', () => {
  assert.deepEqual(arrivalComplementAfter({ stored: 30, offerDelta: 0, override: null, priorSum: 0, added: 85 }),
    { afterOffers: 30, existingTotal: 30, engineAfter: 115, stored: 115 });
  // A re-run with the same lines: 85 out, 85 in.
  assert.equal(arrivalComplementAfter({ stored: 85, offerDelta: 0, override: null, priorSum: 85, added: 85 }).stored, 85);
  // Offering a 20 € extra.
  assert.equal(arrivalComplementAfter({ stored: 20, offerDelta: -20, override: null, priorSum: 0, added: 0 }).stored, 0);
  // rule 24 — an adjusted complement keeps its adjustment; the engine figure is kept beside it.
  assert.deepEqual(arrivalComplementAfter({ stored: 50, offerDelta: 0, override: 50, priorSum: 0, added: 5 }),
    { afterOffers: 50, existingTotal: 50, engineAfter: 55, stored: 50 });
});

test('rule 1 — an upsell: written, kept as it was, removed, or left to the fiche', () => {
  const offer = { optionId: 9, totalPrice: 80, present: false, sasOrigin: false };
  assert.equal(upsellOutcome({ offer, stored: null, wanted: true, offered: false }).total, 80);
  assert.equal(upsellOutcome({ offer, stored: null, wanted: true, offered: true }).total, 0);
  assert.equal(upsellOutcome({ offer: { ...offer, present: true, sasOrigin: true }, stored: { totalPrice: 80 }, wanted: undefined }).total, 80);
  assert.equal(upsellOutcome({ offer: { ...offer, present: true, sasOrigin: true }, stored: { totalPrice: 80 }, wanted: false }).action, 'delete');
  assert.equal(upsellOutcome({ offer: { ...offer, present: true, sasOrigin: false }, stored: null, wanted: true }).action, 'none');
});

test('rule 9 — one gesture needs an open complement, a stay step and a total above zero', () => {
  assert.equal(isUnifiable({ complementOpen: true, stayApplicable: true, arrivalComplementTotal: 50 }), true);
  assert.equal(isUnifiable({ complementOpen: true, stayApplicable: true, arrivalComplementTotal: 0 }), false);
  assert.equal(isUnifiable({ complementOpen: false, stayApplicable: true, arrivalComplementTotal: 50 }), false);
  assert.equal(isUnifiable({ complementOpen: true, stayApplicable: false, arrivalComplementTotal: 50 }), false);
});

test('rule 22 — a cent of difference is a difference; no displayed total is none', () => {
  assert.equal(totalDiffered(85, 90), true);
  assert.equal(totalDiffered(85, 85.004), false);
  assert.equal(totalDiffered(85, 85.01), true);
  assert.equal(totalDiffered(undefined, 90), false);
  assert.equal(totalDiffered('abc', 90), false);
});

// ── the plan on a real schema ───────────────────────────────────────────────────────────────────────

test('rules 1, 6 — 1 pillowcase × 5 € + ménage 80 € → 85 €; offering the pillowcase → 80 €', () => {
  const id = stay();
  const plan = model.planArrivalSas(id, draft(id, { linenItems: [{ itemId: PILLOW, qty: 1 }], cleaningAdded: true }));
  assert.equal(plan.arrivalComplementTotal, 85);
  assert.deepEqual(plan.lines.map((l) => [l.label, l.real, l.billed]), [["Taie d'oreiller", 5, 5], ['Ménage', 80, 80]]);
  const offered = model.planArrivalSas(id, draft(id, { linenItems: [{ itemId: PILLOW, qty: 1, offered: true }], cleaningAdded: true }));
  assert.equal(offered.arrivalComplementTotal, 80);
  assert.equal(offered.lines[0].offered, true);
  assert.equal(offered.lines[0].real, 5, 'the real price stays visible');
});

test('rule 6 — the linen element is priced from « Facturables », whatever the dialog believed', () => {
  const id = stay();
  const plan = model.planArrivalSas(id, draft(id, { linenItems: [{ itemId: PILLOW, qty: 2 }, { itemId: 9999, qty: 1 }, { itemId: PILLOW, qty: 0 }] }));
  assert.equal(plan.arrivalComplementTotal, 10);
  assert.equal(plan.lines.length, 1, 'unknown item and zero quantity dropped');
});

test('rule 1 — a stored « Panier gourmand » 20 € offered → 0 €', () => {
  const id = stay({ complementAmount: 20 });
  inComplement(id, PANIER, 1, 20);
  assert.equal(model.planArrivalSas(id, draft(id, { offeredExtras: [] })).arrivalComplementTotal, 20);
  const plan = model.planArrivalSas(id, draft(id, { offeredExtras: [{ kind: 'option', id: PANIER }] }));
  assert.equal(plan.arrivalComplementTotal, 0);
  assert.deepEqual(plan.lines.map((l) => [l.key, l.offered, l.billed]), [[`option:${PANIER}`, true, 0]]);
});

test('rule 1 — « Repas du soir » 16 × 5 € + tourist tax 4,80 € → 84,80 €; the tax is never offerable', () => {
  const id = stay({ complementAmount: 84.8, touristTaxInComplement: 1, touristTaxTotal: 4.8 });
  inComplement(id, DINNER, 16, 5);
  const plan = model.planArrivalSas(id, draft(id));
  assert.equal(plan.arrivalComplementTotal, 84.8);
  const tax = plan.lines.find((l) => l.label === 'Taxe de séjour');
  assert.equal(tax.real, 4.8);
  assert.equal(tax.offerable, false);
  assert.deepEqual(plan.lines.find((l) => l.label === 'Repas du soir'), {
    key: `option:${DINNER}`, group: 'existing', label: 'Repas du soir', qty: 16, unitPrice: 5, real: 80, billed: 80, offerable: true, offered: false,
  });
});

test('rule 1 — 40 € of added guests, offered → 0 €', () => {
  const id = stay({ complementAmount: 40, extraGuestComplementSurcharge: 40, extraGuestComplementCount: 2 });
  assert.equal(model.planArrivalSas(id, draft(id, { offeredExtras: [] })).arrivalComplementTotal, 40);
  assert.equal(model.planArrivalSas(id, draft(id, { offeredExtras: [{ kind: 'extraGuests', id: 0 }] })).arrivalComplementTotal, 0);
});

test('rule 16 — what the sale steps sell is priced by the plan: 4 × 8 € breakfasts, 2 × 25 € + 17 € of restauration', () => {
  const id = stay();
  const plan = model.planArrivalSas(id, draft(id, {
    soldOptions: [{ optionId: BREAKFAST, units: 4 }, { optionId: MEAL, units: 2 }, { optionId: BOARD, units: 1 }],
  }));
  assert.equal(plan.arrivalComplementTotal, 99);
  assert.deepEqual(plan.lines.map((l) => [l.optionId, l.qty, l.real]), [[BREAKFAST, 4, 32], [MEAL, 2, 50], [BOARD, 1, 17]]);
  const fewer = model.planArrivalSas(id, draft(id, { soldOptions: [{ optionId: MEAL, units: 1 }, { optionId: BOARD, units: 1 }] }));
  assert.equal(fewer.arrivalComplementTotal, 42);
});

test('rules 2, 3 — the preview writes nothing, and the commit stores the very total it planned', () => {
  const id = stay({ complementAmount: 20 });
  inComplement(id, PANIER, 1, 20);
  const input = draft(id, { linenItems: [{ itemId: PILLOW, qty: 1 }], cleaningAdded: true, offeredExtras: [] });
  const snapshot = () => JSON.stringify([
    db.prepare('SELECT * FROM reservations WHERE id = ?').get(id),
    db.prepare('SELECT * FROM reservation_options WHERE reservationId = ? ORDER BY optionId').all(id),
    db.prepare('SELECT * FROM reservation_custom_options WHERE reservationId = ? ORDER BY id').all(id),
  ]);
  const before = snapshot();
  const plan = model.planArrivalSas(id, input);
  assert.equal(snapshot(), before, 'a plan is a read');
  assert.equal(plan.arrivalComplementTotal, 105);
  assert.equal(model.commitArrivalSas(id, input), plan.arrivalComplementTotal);
  assert.equal(amountOf(id), 105);
});

test('rule 2 — a re-run with an unchanged draft plans the stored total, not twice the SAS lines', () => {
  const id = stay();
  model.commitArrivalSas(id, draft(id, { linenItems: [{ itemId: PILLOW, qty: 1 }], cleaningAdded: true }));
  assert.equal(amountOf(id), 85);
  const pillowRow = db.prepare("SELECT id FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1").get(id).id;
  const again = draft(id, { linenItems: [{ itemId: PILLOW, qty: 1 }], cleaningAdded: true });
  assert.equal(model.planArrivalSas(id, again).arrivalComplementTotal, 85);
  assert.equal(model.commitArrivalSas(id, again), 85);
  // rule 7 — a kept line is read from its row: the amount is the stored one.
  db.prepare("UPDATE reservation_custom_options SET description = 'Ancien article' WHERE reservationId = ? AND sasArrivalOrigin = 1").run(id);
  const kept = model.resolveSasArrivalItems(id, { keptLines: [{ customOptionId: db.prepare("SELECT id FROM reservation_custom_options WHERE reservationId = ? AND sasArrivalOrigin = 1").get(id).id }] });
  assert.equal(kept[0].amount, 5);
  assert.ok(pillowRow > 0);
});

test('rule 24, Q3 (verified on a fixture only) — an adjusted complement stores the adjustment; the plan says so', () => {
  const id = stay({ complementAmount: 50, complementAmountOverride: 50 });
  const input = draft(id, { linenItems: [{ itemId: PILLOW, qty: 1 }], cleaningAdded: true });
  const plan = model.planArrivalSas(id, input);
  assert.equal(plan.arrivalComplementTotal, 50);
  assert.deepEqual(plan.adjusted, { amount: 50, engineAmount: 135 });
  assert.equal(model.commitArrivalSas(id, input), 50);
  assert.equal(amountOf(id), 50, 'the commit leaves the operator’s adjustment, as the plan announced');
});

test('edge — a paid complement is frozen: the run’s lines are announced apart', () => {
  const id = stay({ complementAmount: 30, complementPaid: 1 });
  const plan = model.planArrivalSas(id, draft(id, { linenItems: [{ itemId: PILLOW, qty: 1 }] }));
  assert.equal(plan.arrivalComplementTotal, 30);
  assert.equal(plan.supplementOutsideComplement, 5);
});
