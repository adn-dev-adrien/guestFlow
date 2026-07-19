const test = require('node:test');
const assert = require('node:assert/strict');

const { runBreakfastPush, subtractMinutes } = require('../utils/breakfastPushRunner');

// specs/sas-breakfast-bread-and-push.md rules 7-9 — fully injected fakes, no timers, no DB.

function makeDeps({ items = [], lead = 30 } = {}) {
  const stamps = [];
  const pushes = [];
  return {
    stamps,
    pushes,
    breakfastModel: {
      notifyLeadMinutes: () => lead,
      breakfastByDate: ({ from }) => ({ [from]: { items, totalPersons: 0 } }),
    },
    reservationsModel: {
      stampBreakfastNotified: (id, date) => stamps.push({ id, date }),
    },
    pushService: {
      sendToPref: async (prefKey, payload) => { pushes.push({ prefKey, payload }); return { sent: 1 }; },
    },
    logger: { warn: () => {} },
  };
}

function item(over = {}) {
  return {
    reservationId: 42,
    clientName: 'Sarah Arnaud',
    propertyName: 'Aventura lodge',
    persons: 4,
    breakfastTime: '09:00',
    notifiedDate: null,
    ...over,
  };
}

// 2026-07-19 is a fixed local date for every test (isoToday uses local time).
const at = (hhmm) => new Date(`2026-07-19T${hhmm}:00`);

test('subtractMinutes: lead subtraction with 00:00 clamp', () => {
  assert.equal(subtractMinutes('09:00', 30), '08:30');
  assert.equal(subtractMinutes('09:00', 0), '09:00');
  assert.equal(subtractMinutes('00:15', 30), '00:00');
  assert.equal(subtractMinutes('bad', 30), null);
});

test('sends at serving time − lead, not before', async () => {
  let deps = makeDeps({ items: [item()] });
  await runBreakfastPush({ ...deps, now: at('08:29') });
  assert.equal(deps.pushes.length, 0, 'not due yet at 08:29 (send at 08:30)');
  assert.equal(deps.stamps.length, 0);

  deps = makeDeps({ items: [item()] });
  const out = await runBreakfastPush({ ...deps, now: at('08:30') });
  assert.equal(deps.pushes.length, 1);
  assert.deepEqual(deps.stamps, [{ id: 42, date: '2026-07-19' }]);
  assert.equal(out.sent, 1);
  assert.equal(out.lead, 30);
});

test('payload shape: pref key, title, body, deep-link url, per-day tag', async () => {
  const deps = makeDeps({ items: [item()] });
  await runBreakfastPush({ ...deps, now: at('08:45') });
  const { prefKey, payload } = deps.pushes[0];
  assert.equal(prefKey, 'breakfast');
  assert.equal(payload.title, 'Petit déjeuner 09:00');
  assert.equal(payload.body, 'Sarah Arnaud · Aventura lodge — 4 petits déjeuners');
  assert.equal(payload.url, '/planning?breakfast=42&date=2026-07-19');
  assert.equal(payload.tag, 'guestflow-breakfast-42-2026-07-19');
});

test('per-day guard: an item already notified today is skipped', async () => {
  const deps = makeDeps({ items: [item({ notifiedDate: '2026-07-19' }), item({ reservationId: 43, notifiedDate: '2026-07-18' })] });
  await runBreakfastPush({ ...deps, now: at('09:00') });
  assert.equal(deps.pushes.length, 1, 'only the not-yet-notified item fires');
  assert.deepEqual(deps.stamps, [{ id: 43, date: '2026-07-19' }]);
});

test('firstRun stamps without sending (no restart flood)', async () => {
  const deps = makeDeps({ items: [item()] });
  const out = await runBreakfastPush({ ...deps, now: at('10:00'), firstRun: true });
  assert.equal(deps.pushes.length, 0);
  assert.deepEqual(deps.stamps, [{ id: 42, date: '2026-07-19' }]);
  assert.equal(out.stamped, 1);
});

test('lead comes from the breakfast option (0 → send at serving time)', async () => {
  let deps = makeDeps({ items: [item()], lead: 0 });
  await runBreakfastPush({ ...deps, now: at('08:59') });
  assert.equal(deps.pushes.length, 0);

  deps = makeDeps({ items: [item()], lead: 0 });
  await runBreakfastPush({ ...deps, now: at('09:00') });
  assert.equal(deps.pushes.length, 1);

  // Large lead crossing midnight clamps at 00:00 → due from the very start of the day.
  deps = makeDeps({ items: [item({ breakfastTime: '00:15' })], lead: 60 });
  await runBreakfastPush({ ...deps, now: at('00:00') });
  assert.equal(deps.pushes.length, 1);
});

test('one failing item does not abort the pass (and still gets stamped items around it)', async () => {
  const deps = makeDeps({ items: [item(), item({ reservationId: 43 })] });
  deps.reservationsModel.stampBreakfastNotified = (id, date) => {
    if (id === 42) throw new Error('boom');
    deps.stamps.push({ id, date });
  };
  await runBreakfastPush({ ...deps, now: at('09:00') });
  assert.deepEqual(deps.stamps, [{ id: 43, date: '2026-07-19' }]);
  assert.equal(deps.pushes.length, 2, 'both pushes attempted; only the stamp of 42 failed');
});
