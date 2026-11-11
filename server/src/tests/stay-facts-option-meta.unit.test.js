// specs/guest-email-sequence.md §3.5 rules 20 and 23 — on the production schema, the option metadata
// reaches the classifier: a booked juice is confirmed in the J-2 and no longer proposed in the J-7.

const test = require('node:test');
const assert = require('node:assert/strict');

const { freshDb, seedProperty, seedClient, seedReservation } = require('./guestEmailSequenceFixtures');
const { loadStayFacts } = require('../models/stayFactsModel');
const { classifyOptions } = require('../utils/stayContentContext');
const { withSolioWording } = require('./solioWordingFixture');

function stayWithJuiceBooked() {
  const db = freshDb();
  seedProperty(db);
  seedClient(db);
  db.prepare("INSERT INTO options (id, title, price, seedKey, category) VALUES (21, 'Jus de pomme 1L', 5, 'drink_jus_pomme_1l', 'Boissons')").run();
  db.prepare('INSERT INTO property_options (propertyId, optionId) VALUES (1, 21)').run();
  const id = seedReservation(db);
  db.prepare('INSERT INTO reservation_options (reservationId, optionId, unitPrice, totalPrice) VALUES (?, 21, 5, 5)').run(id);
  const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  const lines = db.prepare('SELECT ro.*, o.title FROM reservation_options ro JOIN options o ON o.id = ro.optionId WHERE ro.reservationId = ?').all(id);
  return { facts: loadStayFacts(db, reservation), lines };
}

test('the option metadata loads on the production schema', () => {
  const { facts } = stayWithJuiceBooked();
  assert.equal(facts.optionMeta[21].seedKey, 'drink_jus_pomme_1l');
});

// Since specs/plugins-phase-p-productisation.md, a catering option reaches the emails through its
// mention (rules 7–8).
test('a booked catering option is booked, hence not proposed again', () => {
  const { facts, lines } = stayWithJuiceBooked();
  const solio = withSolioWording(facts);
  const juice = solio.mentions.find((m) => m.optionIds.includes(21));
  const cls = classifyOptions(lines, solio);
  assert.equal(cls.mentionBooked(juice), true);
  assert.equal(cls.mentionProposable(juice), false);
});
