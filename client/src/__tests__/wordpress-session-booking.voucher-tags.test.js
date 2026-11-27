// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 15-17 — the slots of a voucher carry the server's tag: « Inclus », « + x € » (a supplement), « Inclus · boisson offerte »
// (a cheaper slot) and « Inclus · 2 h + boisson offerte »; the recap lists the 0 € lines « Heure offerte » and « Boisson offerte ». The page computes nothing.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  BATH, setup, firstFreeDay, slotButton, validCode, resetPage,
} from './wordpressSessionFixtures';

afterEach(resetPage);

const VOUCHER = {
  kind: 'resource',
  title: 'Une heure de bain nordique en soirée · week-end',
  number: 'BC-2026-0042',
  resource: {
    id: 3, name: 'Bain nordique', band: 'evening', minutes: 60, stepMinutes: 60, maxMinutes: 720, maxPeople: 8,
  },
  contents: [{ kind: 'session', label: 'Bain nordique', detail: '1 h en soirée', qty: 1 }],
  recipientName: 'Julien',
  senderName: 'Claire',
  message: '',
  expiresOn: '2099-01-01', // date-literal-ok: a payload the mocked server answers; the screen only shows it
  usedOn: null,
  addOns: [],
  extraTime: null,
  horizonUntil: BATH.horizonUntil,
  termsVersionId: 9,
};

const TAGS = [
  { start: '10:00', end: '12:00', tag: 'twoHoursDrink', supplementCents: 0, dueCents: 0, evening: false },
  { start: '12:00', end: '13:00', tag: 'drink', supplementCents: 0, dueCents: 0, evening: false },
  { start: '13:00', end: '14:00', tag: 'in', supplementCents: 0, dueCents: 0, evening: false },
  { start: '14:00', end: '15:00', tag: 'supplement', supplementCents: 2000, supplementLabel: 'Supplément soirée week-end', dueCents: 2000, evening: true },
];

function voucherSetup() {
  return setup({
    routes: (method, p, body) => {
      if (p === '/gift-vouchers/use') return { status: 200, body: { data: VOUCHER } };
      if (p === '/gift-vouchers/use/slots') return { status: 200, body: { data: { horizonUntil: VOUCHER.horizonUntil, days: [{ date: `${body.from.slice(0, 8)}20`, slots: TAGS }] } } };
      if (p === '/gift-vouchers/use/quote') {
        const doubled = body.start.endsWith('T10:00');
        return {
          status: 200,
          body: {
            data: {
              date: body.start.slice(0, 10),
              start: body.start.slice(11),
              end: doubled ? '12:00' : '13:00',
              included: [{ label: 'Bain nordique · 1 h', detail: null, qty: 1, valueCents: 5000, vatRate: 10 }],
              supplement: null,
              gifts: [...(doubled ? [{ label: 'Heure offerte', detail: '1 h' }] : []), { label: 'Boisson offerte', detail: null }],
              extras: [],
              extrasCents: 0,
              dueCents: 0,
              totalCents: 5000,
              vat: [],
            },
          },
        };
      }
      return null;
    },
  });
}

const applyTyped = async (code) => {
  fireEvent.change(screen.getByLabelText('Code bon cadeau'), { target: { value: code } });
  fireEvent.click(screen.getByText('Appliquer'));
  await waitFor(() => expect(document.querySelector('.gf-sb-msg').textContent).toContain('Bon n° BC-2026-0042'));
};

test('rules 15-17 — each slot says what the server tagged it, the supplement keeping its « + x € »', async () => {
  voucherSetup();
  await screen.findByLabelText('Code bon cadeau');
  await applyTyped(validCode());
  fireEvent.click(await firstFreeDay());
  const text = async (start) => (await slotButton(start)).querySelector('span').textContent.replace(/\s/g, ' ');
  expect(await text('10:00')).toBe('Inclus · 2 h + boisson offerte');
  expect(await text('12:00')).toBe('Inclus · boisson offerte');
  expect(await text('13:00')).toBe('Inclus dans le bon');
  expect(await text('14:00')).toMatch(/^\+ 20 € · soirée$/);
});

test('rule 17 — the recap of a doubled slot lists the offered hour and the drink at 0 €, and the end of the longer session', async () => {
  voucherSetup();
  await screen.findByLabelText('Code bon cadeau');
  await applyTyped(validCode());
  fireEvent.click(await firstFreeDay());
  fireEvent.click(await slotButton('10:00'));
  await waitFor(() => expect(document.querySelector('.gf-summary').textContent).toMatch(/Heure offerte/));
  const summary = document.querySelector('.gf-summary').textContent.replace(/\s/g, ' ');
  expect(summary).toMatch(/Boisson offerte/);
  expect(summary).toMatch(/10:00 – 12:00/);
});
