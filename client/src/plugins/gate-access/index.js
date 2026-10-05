// Accès au portail (Sowel) — client module (specs/plugins-phase-1-sdk.md §3.C).
import { lazy } from 'react';

export default {
  id: 'gate-access',
  contributes: {
    'settings.integrations': [
      { key: 'gate', order: 40, Component: lazy(() => import('./SettingsGateAccessSection')) },
    ],
    // High in the stack: a guest at a closed gate is the cost of missing it.
    'dashboard.alerts.urgent': [{ key: 'gate-keys', order: 10, Component: lazy(() => import('./GateKeysAlert')) }],
    'reservation.cards': [{ key: 'gate', order: 10, Component: lazy(() => import('./GateAccessCard')) }],
    // Inside the SAS « Portail » step, when the SAS data says there is a key for the stay.
    'sas.portal': [{ key: 'gate', order: 10, Component: lazy(() => import('./SasGateAccessStep')) }],
  },
};
