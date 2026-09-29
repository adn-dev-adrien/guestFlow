// specs/plugins-phase-1-sdk.md rules 13 and 17 — the SAS « Portail » step is the SAS's: the keypad
// code alone is enough to show it; a key held by the gate-access plugin takes the page through its
// slot. Plugin arrival steps (the weather alert) come from their module.
import { screen, waitFor, act } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';

const enabled = new Set();
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: (id) => enabled.has(id) }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn(),
    getReservationGateAccess: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  enabled.clear();
  api.getReservationWeatherAlerts.mockResolvedValue({ alerts: [] });
});

// No caution, cleaning already sold: after the intro the wizard goes straight to what is under test.
const noCaution = { reservation: { cautionAmount: 0 }, cleaning: { included: true, price: 0 } };

test('rule 17: with only a keypad code and no gate plugin, the Portail step shows the code', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload({ ...noCaution, portalCode: '4719' }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  expect(await screen.findByText('Code du portail à communiquer au client :')).toBeTruthy();
  expect(screen.getByText('4719')).toBeTruthy();
  expect(api.getReservationGateAccess).not.toHaveBeenCalled();
});

test('rule 17: no keypad code and no key → no Portail step at all', async () => {
  api.getReservationSas.mockResolvedValue(sasPayload(noCaution));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  expect(await screen.findByText('Récapitulatif')).toBeTruthy();
  expect(screen.queryByText(/Code du portail/)).toBeNull();
});

test('rule 17: a key held by the gate plugin takes the page, with the keypad code as the fallback', async () => {
  enabled.add('gate-access');
  api.getReservationGateAccess.mockResolvedValue({ sas: { status: 'ok', code: '4K7M-9QT2', qrDataUri: null, windowLabel: '' } });
  api.getReservationSas.mockResolvedValue(sasPayload({ ...noCaution, portalCode: '4719', pluginData: { 'gate-access': { available: true } } }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
  expect(await screen.findByText('4K7M-9QT2')).toBeTruthy();
  expect(screen.getByText('Secours — code du clavier du portail :')).toBeTruthy();
});

test('rule 13: the weather plugin adds its step before the recap only while active and alerting', async () => {
  const alert = { phenomenonId: 3, phenomenon: 'Orages', colorLevel: 3, color: 'Orange', timingLabel: 'Demain', message: 'Orages', instructions: [] };
  api.getReservationWeatherAlerts.mockResolvedValue({ alerts: [alert] });
  api.getReservationSas.mockResolvedValue(sasPayload(noCaution));

  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  expect(api.getReservationWeatherAlerts).not.toHaveBeenCalled();
});

test('rule 13: active and alerting, the weather step shows before the recap', async () => {
  enabled.add('weather-alerts');
  const alert = { phenomenonId: 3, phenomenon: 'Orages', colorLevel: 3, color: 'Orange', timingLabel: 'Demain', message: 'Risque d’orages', instructions: [] };
  api.getReservationWeatherAlerts.mockResolvedValue({ alerts: [alert] });
  api.getReservationSas.mockResolvedValue(sasPayload(noCaution));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  // The step loads in the background; it is part of the wizard once its data is in.
  await waitFor(() => expect(api.getReservationWeatherAlerts).toHaveBeenCalledWith(1));
  await act(async () => {});
  clickBtn('Commencer');
  expect(await screen.findByText('Risque d’orages')).toBeTruthy();
});
