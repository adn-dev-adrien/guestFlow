// specs/booking-extranet-intake.md §4.1 — the commission of a platform stay, computed once on the server for
// « Calculer la commission » of the fiche and for the Booking intake plugin. The rules below were the client's
// (platform-tourist-tax-out-of-the-commission.md rules 10 and 24, platform-payment-calculer-button.md).
// Amended 2026-11-26 by platform-host-statement-and-commission-vat.md rules 1 and 8: the gross is the HOST amount of the statement
// (tourist tax never inside it) and `touristTax` is the tax paid WITH the transfer, which adds to it — the box of a mode
// `platform_reversed` stay, resolved by `taxPaidOf`. The figures below are the same stays, their brut taken out of the tax.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { computePlatformCommission } = require('../utils/platformCommission');

test('specs/platform-host-statement-and-commission-vat.md rule 8 — Victor (Gîtes de France): host amount 733, transfer 668 → 65,00', () => {
  assert.equal(computePlatformCommission({ gross: 733, payout: 668 }), 65);
});

test('specs/platform-host-statement-and-commission-vat.md rule 8 — the tax paid with the transfer adds to the host amount: Fraisse 805 + 24 − 704,22 = 124,78', () => {
  assert.equal(computePlatformCommission({ gross: 805, payout: 704.22, touristTax: 24 }), 124.78);
  assert.equal(computePlatformCommission({ gross: 1154.6, payout: 1028.44, touristTax: 52.8 }), 178.96);
});

test('specs/platform-tourist-tax-out-of-the-commission.md rule 10 — an empty box reproduces the August formula exactly', () => {
  assert.equal(computePlatformCommission({ gross: 733, payout: 668, touristTax: '' }), 65);
  assert.equal(computePlatformCommission({ gross: 733, payout: 668 }), 65);
  assert.equal(computePlatformCommission({ gross: 600, payout: 520 }), 80);
});

test('specs/platform-tourist-tax-out-of-the-commission.md rule 10 — an acompte commission is still taken out first', () => {
  assert.equal(computePlatformCommission({ gross: 733, payout: 668, acompteCommission: 10 }), 55);
  assert.equal(computePlatformCommission({ gross: 600, payout: 520, acompteCommission: 10 }), 70);
});

test('specs/platform-tourist-tax-out-of-the-commission.md rule 10 — the commission is clamped at 0, never negative', () => {
  assert.equal(computePlatformCommission({ gross: 700, payout: 714.40 }), 0);
});

test('specs/platform-tourist-tax-out-of-the-commission.md rule 24 — a Booking statement: 22219 gives 188,87 on its host amount 1 264,14 (1 283,34 less the 19,20 kept)', () => {
  assert.equal(computePlatformCommission({ gross: 1264.14, payout: 1075.27, touristTax: '' }), 188.87);
  assert.equal(computePlatformCommission({ gross: 1283.34, payout: 1075.27, touristTax: '' }), 208.07, 'the guest total typed by mistake: the rate warning of rule 11 is there for it');
});

test('specs/booking-extranet-intake.md §4.1 — the two Booking fiches entered by hand: 22304 → 302,69 and 22309 → 95,36', () => {
  assert.equal(computePlatformCommission({ gross: 2014.18, payout: 1711.49 }), 302.69);
  assert.equal(computePlatformCommission({ gross: 701.8, payout: 606.44 }), 95.36);
});

test('specs/booking-extranet-intake.md §4.1 — strings from a form are accepted, a missing gross or payout answers null', () => {
  assert.equal(computePlatformCommission({ gross: '600', payout: '520', touristTax: '', acompteCommission: '' }), 80);
  assert.equal(computePlatformCommission({ gross: '', payout: 520 }), null);
  assert.equal(computePlatformCommission({ gross: 600, payout: null }), null);
  assert.equal(computePlatformCommission({ gross: 'abc', payout: 520 }), null);
});

function withMocks(modules, fn) {
  const origRequire = Module.prototype.require;
  Module.prototype.require = function patched(id) {
    if (Object.prototype.hasOwnProperty.call(modules, id)) return modules[id];
    return origRequire.call(this, id);
  };
  try { return fn(); } finally { Module.prototype.require = origRequire; }
}

test('specs/booking-extranet-intake.md §4.1 — POST /api/reservations/platform-commission answers the figure, 400 without the two amounts', () => {
  const controller = withMocks({
    '../models/reservationsModel': new Proxy({}, { get: () => () => null }),
    '../database': { prepare() { return { get: () => ({}), run: () => ({ changes: 0 }), all: () => [] }; } },
  }, () => {
    delete require.cache[require.resolve('../controllers/reservationsController')];
    return require('../controllers/reservationsController');
  });
  const call = (body) => {
    const out = {};
    const res = { status(code) { out.status = code; return this; }, json(payload) { out.body = payload; return this; } };
    controller.platformCommission({ body }, res);
    return out;
  };
  assert.deepEqual(call({ gross: 701.8, payout: 606.44, touristTax: 20.02 }), { body: { commission: 95.36 } }, 'a platform that keeps the tax: the box adds nothing');
  assert.equal(call({ gross: 721.82 }).status, 400);
  assert.equal(call(undefined).status, 400);
});

test('specs/booking-extranet-intake.md §4.1 — ctx.core.clients.update merges the patch over the stored client, so a patch never blanks a field', () => {
  const updates = [];
  withMocks({
    '../../models/clientsModel': {
      findById: (id) => (id === 7 ? { id: 7, firstName: 'C', lastName: 'G', email: null, phone: '', city: 'Satillieu', emailLanguage: 'fr' } : undefined),
      update: (id, payload) => { updates.push({ id, payload }); return { id, ...payload }; },
    },
  }, () => {
    delete require.cache[require.resolve('../plugins/sdk/coreServices')];
    const core = require('../plugins/sdk/coreServices');
    core.clients.update(7, { firstName: 'Camille', email: 'c@guest.booking.com', emailLanguage: 'en' });
    assert.equal(core.clients.update(99, { firstName: 'x' }), null);
    assert.equal(core.reservations.platformCommission({ gross: 701.8, payout: 606.44, touristTax: 20.02 }), 95.36);
  });
  delete require.cache[require.resolve('../plugins/sdk/coreServices')];
  assert.deepEqual(updates, [{ id: 7, payload: {
    id: 7, firstName: 'Camille', lastName: 'G', email: 'c@guest.booking.com', phone: '', city: 'Satillieu', emailLanguage: 'en',
  } }]);
});
