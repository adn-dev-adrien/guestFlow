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
    // Weather alerts (specs/checkin-weather-alerts.md) — fired in the background on arrival open.
    // Default to "no alert" so the wizard flow under test is unchanged.
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
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
    arrivalComplement: over.arrivalComplement, // undefined → no recall at departure
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

  // cleaning (not included) → add it → recap (the extinguisher check is departure-only now)
  await screen.findByText(/n'a pas été pris/);
  clickBtn('Ajouter le ménage');

  // recap
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText(/Total : 85,00 €/)).toBeInTheDocument();
  expect(screen.queryByText(/vaisselle doit être faite/)).toBeNull(); // cleaning not included → no reminder
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas).toHaveBeenCalledWith(1, {
    cautionReceived: true,
    complementItems: [
      { label: 'Taie d\'oreiller', amount: 5 },
      { label: 'Ménage', amount: 80 },
    ],
    departureHandoverNote: '',
    // specs/recall-unpaid-arrival-complement-at-checkout.md — the « Complément encaissé » box was not
    // ticked in this flow, so the complement stays unsettled (→ recalled at checkout).
    complementSettled: false,
    complementPaidCash: false,
  });
});

test('arrival SAS intro: property photo, centred blue client name, platform badge, planning-style dates + people count', async () => {
  // specs/arrival-departure-sas.md §6 (mobile intro redesign 2026-06-15).
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      firstName: 'Jean', lastName: 'Dupont', propertyName: 'Le Moulin', propertyPhoto: '/uploads/moulin.jpg',
      platform: 'airbnb', adults: 2, children: 1, teens: 0, babies: 0,
      startDate: '2026-07-10', endDate: '2026-07-12', checkInTime: '15:00', checkOutTime: '10:00',
    },
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');

  const photo = document.querySelector('img[alt="Le Moulin"]');
  expect(photo).toBeTruthy();
  expect(photo.getAttribute('src')).toBe('/uploads/moulin.jpg');
  expect(screen.getByText('Le Moulin')).toBeInTheDocument();
  expect(screen.getByText('Jean Dupont')).toBeInTheDocument();   // client name (rendered blue + larger)
  expect(screen.getByText('ARRIVÉE')).toBeInTheDocument();        // planning-style arrival chip
  expect(screen.getByText('DÉPART')).toBeInTheDocument();         // planning-style departure chip
  expect(screen.getByText('3 personnes')).toBeInTheDocument();    // 2 adults + 1 child
});

test('arrival SAS reopen: caution hidden once received, ménage reminder rides on recap, complement reconstructed once', async () => {
  // specs/sas-hide-settled-steps.md §3 — reopening a completed SAS no longer shows the arrival caution
  // page once received (the commit leaves the marker untouched → undefined). Cleaning included → no ménage
  // page; its client reminder rides on the recap. The SAS-origin complement is reconstructed + re-sent once.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      arrivalSasDoneAt: '2026-07-10 15:00:00',
      cautionReceived: 1,                                // caution page hidden even in re-edit now
      extinguisherSealOkAtArrival: 1,
      departureHandoverNote: 'Clé sous le pot',
      // complementAmount already INCLUDES the prior SAS line (5 €) — the recap must subtract it from
      // « déjà dû » so the total stays 5 €, not double it to 10 € (specs/reopen-completed-sas.md §4).
      complementAmount: 5,
      // The prior SAS complement, surfaced as a SAS-origin custom option (as getByIdWithDetails does).
      options: [{ isCustom: 1, sasArrivalOrigin: 1, inComplement: 1, description: 'Taie d\'oreiller', unitPrice: 5 }],
    },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');

  // Caution page NOT shown despite re-edit → land straight on the reconstructed prestations step.
  const suivant = await screen.findByRole('button', { name: 'Suivant' });
  expect(screen.queryByText(/Caution à percevoir/)).toBeNull();
  fireEvent.click(suivant);

  // cleaning included → no ménage page → recap, which carries the vaisselle/poubelles reminder.
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText(/vaisselle doit être faite/)).toBeInTheDocument();
  expect(screen.getByText(/Total : 5,00 €/)).toBeInTheDocument(); // reconstructed pillow only
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  expect(arg.cautionReceived).toBeUndefined(); // caution step hidden → marker left untouched (tri-state)
  expect(arg.complementItems).toEqual([{ label: 'Taie d\'oreiller', amount: 5 }]); // exactly one, no dup
  expect(arg.departureHandoverNote).toBe('Clé sous le pot');
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
  // → recap (cleaning included is hidden), NOT the priced-items page
  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.queryByText('Éléments de linge manquants')).toBeNull();
});

test('arrival SAS recap: an in-complément extra is detailed with quantity + price (not a lump « Déjà dû »)', () => {
  // The complement detail lists each extra routed to the complément with qty × unit price = total.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      cautionAmount: 0, cautionReceived: 1, complementAmount: 80, complementPaid: 0,
      options: [{ optionId: 5, title: 'Repas du soir', quantity: 16, billedUnits: 16, unitPrice: 5, totalPrice: 80, inComplement: 1, offered: 0 }],
    },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  return (async () => {
    await screen.findByText('Commencer');
    clickBtn('Commencer');
    // options step (an option is present) → Suivant → recap (cleaning included is hidden)
    fireEvent.click(await screen.findByRole('button', { name: 'Suivant' }));
    await screen.findByText('Récapitulatif — complément à percevoir');
    // The MUI Dialog renders in a portal → assert on document.body.
    expect(document.body.textContent).toMatch(/Repas du soir/);
    expect(document.body.textContent).toMatch(/16\s*×/);          // quantity shown
    expect(document.body.textContent).not.toMatch(/Déjà dû/);     // lump replaced by the detail
    expect(screen.getByText(/Total : 80,00\s?€/)).toBeInTheDocument();
  })();
});

test('arrival SAS recap: the tourist tax collected at arrival is itemised as a « Taxe de séjour » line', () => {
  // specs/per-platform-tourist-tax-three-way.md §3 rule 7 — the arrival-collected tax is part of the
  // complement; it gets its own line so the detail reconciles with the total (here: Repas 80 + tax 4,80).
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      platform: 'Booking', cautionAmount: 0, cautionReceived: 1, complementAmount: 84.80, complementPaid: 0,
      touristTaxInComplementAmount: 4.80,
      options: [{ optionId: 5, title: 'Repas du soir', quantity: 16, billedUnits: 16, unitPrice: 5, totalPrice: 80, inComplement: 1, offered: 0 }],
    },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });
  return (async () => {
    await screen.findByText('Commencer');
    clickBtn('Commencer');
    fireEvent.click(await screen.findByRole('button', { name: 'Suivant' }));      // options step → recap
    await screen.findByText('Récapitulatif — complément à percevoir');
    expect(document.body.textContent).toMatch(/Taxe de séjour\s*:\s*4,80\s?€/);   // the itemised tax line
    expect(screen.getByText(/Total : 84,80\s?€/)).toBeInTheDocument();            // detail reconciles with the total
  })();
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
  // no breakfast key + cleaning included + caution received → straight to recap (no « Petit déjeuner » page)
  await screen.findByText('Récapitulatif — complément à percevoir');
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
  // no confirm — straight to recap (cleaning included is hidden)
  await screen.findByText('Récapitulatif — complément à percevoir');
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

  // extinguisher → « Oui » = bon état (no charge)
  await screen.findByText(/bon état/i);
  clickBtn('Oui');

  // recap (caution page skipped: cautionAmount 0)
  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText(/Total à percevoir : 80,00 €/)).toBeInTheDocument();
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  // The end-of-stay amount is computed server-side from the detail; the client sends the detail +
  // the extinguisher condition/charges (specs/extinguisher-seal-and-repair-amounts.md §3.2).
  expect(arg.endOfStayComplementDetail.some((l) => l.label === 'Ménage de fin de séjour' && l.amount === 80)).toBe(true);
  expect(arg.extinguisherSealOkAtDeparture).toBe(1);
  expect(arg.extinguisherCharges).toEqual([]);
  // Caution step skipped (cautionAmount 0) → no decision sent, the marker is left untouched
  // (specs/reopen-completed-sas.md §6 tri-state).
  expect(arg.cautionReturned).toBeUndefined();
});

test('departure SAS: an UNSETTLED arrival complement is recalled — detail + combined total + « Compléments encaissés »', async () => {
  // specs/recall-unpaid-arrival-complement-at-checkout.md — the arrival complement (12,50 €) was never
  // collected (paid: 0). The departure recap recalls it with its detail on top of the end-of-stay ménage,
  // shows the combined total, and ticking « Compléments encaissés » sends complementsSettled to the server.
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: 80 },
    arrivalComplement: { amount: 12.5, paid: 0, detail: [{ label: 'Taxe de séjour', amount: 4.8 }, { label: 'Lit bébé', amount: 7.7 }] },
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('Pas OK'); // +80 end-of-stay
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');

  await screen.findByText('Récapitulatif fin de séjour');
  // The recall section + its detail are shown.
  expect(screen.getByText("Compléments d'arrivée non perçus")).toBeInTheDocument();
  expect(screen.getByText(/Taxe de séjour : 4,80 €/)).toBeInTheDocument();
  expect(screen.getByText(/Lit bébé : 7,70 €/)).toBeInTheDocument();
  // Combined total = 80 (ménage) + 12,50 (recalled arrival).
  expect(screen.getByText(/Total à percevoir : 92,50 €/)).toBeInTheDocument();

  // Tick « Compléments encaissés » then validate.
  fireEvent.click(screen.getByRole('checkbox', { name: 'Compléments encaissés' }));
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.complementsSettled).toBe(true);
  // The end-of-stay detail is unchanged — the arrival amount is NOT merged into it (kept separate).
  expect(arg.endOfStayComplementDetail.some((l) => l.label === 'Ménage de fin de séjour' && l.amount === 80)).toBe(true);
  expect(arg.endOfStayComplementDetail.some((l) => l.label === 'Taxe de séjour')).toBe(false);
});

test('departure SAS: a PAID arrival complement is NOT recalled', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: 80 },
    arrivalComplement: { amount: 12.5, paid: 1, detail: [{ label: 'Taxe de séjour', amount: 12.5 }] },
  }));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('Pas OK');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.queryByText("Compléments d'arrivée non perçus")).toBeNull();
  expect(screen.getByText(/Total à percevoir : 80,00 €/)).toBeInTheDocument(); // ménage only
});

test('departure SAS: extinguisher not in good condition opens the tariff page; quantities ride to the payload as charges', async () => {
  // specs/extinguisher-seal-and-repair-amounts.md §3.2 — answering « Non » at departure opens the
  // extinguisher tariff page; the per-tariff quantity is sent as extinguisherCharges (priced server-side).
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: 80 },
    repairAmounts: [
      { id: 1, repairKey: 'extinguisher_seal', label: 'Plomb manquant', price: 30 },
      { id: 2, repairKey: 'extinguisher_use', label: 'Utilisation', price: 15 },
    ],
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

  // extinguisher: « Non » = pas en bon état → opens the tariff-quantity page
  await screen.findByText(/bon état/i);
  clickBtn('Non');
  await screen.findByText('Frais extincteur à facturer');
  expect(screen.getByText('Plomb manquant')).toBeInTheDocument();
  expect(screen.getByText('Utilisation')).toBeInTheDocument();
  // First tariff (Plomb manquant) → qty 1; the « + » buttons are in tariff order.
  fireEvent.click(screen.getAllByRole('button', { name: '+' })[0]);
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText(/Total à percevoir : 30,00 €/)).toBeInTheDocument(); // 30 × 1
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.extinguisherSealOkAtDeparture).toBe(0);
  // Charges carry the quantities; the server prices them (not sent in the detail).
  expect(arg.extinguisherCharges).toEqual([
    { repairKey: 'extinguisher_seal', qty: 1 },
    { repairKey: 'extinguisher_use', qty: 0 },
  ]);
  expect(arg.endOfStayComplementDetail.some((l) => String(l.repairKey || '').startsWith('extinguisher'))).toBe(false);
});
