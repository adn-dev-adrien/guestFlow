// specs/guest-email-sequence.md §3.2 rule 9 + §4.3 — the public unsubscribe page: a GET never
// unsubscribes (mail scanners open every link), a POST does, once; an unknown token learns nothing.

const test = require('node:test');
const assert = require('node:assert/strict');

const emailPreferencesModel = require('../models/emailPreferencesModel');
const { buildController } = require('../controllers/public/emailPreferencesController');
const { freshDb, seedClient } = require('./guestEmailSequenceFixtures');

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: '' };
  res.status = (code) => { res.statusCode = code; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  res.type = () => res;
  res.send = (html) => { res.body = html; return res; };
  return res;
}

function setup() {
  const db = freshDb();
  seedClient(db);
  const preferences = emailPreferencesModel.buildModel(db);
  const controller = buildController({ preferences, database: db });
  return { db, preferences, controller, token: preferences.ensureToken(1) };
}

test('the token is minted once and stays stable', () => {
  const { preferences, token } = setup();
  assert.ok(token.length >= 24);
  assert.equal(preferences.ensureToken(1), token);
  assert.equal(preferences.findByToken(token).id, 1);
  assert.equal(preferences.findByToken('nope'), null);
});

test('GET shows the confirmation button and changes nothing', () => {
  const { db, controller, token } = setup();
  const res = fakeRes();
  controller.show({ query: { t: token }, baseUrl: '/preferences', path: '/emails' }, res);
  assert.match(res.body, /Ne plus recevoir les nouvelles du domaine/);
  assert.match(res.body, /method="post" action="\/preferences\/emails"/);
  assert.equal(db.prepare('SELECT marketingUnsubscribedAt AS d FROM clients WHERE id = 1').get().d, null);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('POST unsubscribes, and says so again (idempotent) on a second POST', () => {
  const { db, controller, token } = setup();
  const res = fakeRes();
  controller.confirm({ body: { t: token } }, res);
  assert.match(res.body, /C&#39;est noté/);
  assert.match(res.body, /informations liées à vos séjours continueront/);
  const first = db.prepare('SELECT marketingUnsubscribedAt AS d FROM clients WHERE id = 1').get().d;
  assert.ok(first);
  controller.confirm({ body: { t: token } }, fakeRes());
  assert.equal(db.prepare('SELECT marketingUnsubscribedAt AS d FROM clients WHERE id = 1').get().d, first, 'date kept');
  const again = fakeRes();
  controller.show({ query: { t: token }, baseUrl: '/preferences', path: '/emails' }, again);
  assert.match(again.body, /C&#39;est déjà fait/);
});

test('an unknown token gets the same neutral page, with no hint that it exists or not', () => {
  const { controller } = setup();
  const get = fakeRes();
  controller.show({ query: { t: 'x'.repeat(32) }, baseUrl: '/preferences', path: '/emails' }, get);
  const post = fakeRes();
  controller.confirm({ body: { t: '<script>' } }, post);
  for (const res of [get, post]) {
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Ce lien n&#39;est plus valable/);
    assert.doesNotMatch(res.body, /<script>/);
  }
});

test('the page speaks the client\'s language', () => {
  const { db, controller, token } = setup();
  // emailLanguage is added by a boot migration, not by the schema.sql baseline.
  db.exec("ALTER TABLE clients ADD COLUMN emailLanguage TEXT NOT NULL DEFAULT 'fr'");
  db.prepare("UPDATE clients SET emailLanguage = 'en' WHERE id = 1").run();
  const res = fakeRes();
  controller.show({ query: { t: token }, baseUrl: '/preferences', path: '/emails' }, res);
  assert.match(res.body, /Stop receiving news from the domain/);
});

test('unsubscribe link: built on the public URL, empty without one', () => {
  assert.equal(emailPreferencesModel.unsubscribeUrl('https://guestflow.example/', 'a b'), 'https://guestflow.example/preferences/emails?t=a%20b');
  assert.equal(emailPreferencesModel.unsubscribeUrl('', 'abc'), '');
});
