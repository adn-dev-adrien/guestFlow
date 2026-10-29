// specs/pricing-min-nights-per-range.md §6 rule 10 (2026-10-27 audit) — on a 390 px phone the tariff page
// stacked twelve month grids (~4000 px) above the recipe card and the price grid. Below `sm` the year
// shows one month, browsed with « Mois précédent / Mois suivant ».
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

const routerState = vi.hoisted(() => ({ id: '2', navigate: () => {} }));

vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useParams: () => ({ id: routerState.id }),
    useNavigate: () => routerState.navigate,
    useLocation: () => ({ search: '' }),
  };
});
vi.mock('../../components/property/TariffRecipeCard', () => ({ default: () => null }));
vi.mock('../../components/PlatformPriceCard', () => ({ default: () => null }));
vi.mock('../../api', () => ({
  default: {
    getProperty: vi.fn(), getProperties: vi.fn(),
    getPublicHolidays: vi.fn(), getSchoolHolidays: vi.fn(),
    addPricingRule: vi.fn(), updatePricingRule: vi.fn(), deletePricingRule: vi.fn(),
    applyPricingRulesToProperty: vi.fn(), assignPricingDateRange: vi.fn(),
    previewProgressivePricing: vi.fn(),
  },
}));

import api from '../../api';
import DialogProvider from '../../components/DialogProvider';
import PropertyPricingSeasonsPage from '../PropertyPricingSeasonsPage';

// Every plugin active — the Solio configuration these tests describe (specs/plugins-phase-0-foundation.md).
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));

const TODAY = new Date('2026-08-12T10:00:00Z');

const SEASONS = [
  {
    id: 1, label: 'Basse saison', color: '#4caf50', pricePerNight: 179, pricingMode: 'fixed',
    minNights: 1, maxNights: 7, seasonKey: 'low', progressiveTiers: [],
    dateRanges: [{ startDate: '2026-08-29', endDate: '2026-10-14' }],
  },
  {
    id: 2, label: 'Haute saison', color: '#f44336', pricePerNight: 247, pricingMode: 'progressive',
    minNights: 1, maxNights: 7, seasonKey: 'high', progressiveTiers: [],
    dateRanges: [
      { startDate: '2027-06-07', endDate: '2027-06-12', minNights: 1, eventKey: 'ardechoise', eventLabel: "L'Ardéchoise" },
      { startDate: '2027-07-10', endDate: '2027-08-20' },
    ],
  },
];

function mockProperty(overrides = {}) {
  api.getProperty.mockResolvedValue({
    id: 2, name: 'Aventura Lodge',
    pricingRules: SEASONS.map((s) => ({ ...s, dateRangesVisible: s.dateRanges })),
    closureRanges: [], tariffRecipeId: 'aventura-lodge-2026', tariffRecipeVersion: '1.1.0',
    rateInclusions: [], ...overrides,
  });
  api.getProperties.mockResolvedValue([{ id: 2, name: 'Aventura Lodge' }]);
  api.getPublicHolidays.mockResolvedValue([]);
  api.getSchoolHolidays.mockResolvedValue([]);
}

const renderPage = () => render(<DialogProvider><PropertyPricingSeasonsPage /></DialogProvider>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TODAY);
  // jsdom has no matchMedia, so MUI's useMediaQuery falls back to `false` = desktop. Reporting a
  // match for every max-width query puts the page in its compact branch.
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query),
    media: query,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  });
});
afterEach(() => { vi.useRealTimers(); delete window.matchMedia; });

test('one month at a time, the current one first', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Basse saison');
  expect(screen.getByText(/^août 2026$/)).toBeInTheDocument();
  expect(screen.queryByText(/^sept\. 2026$/)).toBeNull();
  expect(screen.queryByText(/^janv\. 2026$/)).toBeNull();
});

test('the month arrows browse, and cross into the next year', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Basse saison');
  fireEvent.click(screen.getByRole('button', { name: 'Mois suivant' }));
  expect(screen.getByText(/^sept\. 2026$/)).toBeInTheDocument();
  for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Mois suivant' }));
  expect(screen.getByText(/^janv\. 2027$/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Mois précédent' }));
  expect(screen.getByText(/^déc\. 2026$/)).toBeInTheDocument();
});
