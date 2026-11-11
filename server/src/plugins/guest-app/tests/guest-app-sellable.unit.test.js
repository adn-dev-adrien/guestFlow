// specs/guest-app.md rules 23, 25 — which items a lodging's shop shows, and their free / included state, on the
// catalogue the pricing engine reads.
// specs/plugins-phase-1-sdk.md rule 44 — `publicCatalogProjection`, `midStayExtrasWindow` and the `pricing` names the shop reads.
const test = require('node:test');
const assert = require('node:assert/strict');

const { addOption, addResource, addStay, freshDb, sell } = require('./guestAppFixtures');
const { remainingMornings, sellabilityOf, shopItems, stayConsumption } = require('../sellable');
const createItemsModel = require('../models/itemsModel');
const createStayLinesModel = require('../models/stayLinesModel');
const createOrdersModel = require('../models/ordersModel');
const { isDirectChannel } = require('../../../utils/platformNameFormat');

/** The shop of a stay, built as the controller builds it. */
function soldFor(db, reservationId, { hourlyOffered = () => true } = {}) {
  const extras = createStayLinesModel(db).ofStay(reservationId);
  const { propertyId } = db.prepare('SELECT propertyId FROM reservations WHERE id = ?').get(reservationId);
  const consumed = stayConsumption({
    optionLines: extras.optionLines,
    resourceLines: extras.resourceLines,
    pendingOrderLines: createOrdersModel(db).pendingLines(reservationId),
    orderedLines: createOrdersModel(db).orderedLines(reservationId),
  });
  return shopItems({
    ...createItemsModel(db).catalogueFor(propertyId),
    stay: {
      isDirectBooking: isDirectChannel(extras.platform),
      grantedFreeUnitsByOption: extras.grantedFreeUnitsByOption,
      optionLines: extras.optionLines,
      ...consumed,
    },
    hourlyOffered,
  });
}

const find = (sold, kind, id) => sold.find((s) => s.kind === kind && Number(s.row.id) === id);
const ids = (sold) => sold.map((s) => `${s.kind}:${s.row.id}`).sort();

function order(db, reservationId, status, lines) {
  // A card order awaiting its payment holds until its link lapses: far ahead here.
  const heldUntil = status === 'awaiting_payment' ? '2999-01-01T00:00:00Z' : null; // date-literal-ok: a hold that never lapses
  db.prepare(`INSERT INTO guest_orders (reservationId, payment, status, linesJson, total, createdAt, heldUntil)
    VALUES (?, 'card', ?, ?, 0, '2099-07-07T10:00:00Z', ?)`).run(reservationId, status, JSON.stringify(lines), heldUntil);
}

test('rule 23: options sell per stay, per person or free; every other price is refused with its reason', () => {
  ['per_stay', 'per_person', 'free'].forEach((priceType) => assert.deepEqual(sellabilityOf('option', { priceType }), { ok: true, reason: null }, priceType));
  ['per_night', 'per_person_per_night', 'percent_of_stay', 'per_participant_progressive'].forEach((priceType) => {
    const judged = sellabilityOf('option', { priceType });
    assert.equal(judged.ok, false, priceType);
    assert.match(judged.reason, /application/, priceType);
  });
});

test('rule 23: the cancellation insurance, an auto timed option and an internal option cannot be sold', () => {
  assert.match(sellabilityOf('option', { priceType: 'per_stay', isCancellationInsurance: 1 }).reason, /assurance annulation/);
  assert.match(sellabilityOf('option', { priceType: 'per_stay', autoOptionType: 'late_check_out' }).reason, /départ tardif/);
  assert.equal(sellabilityOf('option', { priceType: 'per_stay', autoOptionType: 'early_check_in' }).ok, false);
  assert.equal(sellabilityOf('option', { priceType: 'per_person', autoOptionType: 'breakfast' }).ok, true, 'breakfast is not a timed option');
  assert.match(sellabilityOf('option', { priceType: 'per_stay', displayToClient: 0 }).reason, /interne/);
});

test('rule 23: resources sell by the hour or by quantity, never per night', () => {
  ['per_hour', 'per_stay', 'free'].forEach((priceType) => assert.equal(sellabilityOf('resource', { priceType }).ok, true, priceType));
  ['per_night', 'per_person_per_night'].forEach((priceType) => assert.equal(sellabilityOf('resource', { priceType }).ok, false, priceType));
});

// Audit R36b N2 — the engine bills a per-person resource quantity × party (« 1 × Vélo » = 40 € for 4), the shop says
// « par personne »: a guest ordering 4 for 4 people paid 16 persons. Refused, as the per-night prices are.
test('rule 23 (R36b N2): a per-person resource is refused with its reason, and a stored switch sells nothing', () => {
  const judged = sellabilityOf('resource', { priceType: 'per_person' });
  assert.equal(judged.ok, false);
  assert.equal(judged.reason, 'Une ressource au prix par personne ne se vend pas dans l’application.');
  assert.equal(sellabilityOf('option', { priceType: 'per_person' }).ok, true, 'a per-person option still sells (unit = one person)');
  const db = freshDb();
  const stay = addStay(db);
  addResource(db, { id: 9, name: 'Vélo', priceType: 'per_person', price: 10 });
  sell(db, 'resource', 9);
  assert.equal(find(soldFor(db, stay), 'resource', 9), undefined, 'switched on before the refusal: absent from the shop');
});

test('rule 23: archived, unlinked, unsold and non-sellable items are absent', () => {
  const db = freshDb();
  const stay = addStay(db);
  addOption(db, { id: 1, title: 'Cidre' });
  addOption(db, { id: 2, title: 'Ancien vin', archivedAt: '2099-01-01' });
  addOption(db, { id: 3, title: 'Vin de L’Estiva', lodgings: [2] });
  addOption(db, { id: 4, title: 'Pas en vente' });
  addOption(db, { id: 5, title: 'Ménage quotidien', priceType: 'per_night' });
  addResource(db, { id: 6, name: 'Bain nordique' });
  addResource(db, { id: 7, name: 'Bois', priceType: 'per_stay', lodgings: [] });
  [1, 2, 3, 5].forEach((id) => sell(db, 'option', id));
  sell(db, 'option', 4, { sold: 0 });
  [6, 7].forEach((id) => sell(db, 'resource', id));
  assert.deepEqual(ids(soldFor(db, stay)), ['option:1', 'resource:6'], 'a resource linked to no lodging is not sold, even though the engine reads it as global');
});

test('rule 23 edge: without the plugin that prices hours, an hourly resource is not sold', () => {
  const db = freshDb();
  const stay = addStay(db);
  addResource(db, { id: 6, name: 'Bain nordique' });
  addResource(db, { id: 7, name: 'Bois', priceType: 'per_stay' });
  sell(db, 'resource', 6);
  sell(db, 'resource', 7);
  assert.deepEqual(ids(soldFor(db, stay, { hourlyOffered: () => false })), ['resource:7']);
  assert.equal(find(soldFor(db, stay), 'resource', 6).hourly, true);
});

test('rule 25: the same option is included at one lodging and paid at the other', () => {
  const db = freshDb();
  const granja = addStay(db);
  const estiva = addStay(db, { propertyId: 2, reservationNumber: 'R-99-002' });
  addOption(db, { id: 1, title: 'Panier du terroir', price: 25, prices: { 1: 0 } });
  addResource(db, { id: 6, name: 'Bain nordique', price: 30, prices: { 1: 0, 2: 40 } });
  sell(db, 'option', 1);
  sell(db, 'resource', 6);
  assert.equal(find(soldFor(db, granja), 'option', 1).included, true);
  const paid = find(soldFor(db, estiva), 'option', 1);
  assert.equal(paid.included, false);
  assert.equal(paid.row.price, 25);
  assert.equal(find(soldFor(db, granja), 'resource', 6).included, true);
  assert.equal(find(soldFor(db, estiva), 'resource', 6).row.price, 40);
});

test('rule 25: an option’s free units go to own-channel bookings only', () => {
  const db = freshDb();
  const direct = addStay(db);
  const platform = addStay(db, { reservationNumber: 'R-99-002' });
  db.prepare("UPDATE reservations SET platform = 'Airbnb' WHERE id = ?").run(platform);
  addOption(db, { id: 1, title: 'Petit-déjeuner', priceType: 'per_person', price: 12, freeUnits: { 1: 2 } });
  sell(db, 'option', 1);
  assert.deepEqual(find(soldFor(db, direct), 'option', 1).freeUnits, { granted: 2, left: 2 });
  assert.equal(find(soldFor(db, platform), 'option', 1).freeUnits, null);
});

test('rule 25: free units are granted once per stay — the fiche’s line and an unpaid order take theirs', () => {
  const db = freshDb();
  const stay = addStay(db);
  addOption(db, { id: 1, title: 'Petit-déjeuner', priceType: 'per_person', price: 12, freeUnits: { 1: 3 } });
  sell(db, 'option', 1);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, billedUnits, unitPrice, totalPrice) VALUES (?, 1, 1, 2, 12, 0)').run(stay);
  assert.deepEqual(find(soldFor(db, stay), 'option', 1).freeUnits, { granted: 3, left: 1 });
  order(db, stay, 'awaiting_payment', [{ kind: 'option', id: 1, quantity: 1 }]);
  assert.deepEqual(find(soldFor(db, stay), 'option', 1).freeUnits, { granted: 3, left: 0 });
});

test('rule 25: the grant the stay was sold with wins over today’s catalogue', () => {
  const db = freshDb();
  const stay = addStay(db);
  addOption(db, { id: 1, title: 'Petit-déjeuner', priceType: 'per_person', price: 12, freeUnits: { 1: 3 } });
  sell(db, 'option', 1);
  db.prepare('UPDATE reservations SET tariffSnapshot = ? WHERE id = ?').run(JSON.stringify({ grantedFreeUnitsByOption: { 1: 1 } }), stay);
  assert.deepEqual(find(soldFor(db, stay), 'option', 1).freeUnits, { granted: 1, left: 1 });
});

test('rule 25: free minutes left after a session already on the fiche, then after a previous order', () => {
  const db = freshDb();
  const stay = addStay(db);
  addResource(db, { id: 6, name: 'Bain nordique', freeMinutes: { 1: 90 } });
  sell(db, 'resource', 6);
  assert.deepEqual(find(soldFor(db, stay), 'resource', 6).freeMinutes, { granted: 90, left: 90 });
  db.prepare('INSERT INTO reservation_resources (reservationId, resourceId, quantity, sessions) VALUES (?, 6, 0, ?)')
    .run(stay, JSON.stringify([{ date: '2099-07-06', start: '18:00', end: '18:30' }]));
  assert.deepEqual(find(soldFor(db, stay), 'resource', 6).freeMinutes, { granted: 90, left: 60 });
  order(db, stay, 'awaiting_payment', [{ kind: 'resource', id: 6, sessions: [{ date: '2099-07-07', start: '20:00', end: '21:00' }] }]);
  assert.deepEqual(find(soldFor(db, stay), 'resource', 6).freeMinutes, { granted: 90, left: 0 });
});

test('rule 25: an order already on the fiche is not counted twice, a dead one not at all', () => {
  const db = freshDb();
  const stay = addStay(db);
  addResource(db, { id: 6, name: 'Bain nordique', freeMinutes: { 1: 60 } });
  sell(db, 'resource', 6);
  const hour = [{ kind: 'resource', id: 6, sessions: [{ date: '2099-07-07', start: '20:00', end: '21:00' }] }];
  ['confirmed', 'paid', 'delivered', 'expired', 'paid_conflict'].forEach((status) => order(db, stay, status, hour));
  assert.deepEqual(find(soldFor(db, stay), 'resource', 6).freeMinutes, { granted: 60, left: 60 });
});

test('rule 25: an option offered by default that the stay already carries is « déjà inclus »', () => {
  const db = freshDb();
  const carried = addStay(db);
  const other = addStay(db, { reservationNumber: 'R-99-002' });
  addOption(db, { id: 1, title: 'Bouteille de bienvenue', price: 15 });
  sell(db, 'option', 1);
  db.prepare('INSERT INTO property_option_defaults (propertyId, optionId, offered) VALUES (1, 1, 1)').run();
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, quantity, billedUnits, offered) VALUES (?, 1, 1, 1, 1)').run(carried);
  assert.equal(find(soldFor(db, carried), 'option', 1).alreadyIncluded, true);
  assert.equal(find(soldFor(db, other), 'option', 1).alreadyIncluded, false, 'a stay without it can buy it');
});

test('rule 27bis: the seeded breakfast sells despite its per-person-night price; another such option does not', () => {
  assert.equal(sellabilityOf('option', { priceType: 'per_person_per_night', autoOptionType: 'breakfast' }).ok, true);
  assert.equal(sellabilityOf('option', { priceType: 'per_person_per_night', autoOptionType: null }).ok, false);
});

test('rule 27bis: the breakfast is its own kind; already on the stay as offered it is included, still orderable', () => {
  const db = freshDb();
  const offered = addStay(db);
  const without = addStay(db, { reservationNumber: 'R-99-002' });
  addOption(db, { id: 1, title: 'Petit déjeuner', priceType: 'per_person_per_night', price: 12, autoOptionType: 'breakfast', category: 'Restauration' });
  sell(db, 'option', 1);
  db.prepare(`INSERT INTO reservation_options (reservationId, optionId, quantity, billedUnits, offered, cardOccurrences)
    VALUES (?, 1, 1, 6, 1, ?)`).run(offered, JSON.stringify([{ date: '2099-07-07', time: '08:30' }]));
  const included = find(soldFor(db, offered), 'breakfast', 1);
  assert.equal(included.included, true);
  assert.equal(included.alreadyIncluded, false, 'never « déjà inclus — not sold again »: the guest picks mornings');
  const paid = find(soldFor(db, without), 'breakfast', 1);
  assert.equal(paid.included, false);
  assert.equal(paid.row.price, 12);
});

test('rule 27bis: the mornings left run from the morning after arrival, from today until the service hour, to departure', () => {
  const stay = { startDate: '2099-07-06', endDate: '2099-07-09', serviceTime: '09:00' };
  assert.deepEqual(remainingMornings({ ...stay, today: '2099-07-03', time: '10:00' }), ['2099-07-07', '2099-07-08', '2099-07-09'], 'before the stay');
  assert.deepEqual(remainingMornings({ ...stay, today: '2099-07-06', time: '08:00' }), ['2099-07-07', '2099-07-08', '2099-07-09'], 'no breakfast on arrival morning');
  assert.deepEqual(remainingMornings({ ...stay, today: '2099-07-08', time: '08:59' }), ['2099-07-08', '2099-07-09']);
  assert.deepEqual(remainingMornings({ ...stay, today: '2099-07-08', time: '09:00' }), ['2099-07-09']);
  assert.deepEqual(remainingMornings({ ...stay, today: '2099-07-09', time: '11:00' }), []);
});

test('rule 25: a 0 € item is limited per stay to its maxQuantity, across the orders that stand', () => {
  const db = freshDb();
  const stay = addStay(db);
  addOption(db, { id: 1, title: 'Fagot de bois', price: 0 });
  addOption(db, { id: 2, title: 'Cidre', price: 6 });
  sell(db, 'option', 1, { maxQuantity: 3 });
  sell(db, 'option', 2, { maxQuantity: 3 });
  assert.equal(find(soldFor(db, stay), 'option', 1).includedLeft, 3);
  order(db, stay, 'confirmed', [{ kind: 'option', id: 1, quantity: 2 }]);
  order(db, stay, 'expired', [{ kind: 'option', id: 1, quantity: 1 }]);
  assert.equal(find(soldFor(db, stay), 'option', 1).includedLeft, 1);
  order(db, stay, 'awaiting_payment', [{ kind: 'option', id: 1, quantity: 5 }]);
  assert.equal(find(soldFor(db, stay), 'option', 1).includedLeft, 0);
  assert.equal(find(soldFor(db, stay), 'option', 2).includedLeft, null, 'a paid item has no allowance');
});
