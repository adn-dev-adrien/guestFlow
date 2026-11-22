// Bons cadeaux — client module (specs/gift-vouchers.md §4.2, specs/gift-voucher-campaigns.md §4.2). The vouchers, the campaigns, the visual library, « Nouveau bon » and the settings contribute here.
import { lazy } from 'react';
import CardGiftcardOutlinedIcon from '@mui/icons-material/CardGiftcardOutlined';

// Rule 29 — admin only: the reception role sees nothing of the plugin.
export default {
  id: 'gift-vouchers',
  contributes: {
    routes: [
      { path: '/bons-cadeaux', Component: lazy(() => import('./GiftVouchersPage')), roles: ['admin'] },
      { path: '/bons-cadeaux/nouveau', Component: lazy(() => import('./NewVoucherPage')), roles: ['admin'] },
      { path: '/bons-cadeaux/campagnes', Component: lazy(() => import('./CampaignsPage')), roles: ['admin'] },
      { path: '/bons-cadeaux/campagnes/:id', Component: lazy(() => import('./CampaignEditor')), roles: ['admin'] },
      { path: '/bons-cadeaux/visuels', Component: lazy(() => import('./VisualsPage')), roles: ['admin'] },
      { path: '/parametres/bons-cadeaux', Component: lazy(() => import('./GiftVoucherSettings')), roles: ['admin'] },
    ],
    // Rules 40-41 — « Payer par bon cadeau » on a confirmed stay, « Recréditer le bon » on a cancelled one.
    'reservation.cards': [{ key: 'voucher', order: 20, Component: lazy(() => import('./ReservationVoucherCard')) }],
    'nav.items': [{ path: '/bons-cadeaux', label: 'Bons cadeaux', Icon: CardGiftcardOutlinedIcon, after: '/planning' }],
    'settings.menu': [{
      path: '/parametres/bons-cadeaux', label: 'Bons cadeaux', Icon: CardGiftcardOutlinedIcon, after: '/settings/emails',
      keywords: ['Bon cadeau', 'Liens permanents', 'Base des liens'],
    }],
  },
};
