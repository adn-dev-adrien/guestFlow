// specs/tourist-tax-matches-the-office-calculation.md rules 10-12 — when the tourist tax stops
// moving, and what it carries with it.
//
// The old rule froze a stay whose last night had gone by. That pinned bookings nobody had ever
// collected or declared — which is what stopped an uncollected stay from being corrected — while
// leaving a stay collected inside the current month free to drift after the guest had paid. The two
// events that actually matter are collection and declaration, and they are what these tests pin.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { isTouristTaxFrozen, writeTouristTaxSnapshot } = require('../utils/touristTaxFreeze');

const SCHEMA = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function seedDb() {
  const db = new Database(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO app_settings (id, vatRate) VALUES (1, 10)').run();
  db.prepare(`INSERT INTO properties (id, name, touristTaxMode, touristTaxPercentage, touristTaxDepartmentPercentage)
    VALUES (1, 'Aventura lodge', 'percentage_accommodation', 5, 10)`).run();
  db.prepare("INSERT INTO clients (id, firstName, lastName) VALUES (1, 'Jean', 'Dupont')").run();
  // « Reversed » (the platform collects, we remit) → the tax rides the BALANCE.
  db.prepare("INSERT INTO platforms (id, name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (1, 'Lodgify', 1, 0)").run();
  // « Owner » (we collect at arrival) → the tax rides the COMPLÉMENT.
  db.prepare("INSERT INTO platforms (id, name, collectsTouristTax, touristTaxRemittedByPlatform) VALUES (2, 'Abracadaroom', 0, 0)").run();
  return db;
}

function insertStay(db, { id = 1, platform = 'direct', balancePaid = 0, complementPaid = 0, declaredAt = null } = {}) {
  db.prepare(`INSERT INTO reservations
      (id, kind, clientId, propertyId, startDate, endDate, platform, adults,
       touristTaxRate, touristTaxTotal, finalPrice, totalPrice, balanceAmount,
       balancePaid, complementPaid, touristTaxDeclaredAt)
    VALUES (?, 'reservation', 1, 1, '2026-05-10', '2026-05-13', ?, 2, 5, 15, 300, 300, 300, ?, ?, ?)`)
    .run(id, platform, balancePaid, complementPaid, declaredAt);
  return db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
}

test('a stay nobody has paid is live — whatever its dates', () => {
  const db = seedDb();
  const stay = insertStay(db, {});
  assert.equal(isTouristTaxFrozen(db, stay), false);
  db.close();
});

test('the balance freezes a stay whose tax rides the balance — direct and « reversed » alike', () => {
  const db = seedDb();
  for (const [id, platform] of [[1, 'direct'], [2, 'Lodgify']]) {
    const live = insertStay(db, { id, platform });
    assert.equal(isTouristTaxFrozen(db, live), false, `${platform} should start live`);

    db.prepare('UPDATE reservations SET balancePaid = 1 WHERE id = ?').run(id);
    const paid = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
    assert.equal(isTouristTaxFrozen(db, paid), true, `${platform} should freeze on the balance`);
  }
  db.close();
});

test('a stay collected at arrival ignores the balance and waits for the complement', () => {
  const db = seedDb();
  insertStay(db, { platform: 'Abracadaroom' });

  db.prepare('UPDATE reservations SET balancePaid = 1 WHERE id = 1').run();
  const balanceOnly = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  assert.equal(isTouristTaxFrozen(db, balanceOnly), false, 'the balance does not carry this tax');

  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = 1').run();
  const complementPaid = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  assert.equal(isTouristTaxFrozen(db, complementPaid), true);
  db.close();
});

test('« touristTaxInComplement » moves the freeze to the complement on any platform', () => {
  const db = seedDb();
  insertStay(db, { platform: 'Lodgify' });
  db.prepare('UPDATE reservations SET touristTaxInComplement = 1, balancePaid = 1 WHERE id = 1').run();
  const stay = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  assert.equal(isTouristTaxFrozen(db, stay), false);

  db.prepare('UPDATE reservations SET complementPaid = 1 WHERE id = 1').run();
  assert.equal(isTouristTaxFrozen(db, db.prepare('SELECT * FROM reservations WHERE id = 1').get()), true);
  db.close();
});

test('ticking « Déclarée » freezes a stay that was never collected', () => {
  const db = seedDb();
  const stay = insertStay(db, { declaredAt: '2026-06-01 09:00:00' });
  assert.equal(isTouristTaxFrozen(db, stay), true);
  db.close();
});

// Rule 10 — un-collecting is a correction of the books, not a licence to re-price what the guest was
// charged and the commune was told.
test('un-collecting does not thaw a stay that has already been frozen', () => {
  const db = seedDb();
  insertStay(db, { balancePaid: 1 });
  writeTouristTaxSnapshot(db, 1, { touristTaxBaseHt: 272.55, touristTaxOccupantsCount: 2, touristTaxUnitAmount: 2.5 });

  db.prepare('UPDATE reservations SET balancePaid = 0 WHERE id = 1').run();
  const thawedAttempt = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  assert.ok(thawedAttempt.touristTaxFrozenAt, 'the stamp survives');
  assert.equal(isTouristTaxFrozen(db, thawedAttempt), true);
  db.close();
});

test('the snapshot records the base, the divisor and the unit — and the stamp only once frozen', () => {
  const db = seedDb();
  insertStay(db, {});
  const quote = { touristTaxBaseHt: 272.55, touristTaxOccupantsCount: 2, touristTaxUnitAmount: 2.5 };

  writeTouristTaxSnapshot(db, 1, quote);
  const live = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  assert.equal(live.touristTaxFrozenBaseHt, 272.55, 'the base is stored on every save');
  assert.equal(live.touristTaxFrozenOccupants, 2);
  assert.equal(live.touristTaxFrozenUnitAmount, 2.5);
  assert.equal(live.touristTaxFrozenAt, null, 'nothing collected yet → not frozen');

  db.prepare('UPDATE reservations SET balancePaid = 1 WHERE id = 1').run();
  writeTouristTaxSnapshot(db, 1, quote);
  const frozen = db.prepare('SELECT * FROM reservations WHERE id = 1').get();
  assert.ok(frozen.touristTaxFrozenAt);

  // A later save must not move the stamp — it dates the freeze, not the last write.
  writeTouristTaxSnapshot(db, 1, { ...quote, touristTaxBaseHt: 999 });
  assert.equal(db.prepare('SELECT touristTaxFrozenAt FROM reservations WHERE id = 1').get().touristTaxFrozenAt,
    frozen.touristTaxFrozenAt);
  db.close();
});

test('a tax offered by the platform never freezes — there is nothing to declare', () => {
  const db = seedDb();
  insertStay(db, { balancePaid: 1 });
  const { frozen } = writeTouristTaxSnapshot(db, 1, {
    touristTaxBaseHt: 0, touristTaxOccupantsCount: 2, touristTaxUnitAmount: 0, touristTaxOfferedByPlatform: true,
  });
  assert.equal(frozen, false);
  assert.equal(db.prepare('SELECT touristTaxFrozenAt FROM reservations WHERE id = 1').get().touristTaxFrozenAt, null);
  db.close();
});
