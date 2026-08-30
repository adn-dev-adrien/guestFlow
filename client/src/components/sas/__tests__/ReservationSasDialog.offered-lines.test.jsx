// Offering a recap line — specs/sas-offer-complement-lines.md
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

// ---- « Offrir » a recap line (specs/sas-offer-complement-lines.md) ----

// A stay whose complement holds one catalogue extra (20 €) — the recap can give it away.
const OFFERABLE_ARRIVAL = {
  cautionAmount: 0,
  complementAmount: 20,
  options: [{
    optionId: 5, title: 'Panier gourmand', inComplement: 1, offered: 0,
    totalPrice: 20, originalTotalPrice: 20, unitPrice: 20, billedUnits: 1, quantity: 1,
  }],
};

test('arrival recap: offering a linen element drops it from the total and rides the commit', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0, bedLinenAlert: { type: 'no_linen' } },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/n'a pas pris le linge de lit/);
  clickBtn('Pas OK');
  await screen.findByText('Éléments de linge manquants');
  fireEvent.click(screen.getByRole('button', { name: '+' })); // 1 × 5 €
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText(/Total : 5,00 €/)).toBeInTheDocument();
  clickBtn('Offrir');
  // The line keeps its real price on screen (struck through); the total drops to 0.
  expect(screen.getByText(/Taie d'oreiller : 5,00 €/)).toBeInTheDocument();
  expect(screen.getByText(/Total : 0,00 €/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '✓ Offert' })).toBeInTheDocument();

  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  const arg = api.commitArrivalSas.mock.calls[0][1];
  // Sent at its REAL price with the gesture — the server is what stores it at 0 €.
  expect(arg.complementItems).toEqual([{ label: 'Taie d\'oreiller', amount: 5, offered: true }]);
});

test('arrival recap: offering a pre-existing extra sends its ref in offeredExtras', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: OFFERABLE_ARRIVAL,
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées'); // options step (the extra)
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByText(/Total : 20,00 €/)).toBeInTheDocument();
  clickBtn('Offrir');
  expect(screen.getByText(/Total : 0,00 €/)).toBeInTheDocument();
  // Nothing left to collect → the settlement buttons disappear (§3.3 rule 11).
  expect(screen.queryByRole('button', { name: 'CB / Chèque' })).toBeNull();

  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].offeredExtras).toEqual([{ kind: 'option', id: 5 }]);
});

test('arrival recap reopen: a line offered at the previous commit comes back « ✓ Offert »', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: {
      ...OFFERABLE_ARRIVAL,
      arrivalSasDoneAt: '2026-07-10 15:00:00',
      complementAmount: 0,
      options: [{ ...OFFERABLE_ARRIVAL.options[0], offered: 1, totalPrice: 0 }],
    },
    cleaning: { included: true, price: null },
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées');
  clickBtn('Suivant');

  await screen.findByText('Récapitulatif — complément à percevoir');
  expect(screen.getByRole('button', { name: '✓ Offert' })).toBeInTheDocument();
  expect(screen.getByText(/Panier gourmand : 20,00 €/)).toBeInTheDocument(); // real price still shown
  expect(screen.getByText(/Total : 0,00 €/)).toBeInTheDocument();
  // Undoing the gesture bills it again.
  clickBtn('✓ Offert');
  expect(screen.getByText(/Total : 20,00 €/)).toBeInTheDocument();
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].offeredExtras).toEqual([]);
});

test('departure recap: offering the end-of-stay ménage drops the total and tags the detail line', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: false, price: 80 },
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
  expect(screen.getByText(/Total à percevoir : 80,00 €/)).toBeInTheDocument();
  clickBtn('Offrir');
  expect(screen.queryByText(/Total à percevoir/)).toBeNull(); // nothing left to collect
  expect(screen.queryByRole('button', { name: 'Payé en liquide' })).toBeNull();

  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  const arg = api.commitDepartureSas.mock.calls[0][1];
  expect(arg.endOfStayComplementDetail).toEqual([
    { label: 'Ménage de fin de séjour', qty: 1, unitPrice: 80, amount: 80, offered: true },
  ]);
  expect(arg.complementsSettled).toBe(false);
});

test('departure recap: a recalled arrival line is offerable, the taxe de séjour is not', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: null },   // no end-of-stay ménage step
    arrivalComplement: {
      amount: 12.5,
      paid: 0,
      detail: [
        { label: 'Taxe de séjour', kind: 'tax', qty: 1, unitPrice: 4.8, amount: 4.8 },
        { label: 'Lit bébé', kind: 'option', qty: 1, unitPrice: 7.7, amount: 7.7, ref: { kind: 'option', id: 4 } },
      ],
    },
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');

  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.getByText(/Total à percevoir : 12,50 €/)).toBeInTheDocument();
  // Only ONE toggle: the tourist tax can never be a geste commercial (§3.2 rule 7).
  expect(screen.getAllByRole('button', { name: 'Offrir' })).toHaveLength(1);
  clickBtn('Offrir');
  expect(screen.getByText(/Total à percevoir : 4,80 €/)).toBeInTheDocument(); // the tax is still due

  clickBtn('CB / Chèque');
  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  expect(api.commitDepartureSas.mock.calls[0][1].offeredArrivalExtras).toEqual([{ kind: 'option', id: 4 }]);
});

// Régression 2026-08-29 (réservation Geuffrard) — the arrival complement is entirely made of gestes
// commerciaux, so it is worth 0 € and the recap shows no recall block. The commit must then say
// NOTHING about the offered flags: an empty set is authoritative server-side and billed them all back.
// specs/sas-offer-complement-lines.md §3.2 rule 6.ter.
test('departure recap: an arrival complement worth 0 € claims no authority over the offered flags', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionAmount: 0 },
    cleaning: { included: true, price: null },
    arrivalComplement: {
      amount: 0,
      paid: 0,
      detail: [
        { label: 'Linge de lit', kind: 'option', qty: 10, unitPrice: 7, amount: 0, offered: 1, originalAmount: 70, ref: { kind: 'option', id: 8 } },
      ],
    },
  }));
  renderDialog({ mode: 'departure' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/serviettes ou des draps/);
  clickBtn('Non');
  await screen.findByText(/récupéré les clés/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');

  await screen.findByText('Récapitulatif fin de séjour');
  expect(screen.queryByText(/Total à percevoir/)).toBeNull(); // the offered linen is not a collection

  clickBtn('Valider et terminer');
  await waitFor(() => expect(api.commitDepartureSas).toHaveBeenCalledTimes(1));
  expect(api.commitDepartureSas.mock.calls[0][1].offeredArrivalExtras).toBeUndefined();
});
