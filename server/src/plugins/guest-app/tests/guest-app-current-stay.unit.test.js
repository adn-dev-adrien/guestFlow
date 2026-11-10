// specs/guest-app.md rules 2, 4, 5, 6, 9 — what a stay link, the fallback lookup and a session open. Pure,
// far-future dates: the instant is an argument and nothing is compared with today.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveSession, openingToday, preArrivalOpensAt, resolveLink, resolveLookup,
} = require('../currentStay');
const { computeWindow } = require('../../../utils/stayWindow');

const stay = (over = {}) => ({
  id: 1, kind: 'reservation', propertyId: 1, startDate: '2099-07-06', endDate: '2099-07-09', checkInTime: '16:00', checkOutTime: '10:00', ...over,
});
const at = (text) => new Date(text);

test('rule 2: the window opens 3 h before check-in and closes 2 h after check-out, Europe/Paris', () => {
  const s = stay();
  assert.equal(resolveLink(s, at('2099-07-06T12:59:00+02:00')).mode, 'preArrival');
  assert.equal(resolveLink(s, at('2099-07-06T13:00:00+02:00')).mode, 'stay');
  assert.equal(resolveLink(s, at('2099-07-09T11:59:00+02:00')).mode, 'stay');
  assert.equal(resolveLink(s, at('2099-07-09T12:00:00+02:00')).mode, 'visitor');
});

test('rule 2: the link opens the pre-arrival from J-7 00:00 Paris, the visitor mode before, and « ended » after', () => {
  const s = stay();
  const before = resolveLink(s, at('2099-06-28T23:59:00+02:00'));
  assert.equal(before.mode, 'visitor');
  assert.equal(before.ended, undefined);
  assert.equal(resolveLink(s, at('2099-06-29T00:00:00+02:00')).mode, 'preArrival');
  const after = resolveLink(s, at('2099-07-09T12:00:00+02:00'));
  assert.deepEqual([after.mode, after.ended], ['visitor', true]);
});

test('rule 2: a cancelled, superseded or devis row opens nothing (the caller answers like an unknown code)', () => {
  const now = at('2099-07-07T12:00:00+02:00');
  ['cancelled', 'superseded', 'devis'].forEach((kind) => {
    assert.equal(resolveLink(stay({ kind }), now), null, kind);
  });
  assert.equal(resolveLink(null, now), null);
});

test('rule 2: the window holds across a spring DST night', () => {
  // The last Sunday of March 2099 is the 29th: 01:00 UTC moves Paris from +01:00 to +02:00.
  const s = stay({ startDate: '2099-03-28', endDate: '2099-03-29', checkOutTime: '10:00' });
  assert.equal(resolveLink(s, at('2099-03-29T11:59:00+02:00')).mode, 'stay');
  assert.equal(resolveLink(s, at('2099-03-29T12:00:00+02:00')).mode, 'visitor');
});

test('rule 2: the window holds across an autumn DST night', () => {
  // The last Sunday of October 2099 is the 25th: Paris goes back to +01:00.
  const s = stay({ startDate: '2099-10-24', endDate: '2099-10-25', checkOutTime: '10:00' });
  assert.equal(resolveLink(s, at('2099-10-25T11:59:00+01:00')).mode, 'stay');
  assert.equal(resolveLink(s, at('2099-10-25T12:00:00+01:00')).mode, 'visitor');
});

test('rule 5: on the arrival day before the window, the pre-arrival is told when the gate and the shop open', () => {
  const s = stay();
  const window = computeWindow(s);
  const opening = openingToday(s, window, at('2099-07-06T11:00:00+02:00'));
  assert.equal(opening.opensAt.toISOString(), '2099-07-06T11:00:00.000Z');
  assert.equal(opening.checkInAt.toISOString(), '2099-07-06T14:00:00.000Z');
  assert.equal(openingToday(s, window, at('2099-07-05T11:00:00+02:00')), null, 'not the arrival day');
  assert.equal(openingToday(s, window, at('2099-07-06T13:00:00+02:00')), null, 'the window is open');
});

test('rule 6: the fallback opens at J-7 00:00 Paris as pre-arrival and ends with the window', () => {
  const s = stay();
  assert.equal(preArrivalOpensAt(s).toISOString(), '2099-06-28T22:00:00.000Z');
  assert.equal(resolveLookup(s, at('2099-06-28T23:59:00+02:00')), null);
  assert.equal(resolveLookup(s, at('2099-06-29T00:00:00+02:00')).mode, 'preArrival');
  assert.equal(resolveLookup(s, at('2099-07-06T12:59:00+02:00')).mode, 'preArrival');
  assert.equal(resolveLookup(s, at('2099-07-06T13:00:00+02:00')).mode, 'stay');
  assert.equal(resolveLookup(s, at('2099-07-09T12:00:00+02:00')), null);
});

test('rule 6: J-7 midnight is computed in the winter offset across the March DST night', () => {
  const s = stay({ startDate: '2099-04-02', endDate: '2099-04-04' });
  assert.equal(preArrivalOpensAt(s).toISOString(), '2099-03-25T23:00:00.000Z');
});

test('rule 6: a cancelled stay cannot be looked up', () => {
  assert.equal(resolveLookup(stay({ kind: 'cancelled' }), at('2099-07-07T12:00:00+02:00')), null);
});

const session = (over = {}) => ({ propertyId: 1, reservationId: 1, origin: 'link', mode: 'stay', ...over });

test('rule 9: a stay session opened from the link lives inside the window, then dies', () => {
  const live = deriveSession(session(), stay(), at('2099-07-07T12:00:00+02:00'));
  assert.equal(live.mode, 'stay');
  assert.equal(live.expiresAt.toISOString(), '2099-07-09T10:00:00.000Z');
  assert.equal(deriveSession(session(), stay(), at('2099-07-09T12:00:00+02:00')), null);
});

test('rule 4: a pre-arrival session opened from the link ends when the window opens', () => {
  const pre = session({ mode: 'preArrival' });
  const early = deriveSession(pre, stay(), at('2099-07-01T12:00:00+02:00'));
  assert.equal(early.mode, 'preArrival');
  assert.equal(early.expiresAt.toISOString(), '2099-07-06T11:00:00.000Z');
  assert.equal(deriveSession(pre, stay(), at('2099-07-06T13:00:00+02:00')), null, 'the app exchanges the link again');
});

test('rule 9: a cancelled or deleted reservation kills its sessions', () => {
  const now = at('2099-07-07T12:00:00+02:00');
  assert.equal(deriveSession(session(), stay({ kind: 'cancelled' }), now), null);
  assert.equal(deriveSession(session({ origin: 'lookup' }), stay({ kind: 'cancelled' }), now), null);
  assert.equal(deriveSession(session(), null, now), null);
});

test('rule 9: a stay moved to another lodging kills the session bound to the first', () => {
  assert.equal(deriveSession(session(), stay({ propertyId: 2 }), at('2099-07-07T12:00:00+02:00')), null);
});

test('rule 9: the expiry follows dates changed by the operator', () => {
  const now = at('2099-07-10T12:00:00+02:00');
  assert.equal(deriveSession(session(), stay(), now), null);
  const extended = deriveSession(session(), stay({ endDate: '2099-07-12' }), now);
  assert.equal(extended.expiresAt.toISOString(), '2099-07-12T10:00:00.000Z');
});

test('rule 6: a lookup session moves from pre-arrival to the stay by itself and ends with the window', () => {
  const lookup = session({ origin: 'lookup', mode: 'preArrival' });
  const ota = { platform: 'Otaexample', reservationNumber: 'OTA-1' };
  assert.equal(deriveSession(lookup, stay(ota), at('2099-07-01T12:00:00+02:00')).mode, 'preArrival');
  const moved = deriveSession(lookup, stay(ota), at('2099-07-07T12:00:00+02:00'));
  assert.equal(moved.mode, 'stay');
  assert.equal(moved.expiresAt.toISOString(), '2099-07-09T10:00:00.000Z');
});
