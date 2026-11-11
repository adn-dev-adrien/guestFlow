// specs/pricing-components.md §3 rule 68 — the committed price-gate fixture holds no personal data: no string with an `@`,
// no phone-like sequence, no table or column outside the allow-list of `scripts/price-gate/anonymise.js`. The strings
// of the JSON columns are read too (a JSON column is a string that holds more strings).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ALLOW_LIST, INTAKE_TABLES } = require('../../../scripts/price-gate/anonymise');

const DIR = process.env.PRICE_GATE_FIXTURE_DIR || path.join(__dirname, 'fixtures', 'price-gate');
const FILES = ['inputs.json', 'expected.json', 'intakes.json'];
const captured = FILES.every((name) => fs.existsSync(path.join(DIR, name)));
const SKIP = captured ? false : 'price-gate fixture absent (captured on the price-gate-baseline tag)';

// An international prefix, or a French number written 0X XX XX XX XX with a space, a dot or a dash between pairs.
const PHONE_LIKE = /(?:\+|\b00)\d{1,3}[\d .]{6,}\d|\b0[1-9](?:[ .-]?\d{2}){4}\b|\b\d{2}(?:[ .]\d{2}){4}\b/;

function strings(value, out = []) {
  if (typeof value === 'string') {
    out.push(value);
    if (/^[[{]/.test(value)) {
      try { strings(JSON.parse(value), out); } catch { /* plain text */ }
    }
  } else if (Array.isArray(value)) {
    value.forEach((item) => strings(item, out));
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) { out.push(key); strings(inner, out); }
  }
  return out;
}

const read = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));

test('rule 68: the detector sees an @ and a phone-like sequence, and lets dates, amounts and booking numbers through', () => {
  for (const bad of ['a@b.c', '+33 6 12 34 56 78', '0612345678x 06 12 34 56 78', '06.12.34.56.78', '0033612345678', '06-12-34-56-78']) {
    assert.ok(bad.includes('@') || PHONE_LIKE.test(bad), bad);
  }
  for (const fine of ['2026-11-11T12:00:00+01:00', '0001-01-01T00:00:00Z', '6669322709', '2026-10-24 08:25:31', 'HMN2HQHJAQ', '710.02', '11773-2026', '1398287456607254737']) {
    assert.ok(!fine.includes('@') && !PHONE_LIKE.test(fine), fine);
  }
});

test('rule 68: no string of the fixture contains an @ or a phone-like sequence', { skip: SKIP }, () => {
  for (const name of FILES) {
    const hits = strings(read(name)).filter((s) => s.includes('@') || PHONE_LIKE.test(s));
    assert.deepEqual(hits.map((s) => `${name}: ${s.slice(0, 12)}…`), []);
  }
});

test('rule 68: the fixture copies no table and no column outside the allow-list', { skip: SKIP }, () => {
  for (const name of ['inputs.json', 'intakes.json']) {
    const { tables } = read(name);
    for (const [table, rows] of Object.entries(tables)) {
      assert.ok(Object.hasOwn(ALLOW_LIST, table), `${name}: table ${table} is not on the list`);
      for (const row of rows) {
        const outside = Object.keys(row).filter((column) => !ALLOW_LIST[table].includes(column));
        assert.deepEqual(outside, [], `${name}: ${table} columns outside the list`);
      }
    }
  }
});

test('rule 68: inputs.json holds no intake table and no client, history or e-mail table', { skip: SKIP }, () => {
  const names = Object.keys(read('inputs.json').tables);
  assert.deepEqual(names.filter((t) => INTAKE_TABLES.includes(t) || /^(clients|reservation_history|email_|guest_email_sends)/.test(t)), []);
  assert.deepEqual(Object.keys(read('intakes.json').tables), INTAKE_TABLES);
});

test('rule 68: an intake carries a placeholder guest and no message, link or mail id', { skip: SKIP }, () => {
  const { tables } = read('intakes.json');
  for (const row of tables.booking_intakes.filter((r) => r.parsed)) {
    const { guest } = JSON.parse(row.parsed).booking;
    assert.equal(guest.firstName, 'Guest');
    assert.deepEqual(Object.keys(guest).sort(), ['email', 'firstName', 'lastName']);
  }
  for (const row of tables.airbnb_intakes) {
    const parsed = JSON.parse(row.parsed);
    assert.equal(parsed.firstName, 'Guest');
    assert.equal(parsed.message, '');
    assert.match(row.messageId, /^message-\d+$/);
  }
});

test('rule 68: no custom line keeps its text and no reservation keeps a note', { skip: SKIP }, () => {
  const { tables } = read('inputs.json');
  for (const row of tables.reservation_custom_options) assert.match(row.description, /^Line \d+$/);
  for (const row of tables.reservations) {
    for (const column of ['notes', 'breakfastNote', 'departureHandoverNote', 'cancellationReason', 'icalOriginalSummary', 'publicToken']) {
      assert.ok(!(column in row), column);
    }
  }
});
