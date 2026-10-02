// Assurance annulation Neat — client module (specs/plugins-phase-3b-neat.md §3.D): its Intégrations card,
// and the subscription state under the fiche's insurance line.
import { lazy } from 'react';

export default {
  id: 'neat',
  contributes: {
    'settings.integrations': [
      { key: 'neat', order: 20, Component: lazy(() => import('./SettingsNeatSection')) },
    ],
    'reservation.optionLine': [{
      key: 'neat',
      appliesTo: (option) => Boolean(option && option.isCancellationInsurance),
      Component: lazy(() => import('./NeatInsuranceStatus')),
    }],
  },
};
