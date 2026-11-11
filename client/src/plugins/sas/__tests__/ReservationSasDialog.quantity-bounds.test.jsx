// specs/sas-departure-recap-server-side.md rule 29, specs/sas-breakfast-and-catering-upsell.md rule 16 — a count the
// server refuses is said with its reason, without a « Réessayer » that would send the same draft; the piece steppers
// stop at the server's ceiling.
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, BOARD_OFFER, salesPayload, renderDialog, clickBtn } from './sasFixtures';
import { recapFor, previewLikeTheServer, departurePreviewLikeTheServer } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn(),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const MESSAGE = 'Quantité invalide : un nombre entier de pièces, 999 au plus.';
const refused = () => Object.assign(new Error(MESSAGE), { status: 400, error: 'INVALID_QUANTITY' });

const ARRIVAL = sasPayload({
  reservation: {
    cautionAmount: 0,
    complementAmount: 20,
    options: [{
      optionId: 5, title: 'Panier gourmand', inComplement: 1, offered: 0,
      totalPrice: 20, originalTotalPrice: 20, unitPrice: 20, billedUnits: 1, quantity: 1,
    }],
  },
  cleaning: { included: true, price: null },
});

beforeEach(() => {
  vi.clearAllMocks();
});

test('rule 29 — a refused count shows the server\'s reason, with no retry, and the commit stays closed', async () => {
  api.getReservationSas.mockResolvedValue(ARRIVAL);
  api.previewArrivalSas.mockImplementation(async (id, draft) => recapFor(ARRIVAL, draft));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText('Prestations réservées');
  clickBtn('Suivant');
  await screen.findByText(/Total : 20,00 €/);
  api.previewArrivalSas.mockRejectedValue(refused());
  clickBtn('Offrir');
  expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeDisabled();
});

test('rule 29 — a missing piece stops at 999', async () => {
  const payload = sasPayload({ linenItems: [{ id: 3, label: 'Serviette', price: 6.5, category: 'bath' }] });
  api.getReservationSas.mockResolvedValue(payload);
  api.previewDepartureSas.mockImplementation(departurePreviewLikeTheServer(payload));
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await waitFor(() => expect(screen.getAllByRole('button').length).toBeGreaterThan(0));
  clickBtn('OK');
  clickBtn('Non');
  await screen.findByText('Serviette');
  const input = screen.getByText('Serviette').closest('.MuiStack-root').querySelector('input');
  fireEvent.change(input, { target: { value: '5000' } });
  await waitFor(() => expect(screen.getByText('Serviette').closest('.MuiStack-root').querySelector('input').value).toBe('999'));
});

test('rule 29 — the catering units stepper stops at 999', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({
    reservation: { cautionReceived: 1, adults: 2 },
    cleaning: { included: true, price: 80 },
    sasSales: salesPayload({ catering: { available: true, options: [BOARD_OFFER] } }),
  }));
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/souhaite-t-il de la restauration/);
  clickBtn('Oui, proposer');
  await screen.findByText('Planche S');
  fireEvent.click(screen.getByRole('switch', { name: 'Planche S' }));
  const row = () => screen.getByText(/^Quantité — /).closest('.MuiStack-root').parentElement;
  await waitFor(() => expect(row().querySelector('input').value).toBe('1'));
  fireEvent.change(row().querySelector('input'), { target: { value: '5000' } });
  await waitFor(() => expect(row().querySelector('input').value).toBe('999'));
});
