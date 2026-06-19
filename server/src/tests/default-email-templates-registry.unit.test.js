// Registry of default email templates — discipline checks.
// See specs/email-automation.md §3 rule 6.
//
// The point of the registry is "one place to add a default template". These tests guard the
// invariants that make AI-assisted additions safe:
//   - Every entry carries a stableKey (the seed's lookup key).
//   - stableKeys are unique within the registry (no silent duplicates).
//   - Each entry has the required fields with valid values.
//   - Each subject + body references at least one supported variable (catch typos early).

const test = require('node:test');
const assert = require('node:assert/strict');

const { DEFAULT_TEMPLATES, ARRIVAL_REMINDER_7D_BODY, ARRIVAL_REMINDER_1D_BODY } = require('../utils/defaultEmailTemplatesRegistry');
const { buildContext } = require('../utils/emailContextBuilder');

// Build the canonical context against an empty input — the var KEYS are stable regardless of
// values, which is what we need for the "is this token supported?" check.
const SUPPORTED_VARS = new Set(
  Object.keys(buildContext({ reservation: {}, client: null, property: null, options: [], settings: {} }).vars),
);
const SUPPORTED_FLAGS = new Set(
  Object.keys(buildContext({ reservation: {}, client: null, property: null, options: [], settings: {} }).flags),
);

test('every entry carries a non-empty stableKey', () => {
  for (const def of DEFAULT_TEMPLATES) {
    assert.ok(def.stableKey, `entry must have a stableKey: ${JSON.stringify(def)}`);
    assert.equal(typeof def.stableKey, 'string');
    assert.ok(def.stableKey.trim().length > 0);
  }
});

test('stableKeys are unique across the registry', () => {
  const keys = DEFAULT_TEMPLATES.map((d) => d.stableKey);
  const unique = new Set(keys);
  assert.equal(unique.size, keys.length, `duplicate stableKey detected: ${keys}`);
});

test('every entry has the required fields with valid values', () => {
  for (const def of DEFAULT_TEMPLATES) {
    assert.ok(def.name && def.name.trim().length > 0, `name required: ${def.stableKey}`);
    assert.ok(def.subject && def.subject.trim().length > 0, `subject required: ${def.stableKey}`);
    assert.ok(def.body && def.body.trim().length > 0, `body required: ${def.stableKey}`);
    assert.ok(Number.isInteger(def.dayOffset), `dayOffset must be integer: ${def.stableKey}`);
    assert.ok(def.dayOffset >= -90 && def.dayOffset <= 90, `dayOffset out of range: ${def.stableKey}`);
    assert.ok(['auto', 'manual'].includes(def.sendMode), `sendMode invalid: ${def.stableKey}`);
    assert.equal(typeof def.enabled, 'boolean', `enabled must be boolean: ${def.stableKey}`);
  }
});

test('every {{token}} the registry references is supported by the context builder', () => {
  const tokenRe = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  for (const def of DEFAULT_TEMPLATES) {
    const text = `${def.subject}\n${def.body}\n${def.subjectEn || ''}\n${def.bodyEn || ''}`;
    let m;
    while ((m = tokenRe.exec(text)) !== null) {
      const token = m[1];
      // Reserved syntax words used by the renderer — these are NOT variables.
      if (token === 'else') continue;
      // Conditional opener — captured by /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/ ? No: `{{#if name}}` won't
      // match this regex because of the `#`. So tokens that reach this point are real variables.
      assert.ok(
        SUPPORTED_VARS.has(token),
        `template "${def.stableKey}" references unknown variable {{${token}}}. Supported: ${[...SUPPORTED_VARS].sort().join(', ')}`,
      );
    }
  }
});

test('every {{#if flag}} the registry uses is supported by the context builder', () => {
  const condRe = /\{\{#if\s+([a-zA-Z0-9_]+)\s*\}\}/g;
  for (const def of DEFAULT_TEMPLATES) {
    const text = `${def.subject}\n${def.body}\n${def.subjectEn || ''}\n${def.bodyEn || ''}`;
    let m;
    while ((m = condRe.exec(text)) !== null) {
      const flag = m[1];
      assert.ok(
        SUPPORTED_FLAGS.has(flag),
        `template "${def.stableKey}" uses unknown flag {{#if ${flag}}}. Supported: ${[...SUPPORTED_FLAGS].sort().join(', ')}`,
      );
    }
  }
});

// ---- the shipped J-7 reminder is asserted explicitly — protects the body Adrien validated ----

test('arrival_reminder_7d is shipped with the canonical body string + 7-day offset + manual mode', () => {
  const def = DEFAULT_TEMPLATES.find((d) => d.stableKey === 'arrival_reminder_7d');
  assert.ok(def);
  assert.equal(def.body, ARRIVAL_REMINDER_7D_BODY);
  assert.equal(def.dayOffset, -7);
  assert.equal(def.sendMode, 'manual');
  assert.equal(def.enabled, true);
  // Sanity: the body uses every conditional flag the spec mentioned.
  assert.ok(def.body.includes('{{#if hasOptions}}'),         'hasOptions block present');
  assert.ok(def.body.includes('{{#if hasBedLinenOption}}'),  'hasBedLinenOption block present');
  assert.ok(def.body.includes('{{#if cautionNotBanked}}'),   'cautionNotBanked block present');
  assert.ok(def.body.includes('{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}'), 'reservation number recall present');
});

// ---- the arrival reminder is now shipped at J-2 (specs/j1-arrival-reminder-email.md) ----

test('arrival_reminder_1d is shipped at J-2 with the GPS + nordic-bath copy (stableKey kept legacy)', () => {
  const def = DEFAULT_TEMPLATES.find((d) => d.stableKey === 'arrival_reminder_1d');
  assert.ok(def);
  assert.equal(def.body, ARRIVAL_REMINDER_1D_BODY);
  assert.equal(def.dayOffset, -2, 'reminder moved from J-1 to J-2');
  assert.equal(def.name, 'Rappel arrivée — J-2');
  assert.equal(def.subject, 'Votre arrivée approche {{propertyWithArticle}}');
  assert.equal(def.sendMode, 'manual');
  assert.equal(def.enabled, true);
  // Copy guarantees: uses the stay date, never « demain ».
  assert.ok(!def.body.includes('demain'), 'J-2 copy must not say « demain »');
  assert.ok(def.body.includes('le {{startDate}} {{propertyWithArticle}}'), 'opens with the stay date');
  assert.ok(def.body.includes('Domaine Solio'), 'GPS line present');
  // Conditional blocks the spec mentioned.
  assert.ok(def.body.includes('{{#if hasNordicBath}}{{nordicBathReminder}}'), 'nordic-bath block present');
  assert.ok(def.body.includes('{{#if hasCleaningOption}}{{else}}'), 'cleaning-by-default notice present');
  assert.ok(def.body.includes('{{#if hasReservationNumber}}- N° de réservation : {{reservationNumber}}'), 'reservation number recall present');
});

// ---- both shipped reminders carry an English translation (specs/email-language-fr-en.md) ----

test('the two default reminders ship a non-empty English subject + body with the same flags', () => {
  for (const key of ['arrival_reminder_7d', 'arrival_reminder_1d']) {
    const def = DEFAULT_TEMPLATES.find((d) => d.stableKey === key);
    assert.ok(def.subjectEn && def.subjectEn.trim().length > 0, `${key}: subjectEn present`);
    assert.ok(def.bodyEn && def.bodyEn.trim().length > 0, `${key}: bodyEn present`);
    assert.ok(!def.bodyEn.includes('Bonjour'), `${key}: EN body is actually English`);
    // The EN body keeps the same conditional flags as the FR body (renderer is language-agnostic).
    const flagsOf = (s) => (s.match(/\{\{#if\s+([a-zA-Z0-9_]+)/g) || []).sort().join(',');
    assert.equal(flagsOf(def.bodyEn), flagsOf(def.body), `${key}: EN/FR use the same flags`);
  }
});
