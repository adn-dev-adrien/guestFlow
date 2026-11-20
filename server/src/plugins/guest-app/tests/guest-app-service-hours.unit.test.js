// specs/guest-app.md rules 39-42 — the service hours: weekly ranges, exceptions and all-properties closures (40), the
// admin routes that store them, delivery times whose preparation lies after now inside one range between check-in and
// check-out (41), the next opening and its banner, « Plus disponible pour votre séjour » (42). The clock is injected;
// the dates the admin PUT stores are taken from today, the date window judges them.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addOption, addStay, enable, freshDb, latestStayToken, livePlugins, openService, paris, sell, startApi,
} = require('./guestAppFixtures');
const {
  deliveryPicker, deliveryTimes, ignitionInHours, nextOpening, rangesOn, serviceState, wallClock,
} = require('../serviceHours');
const createServiceHoursModel = require('../models/serviceHoursModel');
const { todayIso } = require('../../../utils/localDate');
const { addDaysToIsoDate } = require('../../../utils/devisHelpers');

const range = (from, to) => ({ from, to });
const WEEK = Object.freeze({ 0: [range('09:00', '12:00')], 1: [], 2: [range('08:00', '12:00'), range('16:00', '20:00')], 3: [range('08:00', '12:00'), range('16:00', '20:00')], 4: [range('08:00', '12:00'), range('16:00', '20:00')], 5: [range('08:00', '12:00'), range('16:00', '20:00')], 6: [range('08:00', '12:00'), range('16:00', '20:00')] });
// 2099-07-06 is a Monday (closed), the stay runs Mon 16:00 → Thu 10:00.
const STAY = Object.freeze({ startDate: '2099-07-06', endDate: '2099-07-09', checkInTime: '16:00', checkOutTime: '10:00' });
const schedule = (over = {}) => ({ weekly: WEEK, exceptions: [], closures: [], ...over });
const at = (date, time) => wallClock(paris(date, time));
const times = (list) => list.map((t) => `${t.date} ${String(Math.floor(t.minutes / 60)).padStart(2, '0')}:${String(t.minutes % 60).padStart(2, '0')}`);

test('rule 40: a date’s ranges — the week, an exception (closed or its own ranges), an all-properties closure', () => {
  assert.deepEqual(rangesOn('2099-07-07', schedule()), [{ from: 480, to: 720 }, { from: 960, to: 1200 }]);
  assert.deepEqual(rangesOn('2099-07-06', schedule()), [], 'Monday: no range');
  const exceptions = [{ date: '2099-07-07', closed: true }, { date: '2099-07-08', closed: false, ranges: [range('10:00', '11:00')] }];
  assert.deepEqual(rangesOn('2099-07-07', schedule({ exceptions })), []);
  assert.deepEqual(rangesOn('2099-07-08', schedule({ exceptions })), [{ from: 600, to: 660 }]);
  const closures = [{ startDate: '2099-07-07', endDate: '2099-07-09' }];
  assert.deepEqual(rangesOn('2099-07-08', schedule({ exceptions, closures })), [], 'a closure wins over an exception');
  assert.equal(rangesOn('2099-07-09', schedule({ closures })).length, 2, 'its end date is the morning after its last night');
});

test('rule 40: the model — shared hours by default, a lodging’s own when it has some, all-properties closures only', () => {
  const db = freshDb();
  const model = createServiceHoursModel(db);
  openService(db, [['08:00', '12:00']]);
  db.prepare("INSERT INTO establishment_closures (propertyId, startDate, endDate) VALUES (NULL, '2099-08-01', '2099-08-15'), (2, '2099-09-01', '2099-09-05')").run();
  const shared = model.scheduleFor(2, { from: '2099-07-01' });
  assert.deepEqual(shared.weekly[3], [range('08:00', '12:00')]);
  assert.deepEqual(shared.closures, [{ startDate: '2099-08-01', endDate: '2099-08-15' }], 'a closure of one lodging closes its stays, not the service');
  model.save(2, { weekly: { 3: [range('17:00', '19:00')] }, exceptions: [{ date: '2099-07-14', closed: true }] });
  assert.deepEqual(model.scheduleFor(2, { from: '2099-07-01' }).weekly[3], [range('17:00', '19:00')]);
  assert.deepEqual(model.scheduleFor(2, { from: '2099-07-01' }).weekly[4], [], 'its own hours, whole: no shared Thursday');
  assert.deepEqual(model.scheduleFor(1, { from: '2099-07-01' }).weekly[3], [range('08:00', '12:00')], 'the other lodging keeps the shared ones');
  assert.equal(model.read(2).shared, false);
  model.save(2, { weekly: {}, exceptions: [] });
  assert.equal(model.read(2).shared, true, 'saved empty: back to the shared hours');
});

test('rule 40: nothing stored yet → unconstrained; once a range or an exception exists, a day without a range is closed', () => {
  const db = freshDb();
  const model = createServiceHoursModel(db);
  assert.equal(model.isConfigured(), false);
  assert.equal(model.scheduleFor(1, { from: '2099-07-01' }).unconstrained, true);
  db.prepare("INSERT INTO guest_app_service_exceptions (date, propertyId, closed) VALUES ('2099-07-14', NULL, 1)").run();
  assert.equal(model.isConfigured(), true);
  const configured = model.scheduleFor(1, { from: '2099-07-01' });
  assert.equal(configured.unconstrained, false, 'one exception alone is a configuration');
  assert.equal(serviceState({ now: paris('2099-07-07', '10:00'), stay: STAY, schedule: configured, lang: 'fr' }).openNow, false);
  const own = createServiceHoursModel(freshDb());
  own.save(2, { weekly: { 3: [range('17:00', '19:00')] }, exceptions: [] });
  assert.equal(own.scheduleFor(2, { from: '2099-07-01' }).unconstrained, false);
  assert.equal(own.scheduleFor(1, { from: '2099-07-01' }).unconstrained, false, 'rule 41: something is stored — the other lodging’s days without a range are closed');
});

test('rules 40-41: an exception stored for one lodging alone keeps the shared week — its date replaces the shared one', () => {
  const db = freshDb();
  const model = createServiceHoursModel(db);
  openService(db, [['08:00', '12:00']]);
  db.prepare("INSERT INTO guest_app_service_exceptions (date, propertyId, closed) VALUES ('2099-07-14', NULL, 1), ('2099-07-15', NULL, 1)").run();
  model.save(2, { weekly: {}, exceptions: [{ date: '2099-07-14', closed: false, ranges: [range('10:00', '11:00')] }] });
  const schedule2 = model.scheduleFor(2, { from: '2099-07-01' });
  assert.deepEqual(schedule2.weekly[3], [range('08:00', '12:00')], 'the shared week stays');
  assert.deepEqual(rangesOn('2099-07-14', schedule2), [{ from: 600, to: 660 }], 'its own date wins');
  assert.deepEqual(rangesOn('2099-07-15', schedule2), [], 'the shared exception still applies');
  assert.deepEqual(rangesOn('2099-07-14', model.scheduleFor(1, { from: '2099-07-01' })), [], 'the other lodging follows the shared exception');
});

test('rules 31, 41-42: unconstrained — every ignition allowed, delivery from now + lead to the check-out, open, no banner', () => {
  const free = { unconstrained: true, weekly: {}, exceptions: [], closures: [] };
  assert.equal(ignitionInHours(free)({ date: '2099-07-07', time: '03:00' }), true);
  const list = times(deliveryTimes({ now: paris('2099-07-08', '23:10'), stay: STAY, leadMinutes: 45, schedule: free }));
  assert.deepEqual(list.slice(0, 3), ['2099-07-09 00:00', '2099-07-09 00:30', '2099-07-09 01:00'], '23:10 + 45 min, across midnight');
  assert.equal(list[list.length - 1], '2099-07-09 09:30', 'strictly before the check-out');
  assert.equal(times(deliveryTimes({ now: paris('2099-07-01', '09:00'), stay: STAY, leadMinutes: 30, schedule: free }))[0], '2099-07-06 16:00', 'from the check-in');
  assert.deepEqual(serviceState({ now: paris('2099-07-07', '03:00'), stay: STAY, schedule: free, lang: 'fr' }), { openNow: true });
  assert.equal(deliveryPicker({ now: paris('2099-07-07', '03:00'), stay: STAY, leadMinutes: 30, schedule: free, lang: 'fr' }).asap.label, 'Dès que possible — vers 3 h 30');
});

test('rule 40: the setup status asks for the service hours while none is stored', () => {
  const registry = require('../../sdk/registry');
  const { createContext } = require('../../sdk/createContext');
  registry.reset();
  const db = freshDb();
  try {
    require('..').register(createContext('guest-app', { db, settingsModel: () => ({ get: () => 'app.example.test' }) }));
    const status = registry.get('guest-app').setupStatus;
    assert.equal(status(), 'horaires du service à configurer');
    openService(db);
    assert.equal(status(), null);
  } finally {
    registry.reset();
  }
});

test('rule 41: delivery times — 30-min steps, the lead inside ONE range, after now, from the check-in to the check-out', () => {
  const now = paris('2099-07-06', '09:00');
  const list = times(deliveryTimes({ now, stay: STAY, leadMinutes: 60, schedule: schedule() }));
  assert.equal(list[0], '2099-07-07 09:00', 'Monday closed; Tuesday from 08:00 + 1 h of preparation');
  assert.ok(list.includes('2099-07-07 12:00'), 'ready as the morning range closes');
  assert.ok(!list.includes('2099-07-07 12:30') && !list.includes('2099-07-07 16:30'), 'a preparation never spans the break');
  assert.ok(list.includes('2099-07-07 17:00') && list.includes('2099-07-07 20:00'));
  assert.equal(list[list.length - 1], '2099-07-09 09:30', 'strictly before the check-out: 10:00 is not a delivery time');
  const arrival = times(deliveryTimes({ now, stay: { ...STAY, startDate: '2099-07-07' }, leadMinutes: 30, schedule: schedule() }));
  assert.equal(arrival[0], '2099-07-07 16:30', 'not before the check-in, and prepared inside the afternoon range');
  const later = times(deliveryTimes({ now: paris('2099-07-07', '17:10'), stay: STAY, leadMinutes: 30, schedule: schedule() }));
  assert.equal(later[0], '2099-07-07 18:00', '17:10 + 30 min, on the next half hour');
  assert.deepEqual(deliveryTimes({ now, stay: STAY, leadMinutes: 300, schedule: schedule() }), [], 'a lead longer than every range');
});

test('rule 42: the next opening, and the banner that says when the service resumes', () => {
  assert.deepEqual(nextOpening(at('2099-07-07', '21:00'), schedule()), { date: '2099-07-08', minutes: 480 });
  assert.deepEqual(nextOpening(at('2099-07-07', '10:00'), schedule()), { date: '2099-07-07', minutes: 600 }, 'open now: now');
  assert.deepEqual(serviceState({ now: paris('2099-07-07', '10:00'), stay: STAY, schedule: schedule(), lang: 'fr' }), { openNow: true });
  assert.deepEqual(serviceState({ now: paris('2099-07-07', '21:00'), stay: STAY, schedule: schedule(), lang: 'fr' }), {
    openNow: false,
    nextOpening: '2099-07-08T08:00:00+02:00',
    bannerLabel: 'Le service reprend demain à 8 h — vous pouvez commander dès maintenant pour plus tard',
  });
  assert.equal(serviceState({ now: paris('2099-07-07', '13:00'), stay: STAY, schedule: schedule(), lang: 'fr' }).bannerLabel,
    'Le service reprend à 16 h — vous pouvez commander dès maintenant pour plus tard');
  assert.equal(serviceState({ now: paris('2099-07-07', '21:00'), stay: STAY, schedule: schedule(), lang: 'en' }).bannerLabel,
    'Service resumes tomorrow at 8:00 — you can order now for later');
  const sunday = { ...STAY, startDate: '2099-07-04', endDate: '2099-07-07', checkOutTime: '18:00' };
  assert.equal(serviceState({ now: paris('2099-07-04', '20:00'), stay: sunday, schedule: schedule(), lang: 'fr' }).bannerLabel,
    'Le service reprend demain à 9 h — vous pouvez commander dès maintenant pour plus tard', 'Saturday 20:00, Sunday opens at 09:00');
  assert.equal(serviceState({ now: paris('2099-07-05', '13:00'), stay: sunday, schedule: schedule(), lang: 'fr' }).bannerLabel,
    'Le service reprend mar. 7 juil. à 8 h — vous pouvez commander dès maintenant pour plus tard', 'Monday closed');
  const closures = [{ startDate: '2099-07-08', endDate: '2099-07-20' }];
  assert.deepEqual(serviceState({ now: paris('2099-07-07', '21:00'), stay: STAY, schedule: schedule({ closures }), lang: 'fr' }),
    { openNow: false, bannerLabel: 'Le service est fermé jusqu’à votre départ' });
});

test('rules 41-42: the picker — « Dès que possible » on the first time while open, grouped by day with their labels', () => {
  const open = deliveryPicker({ now: paris('2099-07-07', '10:00'), stay: STAY, leadMinutes: 30, schedule: schedule(), lang: 'fr' });
  assert.deepEqual(open.asap, { at: '2099-07-07T10:30:00+02:00', label: 'Dès que possible — vers 10 h 30' });
  assert.deepEqual(open.days.map((d) => d.label), ['lun. 6 juil.', 'Aujourd’hui', 'Demain', 'jeu. 9 juil.'], 'every day of the stay (rule 77), arrival day greyed once past');
  assert.deepEqual(open.days.map((d) => d.available), [false, true, true, true]);
  assert.deepEqual(open.days.filter((d) => d.available)[0].times[0], { at: '2099-07-07T10:30:00+02:00', label: '10 h 30' });
  assert.equal(open.days.filter((d) => d.available)[0].times[3].label, '12 h');
  const closed = deliveryPicker({ now: paris('2099-07-07', '21:00'), stay: STAY, leadMinutes: 30, schedule: schedule(), lang: 'en' });
  assert.equal(closed.asap, null, 'closed now: the picker starts at the next opening, the banner explains');
  assert.equal(closed.days.find((d) => d.available).label, 'Tomorrow');
  assert.deepEqual(closed.days.filter((d) => d.available)[0].times[0], { at: '2099-07-08T08:30:00+02:00', label: '8:30' });
});

test('rule 31: an ignition is in the hours from the range’s start to its end, both included', () => {
  const inHours = ignitionInHours(schedule());
  assert.equal(inHours({ date: '2099-07-07', time: '08:00' }), true);
  assert.equal(inHours({ date: '2099-07-07', time: '12:00' }), true);
  assert.equal(inHours({ date: '2099-07-07', time: '14:00' }), false);
  assert.equal(inHours({ date: '2099-07-06', time: '10:00' }), false, 'Monday');
});

function withApi(name, fn) {
  test(name, async () => {
    const teardown = livePlugins();
    const db = freshDb();
    const ctx = await startApi(db);
    try {
      await fn({ db, ...ctx });
    } finally {
      await ctx.close();
      teardown();
    }
  });
}

const inDays = (days) => addDaysToIsoDate(todayIso(), days);

withApi('rule 40: GET/PUT /api/guest-app/service-hours — the shared hours, a lodging’s own, exceptions', async ({ call }) => {
  const empty = await call('GET', '/api/guest-app/service-hours');
  assert.deepEqual(empty.body, { propertyId: null, shared: true, weekly: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }, exceptions: [] });
  const holiday = inDays(20);
  const special = inDays(21);
  const body = {
    weekly: { 2: [range('16:00', '20:00'), range('08:00', '12:00')] },
    exceptions: [{ date: holiday, closed: true }, { date: special, ranges: [range('10:00', '11:00')] }],
  };
  const saved = await call('PUT', '/api/guest-app/service-hours', body);
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.weekly[2], [range('08:00', '12:00'), range('16:00', '20:00')], 'stored in time order');
  assert.deepEqual(saved.body.exceptions, [{ date: holiday, closed: true }, { date: special, closed: false, ranges: [range('10:00', '11:00')] }]);
  const estiva = await call('GET', '/api/guest-app/service-hours?propertyId=2');
  assert.equal(estiva.body.shared, true);
  assert.deepEqual(estiva.body.weekly[2], saved.body.weekly[2], 'a lodging follows the shared hours by default');
  const own = await call('PUT', '/api/guest-app/service-hours?propertyId=2', { weekly: { 5: [range('18:00', '19:00')] }, exceptions: [] });
  assert.equal(own.body.shared, false);
  assert.deepEqual(own.body.weekly[2], []);
  assert.deepEqual((await call('GET', '/api/guest-app/service-hours')).body.weekly[2], saved.body.weekly[2], 'the shared hours unchanged');
  assert.equal((await call('GET', '/api/guest-app/service-hours?propertyId=9')).status, 404);
  assert.equal((await call('GET', '/api/guest-app/service-hours?propertyId=x')).status, 400);
});

withApi('rule 40: the PUT refuses what the service hours cannot be, in French', async ({ call }) => {
  const put = (body) => call('PUT', '/api/guest-app/service-hours', body);
  const refused = [
    [{ weekly: { 1: [range('08:00', '09:00'), range('10:00', '11:00'), range('12:00', '13:00'), range('14:00', '15:00')] }, exceptions: [] }, /3 plages au plus le lundi/],
    [{ weekly: { 1: [range('8:00', '09:00')] }, exceptions: [] }, /s’écrit HH:MM/],
    [{ weekly: { 1: [range('12:00', '09:00')] }, exceptions: [] }, /commence avant de finir/],
    [{ weekly: { 1: [range('08:00', '12:00'), range('11:00', '13:00')] }, exceptions: [] }, /se chevauchent/],
    [{ weekly: { 7: [] }, exceptions: [] }, /de 0 \(dimanche\) à 6 \(samedi\)/],
    [{ weekly: {} }, /liste de dates/],
    [{ weekly: {}, exceptions: [{ date: inDays(3), closed: true, ranges: [] }] }, /pas les deux/],
    [{ weekly: {}, exceptions: [{ date: inDays(3) }] }, /fermé ou a ses horaires/],
    [{ weekly: {}, exceptions: [{ date: inDays(3), closed: true }, { date: inDays(3), closed: true }] }, /deux exceptions/],
    [{ weekly: {}, exceptions: [{ date: inDays(365 * 6), closed: true }] }, /trop lointaine/],
    [{ weekly: {}, exceptions: [], extra: 1 }, /Requête invalide/],
  ];
  for (const [body, message] of refused) {
    // eslint-disable-next-line no-await-in-loop
    const res = await put(body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.error, message);
  }
  assert.equal((await put({ weekly: { 1: [range('08:00', '12:00'), range('12:00', '13:00')] }, exceptions: [] })).status, 200, 'touching ranges do not overlap');
});

test('rules 40-41: the service hours are the admin’s, a restricted role is refused', () => {
  const enforceRoleAccess = require('../../../middleware/enforceRoleAccess');
  ['reception', 'accountant'].forEach((role) => {
    ['GET', 'PUT'].forEach((method) => {
      const res = { code: null, status(code) { this.code = code; return this; }, json() { return this; } };
      let passed = false;
      enforceRoleAccess({ user: { roles: [role] }, method, path: '/guest-app/service-hours' }, res, () => { passed = true; });
      assert.equal(passed, false, `${role} ${method}`);
      assert.equal(res.code, 403, `${role} ${method}`);
    });
  });
});

/** A session on the stay, its cookie. */
async function scan(api, db, call) {
  enable(api, db);
  return (await call('POST', '/public/v1/guest/sessions', { stayToken: latestStayToken(db) })).setCookie.split(';')[0];
}

withApi('rule 42: the shop’s service banner, and « Plus disponible pour votre séjour » once no delivery time is left', async ({ db, api, call, clock }) => {
  addStay(db);
  addOption(db, { id: 1, title: 'Planche apéro', category: 'Restauration' });
  addOption(db, { id: 2, title: 'Cidre', category: 'Boissons' });
  addOption(db, { id: 3, title: 'Fagot de bois' });
  sell(db, 'option', 1, { needsStaff: 1 });
  sell(db, 'option', 2, { needsStaff: 1 });
  sell(db, 'option', 3);
  db.prepare('UPDATE guest_app_items SET leadMinutes = 180 WHERE itemId = 1').run();
  openService(db, [['08:00', '12:00']]);
  clock.now = paris('2099-07-08', '21:00');
  const cookie = await scan(api, db, call);
  const shop = (await call('GET', '/public/v1/guest/shop', null, { cookie })).body.data;
  assert.deepEqual(shop.service, {
    openNow: false,
    nextOpening: '2099-07-09T08:00:00+02:00',
    bannerLabel: 'Le service reprend demain à 8 h — vous pouvez commander dès maintenant pour plus tard',
  });
  const item = (id) => shop.categories.flatMap((c) => c.items).find((i) => i.id === id);
  assert.equal(item(1).unavailableReason, 'Plus disponible pour votre séjour', 'ready at 11:00 at the earliest, the check-out is 10:00');
  assert.equal(item(2).unavailableReason, undefined, 'ready from 08:30 on the last morning');
  assert.equal(item(3).unavailableReason, undefined, 'self-service: no delivery time');
  const en = (await call('GET', '/public/v1/guest/shop?lang=en', null, { cookie })).body.data;
  assert.equal(en.categories.flatMap((c) => c.items).find((i) => i.id === 1).unavailableReason, 'No longer available for your stay');
  clock.now = paris('2099-07-08', '09:00');
  assert.deepEqual((await call('GET', '/public/v1/guest/shop', null, { cookie })).body.data.service, { openNow: true });
  db.exec('DELETE FROM guest_app_service_hours');
  clock.now = paris('2099-07-08', '21:00');
  const unset = (await call('GET', '/public/v1/guest/shop', null, { cookie })).body.data;
  assert.deepEqual(unset.service, { openNow: true }, 'no hours set: unconstrained, no banner');
  assert.equal(unset.categories.flatMap((c) => c.items).find((i) => i.id === 1).unavailableReason, undefined, '21:00 + 3 h, before the check-out');
});

withApi('rule 41: POST /shop/delivery-slots — the longest lead of the cart’s staff items; a cart without one needs none', async ({ db, api, call, clock }) => {
  addStay(db);
  addOption(db, { id: 1, title: 'Planche apéro' });
  addOption(db, { id: 2, title: 'Cidre' });
  addOption(db, { id: 3, title: 'Fagot de bois' });
  sell(db, 'option', 1, { needsStaff: 1 });
  sell(db, 'option', 2, { needsStaff: 1 });
  sell(db, 'option', 3);
  db.prepare('UPDATE guest_app_items SET leadMinutes = 90 WHERE itemId = 1').run();
  openService(db, [['08:00', '12:00'], ['16:00', '20:00']]);
  clock.now = paris('2099-07-07', '16:10');
  const cookie = await scan(api, db, call);
  const post = async (lines) => (await call('POST', '/public/v1/guest/shop/delivery-slots', { lines }, { cookie })).body.data;
  const drinks = await post([{ kind: 'option', id: 2, quantity: 2 }]);
  assert.deepEqual(drinks.asap, { at: '2099-07-07T17:00:00+02:00', label: 'Dès que possible — vers 17 h' });
  const both = await post([{ kind: 'option', id: 2 }, { kind: 'option', id: 1 }, { kind: 'option', id: 3 }]);
  assert.equal(both.asap.label, 'Dès que possible — vers 18 h', '16:10 + 1 h 30');
  assert.deepEqual(both.days.map((d) => d.label), ['lun. 6 juil.', 'Aujourd’hui', 'Demain', 'jeu. 9 juil.'], 'every day of the stay (rule 77)');
  assert.equal(both.bannerLabel, undefined);
  assert.deepEqual(await post([{ kind: 'option', id: 3 }, { kind: 'option', id: 99 }]), {
    needed: false, asap: null, days: [], mode: 'delivery', question: 'Quand souhaitez-vous la recevoir ?',
  });
  clock.now = paris('2099-07-07', '21:00');
  const evening = await post([{ kind: 'option', id: 2 }]);
  assert.equal(evening.asap, null);
  assert.equal(evening.days.filter((d) => d.available)[0].times[0].label, '8 h 30');
  assert.equal(evening.bannerLabel, 'Le service reprend demain à 8 h — vous pouvez commander dès maintenant pour plus tard');
});

withApi('rule 27bis: the breakfast sheet asks its own times — alone, its lead; beside other staff items, the cart time is theirs', async ({ db, api, call, clock }) => {
  addStay(db);
  addOption(db, { id: 1, title: 'Petit déjeuner', priceType: 'per_person_per_night', price: 12, autoOptionType: 'breakfast' });
  addOption(db, { id: 2, title: 'Cidre' });
  sell(db, 'option', 1, { needsStaff: 1 });
  sell(db, 'option', 2, { needsStaff: 1 });
  db.prepare('UPDATE guest_app_items SET leadMinutes = 60 WHERE itemId = 1').run();
  openService(db, [['07:00', '12:00'], ['16:00', '20:00']]);
  clock.now = paris('2099-07-07', '21:00');
  const cookie = await scan(api, db, call);
  const post = async (lines) => (await call('POST', '/public/v1/guest/shop/delivery-slots', { lines }, { cookie })).body.data;
  const alone = await post([{ kind: 'breakfast', id: 1 }]);
  assert.equal(alone.needed, true);
  assert.equal(alone.days.filter((d) => d.available)[0].times[0].label, '8 h', 'opening at 7 h + its own hour of preparation');
  const mixed = await post([{ kind: 'breakfast', id: 1 }, { kind: 'option', id: 2 }]);
  assert.equal(mixed.days.filter((d) => d.available)[0].times[0].label, '7 h 30', 'the cider’s 30 min, not the breakfast’s hour');
});
