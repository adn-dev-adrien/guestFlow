// specs/gift-voucher-campaigns.md rule 51 — the lodging's booking horizon is saved through the settings' own `booking` group:
// a refused value writes nothing and answers on its own field, a cleared field keeps the stored months, a valid one is stored as an integer.
const test = require('node:test');
const assert = require('node:assert/strict');

let stored = { bookingHorizonMonths: 12 };
let upserted = null;
require.cache[require.resolve('../models/settingsModel')] = {
  exports: {
    upsert(payload) { upserted = payload; stored = { ...stored, ...payload }; },
    read() { return stored; },
    updateLogoPath() {},
    smtpConfigured() { return false; },
    decryptedSmtpSettings() { return {}; },
    publicUrl() { return ''; },
  },
};

const { updateSettings } = require('../controllers/settingsController');

function call(booking) {
  upserted = null;
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
  updateSettings({ body: { booking } }, res);
  return res;
}

test('a refused horizon answers 400 on its own field and writes nothing', () => {
  [0, 37, 2.5, 'abc'].forEach((horizonMonths) => {
    const res = call({ horizonMonths });
    assert.equal(res.statusCode, 400, String(horizonMonths));
    assert.deepEqual(res.body.errors, { bookingHorizonMonths: 'Doit être un nombre entier de mois entre 1 et 36.' });
    assert.equal(upserted, null);
  });
});

test('a valid horizon is stored as a whole number of months, whatever the form sends', () => {
  call({ horizonMonths: '18' });
  assert.equal(upserted.bookingHorizonMonths, 18);
  call({ horizonMonths: 36 });
  assert.equal(upserted.bookingHorizonMonths, 36);
});

test('a cleared field keeps the stored horizon: the column is never written with nothing', () => {
  call({ horizonMonths: '' });
  assert.equal(upserted === null || !('bookingHorizonMonths' in upserted), true);
});
