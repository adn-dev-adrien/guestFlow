// The tariff page BELOW md, where the seasons stop being a table and become a card list.
//
// The desktop suite (PropertyPricingSeasonsPage.test.jsx) runs in jsdom's default 1024 px world and
// therefore only ever exercises the <Table>. Without this file the whole compact branch — the one
// that exists because a 980 px table on a 390 px phone meant scrolling 2,6 screens sideways to read
// one season — would ship with no coverage at all.
//
// CLAUDE.md §Responsive · specs/tariff-recipes/spec.md §3.4 · specs/tariff-events-and-extra-guest-tiers §6.

import React from 'react';
import { render, screen, within } from '@testing-library/react';
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

test('the seasons render as cards, not as a horizontally-scrolling table', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Basse saison');
  // The seasons <Table> is gone. (The season DIALOG holds none, and the platform grid is mocked out,
  // so any surviving table would be the one this branch exists to replace.)
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

test('a card carries everything its table row did', async () => {
  mockProperty();
  renderPage();
  const label = await screen.findByText('Haute saison');
  const card = label.closest('.MuiCard-root');

  expect(within(card).getByText('recette · high')).toBeInTheDocument();
  expect(within(card).getByText('07/06/2027 → 12/06/2027')).toBeInTheDocument();
  expect(within(card).getByText("L'Ardéchoise")).toBeInTheDocument();
  expect(within(card).getByText('Dégressif')).toBeInTheDocument();
  expect(within(card).getByText('247,00 € / nuit')).toBeInTheDocument();
  expect(within(card).getByText('1 – 7 nuits')).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Modifier' })).toBeInTheDocument();
  expect(within(card).getByRole('button', { name: 'Supprimer' })).toBeInTheDocument();
});

test('the year rules still group the ranges on a card', async () => {
  mockProperty();
  renderPage();
  const label = await screen.findByText('Haute saison');
  const card = label.closest('.MuiCard-root');
  expect(within(card).getByText('2027')).toBeInTheDocument();
});

test('the page-bar actions collapse — no labelled-button staircase squeezing the title', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Basse saison');

  // The three labelled buttons are gone; the title keeps its room (and drops the property name).
  expect(screen.queryByRole('button', { name: 'Appliquer à un autre logement' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nouvelle saison' })).not.toBeInTheDocument();
  expect(screen.getByText('Gestion tarifaire')).toBeInTheDocument();
  expect(screen.queryByText(/Gestion tarifaire - Aventura Lodge/)).not.toBeInTheDocument();
});

test('an empty season list still says so on the compact branch', async () => {
  mockProperty({ pricingRules: [] });
  renderPage();
  expect(await screen.findByText(/Aucune saison/)).toBeInTheDocument();
});
