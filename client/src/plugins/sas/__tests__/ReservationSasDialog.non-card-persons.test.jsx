// A non-card per-person option sold at check-in — specs/non-card-option-served-persons.md rule 12 and §6.
//
// One file per subject (CLAUDE.md §9). The stepper announces the line's amount, and the commit carries
// the people served, never units nor a price.
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
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true, complementAmount: 18 }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const BASKET = {
  optionId: 13, title: 'Panier', description: '', unitPrice: 6, priceType: 'per_person', perPerson: true,
  showsPlanningCard: false, persons: 2, multiplier: 2, defaultUnits: 2, sasOrigin: false, selectedUnits: 0,
  selectedOccurrences: [], occurrences: [], defaultPersons: 2, maxPersons: 5, selectedPersons: 2,
};

async function takeTheBasket() {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2 },
    cleaning: { included: true, price: 80 },
    sasSales: salesPayload({ catering: { available: true, options: [BASKET] } }),
  }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/souhaite-t-il de la restauration/);
  clickBtn('Oui, proposer');
  fireEvent.click(await screen.findByRole('switch', { name: 'Panier' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // The double prices units: on this offer, the people served are the units the server bills.
  const fake = previewLikeTheServer(api);
  api.previewArrivalSas.mockImplementation((id, body, options) => fake(id, {
    ...body,
    soldOptions: (body.soldOptions || []).map((sale) => ({ ...sale, units: sale.units ?? sale.persons })),
  }, options));
});

test('the stepper announces the amount the server priced, never a dash', async () => {
  await takeTheBasket();
  expect(await screen.findByText('Personnes servies — 12,00 €')).toBeInTheDocument();
  expect(screen.queryByText(/Personnes servies — —/)).toBeNull();
});

test('the amount follows the people served', async () => {
  await takeTheBasket();
  await screen.findByText('Personnes servies — 12,00 €');
  fireEvent.click(screen.getByRole('button', { name: '+' }));
  expect(await screen.findByText('Personnes servies — 18,00 €')).toBeInTheDocument();
});

test('the commit carries the people served, with no units and no price', async () => {
  await takeTheBasket();
  await screen.findByText('Personnes servies — 12,00 €');
  fireEvent.click(screen.getByRole('button', { name: '+' }));
  await screen.findByText('Personnes servies — 18,00 €');
  clickBtn('Suivant');
  await screen.findByText('Récapitulatif — complément à percevoir');
  clickBtn('Valider et terminer');

  await waitFor(() => expect(api.commitArrivalSas).toHaveBeenCalledTimes(1));
  expect(api.commitArrivalSas.mock.calls[0][1].soldOptions).toEqual([{ optionId: 13, persons: 3 }]);
});
