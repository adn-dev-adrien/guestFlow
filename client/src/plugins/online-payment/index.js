// Paiement en ligne (Qonto) — client module (specs/plugins-phase-3a-online-payment.md rule 17). The
// payment buttons of the fiche and the dashboard stay core: they follow the server's `onlinePayment`
// and `remindType`, whatever the provider.
import { lazy } from 'react';
import PaymentsIcon from '@mui/icons-material/Payments';

const ROLES = ['admin'];

export default {
  id: 'online-payment',
  contributes: {
    routes: [
      { path: '/parametres/paiements', Component: lazy(() => import('./PaymentsSettingsPage')), roles: ROLES },
      // specs/qonto-bank-reconciliation.md rule 28 — the overview, under Suivi financier.
      { path: '/finance/rapprochement', Component: lazy(() => import('./ReconciliationPage')), roles: ROLES },
    ],
    'finance.menu': [{ key: 'bank-reconciliation', path: '/finance/rapprochement', label: 'Rapprochement bancaire', order: 60, roles: ROLES }],
    // Rules 25–27 — under the payments ledger of the fiche, from `pluginBlocks['online-payment']`.
    'reservation.cards': [{ key: 'bank-reconciliation', order: 5, Component: lazy(() => import('./ReservationReconciliationCard')) }],
    // Rule 22 — the home's « Écarts de règlement ».
    'dashboard.alerts': [{ key: 'bank-reconciliation', order: 20, Component: lazy(() => import('./ReconciliationAlert')) }],
    'settings.menu': [{
      path: '/parametres/paiements', label: 'Paiements en ligne', Icon: PaymentsIcon, before: '/settings/tva-exercice',
      keywords: ['Qonto', 'Lien de paiement', 'Carte bancaire', 'Paiement en ligne'],
    }],
  },
};
