/**
 * specs/terms-acceptance-record.md rules 10 and 12 — the terms checkbox names the document, not its
 * version number, and the version is still recorded.
 *
 * Until 2026-09-25 the funnel read « … conditions générales de location (version 1). ». The number is
 * an internal reference that says nothing to the guest, so it is gone from the wording. The danger in
 * that change is doing it one step too far: the acceptance is a legal record and it is worth nothing
 * unless it names the version accepted, so the body must keep carrying it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const view = fs.readFileSync(path.join(PLUGIN, 'blocks', 'booking', 'view.js'), 'utf8');
const blocks = fs.readFileSync(path.join(PLUGIN, 'includes', 'class-gf-blocks.php'), 'utf8');
const catalogue = fs.readFileSync(path.join(PLUGIN, 'languages', 'guestflow-booking-en_GB.po'), 'utf8');

/** Source with comments removed — an assertion about the wording must not match the prose about it. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('the checkbox wording carries no version number (rule 10)', () => {
  const label = /function paintCgv\(\)[\s\S]*?\n    }/.exec(code(view));
  assert.ok(label, 'paintCgv() not found — the checkbox was restructured');
  assert.ok(
    !/terms\.version/.test(label[0].replace(/'v=' \+ terms\.version/, '')),
    'the version is still rendered in the label the guest reads',
  );
  for (const src of [blocks, catalogue]) {
    assert.ok(!/version %d/.test(src), 'the « (version %d) » string is still declared and will be shown again');
  }
});

test('the accepted version still travels with the request (rule 12)', () => {
  const c = code(view);
  assert.ok(
    /body\.termsVersion\s*=\s*terms\.version/.test(c),
    'the body no longer names the version accepted: the acceptance record becomes unusable as proof',
  );
});
