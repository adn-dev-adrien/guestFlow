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
    repairAmounts: over.repairAmounts || [],
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

  // extinguisher (default present) → Suivant
  await screen.findByText(/plomb de l'extincteur/i);
  clickBtn('Suivant');

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
    extinguisherSealOkAtArrival: 1,
  });
});

test('arrival SAS reopen: pre-fills the prior commit (caution shown despite received) + re-commit sends the reconstructed complement once', async () => {
  // specs/reopen-completed-sas.md §2/§3 — a completed SAS reopens with its data; the caution step
  // stays reachable in edit mode; the SAS-origin complement is reconstructed and re-sent without dup.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      arrivalSasDoneAt: '2026-07-10 15:00:00',
      cautionReceived: 1,                                // fresh mode would SKIP the caution step
      extinguisherSealOkAtArrival: 1,
      departureHandoverNote: 'Clé sous le pot',
      // complementAmount already INCLUDES the prior SAS line (5 €) — the recap must subtract it from
      // « déjà dû » so the total stays 5 €, not double it to 10 € (specs/reopen-completed-sas.md §4).
      complementAmount: 5,
      // The prior SAS complement, surfaced as a SAS-origin custom option (as getByIdWithDetails does).
      options: [{ isCustom: 1, sasArrivalOrigin: 1, inComplement: 1, description: 'Taie d\'oreiller', unitPrice: 5 }],
    },
    cleaning: { included: true, price: null },           // cleaning = simple Suivant
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // Edit mode: caution step shown even though already received; keep « Fait ».
  await screen.findByText(/Caution à percevoir/);
  clickBtn('Fait');

  // The reconstructed complement is a custom option → the prestations step shows; just go through it.
  fireEvent.click(await screen.findByRole('button', { name: 'Suivant' }));
  // cleaning included → Suivant ; extinguisher → Suivant
  await screen.findByText(/Le ménage est inclus/);
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
  await screen.findByText(/plomb de l'extincteur/i);
  fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText(/Total : 5,00 €/)).toBeInTheDocument(); // reconstructed pillow only
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.cautionReceived).toBe(true);
  expect(arg.complementItems).toEqual([{ label: 'Taie d\'oreiller', amount: 5 }]); // exactly one, no dup
  expect(arg.departureHandoverNote).toBe('Clé sous le pot');
  expect(arg.extinguisherSealOkAtArrival).toBe(1);
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
  // extinguisher (default present) → Suivant
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

  // extinguisher (default present) → Suivant
  await screen.findByText(/plomb de l'extincteur/i);
  clickBtn('Suivant');

  // recap (caution page skipped: cautionAmount 0)
  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText(/Total à percevoir : 80,00 €/)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.endOfStayComplementAmount).toBe(80);
  // Caution step skipped (cautionAmount 0) → no decision sent, the marker is left untouched
  // (specs/reopen-completed-sas.md §6 tri-state).
  expect(arg.cautionReturned).toBeUndefined();
});

test('departure SAS: extinguisher seal missing (present at arrival) bills the configured amount', async () => {
  // specs/extinguisher-seal-and-repair-amounts.md — default-present switch; flipping it to manquant at
  // departure (when present at arrival) adds the « Plomb extincteur » repair amount to the end-of-stay.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0, extinguisherSealOkAtArrival: 1 },
    cleaning: { included: true, price: 80 },
    repairAmounts: [{ id: 1, repairKey: 'extinguisher_seal', label: 'Plomb extincteur', price: 30 }],
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('OK'); // cleaning OK → no cleaning charge
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');

  // extinguisher: default present → flip the switch to manquant
  await screen.findByText(/plomb de l'extincteur/i);
  fireEvent.click(screen.getAllByRole('switch')[0]);
  await screen.findByText(/Plomb extincteur facturé/);
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText(/Total à percevoir : 30,00 €/)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.endOfStayComplementAmount).toBe(30);
  expect(arg.extinguisherSealOkAtDeparture).toBe(0);
  expect(arg.endOfStayComplementDetail.some((l) => l.label === 'Plomb extincteur' && l.amount === 30)).toBe(true);
});
