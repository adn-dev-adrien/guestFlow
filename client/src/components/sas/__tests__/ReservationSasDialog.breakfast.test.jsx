// The « Petit déjeuner » page — specs/sas-breakfast-and-handover-note.md, sas-breakfast-milk-and-food.md
//
// One file per subject (CLAUDE.md §9): two features appending their cases no longer collide on
// the last line of a shared suite. Fixtures used by more than one subject live in ./sasFixtures.
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

// Mock the API the dialog consumes.
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 85 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    // Weather alerts (specs/checkin-weather-alerts.md) — fired in the background on arrival open.
    // Default to "no alert" so the wizard flow under test is unchanged.
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

beforeEach(() => { vi.clearAllMocks(); });

// ---- breakfast page (specs/sas-breakfast-and-handover-note.md + sas-breakfast-milk-and-food.md) ----

function breakfastPayload(over = {}) {
  return sasPayload({
    reservation: { cautionAmount: 0, ...(over.reservation || {}) }, // no caution page
    cleaning: { included: true, price: null },                      // cleaning = simple Suivant
    breakfast: { applicable: true, persons: 2, time: '09:00', coffee: 0, tea: 0, chocolate: 0, milk: 0, pastries: 0, cereals: 0, bread: 0, note: '' },
    ...over,
  });
}

// Stepper « + » buttons, in render order: café, thé, chocolat, lait, viennoiseries, céréales, pain.
const PLUS = { coffee: 0, tea: 1, chocolate: 2, milk: 3, pastries: 4, cereals: 5, bread: 6 };

test('arrival SAS: breakfast page hidden when not applicable', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({ reservation: { cautionReceived: 1 }, cleaning: { included: true, price: null } }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  // no breakfast key + cleaning included + caution received → straight to recap (no « Petit déjeuner » page)
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText('Petit déjeuner')).toBeNull();
});

test('arrival SAS: breakfast mismatch shows the confirm; after Continuer, counts + handover note reach the payload', async () => {
  api.getReservationSas.mockResolvedValue(breakfastPayload());
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // breakfast page (persons 2): drinks 1 ≠ 2 AND food 0 ≠ 2 → combined plural message
  await screen.findByText('Petit déjeuner');
  fireEvent.click(screen.getAllByRole('button', { name: '+' })[PLUS.coffee]); // café → 1
  clickBtn('Suivant');

  // coherence warning confirm (both categories named)
  await screen.findByText(/Le nombre de boissons \(1\) et le nombre d'aliments \(0\) ne correspondent pas au nombre de personnes \(2\)/);
  clickBtn('Continuer');

  // cleaning included is hidden → « Continuer » lands directly on the recap. findByRole retries until the
  // confirm's close transition lifts the background aria-hidden (otherwise the button isn't yet accessible).
  await screen.findByText('Récapitulatif — complément à percevoir');
  const validate = await screen.findByRole('button', { name: 'Valider et terminer' });
  fireEvent.change(screen.getByLabelText(/Note pour le départ/), { target: { value: 'clé sous le pot' } });
  fireEvent.click(validate);

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.breakfastCoffee).toBe(1);
  expect(arg.breakfastTea).toBe(0);
  expect(arg.breakfastChocolate).toBe(0);
  expect(arg.breakfastMilk).toBe(0);
  expect(arg.breakfastPastries).toBe(0);
  expect(arg.breakfastCereals).toBe(0);
  expect(arg.breakfastBread).toBe(0);
  expect(arg.breakfastTime).toBe('09:00');
  expect(arg.departureHandoverNote).toBe('clé sous le pot');
});

test('arrival SAS: milk and food counts reach the payload; food-only mismatch names only aliments', async () => {
  api.getReservationSas.mockResolvedValue(breakfastPayload());
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Petit déjeuner');
  const plus = screen.getAllByRole('button', { name: '+' });
  fireEvent.click(plus[PLUS.coffee]);   // café 1
  fireEvent.click(plus[PLUS.milk]);     // lait 1 → drinks 2 = persons ✓
  fireEvent.click(plus[PLUS.pastries]); // viennoiseries 1 → food 1 ≠ 2
  clickBtn('Suivant');

  // food-only mismatch → singular message, drinks not named
  await screen.findByText(/Le nombre d'aliments \(1\) ne correspond pas au nombre de personnes \(2\)/);
  clickBtn('Continuer');

  await screen.findByText('Récapitulatif — complément à percevoir');
  fireEvent.click(await screen.findByRole('button', { name: 'Valider et terminer' }));
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.breakfastMilk).toBe(1);
  expect(arg.breakfastPastries).toBe(1);
  expect(arg.breakfastCereals).toBe(0);
});

test('arrival SAS: drinks AND food totals matching persons advance with NO confirm', async () => {
  api.getReservationSas.mockResolvedValue(breakfastPayload());
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Petit déjeuner');
  const plus = screen.getAllByRole('button', { name: '+' });
  fireEvent.click(plus[PLUS.coffee]);   // café 1
  fireEvent.click(plus[PLUS.tea]);      // thé 1 → drinks 2 = persons 2
  fireEvent.click(plus[PLUS.pastries]); // viennoiseries 1
  fireEvent.click(plus[PLUS.cereals]);  // céréales 1 → food 2 = persons 2
  clickBtn('Suivant');
  // no confirm — straight to recap (cleaning included is hidden)
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText(/ne correspond(ent)? pas au nombre de personnes/)).toBeNull();
});

test('arrival SAS: bread steps by 0,5 (French display), rides the payload; server defaults render as-is', async () => {
  // The server pre-fills the smart defaults (pastries = persons, bread = persons × 0.5)
  // while the SAS was never committed — the dialog renders them verbatim.
  api.getReservationSas.mockResolvedValue(breakfastPayload({
    breakfast: { applicable: true, persons: 2, time: '09:00', coffee: 0, tea: 0, chocolate: 0, milk: 0, pastries: 2, cereals: 0, bread: 1, note: '' },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Petit déjeuner');
  expect(screen.getByText('Pain (baguette)')).toBeInTheDocument();

  const plus = screen.getAllByRole('button', { name: '+' });
  fireEvent.click(plus[PLUS.bread]); // 1 → 1,5
  expect(screen.getByDisplayValue('1,5')).toBeInTheDocument();

  fireEvent.click(plus[PLUS.coffee]);
  fireEvent.click(plus[PLUS.tea]); // drinks 2 = persons; food 2 = persons (pastries default)
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  fireEvent.click(await screen.findByRole('button', { name: 'Valider et terminer' }));
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.breakfastPastries).toBe(2); // server default kept
  expect(arg.breakfastBread).toBe(1.5);
});
