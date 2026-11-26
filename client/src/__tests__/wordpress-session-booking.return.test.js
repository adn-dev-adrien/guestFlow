// specs/site/site-outside-resource-booking.md rule 16 — the return page (`?gf_session=<ref>`): it waits for the bank’s word by polling the booking’s status and then says « Séance réservée » with the
// day, the slot, the people and the paid recap — never a bare « Paiement reçu ». A lapsed or refunded payment says what became of it.
import { screen, waitFor } from '@testing-library/react';
import { setup, callsTo, flat, resetPage } from './wordpressSessionFixtures';

const REF = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

const BOOKED = {
  state: 'booked',
  resourceName: 'Bain nordique',
  date: '2026-12-06', // date-literal-ok: a payload the mocked server answers; the screen only shows it
  start: '19:00',
  end: '21:00',
  people: 3,
  recap: {
    parts: [{ label: '19:00 – 20:00 · journée', band: 'day', cents: 5000 }, { label: '20:00 – 21:00 · soirée', band: 'evening', cents: 6300 }],
    extras: [{ label: 'Planche apéro', detail: null, qty: 2, cents: 2800 }],
    dueCents: 14100,
    vat: [{ rate: 10, cents: 1282 }],
  },
};

const returnTo = (answers, { query = `gf_session=${REF}`, statusPath = `/sessions/status/${REF}` } = {}) => {
  window.history.replaceState(null, '', `/reserver/?${query}`);
  let n = 0;
  return setup({
    routes: (method, p) => {
      if (p === statusPath) { const answer = answers[Math.min(n, answers.length - 1)]; n += 1; return { status: 200, body: { data: answer } }; }
      return null;
    },
  });
};

afterEach(() => { vi.unstubAllGlobals(); resetPage(); });

test('rule 16 — a booked session: « Séance réservée », the day, the slot, the people and the paid recap; the form is not drawn', async () => {
  const { calls } = returnTo([BOOKED]);
  expect(await screen.findByText('Séance réservée')).toBeTruthy();
  const text = flat(document.querySelector('.gf-sb-done').textContent);
  expect(text).toContain('dimanche 6 décembre · 19:00 – 21:00 · 3 pers.');
  expect(text).toContain('19:00 – 20:00 · journée');
  expect(text).toContain('20:00 – 21:00 · soirée');
  expect(text).toContain('2 × Planche apéro');
  expect(text).toContain('Payé');
  expect(text).toContain('141,00 €');
  expect(text).not.toContain('Paiement reçu');
  expect(document.querySelector('.gf-sb-main')).toBeNull();
  expect(callsTo(calls, '/sessions/resources')).toHaveLength(0);
  expect(screen.getByText('Réserver une autre séance').getAttribute('href')).toBe('/reserver/');
});

test('rule 16 — while the bank has not answered the page waits and asks again every 3 seconds, then shows the session', async () => {
  const waits = [];
  const real = globalThis.setTimeout;
  // Only the page's own 3-second wait is shortened: the test library keeps its timers.
  vi.stubGlobal('setTimeout', (fn, ms, ...args) => {
    if (ms !== 3000) return real(fn, ms, ...args);
    waits.push(ms);
    queueMicrotask(fn);
    return 0;
  });
  const { calls } = returnTo([{ state: 'held' }, { state: 'held' }, BOOKED]);
  expect(await screen.findByText('Séance réservée')).toBeTruthy();
  expect(callsTo(calls, `/sessions/status/${REF}`)).toHaveLength(3);
  expect(waits).toEqual([3000, 3000]);
});

test('rule 16 — a payment that did not come: the slot is freed and nothing is booked; one that came too late is told as owed back', async () => {
  returnTo([{ state: 'lapsed' }]);
  expect(await screen.findByText(/le créneau a été libéré et aucune séance n’est réservée/)).toBeTruthy();
  resetPage();
  returnTo([{ state: 'refundOwed' }]);
  expect(await screen.findByText(/il sera remboursé, l’équipe vous écrit/)).toBeTruthy();
});

test('rule 16 — back from the bank with a voucher’s remainder: the use is read by its reference and shows « Séance réservée » with its recap, the included line and the evening supplement', async () => {
  const voucher = {
    ...BOOKED,
    recap: { included: [{ label: 'Bain nordique · 1 h', detail: null, qty: 1, valueCents: 5000 }], supplement: { label: 'Supplément soirée', cents: 2000 }, extras: [], dueCents: 2000, vat: [] },
  };
  const { calls } = returnTo([voucher], { query: `gf_use=paid&gf_ref=${REF}`, statusPath: `/gift-vouchers/use/status/${REF}` });
  expect(await screen.findByText('Séance réservée')).toBeTruthy();
  const text = flat(document.querySelector('.gf-sb-done').textContent);
  expect(text).toContain('19:00 – 21:00 · 3 pers.');
  expect(text).toContain('Bain nordique · 1 h0 €inclus dans le bon');
  expect(text).toContain('Supplément soirée');
  expect(text).toContain('20,00 €');
  expect(callsTo(calls, `/gift-vouchers/use/status/${REF}`)).toHaveLength(1);
});

test('rule 16 — a reference that is not a token is not asked of the server; back from the bank with a voucher’s remainder, the page says what it knows', async () => {
  window.history.replaceState(null, '', '/reserver/?gf_session=pas-un-jeton');
  const { calls } = setup();
  await screen.findByText('Réserver une séance');
  expect(callsTo(calls, '/sessions/status/pas-un-jeton')).toHaveLength(0);
  resetPage();
  window.history.replaceState(null, '', '/reserver/?gf_use=paid');
  const harness = setup();
  expect(await screen.findByText('Paiement reçu : la confirmation arrive par mail dès que la banque l’a validé.')).toBeTruthy();
  expect(harness.calls).toHaveLength(0);
});
