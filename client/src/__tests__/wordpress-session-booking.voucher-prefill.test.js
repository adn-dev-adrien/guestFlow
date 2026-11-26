// specs/site-outside-resource-booking.md §3.G rules 28-31 — « Réserver une séance »: no hold notice, « Choisissez un horaire » (muted, red after a press without a slot), a voucher's contents
// listed at « 0 € · inclus dans le bon » before any slot and then from the quote, and the recipient's names filling the contact only where it is empty.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  BATH, setup, flat, pickSlot, slotButton, firstFreeDay, barButton, validCode, resetPage,
} from './wordpressSessionFixtures';

afterEach(resetPage);

const VOUCHER = {
  kind: 'resource',
  title: 'Une heure de bain nordique en journée',
  number: 'BC-2026-0042',
  resource: {
    id: 3, name: 'Bain nordique', band: 'day', minutes: 60, stepMinutes: 60, maxMinutes: 720, maxPeople: 8,
  },
  contents: [
    { kind: 'session', label: 'Bain nordique', detail: '1 h en journée · de 10:00 à 19:00', qty: 1 },
    { kind: 'option', label: 'Planche apéro', detail: null, qty: 2 },
    { kind: 'addOn', label: 'Peignoir', detail: null, qty: 3 },
  ],
  recipientName: 'Julien',
  recipientFirstName: 'Julien',
  recipientLastName: 'Moreau',
  senderName: 'Claire',
  message: '',
  expiresOn: '2099-01-01', // date-literal-ok: a payload the mocked server answers; the screen only shows it
  usedOn: null,
  addOns: [],
  extraTime: null,
  horizonUntil: BATH.horizonUntil,
  termsVersionId: 9,
};

const INCLUDED = [
  { label: 'Bain nordique · 1 h', detail: null, qty: 1, valueCents: 5000, vatRate: 10 },
  { label: 'Planche apéro', detail: null, qty: 2, valueCents: 2800, vatRate: 10 },
  { label: 'Peignoir', detail: null, qty: 3, valueCents: 1800, vatRate: 20 },
];

function voucherSetup(voucher = VOUCHER) {
  return setup({
    routes: (method, p, body) => {
      if (p === '/gift-vouchers/use') return { status: 200, body: { data: voucher } };
      if (p === '/gift-vouchers/use/slots') {
        return {
          status: 200,
          body: { data: { horizonUntil: VOUCHER.horizonUntil, days: [{ date: `${body.from.slice(0, 8)}20`, slots: [{ start: '10:00', end: '11:00', dueCents: 0, evening: false }] }] } },
        };
      }
      if (p === '/gift-vouchers/use/quote') {
        return {
          status: 200,
          body: {
            data: {
              date: body.start.slice(0, 10), start: '10:00', end: '11:00', included: INCLUDED, supplement: null, extras: [], extrasCents: 0, dueCents: 0, totalCents: 0, vat: [],
            },
          },
        };
      }
      return null;
    },
  });
}

const apply = async () => {
  fireEvent.change(await screen.findByLabelText('Code bon cadeau'), { target: { value: validCode() } });
  fireEvent.click(screen.getByText('Appliquer'));
};
const summary = () => document.querySelector('.gf-summary');
const dateLine = () => document.querySelector('.gf-summary-dates');
const names = () => {
  const [first, last, email, phone] = document.querySelectorAll('.gf-sb-who input');
  return { first, last, email, phone };
};

test('rule 28 — nothing is said about the 15-minute hold under the button, before or after a slot', async () => {
  setup();
  await screen.findByText('Réserver une séance');
  expect(summary().textContent).not.toContain('15 minutes');
  await pickSlot('10:00');
  expect(summary().textContent).not.toContain('15 minutes');
  expect(document.querySelector('.gf-sb-hold')).toBeNull();
});

test('rule 29 — « Choisissez un horaire » is muted, turns red when the button is pressed without a slot (in-flow or bar), and is muted again once a slot is chosen', async () => {
  setup();
  await screen.findByText('Réserver une séance');
  expect(dateLine().textContent).toBe('Choisissez un horaire');
  expect(dateLine().classList.contains('is-missing')).toBe(false);
  expect(dateLine().getAttribute('role')).toBe('status');
  fireEvent.click(barButton());
  expect(dateLine().classList.contains('is-missing')).toBe(true);
  fireEvent.click(await firstFreeDay());
  fireEvent.click(await slotButton('10:00'));
  await waitFor(() => expect(dateLine().textContent).toContain('10:00 – 11:00'));
  expect(dateLine().classList.contains('is-missing')).toBe(false);
  fireEvent.click(summary().querySelector('.gf-summary-cta'));
  expect(dateLine().classList.contains('is-missing')).toBe(false);
});

test('rule 29 — the red goes back to muted when the duration or the activity changes', async () => {
  const sauna = { ...BATH, id: 4, name: 'Sauna' };
  setup({ resources: [BATH, sauna] });
  await screen.findByText('Réserver une séance');
  fireEvent.click(summary().querySelector('.gf-summary-cta'));
  expect(dateLine().classList.contains('is-missing')).toBe(true);
  fireEvent.click(document.querySelector('.gf-step[aria-label="Durée"] .gf-step-btn:last-child'));
  expect(dateLine().classList.contains('is-missing')).toBe(false);
  fireEvent.click(barButton());
  expect(dateLine().classList.contains('is-missing')).toBe(true);
  fireEvent.click(document.querySelector('.gf-sb-act[data-resource="4"]'));
  expect(dateLine().classList.contains('is-missing')).toBe(false);
});

test('rule 29 — the red goes back to muted when a voucher is applied', async () => {
  voucherSetup();
  await screen.findByText('Réserver une séance');
  fireEvent.click(barButton());
  expect(dateLine().classList.contains('is-missing')).toBe(true);
  await apply();
  await waitFor(() => expect(screen.getByText('Retirer')).toBeTruthy());
  expect(dateLine().classList.contains('is-missing')).toBe(false);
});

test('rule 30 — an accepted voucher lists every line of its contents at « 0 € » with « inclus dans le bon » under it, before any slot', async () => {
  voucherSetup();
  await screen.findByText('Réserver une séance');
  expect(document.querySelectorAll('.gf-sb-summary-line.is-included')).toHaveLength(0);
  await apply();
  await waitFor(() => expect(document.querySelectorAll('.gf-sb-summary-line.is-included')).toHaveLength(3));
  const lines = [...document.querySelectorAll('.gf-sb-summary-line.is-included')].map((l) => flat(l.textContent));
  expect(lines).toEqual([
    'Bain nordique1 h en journée · de 10:00 à 19:000 €inclus dans le bon',
    '2 × Planche apéro0 €inclus dans le bon',
    '3 × Peignoir0 €inclus dans le bon',
  ]);
  expect(document.querySelector('.gf-sb-summary-line.is-included span:last-child small').textContent).toBe('inclus dans le bon');
  expect(summary().textContent).not.toContain('Rien à payer');
});

test('rule 30 — once a slot is chosen the quote’s included lines are drawn the same way, not as a bare « Inclus »', async () => {
  voucherSetup();
  await screen.findByText('Réserver une séance');
  await apply();
  await waitFor(() => expect(screen.getByText('Retirer')).toBeTruthy());
  await pickSlot('10:00');
  const lines = [...document.querySelectorAll('.gf-sb-summary-line.is-included')].map((l) => flat(l.textContent));
  expect(lines).toEqual([
    'Bain nordique · 1 h0 €inclus dans le bon',
    '2 × Planche apéro0 €inclus dans le bon',
    '3 × Peignoir0 €inclus dans le bon',
  ]);
  expect(flat(summary().textContent)).not.toMatch(/Inclus(?! dans)/);
});

test('rule 31 — the recipient’s first and last names fill the empty name fields; the e-mail, the phone and the people stay as they are', async () => {
  voucherSetup();
  await screen.findByText('Réserver une séance');
  await apply();
  await waitFor(() => expect(names().first.value).toBe('Julien'));
  expect(names().last.value).toBe('Moreau');
  expect([names().email.value, names().phone.value]).toEqual(['', '']);
  expect(flat(document.querySelector('.gf-step[aria-label="Personnes"]').textContent)).toContain('2');
});

test('rule 31 — a name the visitor already typed is never overwritten, the other is still filled; « Retirer » clears only what the voucher filled', async () => {
  voucherSetup();
  await screen.findByText('Réserver une séance');
  fireEvent.input(names().first, { target: { value: 'Marie' } });
  await apply();
  await waitFor(() => expect(names().last.value).toBe('Moreau'));
  expect(names().first.value).toBe('Marie');
  fireEvent.click(screen.getByText('Retirer'));
  expect(names().first.value).toBe('Marie');
  expect(names().last.value).toBe('');
});

test('rule 31 — « Retirer » keeps a filled name the visitor then edited', async () => {
  voucherSetup();
  await screen.findByText('Réserver une séance');
  await apply();
  await waitFor(() => expect(names().first.value).toBe('Julien'));
  fireEvent.input(names().last, { target: { value: 'Moreau-Petit' } });
  fireEvent.click(screen.getByText('Retirer'));
  expect(names().first.value).toBe('');
  expect(names().last.value).toBe('Moreau-Petit');
});

test('rule 31 — a voucher with no last name (sold before the split) fills nothing', async () => {
  voucherSetup({ ...VOUCHER, recipientLastName: '' });
  await screen.findByText('Réserver une séance');
  await apply();
  await waitFor(() => expect(screen.getByText('Retirer')).toBeTruthy());
  expect([names().first.value, names().last.value]).toEqual(['', '']);
});
