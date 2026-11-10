// Application clients — client module (specs/guest-app.md §4.2).
import { lazy } from 'react';
import RoomServiceOutlinedIcon from '@mui/icons-material/RoomServiceOutlined';
import { countOrderTasks } from './planningOrderTasks';

const itemFields = (key) => ({
  key,
  order: 90,
  section: { title: 'Application clients' },
  Component: lazy(() => import('./GuestAppItemFields')),
});

export default {
  id: 'guest-app',
  contributes: {
    'settings.integrations': [{
      key: 'guest-app',
      order: 80,
      tabLabel: 'Application clients',
      keywords: ['Application clients', 'Mon séjour', 'Livret', 'QR', 'Studio'],
      Component: lazy(() => import('./SettingsGuestAppSection')),
    }],
    // specs/guest-app.md rule 9bis (a) — « Mon séjour » takes the SAS « Portail » step over while the SAS data says
    // this stay has a link; the gate key's own step becomes its « QR du portail seul ».
    'sas.portal': [{
      key: 'stay-app',
      order: 5,
      leadsStep: { title: 'Mon séjour' },
      Component: lazy(() => import('./SasStayAppStep')),
    }],
    // Rule 71 — « Commandes Mon séjour »: the orders the stay took in the app before its arrival, just before the recap.
    'sas.arrival.steps': [{
      key: 'stay-app-orders',
      title: 'Commandes Mon séjour',
      Icon: RoomServiceOutlinedIcon,
      isShown: (data) => Boolean(data && data.ordersAtArrival && data.ordersAtArrival.orders.length),
      recapNotes: (value, data) => (data && data.ordersAtArrival && data.ordersAtArrival.toCollect > 0
        ? [`Commandes Mon séjour : ${data.ordersAtArrival.toCollectLabel} (dans le complément d’arrivée)`] : []),
      Component: lazy(() => import('./SasArrivalOrdersStep')),
    }],
    // Rule 9bis (c) — the stay's link on the fiche.
    'reservation.cards': [{ key: 'stay-link', order: 15, Component: lazy(() => import('./StayLinkCard')) }],
    // Rules 22, 37bis — the « Application clients » section of the option and resource editors, stock included.
    'options.fields': [itemFields('guest-app')],
    'resources.fields': [itemFields('guest-app')],
    // Rule 37quater — « Stock : épuisé » under a line of the fiche, a warning that never blocks.
    'reservation.optionLine': [{ key: 'stock', appliesTo: () => true, Component: lazy(() => import('./StockLineWarning')) }],
    'reservation.resourceLine': [{ key: 'stock', appliesTo: () => true, Component: lazy(() => import('./StockLineWarning')) }],
    // Rule 45 — « Commandes clients », in the day-to-day group of the side menu. Admin only: the reception role sees
    // only the dashboard, the planning and its account (specs/reception-role-checkin-only.md); it marks an order
    // delivered from the order's card on the planning.
    routes: [{ path: '/commandes-app', Component: lazy(() => import('./GuestOrdersPage')), roles: ['admin'] }],
    'nav.items': [{ path: '/commandes-app', label: 'Commandes clients', Icon: RoomServiceOutlinedIcon, after: '/planning' }],
    // Rule 43 — the « Commande client » cards on the planning day of their delivery time.
    'planning.days': [{
      key: 'guest-orders',
      order: 20,
      timed: true,
      load: (range) => import('./planningOrders').then((m) => m.loadOrderDays(range)),
      countTasks: countOrderTasks,
      Component: lazy(() => import('./PlanningOrderCard')),
      errorMessage: "Les commandes clients n'ont pas pu être chargées.",
    }],
  },
};
