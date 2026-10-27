// specs/platform-settings-relay-and-review.md rule 12 — the platform colours payload carries the display
// name of every platform, the same one the server's own labels use (platformDisplay), so the client's
// chips never print the stored key « GitesDeFrance » (audit 2026-10-27).
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gf-display-names-')), 'd.db');

const test = require('node:test');
const assert = require('node:assert/strict');

const silent = console.log;
console.log = () => {};
const db = require('../database');
const propertiesModel = require('../models/propertiesModel');
const { platformDisplay } = require('../utils/platformDisplay');
console.log = silent;

test('displayNames: one entry per platform, as platformDisplay names it', () => {
  for (const name of ['GitesDeFrance', 'Greengo', 'Airbnb']) db.prepare('INSERT OR IGNORE INTO platforms (name) VALUES (?)').run(name);
  const { displayNames } = propertiesModel.getPlatformColors();
  assert.equal(displayNames.GitesDeFrance, 'Gîtes de France');
  assert.equal(displayNames.Greengo, 'GreenGo');
  assert.equal(displayNames.Airbnb, 'Airbnb');
  assert.equal(displayNames.direct, 'Direct');
  for (const [name, label] of Object.entries(displayNames)) assert.equal(label, platformDisplay(name), name);
});
