// Paiement en ligne (Qonto) — client module (specs/plugins-phase-3a-online-payment.md rule 17). The
// payment buttons of the fiche and the dashboard stay core: they follow the server's `onlinePayment`
// and `remindType`, whatever the provider.
import { lazy } from 'react';
import PaymentsIcon from '@mui/icons-material/Payments';

export default {
  id: 'online-payment',
  contributes: {
    routes: [{ path: '/parametres/paiements', Component: lazy(() => import('./PaymentsSettingsPage')), roles: ['admin'] }],
    'settings.menu': [{
      path: '/parametres/paiements', label: 'Paiements en ligne', Icon: PaymentsIcon, before: '/settings/tva-exercice',
    }],
  },
};
