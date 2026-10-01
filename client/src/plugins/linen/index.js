// Linge et blanchisserie — client module (specs/plugins-phase-2-hosts.md §3.D).
import { lazy } from 'react';
import LocalLaundryServiceIcon from '@mui/icons-material/LocalLaundryService';

export default {
  id: 'linen',
  contributes: {
    routes: [{ path: '/parametres/stock-blanchisserie', Component: lazy(() => import('./LinenStockPage')), roles: ['admin'] }],
    'settings.menu': [{
      path: '/parametres/stock-blanchisserie', label: 'Linge', Icon: LocalLaundryServiceIcon, after: '/parametres/vacances-fermetures',
    }],
    // Before the recipe runs: a shortage is something to act on before the stays it names.
    'dashboard.alerts': [{ key: 'linen-shortage', order: 5, Component: lazy(() => import('./LinenShortageAlert')) }],
    // The laundry card sits at the bottom of its day, after the core's cards without an hour.
    'planning.days': [{
      key: 'laundry',
      order: 10,
      rank: 100,
      load: (range) => import('./planningDays').then((m) => m.loadLaundryDays(range)),
      Component: lazy(() => import('./PlanningLaundryCard')),
      errorMessage: "Le linge n'a pas pu être chargé.",
    }],
    'planning.actions': [{ key: 'extra-trip', order: 10, Component: lazy(() => import('./ExtraTripButton')) }],
  },
};
