/**
 * specs/settings-rationalization.md rule 29 — the settings search reads the shipped emails' names from
 * client/src/constants/emailNames.js, a mirror of the names the server gives them
 * (utils/emailTimeline.js, specs/guest-email-texts-made-simple.md rule 44). The two never drift.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { NAMES } = require('../utils/emailTimeline');

test('rule 29: the client mirror holds exactly the server names of the shipped emails', async () => {
  const file = path.join(__dirname, '../../../client/src/constants/emailNames.js');
  const { EMAIL_DISPLAY_NAMES } = await import(pathToFileURL(file).href);
  assert.deepEqual({ ...EMAIL_DISPLAY_NAMES }, { ...NAMES });
});
