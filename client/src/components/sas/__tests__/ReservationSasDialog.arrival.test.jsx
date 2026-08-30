// The arrival wizard — specs/arrival-departure-sas.md
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
    // specs/sas-upsells-activate-catalogue-option.md §3.1 — only the LINEN elements are custom lines;
    // the ménage rides its boolean and lands on the catalogue option, priced server-side.
    complementItems: [
      // specs/sas-offer-complement-lines.md §4.3 — every item carries its geste-commercial flag.
      { label: 'Taie d\'oreiller', amount: 5, offered: false },
    ],
    cleaningAdded: true,
    bathLinenAdded: undefined,      // step not shown (no offer in this fixture)
    cleaningOffered: false,
    bathLinenOffered: false,
    offeredExtras: [],
    departureHandoverNote: '',
    // specs/recall-unpaid-arrival-complement-at-checkout.md — the « Complément encaissé » box was not
    // ticked in this flow, so the complement stays unsettled (→ recalled at checkout).
    complementSettled: false,
    complementPaidCash: false,
    // specs/collect-stay-payment-at-check-in.md §3.3 rule 13 — the stay step never ran on this
    // fixture (nothing owed), so the acompte / solde are left strictly untouched.
    stayPaid: undefined,
    stayPaidCash: false,
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
  expect(arg.complementItems).toEqual([{ label: 'Taie d\'oreiller', amount: 5, offered: false }]); // exactly one, no dup
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
