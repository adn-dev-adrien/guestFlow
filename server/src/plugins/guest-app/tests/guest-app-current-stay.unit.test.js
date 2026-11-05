// specs/guest-app.md rules 2, 3, 5, 6, 9 — which stay a lodging or a session is on. Pure, far-future dates:
// the instant is an argument and nothing is compared with today.
const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveSession, pickCurrentStay, preArrivalOpensAt, resolveLodging, resolveLookup } = require('../currentStay');

const stay = (over = {}) => ({
  id: 1, kind: 'reservation', propertyId: 1, startDate: '2099-07-06', endDate: '2099-07-09', checkInTime: '16:00', checkOutTime: '10:00', ...over,
});
const at = (text) => new Date(text);

test('rule 2: the window opens 3 h before check-in and closes 2 h after check-out, Europe/Paris', () => {
  const s = stay();
  assert.equal(resolveLodging([s], at('2099-07-06T12:59:00+02:00')).mode, 'visitor');
  assert.equal(resolveLodging([s], at('2099-07-06T13:00:00+02:00')).mode, 'stay');
  assert.equal(resolveLodging([s], at('2099-07-09T11:59:00+02:00')).mode, 'stay');
  assert.equal(resolveLodging([s], at('2099-07-09T12:00:00+02:00')).mode, 'visitor');
});

test('rule 2: a cancelled, superseded or devis row is no stay', () => {
  const now = at('2099-07-07T12:00:00+02:00');
  ['cancelled', 'superseded', 'devis'].forEach((kind) => {
    assert.equal(resolveLodging([stay({ kind })], now).mode, 'visitor', kind);
  });
});

test('rule 2: the window holds across a spring DST night', () => {
  // The last Sunday of March 2099 is the 29th: 01:00 UTC moves Paris from +01:00 to +02:00.
  const s = stay({ startDate: '2099-03-28', endDate: '2099-03-29', checkOutTime: '10:00' });
  assert.equal(pickCurrentStay([s], at('2099-03-29T11:59:00+02:00')).stay.id, 1);
  assert.equal(pickCurrentStay([s], at('2099-03-29T12:00:00+02:00')), null);
});

test('rule 2: the window holds across an autumn DST night', () => {
  // The last Sunday of October 2099 is the 25th: Paris goes back to +01:00.
  const s = stay({ startDate: '2099-10-24', endDate: '2099-10-25', checkOutTime: '10:00' });
  assert.equal(pickCurrentStay([s], at('2099-10-25T11:59:00+01:00')).stay.id, 1);
  assert.equal(pickCurrentStay([s], at('2099-10-25T12:00:00+01:00')), null);
});

test('rule 3: with custom times the departing stay wins until its check-out, the arriving one after', () => {
  const departing = stay({ id: 1, endDate: '2099-07-09', checkOutTime: '12:00' });
  const arriving = stay({ id: 2, startDate: '2099-07-09', endDate: '2099-07-12', checkInTime: '13:00' });
  assert.equal(pickCurrentStay([arriving, departing], at('2099-07-09T11:30:00+02:00')).stay.id, 1);
  assert.equal(pickCurrentStay([arriving, departing], at('2099-07-09T12:00:00+02:00')).stay.id, 2);
  assert.equal(pickCurrentStay([arriving, departing], at('2099-07-09T13:30:00+02:00')).stay.id, 2);
});

test('rule 3: windows that only touch never hold two stays at once', () => {
  const departing = stay({ id: 1 });
  const arriving = stay({ id: 2, startDate: '2099-07-09', endDate: '2099-07-12', checkInTime: '15:00' });
  assert.equal(pickCurrentStay([departing, arriving], at('2099-07-09T11:59:00+02:00')).stay.id, 1);
  assert.equal(pickCurrentStay([departing, arriving], at('2099-07-09T12:00:00+02:00')).stay.id, 2);
});

test('rule 3: with the 16:00 check-in there is a gap between two stays, visitor mode', () => {
  const departing = stay({ id: 1 });
  const arriving = stay({ id: 2, startDate: '2099-07-09', endDate: '2099-07-12' });
  assert.equal(pickCurrentStay([departing, arriving], at('2099-07-09T12:30:00+02:00')), null);
  assert.equal(pickCurrentStay([departing, arriving], at('2099-07-09T13:00:00+02:00')).stay.id, 2);
});

test('rule 5: too early on the arrival day → visitor, told when the window opens', () => {
  const resolved = resolveLodging([stay()], at('2099-07-06T11:00:00+02:00'));
  assert.equal(resolved.mode, 'visitor');
  assert.equal(resolved.opening.opensAt.toISOString(), '2099-07-06T11:00:00.000Z');
  assert.equal(resolved.opening.checkInAt.toISOString(), '2099-07-06T14:00:00.000Z');
});

test('rule 5: no stay today → visitor with nothing to announce', () => {
  assert.equal(resolveLodging([stay()], at('2099-07-05T11:00:00+02:00')).opening, null);
  assert.equal(resolveLodging([], at('2099-07-05T11:00:00+02:00')).opening, null);
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

const session = (over = {}) => ({ propertyId: 1, reservationId: 1, origin: 'qr', ...over });

test('rule 9: a QR session lives inside the window, then dies', () => {
  assert.equal(deriveSession(session(), stay(), at('2099-07-07T12:00:00+02:00')).mode, 'stay');
  assert.equal(deriveSession(session(), stay(), at('2099-07-09T12:00:00+02:00')), null);
});

test('rule 9: a cancelled or deleted reservation kills its sessions', () => {
  const now = at('2099-07-07T12:00:00+02:00');
  assert.equal(deriveSession(session(), stay({ kind: 'cancelled' }), now), null);
  assert.equal(deriveSession(session(), null, now), null);
});

test('rule 9: a stay moved to another lodging kills the session bound to the first', () => {
  assert.equal(deriveSession(session(), stay({ propertyId: 2 }), at('2099-07-07T12:00:00+02:00')), null);
});

test('rule 9: the expiry follows dates changed by the operator', () => {
  const now = at('2099-07-10T12:00:00+02:00');
  assert.equal(deriveSession(session(), stay(), now), null);
  const extended = deriveSession(session(), stay({ endDate: '2099-07-12' }), now);
  assert.equal(extended.window.end.toISOString(), '2099-07-12T10:00:00.000Z');
});

test('rule 9: a lookup session moves from pre-arrival to stay; a QR session has no pre-arrival', () => {
  const early = at('2099-07-01T12:00:00+02:00');
  assert.equal(deriveSession(session({ origin: 'lookup' }), stay(), early).mode, 'preArrival');
  assert.equal(deriveSession(session({ origin: 'lookup' }), stay(), at('2099-07-07T12:00:00+02:00')).mode, 'stay');
  assert.equal(deriveSession(session({ origin: 'qr' }), stay(), early), null);
});
