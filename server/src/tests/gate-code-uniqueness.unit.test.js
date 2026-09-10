const test = require('node:test');
const assert = require('node:assert/strict');

const { makeGateDb, insertStay, makeModel } = require('./gateFixtures');
const { verifyCode, normalizeCode } = require('../utils/gateCode');

// specs/guest-gate-access.md §3.1 rules 1, 2.bis, 5, 6, 6.bis.

test('the access is created on first need, and only once', () => {
  const db = makeGateDb();
  const stayId = insertStay(db);
  const { model } = makeModel(db);

  const first = model.ensureForReservation(stayId);
  const second = model.ensureForReservation(stayId);

  assert.ok(first, 'a live stay must get an access');
  assert.equal(second.id, first.id, 'the same row, not a second one');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gate_accesses').get().n, 1);
  assert.equal(normalizeCode(first.code), first.code, 'the stored clear code is canonical');
  assert.ok(verifyCode(first.code, first), 'the hash matches the code');
  assert.notEqual(first.codeHash, first.code, 'the hash is not the code');
});

test('a cancelled stay and a devis never get an access', () => {
  const db = makeGateDb();
  const { model } = makeModel(db);

  const cancelled = insertStay(db, { cancelledAt: '2026-09-01 10:00:00' });
  const devis = insertStay(db, { kind: 'devis' });

  assert.equal(model.ensureForReservation(cancelled), null);
  assert.equal(model.ensureForReservation(devis), null);
  assert.equal(model.ensureForReservation(99999), null, 'and neither does a stay that is not there');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gate_accesses').get().n, 0);
});

test('a returning client gets a brand-new code on the new booking, and the old one stays dead', () => {
  const db = makeGateDb();
  const { model, clock } = makeModel(db);

  const firstStay = insertStay(db, { startDate: '2023-07-01', endDate: '2023-07-08' });
  clock.set('2023-07-02T12:00:00.000Z');
  const firstAccess = model.ensureForReservation(firstStay);
  assert.ok(model.findByCode(firstAccess.code), 'live during its own stay');

  // Three years later, same client, new reservation.
  const secondStay = insertStay(db, { startDate: '2026-09-12', endDate: '2026-09-14' });
  clock.set('2026-09-12T17:00:00.000Z');
  const secondAccess = model.ensureForReservation(secondStay);

  assert.notEqual(secondAccess.code, firstAccess.code);
  assert.notEqual(secondAccess.codeHash, firstAccess.codeHash);
  assert.notEqual(secondAccess.codeSalt, firstAccess.codeSalt);
  assert.equal(model.findByCode(firstAccess.code), null, 'the 2023 code opens nothing in 2026');
  assert.ok(model.findByCode(secondAccess.code), 'the new one does');
});

test('the draw retries until the code is distinct from every live one', () => {
  const db = makeGateDb();
  const gite = insertStay(db, { propertyId: 1 });
  const lodge = insertStay(db, { propertyId: 2 });

  // The first draw hands out a code, the second tries to hand out the SAME one — the situation the
  // uniqueness rule exists for, and one that never happens by chance.
  const draws = ['4K7M9QT2', '4K7M9QT2', 'ZW83HPQ5'];
  let index = 0;
  const { model } = makeModel(db, '2026-09-12T17:00:00.000Z', {
    generateCode: () => draws[Math.min(index++, draws.length - 1)],
  });

  const giteAccess = model.ensureForReservation(gite);
  const lodgeAccess = model.ensureForReservation(lodge);

  assert.equal(giteAccess.code, '4K7M9QT2');
  assert.equal(lodgeAccess.code, 'ZW83HPQ5', 'the clashing draw was rejected, not stored');
  assert.equal(index, 3, 'the second draw really was attempted and refused');

  // And each code still resolves to its own stay.
  assert.equal(model.findByCode('4K7M9QT2').reservation.id, gite);
  assert.equal(model.findByCode('ZW83HPQ5').reservation.id, lodge);
});

test('a code exhausted of unique draws throws rather than handing out someone else\'s', () => {
  const db = makeGateDb();
  const first = insertStay(db, { propertyId: 1 });
  const second = insertStay(db, { propertyId: 2 });
  const { model } = makeModel(db, '2026-09-12T17:00:00.000Z', { generateCode: () => '4K7M9QT2' });

  model.ensureForReservation(first);
  assert.throws(() => model.ensureForReservation(second), /could not draw a code/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM gate_accesses').get().n, 1, 'nothing was written');
});

test('regenerating mints a new code, forgets the devices and kills the link already sent', () => {
  const db = makeGateDb();
  const stayId = insertStay(db);
  const { model } = makeModel(db);

  const access = model.ensureForReservation(stayId);
  const deviceId = model.newDeviceId();
  model.touchDevice(access.id, deviceId, { ip: '10.0.0.1', userAgent: 'iPhone' });
  assert.equal(model.countDevices(access.id), 1);

  const oldCode = access.code;
  const fresh = model.regenerate(access.id);

  assert.notEqual(fresh.code, oldCode);
  assert.equal(model.findByCode(oldCode), null, 'the link already sent stops working');
  assert.ok(model.findByCode(fresh.code));
  assert.equal(model.countDevices(access.id), 0, 'every device is forgotten');
  assert.ok(model.listEvents(access.id).some((e) => e.kind === 'regenerated'));
});

test('revoking makes the access answer as if it never existed', () => {
  const db = makeGateDb();
  const stayId = insertStay(db);
  const { model } = makeModel(db);
  const access = model.ensureForReservation(stayId);

  assert.ok(model.findByCode(access.code));
  model.revoke(access.id);

  assert.equal(model.findByCode(access.code), null);
  assert.equal(model.resolve(access.id).state, 'revoked');
  assert.ok(model.listEvents(access.id).some((e) => e.kind === 'revoked'));
});

test('a stay cancelled mid-course kills the access on the next look', () => {
  const db = makeGateDb();
  const stayId = insertStay(db);
  const { model } = makeModel(db);
  const access = model.ensureForReservation(stayId);
  assert.ok(model.findByCode(access.code));

  db.prepare('UPDATE reservations SET cancelledAt = ? WHERE id = ?').run('2026-09-13 09:00:00', stayId);

  assert.equal(model.findByCode(access.code), null, 'no route through a cancelled stay');
  assert.equal(model.resolve(access.id).state, 'revoked');
});

test('the code lockout arms after ten failures and thaws an hour later', () => {
  const db = makeGateDb();
  const stayId = insertStay(db);
  const { model, clock } = makeModel(db);
  const access = model.ensureForReservation(stayId);

  for (let i = 0; i < 9; i += 1) model.noteCodeFailure(access.id);
  assert.equal(model.isLockedOut(access.id), false, 'nine is not ten');

  model.noteCodeFailure(access.id);
  assert.equal(model.isLockedOut(access.id), true);

  clock.advance(59 * 60 * 1000);
  assert.equal(model.isLockedOut(access.id), true);
  clock.advance(2 * 60 * 1000);
  assert.equal(model.isLockedOut(access.id), false, 'an hour later the code works again');

  model.clearCodeFailures(access.id);
  assert.equal(model.resolve(access.id).access.failedCount, 0);
});

test('an early opening moves the start, and the journal says so', () => {
  const db = makeGateDb();
  const stayId = insertStay(db);
  const { model, clock } = makeModel(db, '2026-09-12T11:00:00.000Z'); // 13:00 Paris, three hours early
  const access = model.ensureForReservation(stayId);

  assert.equal(model.resolve(access.id).state, 'before');
  model.markEarlyOpen(access.id);
  assert.equal(model.resolve(access.id).state, 'active');
  assert.ok(model.listEvents(access.id).some((e) => e.kind === 'early_open'));

  // A second click cannot move it again.
  const stamped = model.resolve(access.id).access.earlyOpenedAt;
  clock.advance(60 * 1000);
  model.markEarlyOpen(access.id);
  assert.equal(model.resolve(access.id).access.earlyOpenedAt, stamped);
});
