// specs/reservation-fiche-concurrency.md rule 4 — a write on a stay tells the open fiche the version it
// started from and the one it left.
import { vi } from 'vitest';
import api from '../api';
import { DATA_CHANGED_EVENT } from '../constants/appEvents';

afterEach(() => { vi.unstubAllGlobals(); });

async function writeAndCatch(headers) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, headers: { get: (n) => headers[n] ?? null }, json: () => Promise.resolve({}) })));
  const seen = [];
  const listener = (e) => seen.push(e.detail);
  window.addEventListener(DATA_CHANGED_EVENT, listener);
  try {
    await api.deleteReservationRefund(7, 3);
  } finally {
    window.removeEventListener(DATA_CHANGED_EVENT, listener);
  }
  return seen;
}

test('rule 4: the event carries the stay and its versions on a write to /reservations/:id/...', async () => {
  expect(await writeAndCatch({ 'X-Fiche-Version-Before': 'v1', 'X-Fiche-Version-After': 'v2' }))
    .toEqual([{ reservationId: 7, before: 'v1', after: 'v2' }]);
});

test('rule 4: the event carries nothing when the server sent no version', async () => {
  expect(await writeAndCatch({})).toEqual([null]);
});

test('rule 6: a write from outside the stay puts the moved stays on the event', async () => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve({}),
    headers: { get: (n) => (n === 'X-Stay-Versions' ? JSON.stringify([{ id: 9, before: 'v1', after: 'v2' }]) : null) },
  })));
  const seen = [];
  const listener = (e) => seen.push(e.detail);
  window.addEventListener(DATA_CHANGED_EVENT, listener);
  try { await api.undoReconciliation('tx-1'); } finally { window.removeEventListener(DATA_CHANGED_EVENT, listener); }
  expect(seen).toEqual([{ stays: [{ reservationId: 9, before: 'v1', after: 'v2' }] }]);
});

// specs/reservation-refunds.md rule 42 — the 409 OVERPAID body (overpaymentMethod included, server side:
// trop-percu-stored-measure.unit.test.js) reaches ReservationPage as fields of the thrown error.
test('rule 42: the 409 OVERPAID body fields are on the error the fiche reads', async () => {
  const body = { code: 'OVERPAID', error: 'Trop-perçu', overpaymentTtc: 28, overpaymentMethod: 'internal', overpaymentLines: null };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 409, statusText: 'Conflict', headers: { get: () => null }, json: () => Promise.resolve(body) })));
  const err = await api.updateReservation(7, {}).catch((e) => e);
  expect(err).toMatchObject({ code: 'OVERPAID', overpaymentTtc: 28, overpaymentMethod: 'internal', status: 409 });
});
