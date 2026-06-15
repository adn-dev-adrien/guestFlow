import { readSasDeepLink } from '../sasDeepLink';

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
