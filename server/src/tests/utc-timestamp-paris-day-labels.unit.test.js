// specs/finance-dashboard-redesign.md rule 50 (audit R9-1, 2026-10-30) — three more readers of a stored UTC
// timestamp as a day: the booking day the platform price check compares with the tariff journal
// (specs/reservation-payment-ledger.md rule 65), « Demandée le … » on an installment
// (specs/direct-installments.md rule 49) and « Déjà envoyé le … » in the sequence simulation
// (specs/guest-email-sequence.md rule 36). Each one is stamped 23:30 UTC, which is already the next day in Paris.
process.env.TZ = 'Europe/Paris';
process.env.DB_PATH = ':memory:';

const test = require('node:test');
const assert = require('node:assert/strict');
const { db, inDays, seed, createStay, liveQuote } = require('./ledgerFixture');
const { statusLabel } = require('../utils/installmentPlan');
const guestEmailSendsModel = require('../models/guestEmailSendsModel');
const { planWindow } = require('../utils/guestEmailSequenceRunner');
const { stayDedupKey, MAIL } = require('../utils/guestEmailSequence');
const guestFixtures = require('./guestEmailSequenceFixtures');

const frShort = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

seed();
db.prepare("INSERT INTO platforms (name, commissionPercent) VALUES ('Booking', 15)").run();
db.prepare("UPDATE platforms SET collectsTouristTax = 0 WHERE name = 'Booking'").run();

test('reservation-payment-ledger rule 65 — a tariff change 20 minutes before a booking at 00:30 Paris does not silence the price check', async () => {
  const id = createStay({ platform: 'Booking', platformGrossAmount: 200 });
  const quote = () => liveQuote(id, { platformGrossAmount: 200, forceCurrentPricing: true });
  const bookingDay = inDays(-10);
  db.prepare('UPDATE reservations SET createdAt = ? WHERE id = ?').run(`${inDays(-11)} 23:30:00`, id);
  db.prepare("INSERT INTO tariff_change_events (propertyId, kind, occurredAt) VALUES (1, 'platforms', ?)").run(`${inDays(-11)} 23:10:00`);
  assert.ok((await quote()).platformPriceCheck, `booked and changed on ${bookingDay} (Paris): the change is not after the booking`);

  db.prepare('UPDATE tariff_change_events SET occurredAt = ?').run(`${inDays(-10)} 23:10:00`);
  assert.equal((await quote()).platformPriceCheck, null, 'a change on the next Paris day still silences it');
  db.prepare('DELETE FROM tariff_change_events').run();
});

test('direct-installments rule 49 — « Demandée le » dates a request sent at 00:30 Paris on its Paris day', () => {
  const installment = { dueDate: inDays(20), paid: 0, requestedAt: `${inDays(-1)}T23:30:00.000Z` };
  assert.equal(statusLabel(installment, 'requested'), `Demandée le ${frShort(inDays(0))}`);
});

test('guest-email-sequence rule 36 — « Déjà envoyé le » dates a mail sent at 00:30 Paris on its Paris day', () => {
  const gdb = guestFixtures.freshDb();
  guestFixtures.seedProperty(gdb);
  guestFixtures.seedClient(gdb);
  const rid = guestFixtures.seedReservation(gdb, { startDate: inDays(30), endDate: inDays(33), createdAt: `${inDays(-5)} 10:00:00` });
  const ledger = guestEmailSendsModel.buildModel(gdb);
  const dedupKey = stayDedupKey(MAIL.J7, rid);
  ledger.claim({ dedupKey, stableKey: MAIL.J7, clientId: 1 });
  gdb.prepare("UPDATE guest_email_sends SET status = 'sent', sentAt = ? WHERE dedupKey = ?").run(`${inDays(-1)} 23:30:00`, dedupKey);
  const entry = planWindow({ database: gdb, ledger, from: inDays(23), to: inDays(23), startDate: inDays(-30) })
    .find((e) => e.dedupKey === dedupKey);
  assert.equal(entry.status, 'already-sent');
  assert.equal(entry.reason, `Déjà envoyé le ${inDays(0)}`);
});
