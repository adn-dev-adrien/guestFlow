// Selling the breakfast and the catering catalogue at check-in — specs/sas-breakfast-and-catering-upsell.md, card-option-served-persons.md
//
// One file per subject (CLAUDE.md §9): two features appending their cases no longer collide on
// the last line of a shared suite. Fixtures used by more than one subject live in ./sasFixtures.
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, BREAKFAST_OFFER, MEAL_OFFER, BOARD_OFFER, salesPayload, renderDialog, clickBtn } from './sasFixtures';

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

// ── Prestations sold at check-in (specs/sas-breakfast-and-catering-upsell.md) ────────────────

test('arrival SAS: selling the breakfast — mornings pre-selected, count shown, composition seeded', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2 },
    cleaning: { included: true, price: 80 },
    sasSales: salesPayload({ breakfast: BREAKFAST_OFFER }),
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // Offer page: the per-morning price and how many mornings the stay allows.
  await screen.findByText(/n'a pas pris le petit déjeuner/);
  expect(screen.getByText(/2 matins possibles sur ce séjour/)).toBeInTheDocument();
  clickBtn('Ajouter le petit déjeuner');

  // Mornings page: every morning pre-checked, quantity read like the fiche (2 × 2 pers.).
  await screen.findByText('Quels matins ?');
  expect(screen.getByText(/\(2 × 2 pers\. servies\)/)).toBeInTheDocument();
  expect(screen.getByText(/4 petits déjeuners — 32,00 €/)).toBeInTheDocument();
  clickBtn('Suivant');

  // Composition page, seeded with the defaults of a fresh check-in (2 viennoiseries, 1 baguette).
  await screen.findByLabelText('Heure du petit déjeuner');
  expect(screen.getByText('Viennoiseries').closest('div').parentElement).toBeTruthy();
  expect(screen.getByText(/2 à manger pour 2 personnes/)).toBeInTheDocument();
  clickBtn('Suivant');
  // Drinks are still 0 → the coherence warning asks for a confirmation.
  await screen.findByText('Quantités ≠ personnes');
  clickBtn('Continuer');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText(/Petit déjeuner : 4 × 8,00 € = 32,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Total : 32,00 €/)).toBeInTheDocument();
  // findBy…: the confirm dialog that just closed leaves the wizard aria-hidden for a tick.
  fireEvent.click(await screen.findByRole('button', { name: 'Valider et terminer' }));

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect(payload.soldOptions).toEqual([{
    optionId: 6,
    occurrences: [{ date: '2026-07-11', time: '09:00' }, { date: '2026-07-12', time: '09:00' }],
    persons: 2,
  }]);
  expect(payload.breakfastPastries).toBe(2);
  expect(payload.breakfastBread).toBe(1);
  expect(payload.breakfastTime).toBe('09:00');
});

test('arrival SAS: « Non merci » on the breakfast sells nothing and skips the mornings', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2 },
    cleaning: { included: true, price: 80 },
    sasSales: salesPayload({ breakfast: BREAKFAST_OFFER }),
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/n'a pas pris le petit déjeuner/);
  clickBtn('Non merci');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText('Quels matins ?')).toBeNull();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].soldOptions).toEqual([]);
});

test('arrival SAS: unselecting every morning drops the sale, with a warning', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2 },
    cleaning: { included: true, price: 80 },
    breakfast: { applicable: false },
    sasSales: salesPayload({ breakfast: BREAKFAST_OFFER }),
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/n'a pas pris le petit déjeuner/);
  clickBtn('Ajouter le petit déjeuner');

  await screen.findByText('Quels matins ?');
  fireEvent.click(screen.getAllByText('09:00')[0]);   // uncheck the first morning
  expect(screen.getByText(/2 petits déjeuners — 16,00 €/)).toBeInTheDocument();
  fireEvent.click(screen.getAllByText('09:00')[1]);   // …and the second
  expect(screen.getByText(/Aucun matin sélectionné/)).toBeInTheDocument();
  clickBtn('Suivant');

  await screen.findByLabelText('Heure du petit déjeuner');
  clickBtn('Suivant');
  await screen.findByText('Quantités ≠ personnes');
  clickBtn('Continuer');
  await screen.findByText('Récapitulatif — complément à percevoir');
  fireEvent.click(await screen.findByRole('button', { name: 'Valider et terminer' }));

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].soldOptions).toEqual([]);
});

test('arrival SAS re-open: a breakfast this SAS sold reopens on its own mornings', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2, arrivalSasDoneAt: '2026-07-10 16:00:00' },
    cleaning: { included: true, price: 80 },
    breakfast: { applicable: true, persons: 2, time: '09:00', coffee: 2, tea: 0, chocolate: 0, milk: 0, pastries: 2, cereals: 0, bread: 1, note: '' },
    sasSales: salesPayload({
      breakfast: { ...BREAKFAST_OFFER, sasOrigin: true, selected: [{ date: '2026-07-12', time: '09:00' }] },
    }),
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // The booked-breakfast composition page comes first (the option now exists on the reservation).
  await screen.findByLabelText('Heure du petit déjeuner');
  clickBtn('Suivant');

  await screen.findByText(/n'a pas pris le petit déjeuner/);
  expect(screen.getByText('Petit déjeuner ajouté')).toBeInTheDocument();
  clickBtn('Ajouter le petit déjeuner');

  await screen.findByText('Quels matins ?');
  expect(screen.getByText(/2 petits déjeuners — 16,00 €/)).toBeInTheDocument();  // only the sold morning
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].soldOptions).toEqual([
    { optionId: 6, occurrences: [{ date: '2026-07-12', time: '09:00' }], persons: 2 },
  ]);
});

test('arrival SAS: the restauration page sells a meal by its moment and a board by quantity', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2 },
    cleaning: { included: true, price: 80 },
    sasSales: salesPayload({ catering: { available: true, options: [MEAL_OFFER, BOARD_OFFER] } }),
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  await screen.findByText(/souhaite-t-il de la restauration/);
  clickBtn('Oui, proposer');

  await screen.findByText('Le repas des trappeurs');
  // Card option: taken by its switch, then billed by the moment → 1 × 2 pers. × 25 €.
  fireEvent.click(screen.getByRole('switch', { name: 'Le repas des trappeurs' }));
  fireEvent.click(screen.getAllByText('19:30')[0]);
  expect(screen.getByText(/\(1 × 2 pers\. servies\) = 50,00 €/)).toBeInTheDocument();
  // Plain option: the switch fills the quantity in (per_stay → 1).
  fireEvent.click(screen.getByRole('switch', { name: 'Planche S' }));
  expect(screen.getByText(/Total restauration : 67,00 €/)).toBeInTheDocument();
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText(/Le repas des trappeurs : 2 × 25,00 € = 50,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Planche S : 17,00 €/)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].soldOptions).toEqual([
    { optionId: 16, occurrences: [{ date: '2026-07-11', time: '19:30' }], persons: 2 },
    { optionId: 27, units: 1 },
  ]);
});

test('arrival SAS: no sale steps when nothing is on offer, and no soldOptions in the payload', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1 },
    cleaning: { included: true, price: 80 },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText(/n'a pas pris le petit déjeuner/)).toBeNull();
  expect(screen.queryByText(/souhaite-t-il de la restauration/)).toBeNull();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].soldOptions).toBeUndefined();
});

test('arrival SAS re-open: declining a prior sale skips its sub-pages instead of dead-ending on them', async () => {
  // The sub-pages are active on load (a prior run sold both), so « Non merci » must jump PAST them:
  // `activeKeys` still lists them when the handler runs, and landing there is a dead end.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2, arrivalSasDoneAt: '2026-07-10 16:00:00' },
    cleaning: { included: true, price: 80 },
    breakfast: { applicable: true, persons: 2, time: '09:00', coffee: 2, tea: 0, chocolate: 0, milk: 0, pastries: 2, cereals: 0, bread: 1, note: '' },
    sasSales: salesPayload({
      breakfast: { ...BREAKFAST_OFFER, sasOrigin: true, selected: [{ date: '2026-07-12', time: '09:00' }] },
      catering: { available: true, options: [{ ...BOARD_OFFER, sasOrigin: true, selectedUnits: 1 }] },
    }),
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByLabelText('Heure du petit déjeuner');   // booked-breakfast composition
  clickBtn('Suivant');

  await screen.findByText(/n'a pas pris le petit déjeuner/);
  clickBtn('Non merci');
  // Straight to the restauration question — not on « Quels matins ? », not on the composition again.
  await screen.findByText(/souhaite-t-il de la restauration/);
  expect(screen.queryByText('Quels matins ?')).toBeNull();
  clickBtn('Non merci');

  await screen.findByText('Récapitulatif — complément à percevoir');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].soldOptions).toEqual([]);
});

// ── Personnes servies (specs/card-option-served-persons.md §3.3) ─────────────────────────────
// Les enfants ne mangent pas toujours : le check-in doit pouvoir baisser le nombre de couverts.

test('arrival SAS: lowering the covers of a meal re-prices the preview and the intent', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 4 },
    cleaning: { included: true, price: 80 },
    sasSales: {
      ...salesPayload({ catering: { available: true, options: [{ ...MEAL_OFFER, persons: 4, defaultPersons: 4, selectedPersons: 4 }] } }),
      persons: 4,
    },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/souhaite-t-il de la restauration/);
  clickBtn('Oui, proposer');

  await screen.findByText('Le repas des trappeurs');
  fireEvent.click(screen.getByRole('switch', { name: 'Le repas des trappeurs' }));
  fireEvent.click(screen.getAllByText('19:30')[0]);
  // The whole table by default: 1 moment × 4 pers. × 25 €.
  expect(screen.getByText(/\(1 × 4 pers\. servies\) = 100,00 €/)).toBeInTheDocument();

  // Two children are not eating.
  const minus = screen.getAllByRole('button', { name: '−' });
  fireEvent.click(minus[minus.length - 1]);
  fireEvent.click(minus[minus.length - 1]);
  expect(screen.getByText(/\(1 × 2 pers\. servies\) = 50,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Total restauration : 50,00 €/)).toBeInTheDocument();
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText(/Le repas des trappeurs : 2 × 25,00 € = 50,00 €/)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].soldOptions).toEqual([
    { optionId: 16, occurrences: [{ date: '2026-07-11', time: '19:30' }], persons: 2 },
  ]);
});

test('arrival SAS: fewer breakfasts than guests → quantity, amount and composition follow', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 4 },
    cleaning: { included: true, price: 80 },
    sasSales: {
      ...salesPayload({ breakfast: { ...BREAKFAST_OFFER, persons: 4, defaultPersons: 4, selectedPersons: 4 } }),
      persons: 4,
    },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/n'a pas pris le petit déjeuner/);
  clickBtn('Ajouter le petit déjeuner');

  await screen.findByText('Quels matins ?');
  expect(screen.getByText(/\(2 × 4 pers\. servies\)/)).toBeInTheDocument();
  const minus = screen.getAllByRole('button', { name: '−' });
  fireEvent.click(minus[minus.length - 1]);          // 3 breakfasts a morning
  expect(screen.getByText(/\(2 × 3 pers\. servies\)/)).toBeInTheDocument();
  expect(screen.getByText(/6 petits déjeuners — 48,00 €/)).toBeInTheDocument();
  clickBtn('Suivant');

  // Composition seeded from the covers sold, not from the party: 3 pastries, 1,5 baguette.
  await screen.findByLabelText('Heure du petit déjeuner');
  expect(screen.getByText(/3 à manger pour 3 personnes/)).toBeInTheDocument();
  clickBtn('Suivant');
  await screen.findByText('Quantités ≠ personnes');
  clickBtn('Continuer');

  await screen.findByText('Récapitulatif — complément à percevoir');
  fireEvent.click(await screen.findByRole('button', { name: 'Valider et terminer' }));

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const payload = api.commitArrivalSas.mock.calls[0][1];
  expect(payload.soldOptions[0].persons).toBe(3);
  expect(payload.breakfastPastries).toBe(3);
  expect(payload.breakfastBread).toBe(1.5);
});

test('arrival SAS: the covers stepper stops at the capacity of the logement', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2 },
    cleaning: { included: true, price: 80 },
    sasSales: salesPayload({ catering: { available: true, options: [{ ...MEAL_OFFER, maxPersons: 3 }] } }),
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/souhaite-t-il de la restauration/);
  clickBtn('Oui, proposer');
  await screen.findByText('Le repas des trappeurs');
  fireEvent.click(screen.getByRole('switch', { name: 'Le repas des trappeurs' }));
  fireEvent.click(screen.getAllByText('19:30')[0]);

  const plus = screen.getAllByRole('button', { name: '+' });
  fireEvent.click(plus[plus.length - 1]);           // 2 → 3, the property seats 3
  expect(screen.getByText(/\(1 × 3 pers\. servies\)/)).toBeInTheDocument();
  expect(plus[plus.length - 1]).toBeDisabled();
});

test('arrival SAS re-open: the covers this SAS sold are pre-filled', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 4, arrivalSasDoneAt: '2026-07-10 16:00' },
    cleaning: { included: true, price: 80 },
    sasSales: {
      ...salesPayload({
        catering: {
          available: true,
          options: [{
            ...MEAL_OFFER, persons: 4, defaultPersons: 4, selectedPersons: 2, sasOrigin: true,
            selectedOccurrences: [{ date: '2026-07-11', time: '19:30' }],
          }],
        },
      }),
      persons: 4,
    },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/souhaite-t-il de la restauration/);
  clickBtn('Oui, proposer');

  await screen.findByText('Le repas des trappeurs');
  // The switch reopens ON — the moments this SAS sold stay visible and undoable.
  expect(screen.getByRole('switch', { name: 'Le repas des trappeurs' })).toBeChecked();
  expect(screen.getByText(/\(1 × 2 pers\. servies\) = 50,00 €/)).toBeInTheDocument();
});

// Reported 2026-08-30 from production: on the « Restauration » page the boards each carried a switch
// while « Le repas des trappeurs » carried nothing but a grid of grey hour chips, which reads as
// information rather than a control — the operator had no way to tell the meal could be taken at all
// (specs/sas-breakfast-and-catering-upsell.md §3.2 rule 7).
test('arrival SAS: a card option is taken by its switch, which opens (and clears) its moments', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2 },
    cleaning: { included: true, price: 80 },
    sasSales: salesPayload({ catering: { available: true, options: [MEAL_OFFER, BOARD_OFFER] } }),
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/souhaite-t-il de la restauration/);
  clickBtn('Oui, proposer');

  await screen.findByText('Le repas des trappeurs');
  // Every row carries the same control, the meal included; its moments stay closed until it is taken.
  const mealSwitch = screen.getByRole('switch', { name: 'Le repas des trappeurs' });
  expect(mealSwitch).not.toBeChecked();
  expect(screen.queryByText('19:30')).toBeNull();

  fireEvent.click(mealSwitch);
  expect(screen.getAllByText('19:30').length).toBeGreaterThan(0);
  // Nothing is pre-selected — a meal is picked moment by moment, and the caption says so.
  expect(screen.getByText('Choisissez les moments servis')).toBeInTheDocument();
  expect(screen.getByText(/Total restauration : 0,00 €/)).toBeInTheDocument();

  fireEvent.click(screen.getAllByText('19:30')[0]);
  expect(screen.getByText(/Total restauration : 50,00 €/)).toBeInTheDocument();

  // Turning it back off drops the sale, moments included.
  fireEvent.click(mealSwitch);
  expect(screen.queryByText('19:30')).toBeNull();
  expect(screen.getByText(/Total restauration : 0,00 €/)).toBeInTheDocument();
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText(/Le repas des trappeurs :/)).toBeNull();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].soldOptions).toEqual([]);
});
