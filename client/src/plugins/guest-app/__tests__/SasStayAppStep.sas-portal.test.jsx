// specs/guest-app.md rules 1 and 9bis (a) — while the guest app gives this stay a link, the SAS « Portail » step
// becomes « Mon séjour »: the stay link's QR, the keypad code, Partager, Régénérer le lien, and « QR du portail
// seul » for the gate key. Plugin inactive or no link for the stay → today's gate step, unchanged.
// Lives with the guest app: the SAS's own suites test the `leadsStep` mechanism with a fake contribution.
import { screen, waitFor, fireEvent, configure } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import guestAppApi from '../guestAppApi';
import { sasPayload, renderDialog, clickBtn } from '../../sas/__tests__/sasFixtures';
import { previewLikeTheServer } from '../../sas/__tests__/sasPreviewFake';
import { lacksPlugins } from '../../sdk/testing';

// The step's components load lazily (the SAS dialog, then the plugin's step): under the full suite's load that can
// take longer than the default second.
configure({ asyncUtilTimeout: 5000 });

const enabled = new Set();
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: (id) => enabled.has(id) }));

vi.mock('../../../api', () => ({
  default: {
    getReservationSas: vi.fn(),
    previewArrivalSas: vi.fn(),
    commitArrivalSas: vi.fn().mockResolvedValue({ ok: true }),
    commitDepartureSas: vi.fn().mockResolvedValue({ ok: true }),
    getReservationWeatherAlerts: vi.fn(),
    getReservationGateAccess: vi.fn(),
  },
}));
vi.mock('../guestAppApi', () => ({
  default: { getStayLink: vi.fn(), regenerateStayLink: vi.fn() },
}));

const LINK = {
  url: 'https://sejour.example.test/s/AAAAAAAAAAAAAAAAAAAAAA',
  qrDataUri: 'data:image/png;base64,AAAA',
  validUntilLabel: 'Le lien vaut jusqu’au dim. 12 juil., 12 h.',
};
const noCaution = { reservation: { cautionAmount: 0 }, cleaning: { included: true, price: 0 } };
const both = { 'gate-access': { available: true }, 'guest-app': { available: true } };

beforeEach(() => {
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  vi.clearAllMocks();
  enabled.clear();
  api.getReservationWeatherAlerts.mockResolvedValue({ alerts: [] });
  api.getReservationGateAccess.mockResolvedValue({ sas: { status: 'ok', code: '4K7M-9QT2', qrDataUri: null, windowLabel: '' } });
  guestAppApi.getStayLink.mockResolvedValue(LINK);
});

async function openPortalStep(payload) {
  api.getReservationSas.mockResolvedValue(sasPayload({ ...noCaution, ...payload }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
}

const NEEDS = ['guest-app', 'gate-access', 'sas'];

test.skipIf(lacksPlugins(NEEDS))('rule 9bis (a): the step becomes « Mon séjour » with the stay link’s QR and the keypad code', async () => {
  enabled.add('guest-app').add('gate-access');
  await openPortalStep({ portalCode: '4719', pluginData: both });
  expect(await screen.findByText(/Flashez pour ouvrir Mon séjour/)).toBeTruthy();
  expect(screen.getByAltText('QR du lien Mon séjour').getAttribute('src')).toBe(LINK.qrDataUri);
  expect(screen.getByText(LINK.validUntilLabel)).toBeTruthy();
  expect(screen.getByText('Mon séjour')).toBeTruthy();
  expect(screen.getByText('4719')).toBeTruthy();
  expect(guestAppApi.getStayLink).toHaveBeenCalledWith(1);
  expect(screen.queryByText('4K7M-9QT2')).toBeNull();
});

test.skipIf(lacksPlugins(NEEDS))('rule 9bis (a): « QR du portail seul » shows the gate key under the stay link', async () => {
  enabled.add('guest-app').add('gate-access');
  await openPortalStep({ portalCode: '4719', pluginData: both });
  fireEvent.click(await screen.findByRole('button', { name: 'QR du portail seul' }));
  expect(await screen.findByText('4K7M-9QT2')).toBeTruthy();
  expect(screen.getAllByText('4719')).toHaveLength(1);
});

test.skipIf(lacksPlugins(NEEDS))('rule 9bis (a): without a gate key there is no « QR du portail seul »', async () => {
  enabled.add('guest-app').add('gate-access');
  await openPortalStep({ pluginData: { 'guest-app': { available: true } } });
  expect(await screen.findByText(/Flashez pour ouvrir Mon séjour/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'QR du portail seul' })).toBeNull();
});

test.skipIf(lacksPlugins(NEEDS))('rule 1: « Régénérer le lien » asks first, then shows the new link', async () => {
  enabled.add('guest-app').add('gate-access');
  guestAppApi.regenerateStayLink.mockResolvedValue({ ...LINK, qrDataUri: 'data:image/png;base64,BBBB' });
  await openPortalStep({ pluginData: both });
  fireEvent.click(await screen.findByRole('button', { name: 'Régénérer le lien' }));
  expect(await screen.findByText('Régénérer le lien ?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Régénérer' }));
  await waitFor(() => expect(guestAppApi.regenerateStayLink).toHaveBeenCalledWith(1));
  await waitFor(() => expect(screen.getByAltText('QR du lien Mon séjour').getAttribute('src')).toBe('data:image/png;base64,BBBB'));
});

test.skipIf(lacksPlugins(NEEDS))('rule 9bis (a): the guest app inactive, or no link for this stay → today’s gate step', async () => {
  enabled.add('gate-access');
  await openPortalStep({ portalCode: '4719', pluginData: both });
  expect(await screen.findByText('4K7M-9QT2')).toBeTruthy();
  expect(screen.queryByText(/Flashez pour ouvrir Mon séjour/)).toBeNull();
  expect(guestAppApi.getStayLink).not.toHaveBeenCalled();
});

test.skipIf(lacksPlugins(NEEDS))('rule 9bis (a): a lodging out of the app keeps the gate step', async () => {
  enabled.add('guest-app').add('gate-access');
  await openPortalStep({ portalCode: '4719', pluginData: { 'gate-access': { available: true }, 'guest-app': { available: false } } });
  expect(await screen.findByText('4K7M-9QT2')).toBeTruthy();
  expect(guestAppApi.getStayLink).not.toHaveBeenCalled();
});

test.skipIf(lacksPlugins(NEEDS))('rule 9bis (a): the link unreadable → a warning, a retry, and the gate step as the way in', async () => {
  enabled.add('guest-app').add('gate-access');
  guestAppApi.getStayLink.mockRejectedValue(new Error('boom'));
  await openPortalStep({ portalCode: '4719', pluginData: both });
  expect(await screen.findByText('Le lien « Mon séjour » est indisponible pour ce séjour.')).toBeTruthy();
  // A second read may still be running (« Lecture… »): wait for the button to settle.
  expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeTruthy();
  expect(await screen.findByText('4K7M-9QT2')).toBeTruthy();
});
