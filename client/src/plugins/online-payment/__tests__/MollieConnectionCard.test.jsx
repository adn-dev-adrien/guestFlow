// specs/mollie-rolling-reserve-and-incoming-payments.md rules 14-15, 17 — the optional « Compte Mollie » card: a masked
// token, the profile id, « Tester » and the last read. A refusal (a token that does not start with access_) is the
// SERVER's answer, shown on the field with nothing saved; the token is never shown back.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import DialogProvider from '../../../components/DialogProvider';
import MollieConnectionCard from '../MollieConnectionCard';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: { getPluginSettings: vi.fn(), savePluginSettings: vi.fn(), testMollieConnection: vi.fn() },
}));
import api from '../../../api';

const REFUSAL = 'Ce n\'est pas un jeton d\'accès Mollie : il commence par access_';
const renderCard = () => render(<DialogProvider><MollieConnectionCard /></DialogProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  api.getPluginSettings.mockResolvedValue({ mollieAccessTokenSet: false, mollieProfileId: '', mollieLastRead: '', mollieLastError: '' });
  api.savePluginSettings.mockResolvedValue({});
});

test('rule 14: the card is optional, says what the token adds and carries the steps in Mollie', async () => {
  renderCard();
  expect(await screen.findByText('Compte Mollie')).toBeInTheDocument();
  expect(screen.getByText('Facultatif')).toBeInTheDocument();
  expect(screen.getByText(/les versements groupés sont détaillés paiement par paiement/)).toBeInTheDocument();
  expect(screen.getByText(/Développeurs → Clés API → « \+ Créer une clé API »/)).toBeInTheDocument();
  expect(screen.getByText(/payments\.read, settlements\.read, balances\.read, balance-reports\.read, invoices\.read, refunds\.read, profiles\.read, organizations\.read ; signature des demandes désactivée\./)).toBeInTheDocument();
});

test('rule 14: a stored token is masked, never shown', async () => {
  api.getPluginSettings.mockResolvedValue({ mollieAccessTokenSet: true, mollieProfileId: 'pfl_abc', mollieLastRead: '', mollieLastError: '' });
  renderCard();
  expect(await screen.findByText('Connecté')).toBeInTheDocument();
  expect(screen.getByText('••••••••••')).toBeInTheDocument();
  expect(screen.getByLabelText('Identifiant de profil')).toHaveValue('pfl_abc');
});

test('rule 15: a token the server refuses is shown from its answer and nothing is stored', async () => {
  api.savePluginSettings.mockRejectedValue(Object.assign(new Error('INVALID_SETTING'), { errors: { mollieAccessToken: REFUSAL } }));
  renderCard();
  await screen.findByText('Compte Mollie');
  await userEvent.type(screen.getByLabelText('Jeton d’accès (lecture seule)'), 'live_abcdef');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
  expect(api.savePluginSettings).toHaveBeenCalledWith('online-payment', expect.objectContaining({ mollieAccessToken: 'live_abcdef' }));
  expect(screen.getByText('Facultatif')).toBeInTheDocument();
});

test('rule 15: a profile id the server refuses is shown on its field', async () => {
  api.savePluginSettings.mockRejectedValue(Object.assign(new Error('INVALID_SETTING'), { errors: { mollieProfileId: 'Identifiant de profil Mollie invalide (pfl_…).' } }));
  renderCard();
  await screen.findByText('Compte Mollie');
  await userEvent.type(screen.getByLabelText('Identifiant de profil'), 'xyz');
  await userEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Identifiant de profil Mollie invalide (pfl_…).')).toBeInTheDocument();
});

test('rule 15: « Tester » sends the typed token and says in words what the server found', async () => {
  api.testMollieConnection.mockResolvedValue({ ok: false, settlements: 0, error: 'Ce jeton est limité à un profil : le recréer sans restriction de profil pour lire les règlements' });
  renderCard();
  await screen.findByText('Compte Mollie');
  await userEvent.type(screen.getByLabelText('Jeton d’accès (lecture seule)'), 'access_xyz');
  await userEvent.click(screen.getByRole('button', { name: 'Tester' }));
  await waitFor(() => expect(api.testMollieConnection).toHaveBeenCalledWith('access_xyz'));
  expect(await screen.findByText(/Ce jeton est limité à un profil/)).toBeInTheDocument();
});

test('rule 15: a test the server answers with a 400 shows its refusal', async () => {
  api.testMollieConnection.mockRejectedValue(new Error(REFUSAL));
  renderCard();
  await screen.findByText('Compte Mollie');
  await userEvent.type(screen.getByLabelText('Jeton d’accès (lecture seule)'), 'live_x');
  await userEvent.click(screen.getByRole('button', { name: 'Tester' }));
  expect(await screen.findByText(REFUSAL)).toBeInTheDocument();
});

test('rule 17: the last read and the last failure are shown in words', async () => {
  api.getPluginSettings.mockResolvedValue({
    mollieAccessTokenSet: true, mollieProfileId: '',
    // date-literal-ok: fixture data drawn as given; nothing compares it with today
    mollieLastRead: JSON.stringify({ at: '2026-11-16T09:00:00.000Z', settlements: 3, unknownPayments: 1 }),
    // date-literal-ok: fixture data drawn as given; nothing compares it with today
    mollieLastError: JSON.stringify({ at: '2026-11-16T10:00:00.000Z', message: 'Mollie ne répond pas' }),
  });
  renderCard();
  expect(await screen.findByText(/3 règlements · 1 paiement inconnu de GuestFlow/)).toBeInTheDocument();
  expect(screen.getByText(/Dernier échec de lecture/)).toHaveTextContent('Mollie ne répond pas');
  expect(screen.getByText('À vérifier')).toBeInTheDocument();
});
