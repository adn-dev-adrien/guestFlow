// specs/devis-pdf-and-tourist-tax-fixes.md §3.2 rule 7 reading R32-RES-M1 (2026-11-09) — ONE reading of a devis's
// validity date for every save and preview. A quote moved earlier then back kept the lowered date (the R31 cap only
// ever lowered it), and the fiche's live quote read the raw stored date, so the preview and the save disagreed.
// `devisValidUntil` is now the one resolver of `devisModel.update`, of the engine input of `computeQuote`, of the
// fiche's calculate-price (`scheduleQuoteInputs`) and of the read (`findById`, the PDF).
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');

const { db, controller, respond, inDays, seed, stayBody, ADMIN } = require('./ledgerFixture');
const devisModel = require('../models/devisModel');
const { devisValidUntil } = require('../utils/devisValidity');
const { todayIso } = require('../utils/localDate');
const devisPdf = require('../utils/devisPdf');

const TODAY = todayIso();
const T = (n) => inDays(n);

// Each row: [case, input (days relative to today), expected (days relative to today, or null)].
// `stored` / `storedStart` / `created` / `start` are day offsets; `reissue` = a save (true) or a read (false).
const CASES = [
  ['created far, unchanged', { stored: 15, storedStart: 42, created: 0, start: 42 }, 15],
  ['created near, unchanged (capped at start − 2)', { stored: 3, storedStart: 5, created: 0, start: 5 }, 3],
  ['moved earlier: start − 2', { stored: 15, storedStart: 42, created: 0, start: 10 }, 8],
  ['moved earlier to tomorrow: floored at today', { stored: 15, storedStart: 42, created: 0, start: 1 }, 0],
  ['moved earlier to a past start: floored at today', { stored: 15, storedStart: 42, created: 0, start: -3 }, 0],
  ['moved back after an earlier move: the creation window again', { stored: 8, storedStart: 10, created: 0, start: 42 }, 15],
  ['moved back after a move to today', { stored: 0, storedStart: 1, created: 0, start: 42 }, 15],
  ['moved later from a near creation: the creation window', { stored: 3, storedStart: 5, created: 0, start: 40 }, 15],
  ['moved later, created 10 days ago', { stored: 5, storedStart: 30, created: -10, start: 60 }, 5],
  ['moved later past an override: the override stands', { stored: 25, storedStart: 42, created: 0, start: 90 }, 25],
  ['extended (window opened today), moved later', { stored: 15, storedStart: 60, created: -30, start: 90 }, 15],
  ['extended, moved earlier', { stored: 15, storedStart: 60, created: -30, start: 10 }, 8],
  ['extended, moved earlier then back: the lowered date (the extension day is not stored)', { stored: 8, storedStart: 10, created: -30, start: 60 }, 8],
  ['expired, re-saved unchanged: re-issued from today', { stored: -3, storedStart: 40, created: -20, start: 40, reissue: true }, 15],
  ['expired, re-saved and moved near: re-issued, capped', { stored: -3, storedStart: 40, created: -20, start: 5, reissue: true }, 3],
  ['expired, read: the stored date', { stored: -3, storedStart: 40, created: -20, start: 40 }, -3],
  ['legacy NULL, saved: rule 7 backfill from the creation day', { stored: null, storedStart: 40, created: -2, start: 40, reissue: true }, 13],
  ['legacy NULL, read: the same backfill', { stored: null, storedStart: 40, created: -2, start: 40 }, 13],
  ['quoteValidityDays 0, moved later: the stored same-day date', { stored: 0, storedStart: 30, created: 0, start: 60, days: 0 }, 0],
  ['quoteValidityDays 0, expired and re-saved: today', { stored: -1, storedStart: 30, created: -1, start: 30, days: 0, reissue: true }, 0],
  ['start not an ISO date: the stored date', { stored: 15, storedStart: 42, created: 0, start: 'not-a-date' }, 15],
];

function resolve({ stored, storedStart, created, start, days = 15, reissue = false }) {
  return devisValidUntil({
    stored: stored == null ? null : T(stored),
    storedStartDate: T(storedStart),
    createdDay: T(created),
    startDate: typeof start === 'string' ? start : T(start),
    today: TODAY,
    quoteValidityDays: days,
    reissueExpired: reissue,
  });
}

for (const [name, input, expected] of CASES) {
  test(`R32-RES-M1 resolver — ${name}`, () => {
    const got = resolve(input);
    assert.equal(got, expected == null ? null : T(expected));
    // Idempotent: what a save writes is what the next unchanged save writes.
    if (got && typeof input.start !== 'string' && got >= TODAY) {
      assert.equal(resolve({ ...input, stored: Math.round((Date.parse(got) - Date.parse(TODAY)) / 86400000), storedStart: input.start }), got);
    }
  });
}

// ---- the chain on the real model and controller: preview == save == read == PDF, at every step ----
seed();
db.prepare('UPDATE app_settings SET quoteValidityDays = 15 WHERE id = 1').run();
db.prepare("UPDATE properties SET depositEnabled = 0 WHERE id = 1").run();

const devisBody = (startIn) => stayBody({ startDate: T(startIn), endDate: T(startIn + 3) });
const rowOf = (id) => db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);

async function preview(id, startIn) {
  const res = respond();
  await controller.calculatePrice({ body: { ...devisBody(startIn), devisId: id }, user: ADMIN }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return res.body;
}

async function moveAndCompare(id, startIn, expectedIn) {
  const live = await preview(id, startIn);
  const saved = devisModel.update(id, devisBody(startIn));
  assert.ok(!saved.error, JSON.stringify(saved));
  const row = rowOf(id);
  assert.equal(row.validUntil, T(expectedIn), `stored validUntil after the move to +${startIn}`);
  assert.equal(live.validUntil, row.validUntil, 'the live quote announces the date the save writes');
  assert.equal(live.balanceDueDate, row.balanceDueDate, 'the live single payment is due when the save says');
  assert.equal(saved.data.validUntil, row.validUntil, 'the PUT answers the stored date');
  assert.equal(saved.data.expired, false);
  const read = devisModel.findById(id);
  assert.equal(read.validUntil, row.validUntil);
  assert.equal(read.balanceDueDate, row.balanceDueDate, 'the read schedule hangs off the same date');
  assert.equal(devisPdf.__test.resolveDevisDates(read, { quoteValidityDays: 15 }).validUntilIso, row.validUntil, 'the PDF prints it');
}

test('R32-RES-M1 — created far, moved earlier, moved back, moved later: preview, save, read and PDF agree', async () => {
  const created = devisModel.create(devisBody(42));
  assert.ok(created.data, JSON.stringify(created));
  const id = created.data.id;
  assert.equal(rowOf(id).validUntil, T(15));
  await moveAndCompare(id, 10, 8);
  await moveAndCompare(id, 42, 15);
  await moveAndCompare(id, 1, 0);
  await moveAndCompare(id, 42, 15);
  await moveAndCompare(id, 80, 15);
  await moveAndCompare(id, 80, 15);
});

test('R32-RES-L1 — an expired devis: the live quote announces the window the save re-issues', async () => {
  const created = devisModel.create(devisBody(50));
  const id = created.data.id;
  db.prepare("UPDATE reservations SET validUntil = ?, createdAt = datetime('now', '-20 days') WHERE id = ?").run(T(-3), id);
  assert.equal(devisModel.findById(id).expired, true);
  const live = await preview(id, 50);
  assert.ok(live.validUntil >= TODAY && live.balanceDueDate >= TODAY, `live ${live.validUntil} / ${live.balanceDueDate} in the past`);
  const saved = devisModel.update(id, devisBody(50));
  assert.ok(!saved.error, JSON.stringify(saved));
  const row = rowOf(id);
  assert.equal(row.validUntil, T(15));
  assert.equal(live.validUntil, row.validUntil);
  assert.equal(live.balanceDueDate, row.balanceDueDate);
  assert.equal(saved.data.expired, false, 'the PUT answers the re-issued state the fiche applies');
  assert.equal(saved.data.extendable, false);
});

test('R32 side note — a still-valid row stored above start − 2 reads capped, and its schedule follows', () => {
  const created = devisModel.create(devisBody(42));
  const id = created.data.id;
  db.prepare('UPDATE reservations SET startDate = ?, endDate = ? WHERE id = ?').run(T(10), T(13), id);
  const read = devisModel.findById(id);
  assert.equal(read.validUntil, T(8));
  assert.ok(read.balanceDueDate <= T(10), `due ${read.balanceDueDate} after the arrival`);
  assert.equal(read.expired, false);
});
