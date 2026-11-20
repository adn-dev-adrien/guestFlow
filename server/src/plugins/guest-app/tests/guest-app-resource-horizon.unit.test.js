// specs/gift-voucher-campaigns.md rule 51 — the guest app's slots of an hourly resource stop at the resource's booking
// horizon (« Réservable jusqu'à », 3 months by default), on top of the stay: the days past it read closed, the answer
// carries `horizonUntil`, and a session past it is refused by the scheduler's check.
const { requirePlugins, applyPluginSchema } = require('../../sdk/testing');

if (requirePlugins(['hourly-resources'])) {
  const test = require('node:test');
  const assert = require('node:assert/strict');

  const {
    addResource, addStay, enable, freshDb, latestStayToken, livePlugins, sell, startApi,
  } = require('./guestAppFixtures');
  const { createScheduler } = require('../../hourly-resources/scheduler');
  const { horizonUntil } = require('../../hourly-resources/horizon');

  const BATH = 6;
  // The clock of the fixtures: 2099-07-07 12:00. A long stay: 6 July → 20 September.
  const LONG_STAY = { endDate: '2099-09-20' };

  function bathDb(months) {
    const db = freshDb();
    applyPluginSchema(db, 'hourly-resources');
    ['heatUpMinutes', 'heatRetentionMinutes'].forEach((column) => db.exec(`ALTER TABLE resources ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`));
    addResource(db, { id: BATH, name: 'Bain nordique', lodgings: [1, 2] });
    db.prepare("UPDATE resources SET openTime = '11:00', closeTime = '22:00', slotDuration = 60, showsPlanningCard = 1 WHERE id = ?").run(BATH);
    if (months !== undefined) db.prepare('UPDATE resources SET bookingHorizonMonths = ? WHERE id = ?').run(months, BATH);
    sell(db, 'resource', BATH);
    return db;
  }

  async function withSlots(months, stay, fn) {
    const db = bathDb(months);
    const teardown = livePlugins({ hourly: true, scheduler: createScheduler(db) });
    const ctx = await startApi(db);
    try {
      addStay(db, stay);
      enable(ctx.api, db);
      const cookie = (await ctx.call('POST', '/public/v1/guest/sessions', { stayToken: latestStayToken(db) })).setCookie.split(';')[0];
      await fn({ db, get: (query = '') => ctx.call('GET', `/public/v1/guest/shop/resources/${BATH}/slots${query}`, null, { cookie }) });
    } finally {
      await ctx.close();
      teardown();
    }
  }

  const availability = (body) => Object.fromEntries(body.data.days.map((day) => [day.date, day.available]));

  test('rule 51: a resource is bookable 3 months ahead by default, and the answer says until when', async () => {
    await withSlots(undefined, {}, async ({ get }) => {
      const { body } = await get();
      assert.equal(body.data.horizonUntil, '2099-10-07');
      assert.equal(availability(body)['2099-07-07'], true, 'within the horizon and the stay');
    });
  });

  test('rule 51: with a 1-month horizon the days past it read closed, the days before it stay bookable', async () => {
    await withSlots(1, LONG_STAY, async ({ get }) => {
      const { body } = await get('?from=2099-08-06&to=2099-08-09');
      assert.equal(body.data.horizonUntil, '2099-08-07');
      assert.deepEqual(availability(body), { '2099-08-06': true, '2099-08-07': true, '2099-08-08': false, '2099-08-09': false });
      assert.equal(body.data.days.find((day) => day.date === '2099-08-08').reasonLabel, 'Fermé');
    });
  });

  test('rule 51: the scheduler refuses a session past the horizon as closed, and accepts the same hour before it', async () => {
    const db = bathDb(1);
    const scheduler = createScheduler(db);
    const stay = { startDate: '2099-07-06', endDate: '2099-09-20', checkInTime: '16:00', checkOutTime: '10:00' };
    const now = new Date('2099-07-07T10:00:00Z');
    const verdict = scheduler.validateSessions({
      resourceId: BATH, propertyId: 1, stay, now,
      sessions: [{ date: '2099-08-07', start: '14:00', end: '15:00' }, { date: '2099-08-08', start: '14:00', end: '15:00' }],
    });
    assert.deepEqual(verdict.results.map((r) => [r.date, r.ok, r.reason]), [['2099-08-07', true, undefined], ['2099-08-08', false, 'closed']]);
  });

  test('rule 51: the reusable helper reads the resource\'s months, 3 when it carries none', () => {
    const now = new Date('2099-07-07T10:00:00Z');
    assert.equal(horizonUntil({ bookingHorizonMonths: 6 }, now), '2100-01-07');
    assert.equal(horizonUntil({}, now), '2099-10-07');
    assert.equal(horizonUntil({ bookingHorizonMonths: 0 }, now), '2099-10-07');
  });
}
