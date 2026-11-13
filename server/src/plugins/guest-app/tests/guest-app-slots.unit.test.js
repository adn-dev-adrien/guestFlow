// specs/guest-app.md rules 11, 28-31, 35, §6.4 — `GET /public/v1/guest/shop/resources/:id/slots` through the real routes and
// the real scheduler of hourly-resources: only bookable slots are listed, an ignition outside the service hours makes the
// slot `staff` and unlisted, a warm slot is not constrained, a request is re-checked once a session leaves it, and an
// order awaiting payment holds its slots until `heldUntil`.
const { requirePlugins, applyPluginSchema } = require('../../sdk/testing');

if (requirePlugins(['hourly-resources'])) {
  const test = require('node:test');
  const assert = require('node:assert/strict');

  const {
    addOption, addResource, addStay, enable, freshDb, latestStayToken, livePlugins, openService, paris, sell, startApi,
  } = require('./guestAppFixtures');
  const { createScheduler } = require('../../hourly-resources/scheduler');
  const { createContext } = require('../../sdk/createContext');
  const createServiceHoursModel = require('../models/serviceHoursModel');
  const { ignitionInHours } = require('../serviceHours');
  const sdk = require('../../sdk');

  // The stay of the fixtures: 2099-07-06 16:00 → 2099-07-09 10:00, the clock at 2099-07-07 12:00.
  const BATH = 6;

  function hourlyDb() {
    const db = freshDb();
    applyPluginSchema(db, 'hourly-resources');
    ['heatUpMinutes', 'heatRetentionMinutes'].forEach((column) => db.exec(`ALTER TABLE resources ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`));
    return db;
  }

  /** The bath: 11:00-22:00, 1 h slots, 30 €/h, 50 €/h from 20:00, no reset; `thermal` adds heat-up and retention. */
  function addBath(db, over = {}) {
    addResource(db, { id: BATH, name: 'Bain nordique', lodgings: [1, 2], ...over.resource });
    db.prepare(`UPDATE resources SET openTime = '11:00', closeTime = '22:00', slotDuration = 60, minimumUsageMinutes = 60,
      showsPlanningCard = 1, hourlyEveningStart = '20:00', hourlyEveningRate = 50, heatUpMinutes = ?, heatRetentionMinutes = ? WHERE id = ?`)
      .run(over.heatUp || 0, over.retention || 0, BATH);
    sell(db, 'resource', BATH);
  }

  const sessionOf = (db, reservationId, sessions) => db.prepare(`
    INSERT INTO reservation_resources (reservationId, resourceId, quantity, priceType, sessions) VALUES (?, ?, ?, 'per_hour', ?)
  `).run(reservationId, BATH, sessions.length, JSON.stringify(sessions));

  function withSlots(name, fn, { hourly = true } = {}) {
    test(name, async () => {
      const db = hourlyDb();
      const teardown = livePlugins({ hourly, scheduler: createScheduler(db) });
      const ctx = await startApi(db);
      try {
        // The session is opened on the first read, once the test has written its stay.
        let cookie = null;
        const get = async (query = '', id = BATH) => {
          if (!cookie) enable(ctx.api, db);
          cookie = cookie || (await ctx.call('POST', '/public/v1/guest/sessions', { stayToken: latestStayToken(db) })).setCookie.split(';')[0];
          return ctx.call('GET', `/public/v1/guest/shop/resources/${id}/slots${query}`, null, { cookie });
        };
        await fn({ db, get, ...ctx });
      } finally {
        await ctx.close();
        teardown();
      }
    });
  }

  const euros = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0 }).format(n);
  const PRICE30 = euros(30);
  const PRICE50 = euros(50);
  const startsOn = (body, date) => ((body.data.days.find((d) => d.date === date) || {}).slots || []).map((s) => s.start);

  // Amended 2026-11-10 (rules 77-78, 84): every day of the stay is listed (a day with no bookable slot greyed, with its reason),
  // each slot carries its band and the price this stay pays for it.
  withSlots('rule 28, §6.4: only the bookable slots are drawn, by day; every day of the stay is listed, the empty ones greyed', async ({ db, get }) => {
    const stay = addStay(db);
    addStay(db, { propertyId: 2, reservationNumber: 'R-99-002' });
    addBath(db);
    sessionOf(db, stay + 1, [{ date: '2099-07-07', start: '15:00', end: '16:00' }]);
    db.prepare("INSERT INTO resource_bookings (resourceId, date, startTime, endTime, clientName) VALUES (?, '2099-07-08', '12:00', '13:00', 'Voisin')").run(BATH);
    const res = await get();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.days.map((d) => d.date), ['2099-07-06', '2099-07-07', '2099-07-08', '2099-07-09'], 'the stay\'s days, none outside');
    assert.deepEqual(res.body.data.days.map((d) => [d.available, d.reasonLabel]), [[false, 'Fermé'], [true, undefined], [true, undefined], [false, 'Fermé']],
      'arrival day past, departure day after the check-out: greyed with their reason');
    assert.deepEqual(startsOn(res.body, '2099-07-07'), ['12:00', '13:00', '14:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'], 'another stay’s 15:00 is not shown');
    assert.ok(!startsOn(res.body, '2099-07-08').includes('12:00'), 'an outside booking is not shown');
    const day = res.body.data.days[1];
    assert.equal(day.label, 'mar. 7 juil.');
    assert.deepEqual(day.openingBands, [{ from: '00:00', to: '11:00', open: false }, { from: '11:00', to: '22:00', open: true }, { from: '22:00', to: '24:00', open: false }]);
    assert.deepEqual(day.slots[0], { start: '12:00', end: '13:00', state: 'free', band: 'day', priceLabel: PRICE30 });
    assert.deepEqual(day.slots.find((s) => s.start === '20:00'), { start: '20:00', end: '21:00', state: 'evening', band: 'evening', priceLabel: `${PRICE50} · tarif soirée` });
    assert.ok(res.body.data.days.every((d) => d.slots.every((s) => ['free', 'evening'].includes(s.state))));
    const en = await get('?lang=en');
    assert.equal(en.body.data.days[1].slots[0].priceLabel, '€30');
    assert.deepEqual((await get('?from=2099-07-08&to=2099-07-08')).body.data.days.map((d) => d.date), ['2099-07-08']);
  });

  withSlots('rule 11: the home offers the bath with the first slot still bookable today — « aujourd’hui » before 18 h, « ce soir » after, none once the day is full', async ({ db, get, call, clock }) => {
    const stay = addStay(db);
    addBath(db);
    await get();
    const highlight = async () => (await call('GET', '/public/v1/guest/me')).body.data.highlight;
    assert.deepEqual(await highlight(), {
      key: 'bath', text: 'Un bain nordique aujourd’hui ?', detail: 'Premier créneau libre à 12 h', module: 'bath',
    });
    clock.now = paris('2099-07-07', '19:30');
    assert.deepEqual([(await highlight()).text, (await highlight()).detail], ['Un bain nordique ce soir ?', 'Premier créneau libre à 20 h']);
    sessionOf(db, stay, [{ date: '2099-07-07', start: '20:00', end: '21:00' }, { date: '2099-07-07', start: '21:00', end: '22:00' }]);
    assert.equal(await highlight(), undefined, 'no bookable slot left today');
  });

  withSlots('rule 25: the free minutes left come with the slots', async ({ db, get }) => {
    addStay(db);
    addBath(db);
    db.prepare('INSERT INTO property_resource_prices (propertyId, resourceId, price, freeMinutes) VALUES (1, ?, NULL, 60)').run(BATH);
    const { data } = (await get()).body;
    assert.equal(data.freeMinutesLeft, 60);
    assert.equal(data.freeLabel, '1 h offerte avec votre séjour');
  });

  withSlots('rule 31: an ignition outside the service hours makes the slot « staff », not listed; a warm slot is not constrained', async ({ db, get }) => {
    const stay = addStay(db);
    addStay(db, { propertyId: 2, reservationNumber: 'R-99-002' });
    addBath(db, { heatUp: 120, retention: 60 });
    openService(db, [['08:00', '12:00']]);
    sessionOf(db, stay + 1, [{ date: '2099-07-08', start: '17:00', end: '18:00' }]);
    const tomorrow = startsOn((await get()).body, '2099-07-08');
    assert.ok(tomorrow.includes('13:00'), 'lit at 11:00, inside the morning service');
    assert.ok(tomorrow.includes('14:00'), 'lit at 12:00, as the service closes');
    assert.ok(!tomorrow.includes('16:00'), 'lit at 14:00: nobody there');
    assert.ok(tomorrow.includes('18:00') && tomorrow.includes('19:00'), 'warm after the 17:00 use: no ignition');
    assert.ok(!tomorrow.includes('21:00'), 'cold again');
    assert.ok(!startsOn((await get()).body, '2099-07-07').includes('13:00'), 'heating: lit now, warm at 14:00 only');
    db.exec('DELETE FROM guest_app_service_hours');
    assert.ok(startsOn((await get()).body, '2099-07-08').includes('16:00'), 'no hours set: every ignition is allowed');
  });

  withSlots('rule 29: a slot warm only thanks to a session of the request is checked again once that session leaves it', async ({ db, clock }) => {
    addStay(db);
    addBath(db, { heatUp: 120, retention: 60 });
    openService(db, [['08:00', '12:00']]);
    const schedule = createServiceHoursModel(db).scheduleFor(1, { from: '2099-07-07' });
    const check = (sessions) => sdk.core.resourceScheduler().validateSessions({
      resourceId: BATH, propertyId: 1, stay: { startDate: '2099-07-06', endDate: '2099-07-09', checkInTime: '16:00', checkOutTime: '10:00' },
      sessions, now: clock.now, canIgnite: ignitionInHours(schedule),
    });
    const first = { date: '2099-07-08', start: '13:00', end: '14:00' };
    const second = { date: '2099-07-08', start: '15:00', end: '16:00' };
    assert.equal(check([first, second]).ok, true, 'the 15:00 bath is still warm from 14:00');
    assert.deepEqual(check([second]).results, [{ ...second, ok: false, reason: 'staff' }], 'alone it is lit at 13:00, outside the service');
  });

  withSlots('rule 35: an order awaiting payment holds its slots until heldUntil, for every stay', async ({ db, get, api, clock }) => {
    const stay = addStay(db);
    addBath(db);
    createContext('guest-app', {}).resourceHolds(api.heldSessions);
    const lines = [{ kind: 'resource', id: BATH, sessions: [{ date: '2099-07-07', start: '18:00', end: '19:00' }] }];
    db.prepare(`INSERT INTO guest_orders (reservationId, payment, status, linesJson, heldUntil, createdAt)
      VALUES (?, 'card', 'awaiting_payment', ?, ?, ?)`).run(stay, JSON.stringify(lines), paris('2099-07-07', '12:30').toISOString(), clock.now.toISOString());
    assert.ok(!startsOn((await get()).body, '2099-07-07').includes('18:00'), 'held, even for the stay that ordered it');
    clock.now = paris('2099-07-07', '12:31');
    assert.ok(startsOn((await get()).body, '2099-07-07').includes('18:00'), 'released once the hold lapses');
    db.prepare("UPDATE guest_orders SET heldUntil = ?, status = 'expired'").run(paris('2099-07-07', '13:00').toISOString());
    assert.ok(startsOn((await get()).body, '2099-07-07').includes('18:00'), 'an expired order holds nothing');
  });

  withSlots('rule 28: an item the shop does not sell by the hour is 404; a malformed id or date is 400', async ({ db, get }) => {
    addStay(db);
    addBath(db);
    addResource(db, { id: 7, name: 'Fagot de bois', priceType: 'per_stay' });
    sell(db, 'resource', 7);
    addResource(db, { id: 8, name: 'Sauna', lodgings: [2] });
    sell(db, 'resource', 8);
    for (const id of [7, 8, 99]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await get('', id);
      assert.equal(res.status, 404, String(id));
      assert.equal(res.body.error.code, 'ITEM_NOT_FOUND');
    }
    assert.equal((await get('', 'abc')).status, 400);
    assert.equal((await get('?from=2099-02-30')).status, 400);
  });

  withSlots('rule 28 edge: hourly-resources inactive → no slots, the bath is not in the shop', async ({ db, get, call }) => {
    addStay(db);
    addBath(db);
    addOption(db, { id: 1, title: 'Cidre' });
    sell(db, 'option', 1);
    assert.equal((await get()).body.error.code, 'ITEM_NOT_FOUND');
    const shop = (await call('GET', '/public/v1/guest/shop')).body.data;
    assert.deepEqual(shop.categories.flatMap((c) => c.items.map((i) => i.title)), ['Cidre']);
  }, { hourly: false });
}
