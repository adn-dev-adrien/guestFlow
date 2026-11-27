// specs/guest-app/guest-app-demo-mode.md rules 1-18 — the demo link, the fictitious stay, the demo session and its switch, and above all
// « nothing leaves the screen »: a demo order is validated and priced like a real one and written nowhere (counted before / after on every
// table an order could touch), the gate never reads a key, the lights never reach the house. Through the real routes on the app's database.
const fx = require('./guestOrderFixtures');

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addBath, addOption, db, fakeProvider, livePlugins, seedStay, sell,
} = fx;
const { startApi } = require('./guestAppFixtures');
const { fakeHome, GRANJA_BLOCKS, readingsAt } = require('./homeFixtures');
const registry = require('../../sdk/registry');
const { skipWithout } = require('../../sdk/testing');
const { demoSession, demoStay, DEMO_GATE_CODE } = require('../demoStay');
const { createDemoOrders } = require('../demoOrders');
const { createDemoCommands } = require('../demoCommands');
const { gateState } = require('../gate');
const { parisDate, daysBetween } = require('../currentStay');
const { MIGRATIONS } = require('../migrations');
const { readModules } = require('../modules');

const createDemoLinkModel = require('../models/demoLinkModel');
const createLodgingsModel = require('../models/lodgingsModel');

const CIDER = addOption({ id: 901, title: 'Cidre démo', price: 6 });
const PLATTER = addOption({ id: 902, title: 'Plateau démo', price: 25, prices: { 1: 0 }, category: 'Alimentation' });
sell('option', CIDER, { maxQuantity: 6 });
sell('option', PLATTER, { maxQuantity: 2 });
const BATH = addBath({ id: 905, freeMinutes: { 1: 60 } });
sell('resource', BATH);
db.prepare(`UPDATE resources SET hourlyEveningStart = '19:00', hourlyEveningRate = 40, heatUpMinutes = 240, heatRetentionMinutes = 120,
  turnoverMinutes = 0, showsPlanningCard = 1 WHERE id = ?`).run(BATH);

const API = '/public/v1/guest';
const WRITES = ['reservations', 'clients', 'reservation_options', 'reservation_resources', 'reservation_custom_options', 'reservation_nights', 'reservation_history',
  'guest_orders', 'guest_app_stock_counts', 'payment_links', 'resource_bookings'];
const present = (table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
const counts = () => Object.fromEntries(WRITES.filter(present).map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));

/** A demo session on the demo link, as a phone opens it: both lodgings in the app, the stay moment. */
async function openDemo({
  now = new Date(), lodgings = [1, 2], landOn = 1, card = null, house = null, ...options
} = {}) {
  db.prepare('DELETE FROM guest_sessions').run();
  db.prepare('DELETE FROM guest_demo_links').run();
  const pushes = [];
  const gateReads = [];
  const ctx = await startApi(db, {
    commit: require('../../../utils/extraSale'),
    push: () => ({ sendToPref: async (key, payload) => { pushes.push({ key, payload }); return { sent: 1 }; } }),
    guestHost: 'sejour.example.test',
    readGateUrl: (reservationId) => { gateReads.push(reservationId); return 'https://portail.example.test/real-key'; },
    ...(house ? { homeData: () => house } : {}),
    ...options,
  });
  ctx.clock.now = now;
  const teardown = livePlugins(ctx.api, { card });
  const lodgingModel = createLodgingsModel(db);
  lodgings.forEach((propertyId) => lodgingModel.save(propertyId, { enabled: true }));
  [1, 2].filter((id) => !lodgings.includes(id)).forEach((propertyId) => lodgingModel.save(propertyId, { enabled: false }));
  const link = createDemoLinkModel(db).ensure(now);
  let opened = await ctx.call('POST', `${API}/sessions/demo`, { demoToken: link.token });
  const switchTo = (propertyId, moment) => ctx.call('POST', `${API}/sessions/demo/switch`, { propertyId, moment });
  // The link opens on the first lodging of the Studio's order (by name: L'Estiva); the suites mostly work on La Granja.
  if (landOn && lodgings.includes(landOn)) opened = await switchTo(landOn, 'stay');
  return {
    ...ctx, link, opened, pushes, gateReads, switchTo, close: async () => { await ctx.close(); teardown(); },
  };
}

function withDemo(name, fn, options = {}) {
  test(name, async () => {
    const ctx = await openDemo(options);
    try {
      await fn(ctx);
    } finally {
      await ctx.close();
    }
  });
}

const me = async (call) => (await call('GET', `${API}/me`)).body.data;

// ---------------------------------------------------------------------------------------------------------------------------------
// 3.A — the demo link

withDemo('rule 1: the demo link opens a demo session; an unknown, revoked or empty token reads like any unknown code', async ({ call, opened, link }) => {
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.data.mode, 'stay');
  assert.equal(opened.body.data.lodging.name, "L'Estiva", 'the first lodging of the Studio’s order');
  const unknown = await call('POST', `${API}/sessions/demo`, { demoToken: 'not-a-token' }, { cookie: null });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'CODE_NOT_FOUND');
  assert.equal((await call('POST', `${API}/sessions/demo`, {}, { cookie: null })).body.error.code, 'CODE_NOT_FOUND');
  db.prepare('UPDATE guest_demo_links SET revokedAt = ? WHERE id = ?').run(new Date().toISOString(), link.id);
  const revoked = await call('POST', `${API}/sessions/demo`, { demoToken: link.token }, { cookie: null });
  assert.equal(revoked.body.error.code, 'CODE_NOT_FOUND', 'same answer as a guessed token: no oracle');
}, { landOn: null });

withDemo('rule 1: the Studio shows one link, created once; « Régénérer le lien » replaces it and ends the sessions opened from the old one', async ({ call, link }) => {
  const first = await call('GET', '/api/guest-app/studio/demo-link');
  assert.equal(first.status, 200);
  assert.equal(first.body.url, `https://sejour.example.test/d/${link.token}`);
  assert.match(first.body.qrDataUri, /^data:image\/png;base64,/);
  assert.equal((await call('GET', '/api/guest-app/studio/demo-link')).body.url, first.body.url, 'created the first time only');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_demo_links WHERE revokedAt IS NULL').get().n, 1);
  assert.equal((await call('GET', `${API}/me`)).status, 200);
  const regenerated = await call('POST', '/api/guest-app/studio/demo-link/regenerate');
  assert.equal(regenerated.status, 200);
  assert.notEqual(regenerated.body.url, first.body.url);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_demo_links WHERE revokedAt IS NULL').get().n, 1, 'one live link at a time');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guest_sessions WHERE origin = 'demo'").get().n, 0, 'the old link’s sessions are gone');
  const dead = await call('GET', `${API}/me`);
  assert.equal(dead.status, 401);
  assert.equal(dead.body.error.code, 'SESSION_EXPIRED');
  const stale = await call('POST', `${API}/sessions/demo`, { demoToken: first.body.url.split('/d/')[1] }, { cookie: null });
  assert.equal(stale.body.error.code, 'CODE_NOT_FOUND', 'the stored old link answers like an unknown code');
});

withDemo('rule 2: the Studio link needs the guest app’s address', async ({ call }) => {
  const res = await call('GET', '/api/guest-app/studio/demo-link');
  assert.equal(res.status, 409);
}, { guestHost: null });

withDemo('rule 3: a demo session lasts 24 h, then the stored link opens another one — no re-scan', async ({ call, clock, link }) => {
  clock.now = new Date(clock.now.getTime() + 23 * 3600 * 1000);
  assert.equal((await call('GET', `${API}/me`)).status, 200);
  clock.now = new Date(clock.now.getTime() + 2 * 3600 * 1000);
  const expired = await call('GET', `${API}/me`);
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'SESSION_EXPIRED');
  assert.equal((await call('POST', `${API}/sessions/demo`, { demoToken: link.token }, { cookie: null })).status, 200);
  assert.equal((await call('GET', `${API}/me`)).status, 200);
});

withDemo('rule 4: no lodging in the app → « Aucun logement n’est ouvert dans l’application. », and no session', async ({ call, link }) => {
  db.prepare('DELETE FROM guest_sessions').run();
  const res = await call('POST', `${API}/sessions/demo`, { demoToken: link.token }, { cookie: null });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NO_LODGING');
  assert.equal(res.body.error.message, 'Aucun logement n’est ouvert dans l’application.');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_sessions').get().n, 0);
}, { lodgings: [] });

// ---------------------------------------------------------------------------------------------------------------------------------
// 3.B — the fictitious stay

const PARIS_TIMES = { checkInTime: '16:00', checkOutTime: '10:00' };
const stayAt = (moment, now) => demoSession({
  propertyId: 1, moment, now, times: PARIS_TIMES,
});

test('rule 5: demoStay is Camille, 2 adults, built never stored, with the lodging’s own times; id is null', () => {
  const stay = demoStay({
    propertyId: 2, moment: 'stay', now: new Date(), times: PARIS_TIMES,
  });
  assert.equal(stay.id, null);
  assert.equal(stay.demo, true);
  assert.equal(stay.clientFirstName, 'Camille');
  assert.equal(stay.adults, 2);
  assert.equal(stay.propertyId, 2);
  assert.deepEqual([stay.checkInTime, stay.checkOutTime], ['16:00', '10:00']);
  assert.equal(stay.clientLanguage, null, 'the phone’s own language answers');
});

test('rule 5: the three moments hold their dates and derive the mode the real helpers give — around midnight and across a DST change', () => {
  const instants = [
    // date-literal-ok: instants handed to a pure function, compared with nothing but their own derived dates.
    '2026-10-24T21:59:00Z', '2026-10-24T22:01:00Z', '2026-10-25T00:30:00Z', '2026-10-25T23:30:00Z',
    // date-literal-ok: the spring DST change, same reason.
    '2026-03-28T22:30:00Z', '2026-03-29T00:30:00Z', '2026-03-29T22:30:00Z',
  ];
  instants.forEach((iso) => {
    const now = new Date(iso);
    const today = parisDate(now);
    const arriving = stayAt('preArrival', now);
    assert.equal(arriving.mode, 'preArrival', iso);
    assert.equal(daysBetween(arriving.stay.startDate, today), 5, iso);
    assert.equal(daysBetween(arriving.stay.endDate, arriving.stay.startDate), 3, 'three nights');
    const during = stayAt('stay', now);
    assert.equal(during.mode, 'stay', iso);
    assert.equal(daysBetween(today, during.stay.startDate), 1, 'arrived yesterday');
    assert.equal(daysBetween(during.stay.endDate, today), 2, 'leaves in two days');
    const over = stayAt('ended', now);
    assert.equal(over.mode, 'visitor', iso);
    assert.equal(over.ended, true);
    assert.equal(over.stay, null, 'a visitor carries no stay');
  });
});

withDemo('rule 5: the stay is never stored — no reservation, no client, no stay link row — through /me, /shop and an order', async ({ call }) => {
  const before = counts();
  const links = db.prepare('SELECT COUNT(*) AS n FROM guest_stay_links').get().n;
  const data = await me(call);
  assert.equal(data.guest.firstName, 'Camille');
  assert.equal(data.stay.partySize, 2);
  assert.equal((await call('GET', `${API}/shop`)).status, 200);
  assert.equal((await call('POST', `${API}/orders/quote`, { lines: [{ kind: 'option', id: CIDER, quantity: 1 }] })).status, 200);
  assert.deepEqual(counts(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_stay_links').get().n, links);
});

withDemo('rule 6: a demo session row has origin demo, no reservation, its link and moment; /me never crashes on a stay of id null', async ({ call }) => {
  const row = db.prepare("SELECT * FROM guest_sessions WHERE origin = 'demo'").get();
  assert.equal(row.reservationId, null);
  assert.equal(row.stayLinkId, null);
  assert.equal(row.demoMoment, 'stay');
  assert.ok(row.demoLinkId > 0);
  assert.equal(row.propertyId, 1);
  const data = await me(call);
  assert.equal(data.mode, 'stay');
  assert.ok(data.highlight !== undefined || data.stay.statusLine, 'the stay home is built (highlight reads the orders of a stay of id null)');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 3.B — switching

withDemo('rules 7, 8: switching the lodging and the moment answers /me; the demo block lists the enabled lodgings in the Studio’s order', async ({ call, switchTo }) => {
  const first = await me(call);
  assert.deepEqual(first.demo, {
    moment: 'stay', lodgings: [{ propertyId: 2, name: "L'Estiva" }, { propertyId: 1, name: 'La Granja' }],
  });
  const arrival = await switchTo(2, 'preArrival');
  assert.equal(arrival.status, 200, JSON.stringify(arrival.body));
  assert.equal(arrival.body.data.mode, 'preArrival');
  assert.equal(arrival.body.data.lodging.name, "L'Estiva");
  assert.equal(arrival.body.data.demo.moment, 'preArrival');
  assert.equal(arrival.body.data.stay.statusLine.length > 0, true, 'the pre-arrival stay card is derived like a real stay’s');
  const after = await switchTo(1, 'ended');
  assert.equal(after.body.data.lodging.name, 'La Granja');
  assert.equal(after.body.data.mode, 'visitor');
  assert.equal(after.body.data.ended, true);
  assert.equal(after.body.data.guest, undefined, 'a visitor learns nothing of a stay');
  assert.equal((await me(call)).demo.moment, 'ended');
  assert.equal((await switchTo(1, 'stay')).body.data.mode, 'stay');
});

withDemo('rule 7: an unknown or disabled lodging, or an unknown moment, is a 400 and changes nothing', async ({ call, switchTo }) => {
  createLodgingsModel(db).save(2, { enabled: false });
  for (const [propertyId, moment] of [[2, 'stay'], [99, 'stay'], [1, 'later'], [null, 'stay'], ['1', 'stay']]) {
    const res = await switchTo(propertyId, moment);
    assert.equal(res.status, 400, JSON.stringify([propertyId, moment]));
    assert.equal(res.body.error.code, 'INVALID_INPUT');
  }
  assert.equal(db.prepare("SELECT demoMoment FROM guest_sessions WHERE origin = 'demo'").get().demoMoment, 'stay');
  assert.deepEqual((await me(call)).demo.lodgings, [{ propertyId: 1, name: 'La Granja' }], 'a lodging off the app is not offered');
});

test('rule 7: a stay session cannot switch — 403 NOT_A_DEMO — and its /me has no demo block (rule 8)', async () => {
  const stayId = seedStay();
  const ctx = await fx.openOrdering(stayId, { guestHost: 'sejour.example.test' });
  try {
    const refused = await ctx.call('POST', `${API}/sessions/demo/switch`, { propertyId: 1, moment: 'stay' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error.code, 'NOT_A_DEMO');
    assert.equal((await ctx.call('GET', `${API}/me`)).body.data.demo, undefined);
  } finally {
    await ctx.close();
  }
});

withDemo('edge: a lodging switched off while shown falls back to the first one; none left ends the session', async ({ call }) => {
  createLodgingsModel(db).save(1, { enabled: false });
  const data = await me(call);
  assert.equal(data.lodging.name, "L'Estiva");
  assert.equal(db.prepare("SELECT propertyId FROM guest_sessions WHERE origin = 'demo'").get().propertyId, 2, 'the session follows');
  createLodgingsModel(db).save(2, { enabled: false });
  assert.equal((await call('GET', `${API}/me`)).status, 401);
});

withDemo('edge: two phones on the same link are two sessions, each with its own lodging and moment', async ({ call, link, switchTo }) => {
  await switchTo(2, 'preArrival');
  const second = await call('POST', `${API}/sessions/demo`, { demoToken: link.token }, { cookie: null });
  const cookie = second.setCookie.split(';')[0];
  const other = await call('GET', `${API}/me`, undefined, { cookie });
  assert.equal(other.body.data.lodging.name, "L'Estiva");
  assert.equal(other.body.data.mode, 'stay');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guest_sessions WHERE origin = 'demo'").get().n, 2);
});

withDemo('edge: the same phone opening the link again keeps its session, lodging and moment', async ({ call, link, switchTo }) => {
  await switchTo(2, 'preArrival');
  await call('POST', `${API}/sessions/demo`, { demoToken: link.token });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM guest_sessions WHERE origin = 'demo'").get().n, 1);
  assert.equal((await me(call)).demo.moment, 'preArrival');
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 3.C — reads are real, orders are simulated

withDemo('rule 9: the shop catalogue and the quote are the real ones, on the fictitious party', async ({ call }) => {
  const shop = await call('GET', `${API}/shop`);
  const titles = shop.body.data.categories.flatMap((c) => c.items.map((i) => i.title));
  assert.ok(titles.includes('Cidre démo'));
  const quote = await call('POST', `${API}/orders/quote`, { lines: [{ kind: 'option', id: CIDER, quantity: 2 }] });
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.data.total, 12);
});

withDemo('rule 10: a demo order on the note writes nothing anywhere — no order row, no fiche line, no hold, no link, no stock, no push — and is answered confirmed, demo', async ({
  call, pushes,
}) => {
  const before = counts();
  const res = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual([res.body.data.status, res.body.data.demo], ['confirmed', true]);
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.deepEqual(counts(), before);
  assert.equal(pushes.length, 0, 'the staff is told of nothing');
});

withDemo('rule 10: « Payer maintenant » ends on the confirmation too and never reaches the payment provider', async ({ call, pushes }) => {
  const before = counts();
  const res = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'card' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.paymentUrl, undefined, 'no link to pay');
  assert.deepEqual([res.body.data.status, res.body.data.demo], ['confirmed', true]);
  assert.deepEqual(counts(), before);
  assert.equal(pushes.length, 0);
}, { card: fakeProvider() });

test('rule 10: the payment provider of a demo card order is never asked for a link', async () => {
  const card = fakeProvider();
  const ctx = await openDemo({ card });
  try {
    const res = await ctx.call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'card' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(card.created.length, 0);
  } finally {
    await ctx.close();
  }
});

withDemo('rule 10: a 0 € demo order needs no payment and writes nothing either', async ({ call }) => {
  const before = counts();
  const res = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: PLATTER, quantity: 1 }], payment: 'none' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(counts(), before);
});

withDemo('rule 10: the stock of a tracked article is not counted by a demo order', async ({ call }) => {
  db.prepare('UPDATE guest_app_items SET stockTracked = 1, stockQuantity = 3 WHERE kind = ? AND itemId = ?').run('option', CIDER);
  try {
    const leftOf = async () => (await call('GET', `${API}/shop`)).body.data.categories.flatMap((c) => c.items).find((i) => i.id === CIDER).stock;
    const before = await leftOf();
    assert.equal((await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' })).status, 200);
    assert.deepEqual(await leftOf(), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guest_app_stock_counts').get().n, 0);
  } finally {
    db.prepare('UPDATE guest_app_items SET stockTracked = 0, stockQuantity = NULL WHERE kind = ? AND itemId = ?').run('option', CIDER);
  }
});

test('rule 10: a bath slot ordered in the demo takes no hold in the planning and writes no session on any stay', { skip: skipWithout(['hourly-resources']) }, async () => {
  db.prepare('DELETE FROM resource_bookings').run();
  const ctx = await openDemo();
  try {
    await ctx.switchTo(1, 'preArrival');
    const slots = (await ctx.call('GET', `${API}/shop/resources/${BATH}/slots`)).body.data;
    const day = slots.days.find((d) => d.slots && d.slots.length);
    assert.ok(day, 'the demo stay offers a bath slot');
    const slot = day.slots[0];
    const before = counts();
    const lines = [{ kind: 'resource', id: BATH, sessions: [{ date: day.date, start: slot.start, end: slot.end }] }];
    const res = await ctx.call('POST', `${API}/orders`, { lines, payment: 'note' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.demo, true);
    assert.deepEqual(counts(), before);
    const again = (await ctx.call('GET', `${API}/shop/resources/${BATH}/slots`)).body.data;
    assert.deepEqual(again.days.find((d) => d.date === day.date).slots.map((s) => s.start), day.slots.map((s) => s.start), 'the slot is still free');
    const listed = (await ctx.call('GET', `${API}/orders`)).body.data.orders;
    assert.equal(listed.length, 1);
  } finally {
    await ctx.close();
  }
});

withDemo('rule 10: a refused demo order is refused with the real reason — over maxQuantity, over the ceiling, an unknown article, a payment missing', async ({ call }) => {
  const over = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 7 }], payment: 'note' });
  assert.equal(over.status, 400);
  assert.equal(over.body.error.code, 'ORDER_LIMIT');
  const ceiling = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 5 }], payment: 'note' });
  assert.equal(ceiling.body.error.code, 'ORDER_LIMIT');
  const unknown = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: 424242, quantity: 1 }], payment: 'note' });
  assert.equal(unknown.status, 409);
  assert.equal(unknown.body.error.code, 'ITEM_UNAVAILABLE');
  const unpaid = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'none' });
  assert.equal(unpaid.status, 400);
  assert.equal((await call('GET', `${API}/orders`)).body.data.orders.length, 0, 'a refused order is not simulated');
}, { maxOrderTotal: () => 20 });

withDemo('rule 10: the shop is read-only before the arrival date as the real rules say — and an order at « avant l’arrivée » is judged by the same engine', async ({ call, switchTo }) => {
  await switchTo(1, 'preArrival');
  const shop = await call('GET', `${API}/shop`);
  assert.equal(shop.status, 200);
  assert.equal(shop.body.data.orderCollection, 'arrival', 'collected at the arrival complement, as a real stay of J-5');
  const res = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
});

withDemo('edge: an « après le départ » demo is the visitor mode — no order, no shop write', async ({ call, switchTo }) => {
  await switchTo(1, 'ended');
  const res = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
  assert.ok([403, 404].includes(res.status), 'a visitor orders nothing: the shop is not among its modules');
  assert.equal((await call('GET', `${API}/orders`)).body.data?.orders?.length || 0, 0);
});

withDemo('rule 11: « Mes commandes » and the order page serve the simulated orders; abandoning one removes it; nothing reaches the staff list', async ({ call }) => {
  const placed = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 2 }], payment: 'note' });
  const id = placed.body.data.orderId;
  const list = await call('GET', `${API}/orders`);
  assert.equal(list.body.data.orders.length, 1);
  assert.equal(list.body.data.orders[0].demo, true);
  assert.equal(list.body.data.orders[0].lines[0].label, '2 × Cidre démo');
  assert.equal(list.body.data.orders[0].totalLabel, '12 €');
  const one = await call('GET', `${API}/orders/${id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.data.demo, true);
  assert.equal(one.body.data.status, 'confirmed');
  const staff = await call('GET', '/api/guest-app/orders?all=1');
  assert.equal(staff.status, 200);
  assert.equal(JSON.stringify(staff.body).includes('Cidre démo'), false, 'never on « Commandes clients »');
  const gone = await call('POST', `${API}/orders/${id}/abandon`);
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.body.data.cartLines, [{ kind: 'option', id: CIDER, quantity: 2 }], 'the lines go back in the cart');
  assert.equal((await call('GET', `${API}/orders/${id}`)).status, 404);
  assert.equal((await call('GET', `${API}/orders`)).body.data.orders.length, 0);
});

withDemo('rule 11: the orders are the session’s own — another phone sees none, and cannot read this one’s', async ({ call, link }) => {
  const placed = await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' });
  const second = await call('POST', `${API}/sessions/demo`, { demoToken: link.token }, { cookie: null });
  const cookie = second.setCookie.split(';')[0];
  assert.equal((await call('GET', `${API}/orders`, undefined, { cookie })).body.data.orders.length, 0);
  assert.equal((await call('GET', `${API}/orders/${placed.body.data.orderId}`, undefined, { cookie })).status, 404);
});

withDemo('rule 11: a replayed Idempotency-Key answers the first simulated order again, not a second one', async ({ base, cookies, call }) => {
  const send = () => fetch(`${base}${API}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: cookies.value, 'Idempotency-Key': 'demo-key-0001' },
    body: JSON.stringify({ lines: [{ kind: 'option', id: CIDER, quantity: 1 }], payment: 'note' }),
  }).then((res) => res.json());
  const first = await send();
  const second = await send();
  assert.equal(second.data.orderId, first.data.orderId);
  assert.equal((await call('GET', `${API}/orders`)).body.data.orders.length, 1);
});

test('rule 11: the store keeps at most 20 orders per session (the oldest goes), drops with its session, and bounds its sessions', () => {
  const store = createDemoOrders({ cap: 20, maxSessions: 3 });
  for (let i = 0; i < 25; i += 1) store.add(1, { total: i });
  const kept = store.list(1);
  assert.equal(kept.length, 20);
  assert.equal(kept[0].total, 24, 'newest first');
  assert.equal(kept[19].total, 5, 'the five oldest went');
  assert.equal(store.list(2).length, 0, 'another session sees none');
  store.drop(1);
  assert.equal(store.list(1).length, 0);
  [10, 11, 12, 13].forEach((sessionId) => store.add(sessionId, { total: 1 }));
  assert.equal(store.list(10).length, 0, 'the least recently used session was dropped');
  assert.equal(store.list(13).length, 1);
});

withDemo('rule 11: 21 simulated orders through the route leave 20 in « Mes commandes »', async ({ call }) => {
  for (let i = 0; i < 21; i += 1) {
    assert.equal((await call('POST', `${API}/orders`, { lines: [{ kind: 'option', id: PLATTER, quantity: 1 }], payment: 'none' })).status, 200);
  }
  assert.equal((await call('GET', `${API}/orders`)).body.data.orders.length, 20);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 3.C — gate, lights, push, guard

function gateLive() {
  registry.ensure('gate-access');
}

withDemo('rule 12: on a demo stay session the gate tile is `demo` with the keypad code, and the key is never read', async ({ call, gateReads }) => {
  gateLive();
  const data = await me(call);
  const tile = data.tiles.find((t) => t.key === 'gate');
  assert.ok(tile, 'the Portail tile is shown');
  assert.deepEqual([tile.state, tile.code, tile.url], ['demo', DEMO_GATE_CODE, undefined]);
  const read = await call('GET', `${API}/gate`);
  assert.deepEqual(read.body.data, { state: 'demo', code: '1234' });
  assert.deepEqual(gateReads, [], 'keyUrlOf’s reader is never called for a demo session');
});

withDemo('rule 12: before the arrival and after the departure there is no gate, as for a real stay', async ({ call, switchTo, gateReads }) => {
  gateLive();
  await switchTo(1, 'preArrival');
  const early = (await me(call)).tiles.find((t) => t.key === 'gate');
  assert.ok(!early || early.state === 'outside', 'no key before the arrival');
  assert.notEqual((await call('GET', `${API}/gate`)).body.data?.state, 'demo');
  await switchTo(1, 'ended');
  assert.notEqual((await call('GET', `${API}/gate`)).body.data?.state, 'demo');
  assert.deepEqual(gateReads, []);
});

test('rule 12: gateState never calls the reader for a demo session', () => {
  let called = false;
  const reader = () => { called = true; return 'https://portail.example.test/k'; };
  assert.deepEqual(gateState({ mode: 'stay', reservationId: null, demo: true }, reader), { state: 'demo', code: '1234' });
  assert.deepEqual(gateState({ mode: 'preArrival', reservationId: null, demo: true }, reader), { state: 'outside' });
  assert.equal(called, false);
});

function houseAt(clock) {
  const home = fakeHome();
  home.state.readings = readingsAt(clock.now);
  home.state.lastPollAt = new Date(clock.now.getTime() - 60 * 1000).toISOString();
  return home;
}

test('rule 13: a light command is accepted, done after about a second with the switched state, and never reaches the house', async () => {
  const house = houseAt({ now: new Date() });
  const ctx = await openDemo({ house });
  try {
    createLodgingsModel(db).save(1, { enabled: true, modules: readModules(null).map((m) => (m.key === 'home' ? { ...m, on: true } : m)) });
    assert.equal((await ctx.call('PUT', '/api/guest-app/lodgings/1/home', { blocks: GRANJA_BLOCKS })).status, 200);
    const page = (await ctx.call('GET', `${API}/home`)).body.data;
    const light = page.blocks.find((b) => b.kind === 'lights').items.find((i) => i.pilotable);
    assert.equal(light.on, false, 'the house reads « off »');
    const queued = await ctx.call('POST', `${API}/home/lights/${light.id}`, { on: true });
    assert.equal(queued.status, 202, JSON.stringify(queued.body));
    assert.equal(queued.body.data.state, 'pending');
    assert.equal(queued.body.data.on, true);
    assert.deepEqual(house.state.commands, [], 'the house’s queue is untouched');
    const early = await ctx.call('GET', `${API}/home/commands/${queued.body.data.id}`);
    assert.equal(early.body.data.state, 'pending');
    ctx.clock.now = new Date(ctx.clock.now.getTime() + 1100);
    const done = await ctx.call('GET', `${API}/home/commands/${queued.body.data.id}`);
    assert.deepEqual([done.body.data.state, done.body.data.on], ['done', true]);
    const after = (await ctx.call('GET', `${API}/home`)).body.data.blocks.find((b) => b.kind === 'lights').items.find((i) => i.pilotable);
    assert.equal(after.on, true, 'the page shows the simulated state; the readings stay the house’s');
    assert.deepEqual(house.state.commands, []);
    assert.equal((await ctx.call('GET', `${API}/home/commands/demo-999`)).status, 404);
  } finally {
    await ctx.close();
  }
});

test('rule 13: the simulated commands are per session and settle after the delay only', () => {
  const clock = { now: new Date() };
  const store = createDemoCommands({ now: () => clock.now, settleMs: 1000 });
  const queued = store.queue(1, { equipmentId: 'l-chene', value: 'on' });
  assert.equal(queued.state, 'pending');
  assert.deepEqual(store.settled(1), []);
  clock.now = new Date(clock.now.getTime() + 1000);
  assert.equal(store.read(1, queued.id).state, 'done');
  assert.deepEqual(store.settled(1), [{ equipmentId: 'l-chene', value: 'on' }]);
  assert.equal(store.read(2, queued.id), null, 'another session never reads it');
});

test('rule 14: the guest API has no push subscription route a demo session could reach, and no demo order pushes (rule 10)', async () => {
  const ctx = await openDemo();
  try {
    const paths = ctx.api.publicRouter.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
    assert.equal(paths.filter((p) => /push|subscri/i.test(p)).length, 0);
  } finally {
    await ctx.close();
  }
});

test('rule 15: every write route of the guest API is accounted for — a new one must decide what a demo session does', async () => {
  const ctx = await openDemo();
  try {
    const writes = ctx.api.publicRouter.stack.filter((layer) => layer.route && (layer.route.methods.post || layer.route.methods.put || layer.route.methods.delete))
      .map((layer) => `${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`).sort();
    assert.deepEqual(writes, [
      'POST /home/lights/:lightId', // simulated for a demo session (rule 13)
      'POST /orders', // simulated (rule 10)
      'POST /orders/:id/abandon', // served from the store (rule 11)
      'POST /orders/quote', // read-only: priced inside a rolled-back transaction
      'POST /sessions', // opens a session
      'POST /sessions/demo', // opens a demo session
      'POST /sessions/demo/switch', // demo only (rule 7)
      'POST /sessions/lookup', // opens a session
      'POST /shop/delivery-slots', // read-only
    ].sort());
  } finally {
    await ctx.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// 3.D — the screens: language, and the data model (§5)

withDemo('rule 18: the refusals of the demo follow the guest’s language', async ({ call, switchTo }) => {
  const en = await call('POST', `${API}/sessions/demo/switch?lang=en`, { propertyId: 99, moment: 'stay' });
  assert.equal(en.status, 400);
  assert.equal(en.body.error.message, 'Choose a lodging and a moment of the stay.');
  assert.ok(await switchTo(1, 'stay'));
});

test('rule 6: the migration rebuilds guest_sessions keeping its rows, accepts origin demo and adds the two columns; it runs twice without harm', () => {
  const Database = require('better-sqlite3');
  const old = new Database(':memory:');
  MIGRATIONS.filter((m) => m.name !== 'guest_app_demo_mode_v7' && m.name !== 'guest_orders_counter_floor_v5').forEach((m) => m.up(old));
  old.prepare(`INSERT INTO guest_sessions (tokenHash, propertyId, reservationId, mode, origin, stayLinkId, createdAt, lastSeenAt, expiresAt)
    VALUES ('h1', 1, 7, 'stay', 'link', 3, 'c', 'l', 'e')`).run();
  assert.throws(() => old.prepare(`INSERT INTO guest_sessions (tokenHash, propertyId, mode, origin, createdAt, lastSeenAt, expiresAt)
    VALUES ('h2', 1, 'stay', 'demo', 'c', 'l', 'e')`).run(), /CHECK/);
  const demo = MIGRATIONS.find((m) => m.name === 'guest_app_demo_mode_v7');
  demo.up(old);
  demo.up(old);
  const kept = old.prepare('SELECT * FROM guest_sessions').all();
  assert.equal(kept.length, 1);
  assert.deepEqual([kept[0].tokenHash, kept[0].reservationId, kept[0].origin, kept[0].stayLinkId, kept[0].demoLinkId, kept[0].demoMoment], ['h1', 7, 'link', 3, null, null]);
  old.prepare(`INSERT INTO guest_sessions (tokenHash, propertyId, mode, origin, demoLinkId, demoMoment, createdAt, lastSeenAt, expiresAt)
    VALUES ('h3', 1, 'stay', 'demo', 1, 'stay', 'c', 'l', 'e')`).run();
  assert.throws(() => old.prepare(`INSERT INTO guest_sessions (tokenHash, propertyId, mode, origin, demoMoment, createdAt, lastSeenAt, expiresAt)
    VALUES ('h4', 1, 'stay', 'demo', 'someday', 'c', 'l', 'e')`).run(), /CHECK/);
  assert.ok(old.prepare("SELECT 1 FROM sqlite_master WHERE name = 'idx_guest_sessions_expiry'").get(), 'the expiry index is back');
  assert.ok(old.prepare("SELECT 1 FROM sqlite_master WHERE name = 'guest_demo_links'").get());
});

test('rule 1: the demo link keeps its token encrypted and only its hash searchable; a token that no longer decrypts is replaced', () => {
  const links = createDemoLinkModel(db);
  db.prepare('DELETE FROM guest_demo_links').run();
  const at = new Date();
  const link = links.ensure(at);
  const row = db.prepare('SELECT * FROM guest_demo_links').get();
  assert.notEqual(row.tokenEncrypted, link.token);
  assert.equal(row.tokenHash, createDemoLinkModel.hashToken(link.token));
  assert.deepEqual(links.findLiveByToken(link.token), { id: link.id });
  assert.equal(links.findLiveByToken(`${link.token}x`), null);
  db.prepare('UPDATE guest_demo_links SET tokenEncrypted = ?').run('enc:v1:AAAA:BBBB:CCCC');
  const replaced = links.ensure(at);
  assert.notEqual(replaced.token, link.token);
  assert.equal(links.isLive(link.id), false);
  assert.equal(links.isLive(replaced.id), true);
});
