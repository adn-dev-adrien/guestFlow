// specs/non-card-option-served-persons.md rule 12 (audit R21-S5) — the dialog sells a non-card per-person option in
// people served, as a card does: the stepper's number is what the commit carries.
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, salesPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 85 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const BASKET_OFFER = {
  optionId: 28, title: 'Panier', description: '', unitPrice: 10, priceType: 'per_person_per_night',
  perPerson: true, showsPlanningCard: false, persons: 2, multiplier: 4, defaultUnits: 4, unitsPerPerson: 2,
  sasOrigin: false, selectedUnits: 0, selectedOccurrences: [], occurrences: [],
  defaultPersons: 2, maxPersons: 5, selectedPersons: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
});

test('rule 12 — the commit and the preview carry the people served, not units', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2 },
    cleaning: { included: true, price: 80 },
    sasSales: salesPayload({ catering: { available: true, options: [BASKET_OFFER] } }),
  }));
  renderDialog({ mode: 'arrival' });

  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/souhaite-t-il de la restauration/);
  clickBtn('Oui, proposer');
  await screen.findByText('Panier');
  fireEvent.click(screen.getByRole('switch', { name: 'Panier' }));

  const row = (await screen.findByText(/Personnes servies —/)).closest('div');
  expect(row).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Augmenter|Ajouter|\+/ }));

  await waitFor(() => {
    const last = api.previewArrivalSas.mock.calls.at(-1)[1];
    expect(last.soldOptions).toEqual([{ optionId: 28, persons: 3 }]);
  });
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  fireEvent.click(await screen.findByRole('button', { name: 'Valider et terminer' }));

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].soldOptions).toEqual([{ optionId: 28, persons: 3 }]);
});
