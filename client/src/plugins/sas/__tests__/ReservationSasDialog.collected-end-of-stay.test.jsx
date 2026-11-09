// specs/recall-unpaid-arrival-complement-at-checkout.md rule 11 (audit R26 H1) — an end-of-stay complement collected outside the
// departure SAS takes no new charge: the server refuses the preview, the dialog says its reason with no « Réessayer » and
// keeps « Valider et terminer » closed.
//
// One file per subject (CLAUDE.md §9). Fixtures used by more than one subject live in ./sasFixtures.
import { screen } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { departureRecapFor } from './sasPreviewFake';

vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    previewDepartureSas: vi.fn(),
    commitArrivalSas: vi.fn(),
    commitDepartureSas: vi.fn(),
    getReservationWeatherAlerts: vi.fn().mockResolvedValue({ configured: false, resolved: false, department: null, alerts: [] }),
  },
}));

const MESSAGE = 'Complément de fin de séjour déjà encaissé : le décocher sur la fiche avant d’ajouter des frais.';
const refused = () => Object.assign(new Error(MESSAGE), { status: 409, error: MESSAGE, code: 'END_OF_STAY_ALREADY_COLLECTED' });

const PAYLOAD = sasPayload({
  reservation: { cautionAmount: 0 },
  cleaning: { included: false, price: 80 },
});

beforeEach(() => {
  vi.clearAllMocks();
  api.getReservationSas.mockResolvedValue(PAYLOAD);
  api.previewDepartureSas.mockImplementation(async (id, draft) => {
    if (draft.cleaningCharged) throw refused();
    return departureRecapFor(PAYLOAD, draft);
  });
});

test('a charge on a collected end of stay: the server’s reason, no retry, « Valider » closed', async () => {
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('Pas OK');
  await screen.findByText(/serviettes et les draps sont-ils tous là/);
  clickBtn('Oui');
  await screen.findByText(/Clés du logement récupérées/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  expect(await screen.findByText(MESSAGE)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  expect(screen.queryByText('Le récapitulatif est refusé.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Valider et terminer' })).toBeDisabled();
  expect(api.commitDepartureSas).not.toHaveBeenCalled();
});

test('no charge: the recap prices as before and « Valider » opens', async () => {
  renderDialog({ mode: 'departure' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  await screen.findByText(/fait correctement/);
  clickBtn('OK');
  await screen.findByText(/serviettes et les draps sont-ils tous là/);
  clickBtn('Oui');
  await screen.findByText(/Clés du logement récupérées/);
  clickBtn('Oui');
  await screen.findByText(/bon état/i);
  clickBtn('Oui');
  const validate = await screen.findByRole('button', { name: 'Valider et terminer' });
  await vi.waitFor(() => expect(validate).toBeEnabled());
  expect(screen.queryByText(MESSAGE)).toBeNull();
});
