/**
 * specs/public-request-abuse-and-grouping.md rules 2 and 13 — the WordPress plugin side of the proof
 * of work. The solver (assets/pow.js) is plain browser JavaScript with no DOM: it runs here, in a VM,
 * and what it finds must pass GuestFlow's own check. The rest is the shape that makes the rules true:
 * a fixed proxy route for the challenge, never cached; the worker; the drawer starting the work when
 * the form opens; the two strings and their English.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const challenge = require('../plugins/website-booking/challenge');

const PLUGIN = path.join(__dirname, '..', '..', '..', 'integrations', 'wordpress', 'guestflow-booking');
const read = (...p) => fs.readFileSync(path.join(PLUGIN, ...p), 'utf8');

function loadPow() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(read('assets', 'pow.js'), sandbox);
  return sandbox.GFPow;
}

test('rule 2: the plugin\'s SHA-256 is SHA-256', () => {
  const pow = loadPow();
  ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'f0'.repeat(70) + 'zz9'].forEach((s) => {
    assert.equal(pow.sha256Hex(s), crypto.createHash('sha256').update(s).digest('hex'), `length ${s.length}`);
  });
});

test('rule 2: the nonce the browser finds passes GuestFlow\'s check', () => {
  const pow = loadPow();
  const now = Date.now();
  const c = challenge.issue({ secret: 's', ipKey: '81.250.12.4', difficulty: 14, now });
  const nonce = pow.search(c.salt, c.difficulty, 0, 1e7);
  assert.ok(nonce);
  assert.equal(challenge.verify({ secret: 's', challenge: c, nonce, ipKey: '81.250.12.4', now: now + 4000 }).ok, true);
});

test('rule 2: the worker solves with the same file, served beside it', () => {
  const worker = read('assets', 'pow-worker.js');
  assert.match(worker, /importScripts\('pow\.js'\)/);
  assert.match(worker, /GFPow\.search\(/);
  const blocks = read('includes', 'class-gf-blocks.php');
  assert.match(blocks, /'powWorkerUrl'\s*=>/);
  assert.match(blocks, /\$name === 'booking' \? \['gf-runtime', 'gf-pow'\]/);
});

test('rule 2: the challenge is relayed on a fixed path, never cached', () => {
  const proxy = read('includes', 'class-gf-rest-proxy.php');
  assert.match(proxy, /register_rest_route\(self::NS, '\/booking-requests\/challenge', \[\s*'methods'\s*=> 'GET'/);
  assert.match(proxy, /->get\('\/booking-requests\/challenge'\)/);
  assert.match(proxy, /header\('Cache-Control', 'no-store'\)/);
});

test('rule 2: the drawer starts the work when the form opens, and says « Vérification… » only if it is not done', () => {
  const view = read('blocks', 'booking', 'view.js');
  assert.match(view, /recompute\(\);\n\s*\/\/[^\n]*\n\s*prepareProof\(\);\n {2}\}/);
  assert.match(view, /if \(!entry\.solved\) busy\(GF\.t\('verifying'\)\);/);
  assert.match(view, /new Worker\(GF\.powWorkerUrl\)/);
  assert.match(view, /body\.challenge = p\.challenge;/);
});

test('rule 13: an update says « Votre demande du <date> a été mise à jour. »', () => {
  const view = read('blocks', 'booking', 'view.js');
  assert.match(view, /else if \(data\.updated\) sentText = GF\.t\('requestUpdated', askedOn\);/);
});

test('the two strings are declared and translated', () => {
  const blocks = read('includes', 'class-gf-blocks.php');
  const po = read('languages', 'guestflow-booking-en_GB.po');
  [['verifying', 'Vérification…', 'Checking…'], ['requestUpdated', 'Votre demande du %s a été mise à jour.', 'Your request of %s has been updated.']]
    .forEach(([key, fr, en]) => {
      assert.ok(blocks.includes(`'${key}'`) && blocks.includes(`__('${fr}'`), key);
      assert.ok(po.includes(`msgid "${fr}"\nmsgstr "${en}"`), fr);
    });
});

// Review of PR #805 — rules 20-22 on the drawer side.
test('rule 20: the drawer sends the token of the quote it created, and pays only a quote that came back with one', () => {
  const view = read('blocks', 'booking', 'view.js');
  assert.match(view, /if \(pendingRequest && pendingRequest\.token\) body\.publicToken = pendingRequest\.token;/);
  assert.match(view, /var noQuote = !data\.publicToken;/);
  assert.match(view, /if \(paying && !noQuote\) \{/);
});

test('rules 21-22: « message ajouté », a reference-free receipt, and the 2 000-character textarea', () => {
  const view = read('blocks', 'booking', 'view.js');
  assert.match(view, /if \(data\.messageAdded\) sentText = GF\.t\('messageAdded', askedOn\);/);
  assert.match(view, /GF\.t\('requestReceived'\)/);
  assert.match(view, /GF\.el\('textarea', \{ rows: '3', maxlength: '2000' \}\)/);
  const blocks = read('includes', 'class-gf-blocks.php');
  const po = read('languages', 'guestflow-booking-en_GB.po');
  [['messageAdded', 'Votre demande du %s a déjà été transmise : votre message a été ajouté.'], ['requestReceived', 'Demande reçue. Nous vous recontactons rapidement.']]
    .forEach(([key, fr]) => {
      assert.ok(blocks.includes(`'${key}'`) && blocks.includes(`__('${fr}'`), key);
      assert.match(po, new RegExp(`msgid "${fr.replace(/[.%]/g, '\\$&')}"\nmsgstr "[^"]+"`));
    });
});
