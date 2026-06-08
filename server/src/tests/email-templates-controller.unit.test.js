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
