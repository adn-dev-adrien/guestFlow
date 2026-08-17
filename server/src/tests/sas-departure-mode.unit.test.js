// specs/sas-departure-mode-param.md — `GET /reservations/:id/sas` answers a different « is the cleaning
// already sold? » per end of the stay. The client never sent `?mode=departure`, so the check-out SAS got
// the check-in answer: it asked about a ménage it could never bill and announced 80 € the commit threw
// away. These tests pin the two flavours of the read.

const test = require('node:test');
const assert = require('node:assert/strict');

const Module = require('module');

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const RESERVATION = {
  id: 1, propertyId: 7, startDate: '2026-07-19', endDate: '2026-07-26',
  options: [], resources: [], nights: [],
};

// `sasOrigin` = the ménage row was added by the arrival SAS; `sold` = the reservation carries a cleaning
// whatever its origin.
function readSas({ mode, sold, sasOrigin }) {
  const reservationsModelMock = new Proxy({}, { get: (_, k) => {
    if (k === 'getByIdWithDetails') return () => RESERVATION;
    if (k === 'getSasUpsellOptions') return () => ({
      cleaning: { present: sold, sasOrigin, optionId: 3, totalPrice: 80 },
      bathLinen: { present: false, sasOrigin: false, optionId: 9, totalPrice: 0 },
    });
    if (k === 'isCleaningSoldForReservation') return () => sold;
    if (k === 'getCleaningPriceForProperty') return () => 80;
    if (k === 'getBathLinenOfferForReservation') return () => ({ available: false, label: 'Linge de toilette' });
    if (k === 'buildArrivalComplementDetail') return () => ({ amount: 0, paid: 0, detail: [] });
    return () => null;
  } });

  const controller = withMocks({
    '../models/reservationsModel': reservationsModelMock,
    '../models/linenItemsModel': { list: () => [] },
    '../models/settingsModel': { read: () => ({ portalCode: '' }) },
    '../models/breakfastModel': { getForReservation: () => ({ applicable: false }) },
    '../models/repairAmountsModel': { list: () => [] },
    '../models/resourceSchedulingModel': { getSchedulingPayload: () => ({ applicable: true, resources: [{ resourceId: 2 }] }) },
  }, () => {
    delete require.cache[require.resolve('../controllers/sasController')];
    return require('../controllers/sasController');
  });
  delete require.cache[require.resolve('../controllers/sasController')];

  const res = fakeRes();
  controller.getSas({ params: { id: 1 }, query: mode ? { mode } : {}, user: { roles: ['admin'] } }, res);
  return res.body;
}

test('check-out read: a ménage sold by the arrival SAS counts as included — no end-of-stay ménage step', () => {
  const body = readSas({ mode: 'departure', sold: true, sasOrigin: true });
  assert.equal(body.cleaning.included, true, 'the host was already paid — the guest is not asked again');
  assert.equal(body.resourceScheduling.applicable, false, 'nothing is scheduled at check-out');
});

test('check-in read: the SAS keeps the right to undo its OWN ménage upsell', () => {
  const body = readSas({ mode: 'arrival', sold: true, sasOrigin: true });
  assert.equal(body.cleaning.included, false, 'the step stays visible, pre-selected « ajouté »');
  assert.equal(body.cleaning.sasOrigin, true);
  assert.equal(body.resourceScheduling.applicable, true, 'the arrival read carries the scheduling payload');
});

test('a ménage sold on the fiche is included on BOTH ends', () => {
  assert.equal(readSas({ mode: 'arrival', sold: true, sasOrigin: false }).cleaning.included, true);
  assert.equal(readSas({ mode: 'departure', sold: true, sasOrigin: false }).cleaning.included, true);
  // …and a stay with no cleaning at all keeps its ménage step on both ends.
  assert.equal(readSas({ mode: 'departure', sold: false, sasOrigin: false }).cleaning.included, false);
});
