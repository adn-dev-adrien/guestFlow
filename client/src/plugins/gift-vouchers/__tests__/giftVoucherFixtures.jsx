// Shared fixtures of the gift-vouchers client suites: the server's payload shapes and a render wrapper.
import React from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';

export const summary = (over = {}) => ({
  id: 1,
  number: 'BC-2026-0001',
  kind: 'lodging',
  campaignId: 1,
  campaignName: 'Bon séjour',
  offered: false,
  contentsText: 'Un séjour dans nos logements, d’une valeur de 150 €',
  usedOn: null,
  bookingId: null,
  canDownload: true,
  state: 'active',
  amountCents: 15000,
  balanceCents: 15000,
  issuedAt: '2026-11-10T09:00:00.000Z', // date-literal-ok: the server's value, rendered as sent
  expiresOn: '2028-05-10',
  cancelledAt: null,
  buyerEmail: 'marie@example.test',
  senderName: 'Marie',
  recipientName: 'Paul',
  source: 'manual',
  paymentMethod: 'card',
  mailSentAt: null,
  mailError: null,
  ...over,
});

export const detail = (over = {}) => ({
  ...summary(),
  message: 'Joyeux anniversaire',
  codeMasked: '···· ···· ···· 3NPC',
  canCancel: true,
  oneShot: false,
  contentLines: ['Un séjour dans nos logements, d’une valeur de 150 €'],
  refundCents: 15000,
  withdrawal: { open: true, endsOn: '2026-11-24' }, // date-literal-ok: a payload the mocked server answers; the screen only shows it
  refunds: [],
  unusedCents: 0,
  unused: [],
  bath: null,
  movements: [
    {
      id: 1, kind: 'issue', label: 'Émission', amountCents: 15000, date: '2026-11-10', actorName: 'Adrien', reservationId: null, note: null, // date-literal-ok: a payload the mocked server answers; the screen only shows it
    },
  ],
  ...over,
});

export const PAYMENT_METHODS = [
  { value: 'card', label: 'CB' }, { value: 'cash', label: 'Espèces' }, { value: 'cheque', label: 'Chèque' },
];

// `route` + `path`: the page is mounted on a route pattern (`/bons-cadeaux/campagnes/:id`) entered at `route`.
/** The providers a gift-voucher page needs (theme, router at `route`, dialogs), around `ui` drawn at `path`. */
export function Shell({ ui, route = '/', path = null }) {
  return (
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[route]}>
        <DialogProvider>
          {path ? <Routes><Route path={path} element={ui} /><Route path="*" element={<div data-testid="elsewhere" />} /></Routes> : ui}
        </DialogProvider>
      </MemoryRouter>
    </ThemeProvider>
  );
}

export function renderWithShell(ui, { route = '/', path = null } = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <MemoryRouter initialEntries={[route]}>
        <DialogProvider>
          {path ? <Routes><Route path={path} element={ui} /><Route path="*" element={<div data-testid="elsewhere" />} /></Routes> : ui}
        </DialogProvider>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

const FOLLOWING_TEXT = 'puis 45 €/h';

export const CATALOGUE = [
  {
    articleRef: 'resource:1', kind: 'resource', id: 1, label: 'Bain nordique', category: null, priceType: 'per_hour', priceTypeLabel: 'Par heure', hourly: true, sellable: true, reason: null,
    modes: [
      {
        key: 'outside-day', band: 'day', label: 'Extérieur · journée', rateCents: 5000, from: '10:00', to: '19:00', lengthMinutes: 540, followingRateCents: 4500, followingText: FOLLOWING_TEXT, slotMinutes: 60, minimumMinutes: 60, sellable: true,
      },
      {
        key: 'outside-evening', band: 'evening', label: 'Extérieur · soirée', rateCents: 7000, from: '19:00', to: '22:00', lengthMinutes: 180, followingRateCents: 7000, followingText: null, slotMinutes: 60, minimumMinutes: 60, sellable: true,
      },
    ],
  },
  {
    articleRef: 'resource:2', kind: 'resource', id: 2, label: 'Sauna sans carte', category: null, priceType: 'per_hour', priceTypeLabel: 'Par heure', hourly: false, sellable: false, reason: 'Ressource à l’heure sans carte de planning : une séance se réserve au planning.', modes: [],
  },
  {
    articleRef: 'option:10', kind: 'option', id: 10, label: 'Planche apéro', category: 'Restauration', priceType: 'per_stay', priceTypeLabel: 'Prix fixe', hourly: false, sellable: true, reason: null, modes: [],
  },
  {
    articleRef: 'option:11', kind: 'option', id: 11, label: 'Boisson', category: 'Restauration', priceType: 'per_stay', priceTypeLabel: 'Prix fixe', hourly: false, sellable: true, reason: null, modes: [],
  },
  {
    articleRef: 'option:12', kind: 'option', id: 12, label: 'Petit-déjeuner', category: 'Restauration', priceType: 'per_night', priceTypeLabel: 'Par jour', hourly: false, sellable: false,
    reason: 'Le prix « par jour » a besoin d’un séjour : il ne se vend pas seul.', modes: [],
  },
];

export const campaign = (over = {}) => ({
  id: 5,
  name: 'Bain journée',
  title: 'Un bain nordique',
  kind: 'resource',
  state: 'draft',
  oneShot: false,
  slug: 'bain-jour',
  slugLockedAt: null,
  validityMonths: 12,
  composition: { resourceId: 1, band: 'day', minutes: 120, options: [{ articleRef: 'option:10', qty: 1 }] },
  addOns: ['option:11'],
  extraTimeMaxMinutes: 120,
  minAmountCents: null,
  maxAmountCents: null,
  ideas: [],
  vatRatePercent: null,
  voucherVisualId: 3,
  merchantVisualId: null,
  pricing: { priceable: true, totalCents: 10900 },
  summary: 'Bain nordique : 2 h en journée · Planche apéro',
  links: { offer: '/bon-cadeau/offrir/bain-jour', use: '/bon-cadeau/utiliser' },
  ...over,
});

export const lodgingCampaign = (over = {}) => campaign({
  id: 1, name: 'Bon séjour', title: 'Un séjour offert', kind: 'lodging', slug: 'sejour', composition: null, addOns: [], extraTimeMaxMinutes: 0,
  minAmountCents: 2000, maxAmountCents: 200000, vatRatePercent: 10, ideas: [{ label: 'Week-end', propertyId: 7, nights: 2, guests: 2 }],
  summary: 'Montant libre de 20 € à 2 000 €', links: { offer: '/bon-cadeau/offrir/sejour', use: '/bon-cadeau/utiliser' }, ...over,
});

export const visual = (over = {}) => ({
  id: 3, name: 'Recto bain', use: 'both', createdAt: '2026-11-01T10:00:00.000Z', versionId: 31, versions: 1, width: 1240, height: 1748, campaigns: [{ id: 5, name: 'Bain journée', state: 'draft' }], validVouchers: 2, ...over, // date-literal-ok: a payload the mocked server answers; the screen only shows it
});

export const PRICE = {
  ok: true,
  kind: 'resource',
  title: 'Un bain nordique',
  totalCents: 10900,
  extrasCents: 0,
  lines: [
    { kind: 'session', label: 'Bain nordique · journée', qty: 1, unitCents: 9000, totalCents: 9000, vatRate: 20 },
    { kind: 'option', label: 'Planche apéro', qty: 1, unitCents: 1900, totalCents: 1900, vatRate: 10 },
  ],
  vat: [{ rate: 20, cents: 1500 }, { rate: 10, cents: 173 }],
  vatLines: [{ ratePercent: 20, htCents: 7500, vatCents: 1500 }, { ratePercent: 10, htCents: 1727, vatCents: 173 }],
};

export const OFFER = {
  campaigns: [
    {
      slug: 'bain-jour', kind: 'resource', title: 'Un bain nordique', validityMonths: 12, band: { key: 'day', label: 'journée', from: '10:00', to: '19:00' },
      contents: [{ kind: 'session', label: 'Bain nordique', detail: '2 h en journée · de 10:00 à 19:00', qty: 1 }, { kind: 'option', label: 'Planche apéro', detail: null, qty: 1 }],
      addOns: [{
        articleRef: 'option:11', label: 'Boisson', maxQty: 20, unitLabel: 'l’unité', linear: true, prices: Array.from({ length: 20 }, (_, i) => ({ qty: i + 1, cents: (i + 1) * 650 - (i > 0 ? 50 : 0) })),
      }],
      extraTime: { maxMinutes: 120, stepMinutes: 60, prices: [{ minutes: 60, cents: 4500 }, { minutes: 120, cents: 8700 }] },
      totalCents: 10900,
    },
    {
      slug: 'sejour', kind: 'lodging', title: 'Un séjour offert', validityMonths: 18, minAmountCents: 2000, maxAmountCents: 200000, ideas: [],
    },
  ],
  omitted: [],
  paymentMethods: PAYMENT_METHODS,
};
