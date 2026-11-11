// specs/airbnb-mail-intake.md rule 28 (audit R2, finding N3) — the subject and the heading are read on
// bounded lines: a 120 000-space line used to cost 34 s in `(.+?)\s+` and the mail still parsed.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAirbnbMail } = require('../mailParser');
const { SUBJECT, SENT_AT, bookingMail } = require('./fixtures');

const timed = (fn) => { const t = process.hrtime.bigint(); const out = fn(); return { out, ms: Number(process.hrtime.bigint() - t) / 1e6 }; };

test('rule 28: a heading line of 120 000 spaces costs milliseconds and the mail still parses', () => {
  const text = bookingMail().replace('Bonjour,', `Bonjour,\nRéservation CONFIRMÉE !${' '.repeat(120000)}`);
  const { out, ms } = timed(() => parseAirbnbMail({ subject: SUBJECT, sentAt: SENT_AT, text }));
  assert.ok(ms < 50, `${ms} ms`);
  assert.equal(out.ok, true);
});

test('rule 28: a subject of 120 000 spaces is refused in milliseconds', () => {
  const { out, ms } = timed(() => parseAirbnbMail({ subject: `${SUBJECT.split(':')[0]}:${' '.repeat(120000)}`, sentAt: SENT_AT, text: bookingMail() }));
  assert.ok(ms < 50, `${ms} ms`);
  assert.equal(out.ok, false);
});

test('rule 28: the usual subject and heading still give the guest name', () => {
  const out = parseAirbnbMail({ subject: SUBJECT, sentAt: SENT_AT, text: bookingMail() });
  assert.equal(out.ok, true);
  assert.ok(out.booking.firstName && out.booking.lastName);
});

test('rule 26: a 200 KB heading line with no « ARRIVERA », and a 3 KB subject, cost milliseconds', () => {
  const heading = bookingMail().replace('Bonjour,', `Bonjour,\nRéservation CONFIRMÉE !${' '.repeat(200000)}x`);
  let r = timed(() => parseAirbnbMail({ subject: SUBJECT, sentAt: SENT_AT, text: heading }));
  assert.ok(r.ms < 50, `${r.ms} ms`);
  r = timed(() => parseAirbnbMail({ subject: `Réservation confirmée : ${' '.repeat(3000)}x`, sentAt: SENT_AT, text: bookingMail() }));
  assert.ok(r.ms < 50, `${r.ms} ms`);
  assert.equal(r.out.ok, false);
});
