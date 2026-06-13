import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import ReservationSasDialog from '../ReservationSasDialog';
import api from '../../../api';

// Mock the API the dialog consumes.
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 85 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

const BASE_RES = {
  id: 1, firstName: 'Jean', lastName: 'Dupont', propertyName: 'Tente', platform: 'direct',
  startDate: '2026-07-10', endDate: '2026-07-12', checkInTime: '15:00', checkOutTime: '10:00',
  adults: 1, teens: 0, children: 0, babies: 0, doubleBeds: 0, singleBeds: 0, babyBeds: 0,
  options: [], resources: [], complementAmount: 0, complementPaid: 0,
  cautionAmount: 500, cautionReceived: 0, cautionReturned: 0,
};

function sasPayload(over = {}) {
  return {
    reservation: { ...BASE_RES, ...(over.reservation || {}) },
    portalCode: over.portalCode || '',
    cleaning: over.cleaning || { included: false, price: 80 },
    linenItems: over.linenItems || [{ id: 1, label: 'Taie d\'oreiller', price: 5, category: 'bed' }],
    breakfast: over.breakfast, // undefined → breakfast page hidden
  };
}

function renderDialog(props) {
  return render(
    <MemoryRouter>
      <ReservationSasDialog open reservationId={1} onClose={() => {}} onCommitted={() => {}} {...props} />
    </MemoryRouter>,
  );
}

const clickBtn = (name) => fireEvent.click(screen.getByRole('button', { name }));

beforeEach(() => { vi.clearAllMocks(); });

test('arrival SAS: full flow — caution Fait, linen Pas OK reveals the priced items, commit payload', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { bedLinenAlert: { type: 'no_linen' } },
  }));
  renderDialog({ mode: 'arrival' });

  // intro
  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // caution page
  await screen.findByText(/Caution à percevoir/);
  clickBtn('Fait');

  // options skipped (none) → linen page
  await screen.findByText(/n'a pas pris le linge de lit/);
  // Regression: « Pas OK » must reveal the priced-items page (was skipped).
  clickBtn('Pas OK');
  await screen.findByText('Éléments de linge manquants');
  expect(screen.getByText('Taie d\'oreiller')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '+' })); // qty 1 → 5 €
  clickBtn('Suivant');

  // cleaning (not included) → add it
  await screen.findByText(/n'a pas été pris/);
  clickBtn('Ajouter le ménage');

  // recap
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText(/Total : 85,00 €/)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas).toHaveBeenCalledWith(1, {
    cautionReceived: true,
    complementItems: [
      { label: 'Taie d\'oreiller', amount: 5 },
      { label: 'Ménage', amount: 80 },
    ],
    departureHandoverNote: '',
  });
});

test('arrival SAS: linen OK skips the priced-items page', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { bedLinenAlert: { type: 'capacity', capacity: 1, required: 2 }, cautionReceived: 1 },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  // caution skipped (received) → linen page (capacity variant)
  await screen.findByText(/ne couvre pas le nombre de personnes/);
  clickBtn('OK');
  // → cleaning (included reminder), NOT the priced-items page
  await screen.findByText(/Le ménage est inclus/);
  expect(screen.queryByText('Éléments de linge manquants')).toBeNull();
});

// ---- breakfast page (specs/sas-breakfast-and-handover-note.md) ----

function breakfastPayload(over = {}) {
  return sasPayload({
    reservation: { cautionAmount: 0, ...(over.reservation || {}) }, // no caution page
    cleaning: { included: true, price: null },                      // cleaning = simple Suivant
    breakfast: { applicable: true, persons: 2, time: '09:00', coffee: 0, tea: 0, chocolate: 0, note: '' },
    ...over,
  });
}

test('arrival SAS: breakfast page hidden when not applicable', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({ reservation: { cautionReceived: 1 }, cleaning: { included: true, price: null } }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  // no breakfast key in payload → straight to cleaning (no « Petit déjeuner » page)
  await screen.findByText(/Le ménage est inclus/);
  expect(screen.queryByText('Petit déjeuner')).toBeNull();
});

test('arrival SAS: breakfast mismatch shows the confirm; after Continuer, counts + handover note reach the payload', async () => {
  api.getReservationSas.mockResolvedValue(breakfastPayload());
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // breakfast page (persons 2)
  await screen.findByText('Petit déjeuner');
  fireEvent.click(screen.getAllByRole('button', { name: '+' })[0]); // café → 1 (total 1 ≠ 2 persons)
  clickBtn('Suivant');

  // coherence warning confirm
  await screen.findByText(/ne correspond pas au nombre de personnes/);
  clickBtn('Continuer');

  // cleaning (included) → recap. findByRole retries until the confirm's close transition
  // lifts the background aria-hidden (otherwise « Suivant » isn't yet accessible).
  fireEvent.click(await screen.findByRole('button', { name: 'Suivant' }));
  await screen.findByText('Récapitulatif — complément à percevoir');
  fireEvent.change(screen.getByLabelText(/Note pour le départ/), { target: { value: 'clé sous le pot' } });
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.breakfastCoffee).toBe(1);
  expect(arg.breakfastTea).toBe(0);
  expect(arg.breakfastChocolate).toBe(0);
  expect(arg.breakfastTime).toBe('09:00');
  expect(arg.departureHandoverNote).toBe('clé sous le pot');
});

test('arrival SAS: breakfast total matching persons advances with NO confirm', async () => {
  api.getReservationSas.mockResolvedValue(breakfastPayload());
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Petit déjeuner');
  const plus = screen.getAllByRole('button', { name: '+' });
  fireEvent.click(plus[0]); // café 1
  fireEvent.click(plus[1]); // thé 1 → total 2 = persons 2
  clickBtn('Suivant');
  // no confirm — straight to cleaning
  await screen.findByText(/Le ménage est inclus/);
  expect(screen.queryByText(/ne correspond pas au nombre de personnes/)).toBeNull();
});

test('departure SAS: shows the read-only handover note left at arrival', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0, departureHandoverNote: 'Récupérer la 2e clé' },
    cleaning: { included: true, price: 80 },
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  expect(screen.getByText('Note laissée à l\'arrivée')).toBeInTheDocument();
  expect(screen.getByText('Récupérer la 2e clé')).toBeInTheDocument();
});

test('departure SAS: cleaning page asks « fait correctement » (not the arrival UI) and commits the end-of-stay complement', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: 80 },
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // Regression: departure cleaning shows the OK/Pas OK question, not « Ajouter le ménage ».
  await screen.findByText(/Le ménage de fin de séjour a-t-il été fait correctement/);
  expect(screen.queryByRole('button', { name: 'Ajouter le ménage' })).toBeNull();
  clickBtn('Pas OK'); // → +80 end-of-stay

  // missing items? → Non
  await screen.findByText(/serviettes ou des draps sont-ils manquants/);
  clickBtn('Non');

  // keys → Oui
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');

  // recap (caution page skipped: cautionAmount 0)
  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText(/Total à percevoir : 80,00 €/)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.endOfStayComplementAmount).toBe(80);
  expect(arg.cautionReturned).toBe(false);
});
