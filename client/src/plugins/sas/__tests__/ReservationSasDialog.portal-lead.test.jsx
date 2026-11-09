// specs/guest-app.md rule 9bis (a) — the SAS mechanism, with no real plugin: a `sas.portal` contribution marked
// `leadsStep` takes the « Portail » step over (its title included) while its plugin's SAS data says it is
// available, and receives the other portal contributions as `gateStep`; unavailable, the step is the gate's.
import { screen } from '@testing-library/react';
import { vi } from 'vitest';

import api from '../../../api';
import { sasPayload, renderDialog, clickBtn } from './sasFixtures';
import { previewLikeTheServer } from './sasPreviewFake';

const FakeLead = ({ portalCode, gateStep }) => (
  <div>
    <p>{`Accueil numérique · code ${portalCode}`}</p>
    {gateStep ? <div data-testid="gate-under-lead">{gateStep}</div> : null}
  </div>
);
const FakeGate = ({ portalCode }) => <p>{`Clé du portail · code ${portalCode || 'aucun'}`}</p>;

vi.mock('../../sdk/useSlot', () => ({
  useSlot: (name) => (name === 'sas.portal'
    ? [
      { key: 'gate', pluginId: 'gate-access', Component: FakeGate },
      { key: 'lead', pluginId: 'fake-lead', leadsStep: { title: 'Accueil numérique' }, Component: FakeLead },
    ]
    : []),
}));
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => false }));
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

const noCaution = { reservation: { cautionAmount: 0 }, cleaning: { included: true, price: 0 } };

beforeEach(() => {
  api.previewArrivalSas.mockImplementation(previewLikeTheServer(api));
  vi.clearAllMocks();
});

async function openPortalStep(pluginData) {
  api.getReservationSas.mockResolvedValue(sasPayload({ ...noCaution, portalCode: '4719', pluginData }));
  renderDialog({ mode: 'arrival' });
  await screen.findByText('Commencer');
  clickBtn('Commencer');
}

test('rule 9bis (a): an available lead takes the step and its title, with the gate contribution under it', async () => {
  await openPortalStep({ 'fake-lead': { available: true }, 'gate-access': { available: true } });
  expect(await screen.findByText('Accueil numérique · code 4719')).toBeTruthy();
  expect(screen.getAllByText('Accueil numérique').length).toBeGreaterThan(0);
  expect(screen.getByTestId('gate-under-lead').textContent).toBe('Clé du portail · code aucun');
});

test('rule 9bis (a): a lead its plugin says is unavailable leaves the step to the gate', async () => {
  await openPortalStep({ 'fake-lead': { available: false }, 'gate-access': { available: true } });
  expect(await screen.findByText('Clé du portail · code 4719')).toBeTruthy();
  expect(screen.queryByText(/Accueil numérique/)).toBeNull();
});
