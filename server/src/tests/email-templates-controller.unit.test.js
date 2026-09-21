// Email templates controller: validates payloads + surfaces 400 / 404.
// See specs/email-automation.md §4.1.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildController } = require('../controllers/emailTemplatesController');

function res() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function fakeModel(initial = []) {
  let next = 1;
  const rows = initial.map((r) => ({ id: next++, ...r }));
  return {
    list:       () => rows,
    findById:   (id) => rows.find((r) => Number(r.id) === Number(id)),
    insert:     (p) => { const r = { id: next++, stableKey: null, ...p }; rows.push(r); return r; },
    update:     (id, p) => {
      const r = rows.find((x) => Number(x.id) === Number(id)); if (!r) return undefined;
      for (const k of Object.keys(p)) if (p[k] !== undefined) r[k] = p[k];
      return r;
    },
    remove:     (id) => {
      const idx = rows.findIndex((x) => Number(x.id) === Number(id));
      if (idx < 0) return false;
      rows.splice(idx, 1); return true;
    },
  };
}

// ---- create ----

test('POST: 400 when required fields are missing', () => {
  const ctl = buildController(fakeModel());
  const r = res();
  ctl.create({ body: { name: '' } }, r);
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.error, 'INVALID_PAYLOAD');
  assert.ok(r.body.fields.includes('name'));
  assert.ok(r.body.fields.includes('subject'));
  assert.ok(r.body.fields.includes('body'));
});

test('POST: 400 on out-of-range dayOffset', () => {
  const ctl = buildController(fakeModel());
  const r = res();
  ctl.create({ body: { name: 'X', subject: 'S', body: 'B', dayOffset: -200, sendMode: 'manual' } }, r);
  assert.equal(r.statusCode, 400);
  assert.ok(r.body.fields.includes('dayOffset'));
});

test('POST: 400 on invalid sendMode', () => {
  const ctl = buildController(fakeModel());
  const r = res();
  ctl.create({ body: { name: 'X', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'XX' } }, r);
  assert.equal(r.statusCode, 400);
  assert.ok(r.body.fields.includes('sendMode'));
});

test('POST: happy path returns 201 + row', () => {
  const ctl = buildController(fakeModel());
  const r = res();
  ctl.create({ body: { name: 'X', subject: 'S', body: 'B', dayOffset: -3, sendMode: 'auto', enabled: true } }, r);
  assert.equal(r.statusCode, 201);
  assert.equal(r.body.name, 'X');
});

// ---- update ----

test('PUT: 404 on unknown id', () => {
  const ctl = buildController(fakeModel());
  const r = res();
  ctl.update({ params: { id: 999 }, body: { name: 'X' } }, r);
  assert.equal(r.statusCode, 404);
});

test('PUT: 400 when a provided field is empty', () => {
  const model = fakeModel([{ name: 'X', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual', enabled: 1 }]);
  const ctl = buildController(model);
  const r = res();
  ctl.update({ params: { id: 1 }, body: { subject: '' } }, r);
  assert.equal(r.statusCode, 400);
});

test('PUT: partial payload preserves the other fields (model 3-way handles this)', () => {
  const model = fakeModel([{ name: 'X', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual', enabled: 1 }]);
  const ctl = buildController(model);
  const r = res();
  ctl.update({ params: { id: 1 }, body: { name: 'Y' } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.name, 'Y');
  assert.equal(r.body.subject, 'S');
});

// ---- delete ----

test('DELETE: 404 on unknown id', () => {
  const ctl = buildController(fakeModel());
  const r = res();
  ctl.remove({ params: { id: 999 } }, r);
  assert.equal(r.statusCode, 404);
});

test('DELETE: 200 + ok when row existed', () => {
  const model = fakeModel([{ name: 'X', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual', enabled: 1 }]);
  const ctl = buildController(model);
  const r = res();
  ctl.remove({ params: { id: 1 } }, r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, true);
});

// ---- list / get ----

test('GET: list returns model.list()', () => {
  const model = fakeModel([{ name: 'A', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual', enabled: 1 }]);
  const ctl = buildController(model);
  const r = res();
  ctl.list({}, r);
  assert.equal(r.body[0].name, 'A');
});

test('GET: 404 on unknown id', () => {
  const ctl = buildController(fakeModel());
  const r = res();
  ctl.getOne({ params: { id: 999 } }, r);
  assert.equal(r.statusCode, 404);
});

// ---- automatic sending per template (specs/settings-rationalization.md rule 17b) ----
// No « Auto désactivé » flag any more: a template's mode is the only switch. Every write re-aligns the
// 08:00 scheduler, and the first SEQUENCE template switched to « auto » fixes the sequence start date.

function recordingSettings(initial = {}) {
  const state = { ...initial };
  return { state, read: () => ({ ...state }), upsert(p) { Object.assign(state, p); } };
}

function recordingScheduler() {
  return { syncs: 0, syncWithTemplates() { this.syncs += 1; } };
}

test('GET list: the rows are returned as stored, with no blocked flag', () => {
  const model = fakeModel([
    { name: 'Auto on', subject: 'S', body: 'B', dayOffset: -7, sendMode: 'auto', enabled: true },
  ]);
  const r = res();
  buildController(model, recordingSettings()).list({}, r);
  assert.equal('autoSendBlocked' in r.body[0], false);
  assert.equal(r.body[0].sendMode, 'auto');
});

test('a sequence template switched to « auto » fixes the start date once; the scheduler follows every write', () => {
  const model = fakeModel([
    { stableKey: 'arrival_reminder_7d', name: 'J-7', subject: 'S', body: 'B', dayOffset: -7, sendMode: 'manual', enabled: true },
  ]);
  const settings = recordingSettings();
  const scheduler = recordingScheduler();
  let day = '2026-10-01';
  const ctl = buildController(model, settings, { scheduler, today: () => day });
  const id = model.list()[0].id;

  ctl.update({ params: { id }, body: { sendMode: 'auto' } }, res());
  assert.equal(settings.state.guestSequenceStartDate, '2026-10-01');
  assert.equal(scheduler.syncs, 1);

  day = '2026-11-15';
  ctl.update({ params: { id }, body: { sendMode: 'manual' } }, res());
  ctl.update({ params: { id }, body: { sendMode: 'auto' } }, res());
  assert.equal(settings.state.guestSequenceStartDate, '2026-10-01', 'never moved afterwards');
  assert.equal(scheduler.syncs, 3);
});

test('a non-sequence template switched to « auto » does not start the sequence', () => {
  const model = fakeModel([
    { stableKey: null, name: 'Libre', subject: 'S', body: 'B', dayOffset: -3, sendMode: 'manual', enabled: true },
  ]);
  const settings = recordingSettings();
  const ctl = buildController(model, settings, { scheduler: recordingScheduler() });
  ctl.update({ params: { id: model.list()[0].id }, body: { sendMode: 'auto' } }, res());
  assert.equal(settings.state.guestSequenceStartDate, undefined);
});
