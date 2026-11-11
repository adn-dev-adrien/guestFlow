// specs/guest-email-sequence.md rule 37 (audit R42-PUB-L1, 2026-11-10) — the unsubscribe page declares the language it
// speaks: `<html lang="en">` around the English copy, `fr` around the French one and on the neutral unknown-token page.
// It always declared `fr`, so a screen reader or a translation offer read the English text as French.
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

function setup(language) {
  const db = freshDb();
  seedClient(db);
  // emailLanguage is added by a boot migration, not by the schema.sql baseline.
  db.exec("ALTER TABLE clients ADD COLUMN emailLanguage TEXT NOT NULL DEFAULT 'fr'");
  db.prepare('UPDATE clients SET emailLanguage = ? WHERE id = 1').run(language);
  const preferences = emailPreferencesModel.buildModel(db);
  return { controller: buildController({ preferences, database: db }), token: preferences.ensureToken(1) };
}
const req = (extra) => ({ baseUrl: '/preferences', path: '/emails', query: {}, body: {}, ...extra });

test('rule 37 — an English client reads <html lang="en">, on the page and on the confirmation', () => {
  const { controller, token } = setup('en');
  const shown = fakeRes();
  controller.show(req({ query: { t: token } }), shown);
  assert.match(shown.body, /^<!doctype html><html lang="en">/);
  assert.match(shown.body, /Stop receiving our news/);
  const done = fakeRes();
  controller.confirm(req({ body: { t: token } }), done);
  assert.match(done.body, /^<!doctype html><html lang="en">/);
  assert.match(done.body, /You will no longer receive our news/);
});

test('rule 37 — a French client and an unknown token read <html lang="fr">', () => {
  const { controller, token } = setup('fr');
  const shown = fakeRes();
  controller.show(req({ query: { t: token } }), shown);
  assert.match(shown.body, /^<!doctype html><html lang="fr">/);
  const unknown = fakeRes();
  controller.show(req({ query: { t: 'nope' } }), unknown);
  assert.match(unknown.body, /^<!doctype html><html lang="fr">/);
});
