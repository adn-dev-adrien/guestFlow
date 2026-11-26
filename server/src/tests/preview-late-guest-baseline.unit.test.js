// specs/pricing/pricing-components.md §3 rule 102 reading (stabilisation loop t15, S15-2, 2026-11-17) — a late guest (the check-in hour passed, the
// arrival not validated, its complement not collected): an unpaid arrival line raised at the door stays in the arrival complement on the save
// (the window's engine baseline reads the open arrival keys as never mid-stay). The price preview now prices on that same baseline
// (`midStayWindowBaselines`, shared), so it no longer carved the raise out to the end of stay (complement −5 € vs the save).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const extraSale = require('../utils/extraSale');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const FIELDS = ['finalPrice', 'depositAmount', 'balanceAmount', 'complementAmount', 'endOfStayComplementAmount'];
const cents = (value) => Math.round(Number(value || 0) * 100);
const figures = (source) => Object.fromEntries(FIELDS.map((field) => [field, cents(source[field])]));
const at = (id, time, offset = 0) => new Date(`${addDaysToIsoDate(row(id).startDate, offset)}T${time}:00`);

const call = (handler, body) => new Promise((resolve, reject) => {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { resolve({ status: this.statusCode, body: payload }); return this; },
    set() { return this; },
    setHeader() {},
  };
  Promise.resolve(handler({ body, params: {}, query: {}, user: { role: 'admin', id: 1 }, headers: {} }, res)).catch(reject);
});

for (const platform of ['direct', 'Booking']) {
  test(`S15-2 — late guest, ${platform}: raising an unpaid arrival line is previewed in the complement the save stores`, async (t) => {
    const id = stay(20);
    if (platform !== 'direct') db.prepare('UPDATE reservations SET platform = ? WHERE id = ?').run(platform, id);
    for (const [label, amount] of [['Bois', 15], ['Pain', 6]]) {
      const sold = extraSale.sell(id, [{ articleRef: 'custom', label, amount }], { now: at(id, '12:00', -3) });
      assert.equal(sold.status, 200, JSON.stringify(sold.body));
    }
    const door = at(id, '18:00');
    t.mock.timers.enable({ apis: ['Date'], now: door.getTime() });
    const body = storedBody(id);
    body.customOptions = body.customOptions.map((line) => (line.description === 'Bois' ? { ...line, amount: 20 } : line));
    const preview = await call(ctrl.calculatePrice, JSON.parse(JSON.stringify({
      ...body, selectedOptions: body.options, selectedResources: body.resources, reservationId: id,
    })));
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    const before = row(id);
    const saved = ctrl.performUpdate(id, body, { now: door });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(cents(row(id).complementAmount) - cents(before.complementAmount), 500, 'the save keeps the raise in the arrival complement');
    assert.deepEqual(figures(preview.body), figures(row(id)));
  });
}
