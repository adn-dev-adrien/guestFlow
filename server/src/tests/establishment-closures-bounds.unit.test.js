// specs/establishment-closures.md rules 18-20 (audit R19, 2026-11-02) — a closure is two real days at
// most MAX_CLOSURE_DAYS apart, refused otherwise on create, update and the conflicts preview; a closure
// is expanded only over the window asked, so a legacy closure ending in 9999 costs nothing; and the
// occupied dates answer a bounded window whose `to` is exclusive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-closure-bounds-')), 'g.db');
const db = require('../database');
const { validateRange, MAX_CLOSURE_DAYS, MESSAGES } = require('../utils/establishmentClosuresValidation');
const establishmentClosuresModel = require('../models/establishmentClosuresModel');
const { computeBlockedDates } = require('../utils/blockedDates');
const reservationsController = require('../controllers/reservationsController');
const { seedClosures, call } = require('./closureConflictsFixture');

const plusDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const TODAY = require('../utils/localDate').todayIso();
const START = plusDays(TODAY, 400);
const FAR = '9999-12-31';

test('rule 18 — two real days are required', () => {
  const year = Number(START.slice(0, 4)) + 1;
  assert.equal(validateRange(`${year}-02-30`, `${year}-03-05`), MESSAGES.invalidDate);
  assert.equal(validateRange('abc', 'abd'), MESSAGES.invalidDate);
  assert.equal(validateRange(START, `${START}T00:00`), MESSAGES.invalidDate);
  assert.equal(MESSAGES.invalidDate, 'Date invalide.');
});

test('rule 18 — two years at most: the cap passes, one more day is refused', () => {
  assert.equal(MAX_CLOSURE_DAYS, 731);
  assert.equal(validateRange(START, plusDays(START, MAX_CLOSURE_DAYS)), null);
  assert.equal(validateRange(START, plusDays(START, MAX_CLOSURE_DAYS + 1)), MESSAGES.tooLong);
  assert.equal(validateRange(START, FAR), MESSAGES.tooLong);
  assert.equal(MESSAGES.tooLong, 'Fermeture trop longue : 2 ans au plus.');
});

test('rule 18 — create, update and the conflicts preview refuse a closure to 9999 with a 400', () => {
  const { controller } = seedClosures();
  const created = call(controller.create, { body: { propertyId: 2, startDate: START, endDate: FAR } });
  assert.equal(created.statusCode, 400);
  assert.deepEqual(created.body, { error: MESSAGES.tooLong, code: 'INVALID_RANGE' });

  const ok = call(controller.create, { body: { propertyId: 2, startDate: START, endDate: plusDays(START, 10) } });
  assert.equal(ok.statusCode, 200);
  const updated = call(controller.update, { params: { id: ok.body.id }, body: { propertyId: 2, startDate: START, endDate: FAR } });
  assert.equal(updated.statusCode, 400);
  assert.equal(updated.body.error, MESSAGES.tooLong);

  const preview = call(controller.conflicts, { query: { propertyId: 2, startDate: 'abc', endDate: 'abd' } });
  assert.equal(preview.statusCode, 400);
  assert.equal(preview.body.error, MESSAGES.invalidDate);
});

test('rule 19 — the expansion keeps only the nights of the asked window', () => {
  const closures = [{ startDate: START, endDate: FAR }];
  const from = plusDays(START, -3);
  const to = plusDays(START, 3);
  assert.deepEqual(establishmentClosuresModel.expandClosuresToDates(closures, { from, to }), [START, plusDays(START, 1), plusDays(START, 2)]);
  assert.deepEqual(establishmentClosuresModel.expandClosuresToDates([{ startDate: START, endDate: plusDays(START, 2) }]), [START, plusDays(START, 1)]);
  assert.deepEqual(establishmentClosuresModel.expandClosuresToDates([{ startDate: 'abc', endDate: 'abd' }], { from, to }), []);
});

// A row written before rule 18, straight into the table.
const pid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Tente', 2)").run().lastInsertRowid;
db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, 'Ancienne', ?, ?)").run(pid, START, FAR);

test('rule 19 — the public blocked nights of a legacy closure to 9999 stay inside the window, at once', () => {
  const started = Date.now();
  const blocked = computeBlockedDates(pid, plusDays(START, -2), plusDays(START, 2));
  assert.deepEqual(blocked, [START, plusDays(START, 1)]);
  assert.ok(Date.now() - started < 1000);
});

test('rule 19 — the fiche\'s occupied dates of a legacy closure to 9999 stay inside the window, at once', () => {
  const res = {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  const started = Date.now();
  reservationsController.occupiedDates({ params: { propertyId: String(pid) }, query: { from: plusDays(START, 365), to: plusDays(START, 367) } }, res);
  assert.deepEqual(res.body, [plusDays(START, 365), plusDays(START, 366)]);
  assert.ok(Date.now() - started < 1000);
});

test('rule 20 — the occupied dates answer a window of at most 750 real days, refused fast past it', () => {
  const ask = (from, to) => {
    const res = {
      statusCode: 200, body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    reservationsController.occupiedDates({ params: { propertyId: String(pid) }, query: { from, to } }, res);
    return res;
  };
  const started = Date.now();
  const absurd = ask('0001-01-01', FAR);
  assert.ok(Date.now() - started < 1000);
  assert.equal(absurd.statusCode, 400);
  assert.deepEqual(absurd.body, { error: 'DATE_RANGE_TOO_WIDE', message: 'Période trop longue.' });
  assert.equal(ask('abc', 'abd').statusCode, 400);
  assert.equal(ask(plusDays(START, 2), START).statusCode, 400);
  const wide = ask(plusDays(START, -10), plusDays(START, 740));
  assert.equal(wide.statusCode, 200);
  assert.equal(wide.body.length, 740);
});

test('rule 20 — a closure on the last Sunday of a month grid is occupied when the grid asks up to the day after', () => {
  const ask = (from, to) => {
    const res = {
      statusCode: 200, body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    reservationsController.occupiedDates({ params: { propertyId: String(cid) }, query: { from, to } }, res);
    return res.body;
  };
  // A month a year ahead whose last day is a Sunday: its grid ends on that day.
  let last = null;
  for (let m = 12; m < 36 && !last; m += 1) {
    const d = new Date(Date.UTC(Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)) - 1 + m + 1, 0));
    if (d.getUTCDay() === 0) last = d.toISOString().slice(0, 10);
  }
  const gridFrom = plusDays(`${last.slice(0, 7)}-01`, -6);
  const cid = db.prepare("INSERT INTO properties (name, maxGuests) VALUES ('Lodge', 2)").run().lastInsertRowid;
  db.prepare("INSERT INTO establishment_closures (propertyId, label, startDate, endDate) VALUES (?, 'Hiver', ?, ?)").run(cid, plusDays(last, -2), plusDays(last, 30));
  assert.deepEqual(ask(gridFrom, plusDays(last, 1)), [plusDays(last, -2), plusDays(last, -1), last]);
  assert.ok(!ask(gridFrom, last).includes(last), 'the end is exclusive: the grid must ask for the day after its last cell');
});
