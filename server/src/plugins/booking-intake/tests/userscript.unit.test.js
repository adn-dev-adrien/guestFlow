// specs/booking-extranet-intake.md rules 2–6 — the userscript is a dumb carrier: it embeds this instance's URL
// and secret, runs on the extranet reservation page only, sends one request per view, parses nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { buildUserscript, MATCH } = require('../userscript');

const source = buildUserscript({ publicUrl: 'https://guestflow.example.org/', secret: 'abc-123_XYZ' });

test('specs/booking-extranet-intake.md rule 2: the script is valid JavaScript with a userscript header carrying this instance’s URL and secret', () => {
  assert.doesNotThrow(() => new vm.Script(source));
  assert.match(source, /^\/\/ ==UserScript==/);
  assert.match(source, /ENDPOINT = "https:\/\/guestflow\.example\.org\/public\/booking-intake\/page"/);
  assert.match(source, /KEY = "abc-123_XYZ"/);
  assert.match(source, /@connect\s+guestflow\.example\.org/);
  assert.match(source, /@grant\s+GM_xmlhttpRequest/);
});

test('specs/booking-extranet-intake.md rule 2: a secret with quotes cannot break out of the script', () => {
  const hostile = buildUserscript({ publicUrl: 'https://g.example.org', secret: '";alert(1);"' });
  assert.doesNotThrow(() => new vm.Script(hostile));
  assert.match(hostile, /KEY = "\\";alert\(1\);\\""/);
});

test('specs/booking-extranet-intake.md rule 3: it runs on the extranet reservation page and nowhere else', () => {
  assert.equal(MATCH, 'https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking.html*');
  assert.equal([...source.matchAll(/@match\s+(\S+)/g)].length, 1);
  assert.match(source, new RegExp(`@match\\s+${MATCH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('specs/booking-extranet-intake.md rule 3: it waits for « Numéro de réservation », reveals the phone, and sends once per page view', () => {
  assert.match(source, /Numéro de réservation/);
  assert.match(source, /Afficher le numéro de téléphone/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /resId/);
  assert.equal([...source.matchAll(/^\s+send\(text, guard, fingerprint\);/gm)].length, 1);
});

test('specs/booking-extranet-intake.md rule 3: a refused page is not remembered, so a reload after the iCal import retries', () => {
  assert.match(source, /if \(!failed\) \{ try \{ sessionStorage\.setItem/);
});

test('specs/booking-extranet-intake.md rule 4: one POST with the secret in X-Booking-Intake-Key, through GM_xmlhttpRequest, body { v, hotelId, resId, text }', () => {
  assert.match(source, /method: 'POST'/);
  assert.match(source, /'X-Booking-Intake-Key': KEY/);
  assert.match(source, /GM_xmlhttpRequest\(/);
  assert.match(source, /JSON\.stringify\(\{ v: 1, hotelId: hotelId, resId: resId, text: text \}\)/);
  assert.doesNotMatch(source, /\bfetch\(|XMLHttpRequest\(/);
});

test('specs/booking-extranet-intake.md rule 5: it parses nothing — no amount, no label of the page beyond the two it waits on', () => {
  for (const word of ['Montant', 'Commission', 'Taxe', 'Sous-total', 'adultes', 'parseFloat', 'RegExp']) {
    assert.doesNotMatch(source, new RegExp(word), word);
  }
});

test('specs/booking-extranet-intake.md rule 6: the answer is shown as a toast — errors stay until clicked, success goes after 8 s', () => {
  assert.match(source, /setTimeout\(function \(\) \{ el\.remove\(\); \}, 8000\)/);
  assert.match(source, /if \(!isError\)/);
  assert.match(source, /script obsolète, le réinstaller depuis GuestFlow/);
  assert.match(source, /module inactif/);
  assert.match(source, /GuestFlow injoignable/);
});
