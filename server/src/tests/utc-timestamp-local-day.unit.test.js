// specs/finance-dashboard-redesign.md rule 50 — a stored UTC timestamp read as a day is read on the
// operator's calendar day (`vatRegime.bookingDayOf`), like « today » (rule 37). A row created at 00:30 in
// Paris carries `2026-10-30 23:30:00`: its first ten characters are the day before.
process.env.TZ = 'Europe/Paris';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { clientWhenLabel } = require('../utils/clientWhenLabel');
const { freshDb, insert } = require('./financeDashboardFixture');

const AT_HALF_PAST_MIDNIGHT = '2026-10-30 23:30:00';

test('rule 50 — the Clients line dates a client created at 00:30 on its Paris day', () => {
  assert.equal(clientWhenLabel('none', null, null, AT_HALF_PAST_MIDNIGHT, '2026-10-31'), 'Créé le 31/10/2026');
  assert.equal(clientWhenLabel('none', null, null, '2026-10-30', '2026-10-31'), 'Créé le 30/10/2026');
  assert.equal(clientWhenLabel('none', null, null, null, '2026-10-31'), '');
});

test('rule 50 — the pace counts a stay booked at 00:30 on its Paris day', () => {
  const { db, finance } = freshDb();
  insert(db, { startDate: '2027-06-14', endDate: '2027-06-17', finalPrice: 600, balanceAmount: 600, createdAt: AT_HALF_PAST_MIDNIGHT });
  assert.deepEqual(finance.getPaceStays({}).map((s) => s.bookedOn), ['2026-10-31']);
});

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

const fakeRes = () => ({
  statusCode: 200, body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

// A solde and a complement both due: the fiche offers them as one arrival payment.
const DUE = {
  id: 7, propertyId: 1, createdAt: AT_HALF_PAST_MIDNIGHT,
  balanceAmount: 200, balancePaid: 0, complementAmount: 50, complementPaid: 0, arrivalPaymentGroup: null,
};

function settle(body) {
  const controller = withMocks({
    '../utils/pricing': { calculateReservationQuote: () => ({ error: null }) },
    '../utils/reservationHelpers': { computeNextIcalSyncLocked: () => 0, getTodayIsoDate: () => '2026-10-31' },
    '../models/establishmentClosuresModel': new Proxy({}, { get: () => () => null }),
    '../models/reservationsModel': new Proxy({}, {
      get: (_, k) => {
        if (k === 'getRow') return () => ({ ...DUE });
        if (k === 'getByIdWithDetails') return () => ({ ...DUE, options: [], resources: [] });
        if (k === 'settleArrivalBuckets') return () => ({ buckets: [], total: 0 });
        return () => null;
      },
    }),
    '../models/settingsModel': { read: () => ({}) },
    '../database': { prepare: () => ({ get: () => undefined, run: () => ({ changes: 0 }), all: () => [] }) },
  }, () => {
    const p = '../controllers/reservationsController';
    delete require.cache[require.resolve(p)];
    return require(p);
  });
  const res = fakeRes();
  controller.settleArrivalPayment({ params: { id: '7' }, body, user: { role: 'admin' } }, res);
  return res;
}

test('rule 50 — the arrival payment cannot predate the Paris booking day', () => {
  const refused = settle({ mode: 'card', date: '2026-10-30' });
  assert.equal(refused.statusCode, 400);
  assert.match(refused.body.error, /n'existait pas encore le 30\/10\/2026/);
});

test('rule 50 — the fiche offers the Paris booking day as the earliest collection date', () => {
  const res = settle({ mode: 'card', date: '2026-10-31' });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.arrivalPayment.collectible.bookedAt, '2026-10-31');
});
