const test = require('node:test');
const assert = require('node:assert/strict');

const { priceRange, priceSessions, isValidSession } = require('../utils/resourceHourlyPricing');

// specs/resource-hourly-scheduling.md §3.3/§3.5 — time-banded hourly pricing.
// Bain nordique grid: day 30 €/h (12:00–20:00), evening 50 €/h (20:00–22:00), 30-min slots.
const GUEST = { dayRate: 30, eveningRate: 50, eveningStart: '20:00', slotMinutes: 30 };

test('priceRange: day-only range bills at the day rate', () => {
  assert.equal(priceRange('14:00', '16:00', GUEST), 60); // 2 h × 30
  assert.equal(priceRange('14:00', '14:30', GUEST), 15); // 30 min
});

test('priceRange: evening-only range bills at the evening rate', () => {
  assert.equal(priceRange('20:00', '22:00', GUEST), 100); // 2 h × 50
  assert.equal(priceRange('20:30', '21:00', GUEST), 25);  // 30 min × 50
});

test('priceRange: a range crossing 20:00 bills each slice at its own band', () => {
  // 19:00–21:00 = 2×15 (day) + 2×25 (evening) = 80
  assert.equal(priceRange('19:00', '21:00', GUEST), 80);
  // 19:30–20:30 = 15 (19:30) + 25 (20:00) = 40
  assert.equal(priceRange('19:30', '20:30', GUEST), 40);
});

test('priceRange: evening rate falls back to day rate when unset', () => {
  assert.equal(priceRange('19:00', '21:00', { dayRate: 30, slotMinutes: 30 }), 60); // flat 30
  assert.equal(priceRange('19:00', '21:00', { dayRate: 30, eveningRate: 0, eveningStart: '20:00', slotMinutes: 30 }), 60);
});

test('isValidSession: enforces window, granularity and minimum duration', () => {
  const cfg = { slotMinutes: 30, openTime: '12:00', closeTime: '22:00', minMinutes: 60 };
  assert.equal(isValidSession({ date: '2026-07-10', start: '19:00', end: '21:00' }, cfg), true);
  assert.equal(isValidSession({ date: '2026-07-10', start: '19:00', end: '19:30' }, cfg), false); // < 1 h
  assert.equal(isValidSession({ date: '2026-07-10', start: '19:15', end: '20:15' }, cfg), false); // off-grid
  assert.equal(isValidSession({ date: '2026-07-10', start: '11:00', end: '12:30' }, cfg), false); // before open
  assert.equal(isValidSession({ date: '2026-07-10', start: '21:00', end: '22:30' }, cfg), false); // after close
  assert.equal(isValidSession({ date: 'nope', start: '19:00', end: '20:00' }, cfg), false);       // bad date
});

test('priceSessions: free first hour deducted once, on the earliest session', () => {
  const sessions = [
    { date: '2026-07-11', start: '20:00', end: '22:00' }, // later (evening)
    { date: '2026-07-10', start: '19:00', end: '21:00' }, // earliest
  ];
  // gross = 100 (evening session) + 80 (mixed session) = 180
  // free = first 60 min of the earliest session (19:00–20:00 = 30 €)
  const out = priceSessions(sessions, GUEST, 60);
  assert.equal(out.grossPrice, 180);
  assert.equal(out.totalPrice, 150);   // 180 − 30
  assert.equal(out.billedHours, 3);    // (2+2)h − 1h free
  assert.equal(out.unitPrice, 50);     // 150 / 3
  assert.equal(out.validSessions.length, 2);
});

test('priceSessions: no free allowance bills the full gross', () => {
  const out = priceSessions([{ date: '2026-07-10', start: '19:00', end: '21:00' }], GUEST, 0);
  assert.equal(out.totalPrice, 80);
  assert.equal(out.billedHours, 2);
  assert.equal(out.unitPrice, 40); // (30+50)/2 effective
});

test('priceSessions: invalid sessions are dropped', () => {
  const cfg = { ...GUEST, openTime: '12:00', closeTime: '22:00', minMinutes: 60 };
  const out = priceSessions([
    { date: '2026-07-10', start: '14:00', end: '16:00' }, // valid → 60
    { date: '2026-07-10', start: '19:00', end: '19:30' }, // < 1 h → dropped
  ], cfg, 0);
  assert.equal(out.validSessions.length, 1);
  assert.equal(out.totalPrice, 60);
});

test('priceSessions: free hour capped to a short earliest session', () => {
  // earliest session only 1 h; free 60 → whole session free; second session billed fully.
  const out = priceSessions([
    { date: '2026-07-10', start: '14:00', end: '15:00' }, // 30 €, fully free
    { date: '2026-07-12', start: '14:00', end: '16:00' }, // 60 €
  ], GUEST, 60);
  assert.equal(out.totalPrice, 60);
  assert.equal(out.billedHours, 2);
});
