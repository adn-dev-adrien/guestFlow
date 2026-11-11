// specs/gites-de-france-mail-intake.md rules 23–25 (audit 2026-10-28, findings F2, F4, F6) — the guest's own
// name decides neither the party nor the amounts; dates are real; a cancelled fiche is never matched; a hostile
// mail is parsed in milliseconds and remembered when it fails.
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseGitesDeFranceMail } = require('../mailParser');
const { BOOKING_MAIL } = require('./fixtures');
const { setup, PLACEHOLDER } = require('./serviceFixtures');

// Relative to the clock: an ignored mail older than the reader's window is forgotten (rule 31), so a
// literal date would make the second pass read it again once that window has passed.
const RECEIVED_AT = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();

const withName = (name) => BOOKING_MAIL.replace('DUPONT Claire', name);

test('rule 23: a party typed in the name does not decide the party', () => {
  const r = parseGitesDeFranceMail(withName('DUPONT Claire 1 adulte'));
  assert.equal(r.ok, false);
});

test('rule 23: money typed in the name does not decide the amounts', () => {
  const r = parseGitesDeFranceMail(withName("DUPONT Montant net de la location 1.00 € Total des options 80.00 € Total net : 81.00 € taxe de séjour d'un montant de 0 € Claire"));
  assert.equal(r.ok, false);
  const long = parseGitesDeFranceMail(withName(`DUPONT ${'x'.repeat(200)}`));
  assert.equal(long.ok, false);
});

test('rule 23: a label typed inside the name line is not a label', () => {
  const r = parseGitesDeFranceMail(withName('DUPONT Claire picto personnes'));
  assert.equal(r.ok, true);
  assert.equal(r.booking.adults, 8);
  assert.equal(r.booking.netRent, 454);
});

test('rule 23: a label that opens two lines makes the mail ambiguous', () => {
  const r = parseGitesDeFranceMail(BOOKING_MAIL.replace('Cordialement,', 'Total net : 1.00 €\nCordialement,'));
  assert.deepEqual(r, { ok: false, error: 'Mail ambigu : un libellé apparaît plusieurs fois' });
});

test('rule 23: the dates are real, the departure follows the arrival, the stay is of a sane length', () => {
  assert.equal(parseGitesDeFranceMail(BOOKING_MAIL.replace('13/11/2026', '31/02/2026')).error, 'Dates du séjour invalides');
  assert.equal(parseGitesDeFranceMail(BOOKING_MAIL.replace('15/11/2026', '01/01/2020')).error, 'Dates du séjour invalides');
  assert.equal(parseGitesDeFranceMail(BOOKING_MAIL.replace('15/11/2026', '15/11/2027')).error, 'Dates du séjour invalides');
  assert.equal(parseGitesDeFranceMail(BOOKING_MAIL).ok, true);
});

test('rule 25: 1 MB of filler is refused or parsed in well under a second', () => {
  const t0 = Date.now();
  const filler = `${'a ( 1 ) x '.repeat(100000)}`;
  const mails = [BOOKING_MAIL.replace('Détail des crédits', `${filler}\nDétail des crédits`), BOOKING_MAIL.replace('Forfait ménage', 'x'.repeat(1000000)), `${BOOKING_MAIL}\n${' '.repeat(1000000)}`];
  for (const mail of mails) parseGitesDeFranceMail(mail);
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
});

test('rule 25: a supplements section of 250 KB without a closing parenthesis is linear', () => {
  const filler = `${'x'.repeat(250000)}`;
  const t0 = Date.now();
  parseGitesDeFranceMail(BOOKING_MAIL.replace('Forfait ménage ( 1 ) x 1\t80.00 €', filler));
  assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
});

test('rule 25: an unauthenticated mail that does not parse is stored once, out of every list, and not parsed again', async () => {
  const bad = { messageId: '<bad@x>', receivedAt: RECEIVED_AT, text: 'Une nouvelle réservation\nrien d’autre', authenticated: false };
  const { service, intakes, calls } = setup({ mails: [bad] });
  assert.deepEqual(await service.runPass(), { read: 1 });
  assert.equal(intakes.has('<bad@x>'), true);
  assert.deepEqual(intakes.listOpen(), []);
  assert.deepEqual(service.attention(), []);
  assert.deepEqual(await service.runPass(), { read: 0 });
  assert.deepEqual(calls.updates, []);
});

test('rule 24: a cancelled fiche on the same dates is never matched or written to', async () => {
  const cancelled = { ...PLACEHOLDER, id: 1, cancelledAt: '2026-10-10T10:00:00Z' };
  const only = setup({ reservations: [cancelled] });
  assert.deepEqual(await only.service.runPass(), { read: 1, pending: 1 });
  assert.deepEqual(only.calls.updates, []);
  const rebooked = setup({ reservations: [cancelled, { ...PLACEHOLDER, id: 2 }] });
  const out = await rebooked.service.runPass();
  assert.equal(out.error, undefined);
  assert.deepEqual(rebooked.calls.updates.map((u) => u.id), [2]);
});

test('rule 26: a client is reused by e-mail only for a verified mail; an operator-applied unverified proposal gets its own client', async () => {
  const verified = setup();
  await verified.service.runPass();
  assert.equal(verified.calls.updates[0].opts.reuseByEmail, true);

  const mail = { messageId: '<u@x>', receivedAt: RECEIVED_AT, text: BOOKING_MAIL, authenticated: false };
  const unverified = setup({ mails: [mail] });
  assert.deepEqual(await unverified.service.runPass(), { read: 1, proposed: 1 });
  assert.deepEqual(unverified.calls.updates, []);
  unverified.service.applyFromBanner(1, { rent: 504 });
  assert.equal(unverified.calls.updates[0].opts.reuseByEmail, false);
});
