// specs/google-vacation-rentals-feed.md rules 16-17, §6 — the settings tab: Envoi refused without a
// partner id (shown at once, nothing written), confirmed otherwise; the last check's mismatches listed
// with both amounts, as the server returns them.
import React, { createRef } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const api = vi.hoisted(() => ({
  getPluginSettings: vi.fn(),
  savePluginSettings: vi.fn(),
  getGoogleVrStatus: vi.fn(),
  getGoogleVrLog: vi.fn(),
  pushGoogleVr: vi.fn(),
  checkGoogleVr: vi.fn(),
}));
vi.mock('../../sdk', async () => {
  const actual = await vi.importActual('../../../utils/formatters');
  return {
    api,
    ConfirmDialog: (await vi.importActual('../../../components/ConfirmDialog')).default,
    StatusBadge: (await vi.importActual('../../../components/StatusBadge')).default,
    SummaryItem: (await vi.importActual('../../../components/SummaryItem')).default,
    displayDate: actual.displayDate,
    formatCurrency: actual.formatCurrency,
  };
});

import SettingsGoogleVrSection from '../SettingsGoogleVrSection';

const SETTINGS = { partnerId: '', mode: 'simulation', horizonDays: '365', maxLos: '14', fullResendHour: '4', properties: '{"1":{"enabled":true,"hotelCode":"solio-la-granja"}}' };
const PROPERTY = {
  id: 1, name: 'La Granja', enabled: true, hotelCode: 'solio-la-granja', slug: 'la-granja',
  landingUrl: 'https://domainesolio.com/la-granja/?checkin=(CHECKINDAY)', lastRunAt: '2027-03-01T04:12:00.000Z',
  lastResult: 'simulated', lastResultLabel: 'Simulé', itineraries: 63826, pendingDiff: 0, scheduled: false,
};
const STATUS = { mode: 'simulation', configured: false, enabledCount: 1, properties: [PROPERTY], lastError: null, lastCheck: null };

function setup({ settings = SETTINGS, status = STATUS } = {}) {
  api.getPluginSettings.mockResolvedValue(settings);
  api.getGoogleVrStatus.mockResolvedValue(status);
  api.getGoogleVrLog.mockResolvedValue({ runs: [] });
  const onDirtyChange = vi.fn();
  const ref = createRef();
  render(<SettingsGoogleVrSection ref={ref} onDirtyChange={onDirtyChange} />);
  return { ref, onDirtyChange };
}

afterEach(() => vi.clearAllMocks());

test('rule 16 — Envoi without a partner id is refused on the spot: no dialog, the mode stays Simulation', async () => {
  const { onDirtyChange } = setup();
  const envoi = await screen.findByRole('button', { name: 'Envoi' });
  await userEvent.click(envoi);
  expect(screen.getByRole('alert')).toHaveTextContent('Envoi impossible : identifiant partenaire manquant.');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(envoi).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: 'Simulation' })).toHaveAttribute('aria-pressed', 'true');
  expect(onDirtyChange).not.toHaveBeenCalledWith(true);
});

test('rule 16 — with a partner id, Envoi asks for confirmation, then the bar saves it', async () => {
  const { ref } = setup();
  await userEvent.type(await screen.findByLabelText('Identifiant partenaire Google'), 'solio_partner');
  await userEvent.click(screen.getByRole('button', { name: 'Envoi' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText('Passer en Envoi ?')).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Passer en Envoi' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Envoi' })).toHaveAttribute('aria-pressed', 'true');
  api.savePluginSettings.mockResolvedValue({ ...SETTINGS, partnerId: 'solio_partner', mode: 'envoi' });
  await ref.current.save();
  expect(api.savePluginSettings).toHaveBeenCalledWith('google-vacation-rentals', expect.objectContaining({ partnerId: 'solio_partner', mode: 'envoi' }));
});

test('the server\'s refusal of a write lands under its field', async () => {
  const { ref } = setup();
  await userEvent.type(await screen.findByLabelText('Identifiant partenaire Google'), 'a b');
  api.savePluginSettings.mockRejectedValue(Object.assign(new Error('INVALID_SETTING'), { errors: { partnerId: 'Identifiant partenaire : lettres, chiffres, « - » et « _ ».' } }));
  await expect(ref.current.save()).rejects.toThrow();
  expect(await screen.findByText('Identifiant partenaire : lettres, chiffres, « - » et « _ ».')).toBeInTheDocument();
});

test('rule 17 — the last check\'s mismatches are listed with what was sent and what the site quotes', async () => {
  setup({
    status: {
      ...STATUS,
      lastCheck: {
        checkedAt: '2027-03-01T10:00:00.000Z',
        checked: 200,
        mismatches: [
          { propertyId: 1, propertyName: 'La Granja', checkin: '2027-12-30', nights: 3, guests: 10, sent: 1236, website: 1299 },
          { propertyId: 1, propertyName: 'La Granja', checkin: '2027-07-12', nights: 4, guests: 2, sent: null, website: 1804 },
        ],
      },
    },
  });
  const list = await screen.findByRole('list', { name: 'Écarts de prix' });
  expect(screen.getByText('2 écarts sur 200 séjours')).toBeInTheDocument();
  const items = within(list).getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('La Granja, arrivée 30/12/2027, 3 nuits, 10 voyageurs — envoyé 1 236,00 €, site 1 299,00 €');
  expect(items[1]).toHaveTextContent('envoyé rien, site 1 804,00 €');
});

test('rule 17 — a clean check says so', async () => {
  setup({ status: { ...STATUS, lastCheck: { checkedAt: '2027-03-01T10:00:00.000Z', checked: 200, mismatches: [] } } });
  expect(await screen.findByText(/200 séjours vérifiés le .* : aucun écart avec le devis du site\./)).toBeInTheDocument();
});

test('« Tout renvoyer » goes through a confirmation, then reports each property\'s run', async () => {
  setup();
  api.pushGoogleVr.mockResolvedValue({ mode: 'simulation', runs: [{ propertyId: 1, result: 'simulated', resultLabel: 'Simulé', rates: 63826, days: 379 }] });
  await userEvent.click(await screen.findByRole('button', { name: 'Tout renvoyer' }));
  expect(api.pushGoogleVr).not.toHaveBeenCalled();
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Tout renvoyer' }));
  await waitFor(() => expect(api.pushGoogleVr).toHaveBeenCalledWith({ full: true }));
  expect(await screen.findByText('La Granja : Simulé (63826 prix, 379 jours)')).toBeInTheDocument();
});
