import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// specs/neat-cancellation-insurance-subscription.md §6.1 — the « Assurance annulation (Neat) »
// Réglages card: status badge, credentials (secret 3-way), margin, discovery selects, mapping rows.

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getNeatSettings: vi.fn(),
    updateNeatSettings: vi.fn(),
    testNeatConnection: vi.fn(),
    getNeatDiscovery: vi.fn(),
    updateNeatSelection: vi.fn(),
    updateNeatMapping: vi.fn(),
  },
}));

import api from '../../api';
import DialogProvider from '../DialogProvider';
import SettingsNeatSection from '../SettingsNeatSection';

const CONTRACT_FIELDS = [
  { id: 'f-nights', title: 'Nombre de nuits', name: 'nights', type: 'number', required: true, options: [] },
  { id: 'f-kind', title: "Type d'hébergement", name: 'kind', type: 'dropdown', required: false, options: ['Lodge'] },
];

const BASE_SETTINGS = {
  environment: 'staging',
  clientId: '',
  clientSecretSet: false,
  storeId: '',
  salesChannelId: '',
  salesChannelLabel: '',
  contractId: '',
  contractLabel: '',
  paymentMethodId: '',
  paymentMethodKind: '',
  paymentMethodLabel: '',
  marginPercent: null,
  mapping: {},
  contractFields: [],
  sources: [
    { key: 'nights', type: 'number', label: 'Nombre de nuits' },
    { key: 'constant', type: 'any', label: 'Valeur fixe' },
  ],
  status: {
    environment: 'staging',
    credentialsSet: false,
    selectionComplete: false,
    mappingComplete: false,
    requiredFieldsTotal: 0,
    requiredFieldsMapped: 0,
    subscriptionActive: false,
    pricingActive: false,
  },
  counters: { pending: 0, failed: 0, active: 0, voided: 0 },
};

const CONFIGURED_SETTINGS = {
  ...BASE_SETTINGS,
  clientId: 'svc-solio',
  clientSecretSet: true,
  salesChannelId: 'ch-1',
  salesChannelLabel: 'Site direct',
  contractId: 'c-1',
  contractLabel: 'Assurance annulation',
  paymentMethodId: 'pm-1',
  paymentMethodLabel: 'Facturation établissement',
  marginPercent: 30,
  mapping: { 'f-nights': { source: 'nights' } },
  contractFields: CONTRACT_FIELDS,
  status: {
    ...BASE_SETTINGS.status,
    credentialsSet: true,
    selectionComplete: true,
    mappingComplete: true,
    requiredFieldsTotal: 1,
    requiredFieldsMapped: 1,
    subscriptionActive: true,
    pricingActive: true,
  },
  counters: { pending: 2, failed: 1, active: 4, voided: 0 },
};

function renderSection() {
  return render(
    <DialogProvider>
      <SettingsNeatSection />
    </DialogProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getNeatSettings.mockResolvedValue(BASE_SETTINGS);
});

test('unconfigured → « Non configurée » badge, credentials form, no discovery yet', async () => {
  renderSection();
  expect(await screen.findByText('Non configurée')).toBeInTheDocument();
  expect(screen.getByLabelText('Identifiant client (clientId)')).toBeInTheDocument();
  expect(screen.getAllByText('Secret client').length).toBeGreaterThan(0);
  expect(screen.queryByText('Charger les canaux de vente')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tester la connexion' })).toBeDisabled();
});

test('configured on staging → « Connectée — staging » badge + summary + counters', async () => {
  api.getNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  renderSection();
  expect(await screen.findByText('Connectée — staging')).toBeInTheDocument();
  expect(screen.getByText('Site direct')).toBeInTheDocument();
  expect(screen.getByText('Assurance annulation')).toBeInTheDocument();
  expect(screen.getByText('1 / 1')).toBeInTheDocument();
  expect(screen.getByText('2 en attente · 1 en échec · 4 active(s)')).toBeInTheDocument();
});

test('saving credentials posts the draft; an untouched secret stays OUT of the payload', async () => {
  api.getNeatSettings.mockResolvedValue({ ...CONFIGURED_SETTINGS });
  api.updateNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  renderSection();
  await screen.findByText('Connectée — staging');
  fireEvent.change(screen.getByLabelText('Identifiant client (clientId)'), { target: { value: 'svc-new' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateNeatSettings).toHaveBeenCalledTimes(1));
  const payload = api.updateNeatSettings.mock.calls[0][0];
  expect(payload.clientId).toBe('svc-new');
  expect(payload.marginPercent).toBe('30');
  expect('clientSecret' in payload).toBe(false);
});

test('« Tester la connexion » surfaces the server verdict, success and failure alike', async () => {
  api.getNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  api.testNeatConnection.mockResolvedValue({ ok: true, environment: 'staging' });
  renderSection();
  await screen.findByText('Connectée — staging');
  fireEvent.click(screen.getByRole('button', { name: 'Tester la connexion' }));
  expect(await screen.findByText('Connexion Neat réussie (staging).')).toBeInTheDocument();

  api.testNeatConnection.mockRejectedValue(new Error('Connexion Neat impossible : identifiants refusés (401).'));
  fireEvent.click(screen.getByRole('button', { name: 'Tester la connexion' }));
  expect(await screen.findByText(/identifiants refusés/)).toBeInTheDocument();
});

test('the mapping table renders one row per contract field with the « requis » badge', async () => {
  api.getNeatSettings.mockResolvedValue(CONFIGURED_SETTINGS);
  renderSection();
  await screen.findByText('Champs du contrat Neat');
  expect(screen.getAllByText('Nombre de nuits').length).toBeGreaterThan(0);
  expect(screen.getByText("Type d'hébergement")).toBeInTheDocument();
  expect(screen.getAllByText('requis')).toHaveLength(1);
});

test('a 422 on the mapping save marks the offending rows in French', async () => {
  api.getNeatSettings.mockResolvedValue({ ...CONFIGURED_SETTINGS, mapping: {} });
  const err = new Error('MAPPING_INVALID');
  err.code = 'MAPPING_INVALID';
  err.errors = [{ fieldId: 'f-nights', error: 'REQUIRED_UNMAPPED' }];
  api.updateNeatMapping.mockRejectedValue(err);
  renderSection();
  await screen.findByText('Champs du contrat Neat');
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le mappage' }));
  expect(await screen.findByText('Champ requis non mappé.')).toBeInTheDocument();
  expect(screen.getByText('Mappage incomplet — corrige les champs signalés.')).toBeInTheDocument();
});

test('the load failure state offers a retry', async () => {
  api.getNeatSettings.mockRejectedValueOnce(new Error('down'));
  renderSection();
  expect(await screen.findByText('Impossible de charger les réglages Neat.')).toBeInTheDocument();
  api.getNeatSettings.mockResolvedValue(BASE_SETTINGS);
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByText('Non configurée')).toBeInTheDocument();
});
