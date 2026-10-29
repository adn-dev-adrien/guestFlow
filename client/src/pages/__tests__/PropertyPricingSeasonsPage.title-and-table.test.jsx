// specs/pricing-min-nights-per-range.md §6 rule 10 (2026-10-27 audit) — at 1280 the bar title read
// « Gestion tarifaire - La Granja — gîte… » (cut, two kinds of dash) and the seasons table overflowed
// its card by 36 px, clipping « Supprimer ». The name is now a caption beside the title, the amounts
// align right, and the table's floor fits the 1280 content column.
import React from 'react';
import { render, screen } from '@testing-library/react';
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
});
afterEach(() => { vi.useRealTimers(); });

test('the title is « Gestion tarifaire », the property name a separate caption', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Basse saison');
  expect(screen.getByText('Gestion tarifaire')).toBeInTheDocument();
  expect(screen.getByText('Aventura Lodge')).toBeInTheDocument();
  expect(screen.queryByText(/Gestion tarifaire -/)).toBeNull();
});

test('the seasons table no longer demands 980 px and right-aligns its figures', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Basse saison');
  const tables = screen.getAllByRole('table');
  const seasons = tables.find((t) => t.textContent.includes('Tarif base 1 nuit'));
  expect(seasons.style.minWidth || getComputedStyle(seasons).minWidth).not.toBe('980px');
  const header = screen.getByText('Tarif base 1 nuit');
  expect(header.className).toMatch(/alignRight/);
});
