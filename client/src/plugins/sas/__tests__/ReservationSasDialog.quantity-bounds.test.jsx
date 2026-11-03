// specs/sas-departure-recap-server-side.md rule 29 — a count the server refuses is said with its reason, without
// a « Réessayer » that would send the same draft; the piece steppers stop at the server's ceiling.
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { recapFor, departurePreviewLikeTheServer } from './sasPreviewFake';

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
