// specs/terms-acceptance-record.md rule 7 — the public CGV reads: the current version, a given one
// for the pinned `/cgv/?v=N` link, never a draft; 503 while nothing is published, 404 for an unknown
// version.
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
    json(payload) { this.body = payload; return this; },
  };
}

const V1 = { id: 1, version: 1, publishedAt: '2026-09-01T08:00:00.000Z', htmlFr: '<p>v1</p>', htmlEn: '<p>v1 en</p>', markdownFr: 'brouillon ?' };
const V2 = { id: 2, version: 2, publishedAt: '2026-09-20T08:00:00.000Z', htmlFr: '<p>v2</p>', htmlEn: '<p>v2 en</p>', markdownFr: 'x' };

function controller(versions) {
  const mod = '../controllers/public/publicTermsController';
  return withMocks({
    '../../models/termsModel': {
      getCurrent: () => versions[versions.length - 1] || null,
      getByVersion: (n) => versions.find((v) => v.version === n) || null,
    },
  }, () => {
    delete require.cache[require.resolve(mod)];
    return require(mod);
  });
}

test('rule 7 — current version: frozen HTML only, no Markdown source, currentVersion given', () => {
  const res = fakeRes();
  controller([V1, V2]).getCurrent({}, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, {
    version: 2, publishedAt: V2.publishedAt, html: { fr: '<p>v2</p>', en: '<p>v2 en</p>' }, currentVersion: 2,
  });
});

test('rule 7 — a given older version, with the current one named', () => {
  const res = fakeRes();
  controller([V1, V2]).getVersion({ params: { version: '1' } }, res);
  assert.equal(res.body.data.version, 1);
  assert.equal(res.body.data.currentVersion, 2);
  assert.equal(res.body.data.html.fr, '<p>v1</p>');
});

test('rule 7 — nothing published → 503 TERMS_NOT_CONFIGURED', () => {
  const res = fakeRes();
  controller([]).getCurrent({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, 'TERMS_NOT_CONFIGURED');
});

test('rule 7 — unknown or malformed version → 404 TERMS_NOT_FOUND', () => {
  for (const version of ['9', '0', 'abc']) {
    const res = fakeRes();
    controller([V1]).getVersion({ params: { version } }, res);
    assert.equal(res.statusCode, 404, version);
    assert.equal(res.body.error.code, 'TERMS_NOT_FOUND');
  }
});
