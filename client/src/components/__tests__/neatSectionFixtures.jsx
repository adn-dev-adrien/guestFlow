// Shared fixtures for the « Assurance annulation (Neat) » suites
// (specs/neat-cancellation-insurance-subscription.md §6.1).
//
// A sibling non-test module, so a new subject never has to import — and therefore re-run — another
// suite (CLAUDE.md §9 "one test file per subject"). `vi.mock('../../api')` stays in each test file:
// Vitest hoists it per file.

export const CONTRACT_FIELDS = [
  { id: 'f-nights', title: 'Nombre de nuits', name: 'nights', type: 'number', required: true, options: [] },
  { id: 'f-kind', title: "Type d'hébergement", name: 'kind', type: 'dropdown', required: false, options: ['Lodge'] },
];

export const BASE_SETTINGS = {
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

export const CONFIGURED_SETTINGS = {
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
