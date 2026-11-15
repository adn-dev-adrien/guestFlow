// Bons cadeaux — client module (specs/gift-vouchers.md §4.2). The page, its dialogs and the settings contribute here.
import { lazy } from 'react';
import CardGiftcardOutlinedIcon from '@mui/icons-material/CardGiftcardOutlined';

// Rule 29 — admin only: the reception role sees nothing of the plugin.
export default {
  id: 'gift-vouchers',
  contributes: {
    routes: [
      { path: '/bons-cadeaux', Component: lazy(() => import('./GiftVouchersPage')), roles: ['admin'] },
      { path: '/parametres/bons-cadeaux', Component: lazy(() => import('./GiftVoucherSettings')), roles: ['admin'] },
    ],
    'nav.items': [{ path: '/bons-cadeaux', label: 'Bons cadeaux', Icon: CardGiftcardOutlinedIcon, after: '/planning' }],
    'settings.menu': [{
      path: '/parametres/bons-cadeaux', label: 'Bons cadeaux', Icon: CardGiftcardOutlinedIcon, after: '/settings/emails',
      keywords: ['Bon cadeau', 'Validité', 'Idées de séjour', 'Mail du bon'],
    }],
  },
};
