import { readSasDeepLink, readBreakfastDeepLink } from '../sasDeepLink';

// specs/pwa-push-notifications.md §3.3 rule 10 — the arrival/departure push deep-link
// `/planning?sas=arrival|departure&reservationId=:id` is parsed + validated here before the
// Planning page opens the matching SAS.

const sp = (q) => new URLSearchParams(q);

test('parses a valid arrival deep-link', () => {
  expect(readSasDeepLink(sp('sas=arrival&reservationId=42'))).toEqual({ mode: 'arrival', reservationId: 42 });
});

test('parses a valid departure deep-link', () => {
  expect(readSasDeepLink(sp('sas=departure&reservationId=7'))).toEqual({ mode: 'departure', reservationId: 7 });
});

test('rejects an unknown mode', () => {
  expect(readSasDeepLink(sp('sas=foo&reservationId=42'))).toBeNull();
  expect(readSasDeepLink(sp('reservationId=42'))).toBeNull();
});

test('rejects a missing / zero / negative / non-numeric reservationId', () => {
  expect(readSasDeepLink(sp('sas=arrival'))).toBeNull();
  expect(readSasDeepLink(sp('sas=arrival&reservationId=0'))).toBeNull();
  expect(readSasDeepLink(sp('sas=arrival&reservationId=-3'))).toBeNull();
  expect(readSasDeepLink(sp('sas=arrival&reservationId=abc'))).toBeNull();
});

test('ignores unrelated params + empty query', () => {
  expect(readSasDeepLink(sp('date=2026-06-15'))).toBeNull();
  expect(readSasDeepLink(sp(''))).toBeNull();
});

test('is defensive against a bad argument', () => {
  expect(readSasDeepLink(null)).toBeNull();
  expect(readSasDeepLink({})).toBeNull();
});

// specs/sas-breakfast-bread-and-push.md rule 10 — the breakfast push deep-link
// `/planning?breakfast=:id&date=YYYY-MM-DD` opens the preparation popup.

test('readBreakfastDeepLink parses a valid link', () => {
  expect(readBreakfastDeepLink(sp('breakfast=42&date=2026-07-19'))).toEqual({ reservationId: 42, date: '2026-07-19' });
});

test('readBreakfastDeepLink rejects bad id or date', () => {
  expect(readBreakfastDeepLink(sp('breakfast=0&date=2026-07-19'))).toBeNull();
  expect(readBreakfastDeepLink(sp('breakfast=abc&date=2026-07-19'))).toBeNull();
  expect(readBreakfastDeepLink(sp('breakfast=42&date=19/07/2026'))).toBeNull();
  expect(readBreakfastDeepLink(sp('breakfast=42'))).toBeNull();
  expect(readBreakfastDeepLink(sp('date=2026-07-19'))).toBeNull();
  expect(readBreakfastDeepLink(sp(''))).toBeNull();
  expect(readBreakfastDeepLink(null)).toBeNull();
});
