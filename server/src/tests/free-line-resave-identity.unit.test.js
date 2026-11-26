// specs/pricing/pricing-components.md §3 rule 94 reading (stabilisation loop t16, VS16-1, 2026-11-17 — the verifier's `probe-resave` made permanent). A
// free line typed on the fiche is saved, the fiche stays open without re-reading its row ids (a PDF, a payment request, a note, a ledger mark),
// then is saved again. The client's own payload (`customOptionsPayload` with the keys a save stored) sends the line `newLine` the first time
// only; the second save keeps its row (same lineId, sale date) — and is not refused LINE_PAID once a note settled it — before the arrival,
// on a started (locked) fiche and on an admin-unlocked one.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, stay, row, addDaysToIsoDate } = require('./saleRound1Fixtures');
const ctrl = require('../controllers/reservationsController');
const { storedBody } = require('../utils/stayOrderLines');

const rowsOf = (id) => db.prepare('SELECT lineId, description, soldAt FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(id);
let FQ;
test.before(async () => { FQ = await import(pathToFileURL(path.join(__dirname, '../../../client/src/utils/ficheQuoteBody.js')).href); });

// The fiche's form line as typed (no row id). An admin-unlocked fiche keeps its final price (UNLOCKED_PRICE_CHANGED): the line is offered there.
const formOf = (offered) => [{ customKey: 'custom_1731840000000', description: 'Bois', amount: 15, offered }];

// A locked fiche keeps its notes field as stored (rule 8 allowlist): its second save changes nothing but resends the line.
const MOMENTS = {
  beforeArrival: { offset: -3, checkIn: 0, notes: true },
  startedLocked: { offset: 1, checkIn: 1 },
  unlockedAfterDeparture: { offset: 5, checkIn: 1, unlock: true, notes: true, offered: true },
};

for (const [moment, m] of Object.entries(MOMENTS)) {
  for (const variant of ['plain', 'paidByNote']) {
    test(`VS16-1 — ${moment} × ${variant}: typed line saved, fiche kept open, saved again → same row, never LINE_PAID`, (t) => {
      const id = stay(20);
      t.mock.timers.enable({ apis: ['Date'], now: new Date(`${addDaysToIsoDate(row(id).startDate, m.offset)}T12:00:00`).getTime() });
      try {
        db.prepare('UPDATE reservations SET checkInDone = ? WHERE id = ?').run(m.checkIn, id);
        const saved = new Set();
        const save = (notes) => {
          const body = { ...storedBody(id), ...(m.notes ? { notes } : {}), customOptions: FQ.customOptionsPayload(formOf(Boolean(m.offered)), saved) };
          const result = ctrl.performUpdate(id, JSON.parse(JSON.stringify(body)), { now: new Date(), unlockPast: Boolean(m.unlock) });
          if (result.status === 200) for (const line of body.customOptions) saved.add(String(line.customKey));
          return { result, sent: body.customOptions };
        };
        const first = save('');
        assert.equal(first.result.status, 200, JSON.stringify(first.result.body));
        assert.equal(first.sent[0].newLine, true);
        const stored = rowsOf(id);
        assert.equal(stored.length, 1);
        if (variant === 'paidByNote') {
          db.prepare('UPDATE reservations SET midStaySettledNotes = ? WHERE id = ?')
            .run(JSON.stringify([{ id: 'n1', lines: [{ key: 'custom:bois', amount: 15 }] }]), id);
        }
        const second = save('Une note');
        assert.equal(second.sent[0].newLine, undefined, 'stored by the first save: not new any more');
        assert.equal(second.result.status, 200, JSON.stringify(second.result.body));
        assert.deepEqual(rowsOf(id), stored, 'the typed line keeps its row');
        const third = save('Encore');
        assert.equal(third.result.status, 200, JSON.stringify(third.result.body));
        assert.deepEqual(rowsOf(id), stored, 'and keeps it save after save');
      } finally {
        t.mock.timers.reset();
      }
    });
  }
}

// VS16-2 (rule 79 reading, S13-1 family) — the fiche kept open takes the row ids its re-read answers (`storedCustomIdsByKey`): a line typed,
// saved, discounted from the sale panel, then RENAMED before the next save keeps its row — lineId, discount, moment, sale date.
let H;
test.before(async () => { H = await import(pathToFileURL(path.join(__dirname, '../../../client/src/utils/bookingFormHydration.js')).href); });
const call = (fn, body, params = {}) => new Promise((resolve, reject) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode, body: b }); return this; }, set() { return this; }, setHeader() {} };
  Promise.resolve(fn({ body, params, query: {}, user: { role: 'admin', id: 1 }, headers: {} }, res)).catch(reject);
});
const factsOf = (id) => db.prepare('SELECT lineId, description, discountCents, collectAt, soldAt FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(id);

for (const [moment, m] of Object.entries({ beforeArrival: MOMENTS.beforeArrival, unlockedAfterDeparture: MOMENTS.unlockedAfterDeparture })) {
  test(`VS16-2 — ${moment}: typed line saved (fiche kept open), discounted, renamed, saved → same row with its discount and moment`, async (t) => {
    const id = stay(20);
    t.mock.timers.enable({ apis: ['Date'], now: new Date(`${addDaysToIsoDate(row(id).startDate, m.offset)}T12:00:00`).getTime() });
    try {
      db.prepare('UPDATE reservations SET checkInDone = ? WHERE id = ?').run(m.checkIn, id);
      const line = { ...formOf(Boolean(m.offered))[0], amount: 15 };
      const saved = new Set();
      const sent1 = FQ.customOptionsPayload([line], saved);
      const first = ctrl.performUpdate(id, { ...storedBody(id), customOptions: sent1 }, { now: new Date(), unlockPast: Boolean(m.unlock) });
      assert.equal(first.status, 200, JSON.stringify(first.body));
      sent1.forEach((l) => saved.add(l.customKey));
      // The fiche's quiet re-read after the save: the ids land on the lines it sent.
      const reread = (await call(ctrl.getById, undefined, { id: String(id) })).body;
      const ids = H.storedCustomIdsByKey(sent1, reread.options);
      assert.ok(ids && ids.get(line.customKey) != null, 'the re-read names the typed line');
      const rowId = ids.get(line.customKey).customOptionId;
      assert.equal(rowId, db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id).id, 'the stored row id');
      const stored = factsOf(id)[0];
      if (!m.offered) {
        const { changeLine } = require('../utils/extraSale');
        assert.equal(changeLine(id, `custom:${stored.lineId}`, { discount: { amount: 2 } }, { now: new Date() }).status, 200);
      }
      const before = factsOf(id)[0];
      // The sale panel's change rewrote nothing of the row id: the fiche re-reads after a panel sale anyway (rule 101); its id is current.
      const currentId = db.prepare('SELECT id FROM reservation_custom_options WHERE reservationId = ?').get(id).id;
      const renamed = { ...line, customOptionId: m.offered ? rowId : currentId, description: 'Bûches' };
      const second = ctrl.performUpdate(id, { ...storedBody(id), customOptions: FQ.customOptionsPayload([renamed], saved) }, { now: new Date(), unlockPast: Boolean(m.unlock) });
      assert.equal(second.status, 200, JSON.stringify(second.body));
      const after = factsOf(id);
      assert.equal(after.length, 1);
      assert.deepEqual({ ...after[0], description: undefined }, { ...before, description: undefined }, 'lineId, discount, moment and sale date kept');
      assert.equal(after[0].description, 'Bûches');
    } finally {
      t.mock.timers.reset();
    }
  });
}

// VS16-3 (the verifier's `probe-adopt` made permanent) — a REPEATED label: the save numbers the second « Bois » « Bois (2) »; the fiche kept open
// adopts each row id AND, its text unchanged since the send, the stored label (`adoptStoredCustomLines`, as a reload shows it). The next save
// is then no rename onto the other line's label (was 409 LINE_LABEL_TAKEN) and every row keeps its lineId; with and without the preview's
// typed-title echo (rule 94 reading S14-1). Then the numbered line renamed keeps its row.
const rowsOfAmounts = (id) => db.prepare('SELECT id, lineId, description, amount FROM reservation_custom_options WHERE reservationId = ? ORDER BY sortOrder, id').all(id);
async function previewEcho(id, form, saved) {
  const body = { ...storedBody(id), reservationId: id, customOptions: FQ.customOptionsPayload(form, saved) };
  const quote = (await call(ctrl.calculatePrice, { ...body, selectedOptions: body.options, selectedResources: body.resources })).body;
  const byKey = new Map((quote.optionLines || []).filter((l) => l.isCustom).map((l) => [String(l.customKey), l]));
  return form.map((l) => (byKey.get(l.customKey) ? { ...l, description: String(byKey.get(l.customKey).title || byKey.get(l.customKey).description).trim() } : l));
}
async function saveTwice(id, form, echo) {
  const saved = new Set();
  let current = echo ? await previewEcho(id, form, saved) : form;
  const sent = FQ.customOptionsPayload(current, saved);
  const first = ctrl.performUpdate(id, { ...storedBody(id), customOptions: sent }, { now: new Date() });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  sent.forEach((l) => saved.add(l.customKey));
  const stored = rowsOfAmounts(id);
  const reread = (await call(ctrl.getById, undefined, { id: String(id) })).body;
  current = H.adoptStoredCustomLines(current, sent, reread.options);
  assert.ok(current, 'the re-read answers the sent lines');
  for (const l of current) assert.equal(Number(stored.find((r) => r.id === l.customOptionId).amount), Number(l.amount), 'each id on its own line');
  assert.deepEqual(current.map((l) => l.description).sort(), stored.map((r) => r.description).sort(), 'the fiche shows the stored labels');
  if (echo) current = await previewEcho(id, current, saved);
  const second = ctrl.performUpdate(id, { ...storedBody(id), notes: 'x', customOptions: FQ.customOptionsPayload(current, saved) }, { now: new Date() });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.deepEqual(rowsOfAmounts(id).map((r) => [r.lineId, r.description, r.amount]), stored.map((r) => [r.lineId, r.description, r.amount]), 'identity kept');
  return { current, saved, stored };
}
const storedBois = async (id) => {
  const body = storedBody(id);
  body.customOptions = [{ customKey: 'seed', description: 'Bois', amount: 15, newLine: true }];
  assert.equal(ctrl.performUpdate(id, body, { now: new Date() }).status, 200);
  return H.hydrateCustomOptions((await call(ctrl.getById, undefined, { id: String(id) })).body.options);
};
const CASES = {
  twoTyped: async () => [{ customKey: 'custom_1', description: 'Bois', amount: 15 }, { customKey: 'custom_2', description: 'Bois', amount: 10 }],
  storedThenTyped: async (id) => [...await storedBois(id), { customKey: 'custom_2', description: 'Bois', amount: 10 }],
  typedThenStored: async (id) => [{ customKey: 'custom_2', description: 'Bois', amount: 10 }, ...await storedBois(id)],
};
for (const echo of [false, true]) {
  for (const [name, build] of Object.entries(CASES)) {
    test(`VS16-3 — repeated label × ${name} × ${echo ? 'preview echo' : 'no echo'}: saved, kept open, saved again → 200, rows kept`, async (t) => {
      const id = stay(20);
      t.mock.timers.enable({ apis: ['Date'], now: new Date(`${addDaysToIsoDate(row(id).startDate, -3)}T12:00:00`).getTime() });
      try {
        await saveTwice(id, await build(id), echo);
      } finally {
        t.mock.timers.reset();
      }
    });
  }
}

test('VS16-3 — after the adoption the numbered line renamed keeps its row (rule 79), the other line untouched', async (t) => {
  const id = stay(20);
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${addDaysToIsoDate(row(id).startDate, -3)}T12:00:00`).getTime() });
  try {
    const { current, saved, stored } = await saveTwice(id, await CASES.twoTyped(), true);
    const numbered = current.find((l) => /\(2\)$/.test(l.description));
    const renamed = current.map((l) => (l === numbered ? { ...l, description: 'Bûches' } : l));
    const third = ctrl.performUpdate(id, { ...storedBody(id), customOptions: FQ.customOptionsPayload(renamed, saved) }, { now: new Date() });
    assert.equal(third.status, 200, JSON.stringify(third.body));
    const after = rowsOfAmounts(id);
    const was = stored.find((r) => r.id === numbered.customOptionId);
    assert.deepEqual(after.find((r) => r.lineId === was.lineId).description, 'Bûches');
    assert.deepEqual(after.map((r) => r.lineId).sort(), stored.map((r) => r.lineId).sort());
  } finally {
    t.mock.timers.reset();
  }
});
