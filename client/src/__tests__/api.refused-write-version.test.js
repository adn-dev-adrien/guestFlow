// specs/reservation-fiche-concurrency.md rule 12 (audit R8 client N1) — a refused write that still wrote the
// stay (409 LINK_ALREADY_PAID books the payment, then refuses the new link) tells the open fiche the versions
// it moved, like a write that succeeded; a refusal that wrote nothing puts nothing on the event.
import { vi } from 'vitest';
import api from '../api';
import { DATA_CHANGED_EVENT } from '../constants/appEvents';

afterEach(() => { vi.unstubAllGlobals(); });

async function refusedAndCaught(headers) {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: false, status: 409, statusText: 'Conflict', headers: { get: (n) => headers[n] ?? null },
    json: () => Promise.resolve({ error: 'LINK_ALREADY_PAID', message: 'paiement enregistré' }),
  })));
  const seen = [];
  const listener = (e) => seen.push(e.detail);
  window.addEventListener(DATA_CHANGED_EVENT, listener);
  let err = null;
  try { await api.sendPaymentRequestOfType(9, 'balance').catch((e) => { err = e; }); } finally { window.removeEventListener(DATA_CHANGED_EVENT, listener); }
  return { seen, err };
}

test('rule 12: the stays a refused request moved reach the fiche, and the error still reaches the caller', async () => {
  const { seen, err } = await refusedAndCaught({ 'X-Stay-Versions': JSON.stringify([{ id: 9, before: 'v1', after: 'v2' }]) });
  expect(seen).toEqual([{ stays: [{ reservationId: 9, before: 'v1', after: 'v2' }] }]);
  expect(err).toMatchObject({ error: 'LINK_ALREADY_PAID', status: 409 });
});

test('rule 12: a refusal that wrote nothing dispatches nothing', async () => {
  const { seen } = await refusedAndCaught({});
  expect(seen).toEqual([]);
});
