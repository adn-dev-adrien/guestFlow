// specs/client-contact-smart-input.md rule 13 (audit R2, finding N2) — the parse-contact input is capped:
// a long dotted run used to cost 46 s in the unanchored email pattern.
const test = require('node:test');
const assert = require('node:assert/strict');

const { extractEmail, MAX_RAW_LENGTH } = require('../utils/contactParsing');
const controller = require('../controllers/clientsController');

const HOSTILE = `${'a'.repeat(60000)}@b${'.1'.repeat(60000)}`;

function call(body) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  controller.parseContact({ body }, res);
  return res;
}

test('rule 13: extractEmail refuses an oversized input at once, and still reads a normal one', () => {
  const t = process.hrtime.bigint();
  assert.equal(extractEmail(HOSTILE), '');
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 50);
  assert.equal(extractEmail('Claire <Claire@Aulnes.fr>'), 'claire@aulnes.fr');
});

test('rule 13: POST /clients/parse-contact answers 400 PAYLOAD_TOO_LONG above the cap, instantly', () => {
  const t = process.hrtime.bigint();
  const res = call({ email: HOSTILE });
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 50);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'PAYLOAD_TOO_LONG' });
  assert.equal(call({ phone: '1'.repeat(MAX_RAW_LENGTH + 1) }).statusCode, 400);
  assert.equal(call({ email: 'Claire <claire@aulnes.fr>' }).body.email, 'claire@aulnes.fr');
});

// specs/wordpress-plugin.md rule 32 (audit R2, external N2) — format characters never reach a stored name.
const { personNameCase } = require('../utils/textFormatters');

test('rule 32: personNameCase strips U+202E and U+200B and keeps accents and joiners', () => {
  assert.equal(personNameCase('DUP‮​ Éloïse'), 'DUP Éloïse');
  assert.equal(personNameCase('Zeynab‌n'), 'Zeynab‌n');
});
