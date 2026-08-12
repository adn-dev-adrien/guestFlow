// The tariff page's own display logic, which no other test covers: which ranges the seasons table
// shows, how it groups them, what it says about an event, and what a closure hides.
//
// All of it is presentation over a server payload — but presentation with rules, and rules that
// silently drop information when they break: a range filtered out by mistake simply does not
// appear, and nothing errors. Hence assertions on what is ABSENT as much as on what is present.
//
// specs/tariff-events-and-extra-guest-tiers/spec.md §3.3 · specs/tariff-recipes/spec.md §3.4.

import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
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
// The recipe card owns its own fetches and has its own suite; here it would only add noise.
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

// The page calls useToast, which lives behind DialogProvider.
const renderPage = () => render(<DialogProvider><PropertyPricingSeasonsPage /></DialogProvider>);

// « Today » is pinned so « upcoming » is a fact of the test, not of the day it runs.
const TODAY = new Date('2026-08-12T10:00:00Z');

const SEASONS = [
  {
    id: 1, label: 'Basse saison', color: '#4caf50', pricePerNight: 179, pricingMode: 'fixed',
    minNights: 1, maxNights: 7, seasonKey: 'low', progressiveTiers: [],
    dateRanges: [
      { startDate: '2026-01-01', endDate: '2026-04-03' },   // past
      { startDate: '2026-08-29', endDate: '2026-10-14' },   // upcoming
      { startDate: '2027-04-01', endDate: '2027-05-05' },   // next year
    ],
  },
  {
    id: 2, label: 'Haute saison', color: '#f44336', pricePerNight: 247, pricingMode: 'progressive',
    minNights: 1, maxNights: 7, seasonKey: 'high', progressiveTiers: [],
    dateRanges: [
      { startDate: '2026-06-08', endDate: '2026-06-13', minNights: 1, eventKey: 'ardechoise', eventLabel: "L'Ardéchoise" },
      { startDate: '2027-06-07', endDate: '2027-06-12', minNights: 1, eventKey: 'ardechoise', eventLabel: "L'Ardéchoise" },
      { startDate: '2027-07-10', endDate: '2027-08-20' },
    ],
  },
];

// `dateRangesVisible` is the server's closure-subtracted view; the page renders it when present.
function withVisible(seasons, closureRanges = []) {
  return seasons.map((s) => ({ ...s, dateRangesVisible: s.dateRanges }));
}

function mockProperty(overrides = {}) {
  api.getProperty.mockResolvedValue({
    id: 2, name: 'Aventura Lodge', pricingRules: withVisible(SEASONS),
    closureRanges: [], tariffRecipeId: 'aventura-lodge-2026', tariffRecipeVersion: '1.1.0',
    rateInclusions: [], ...overrides,
  });
  api.getProperties.mockResolvedValue([{ id: 2, name: 'Aventura Lodge' }]);
  api.getPublicHolidays.mockResolvedValue([]);
  api.getSchoolHolidays.mockResolvedValue([]);
}

const seasonsTable = () => screen.getByRole('table');
const rowFor = (label) => within(seasonsTable()).getAllByRole('row').find((r) => r.textContent.includes(label));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(TODAY);
});
afterEach(() => { vi.useRealTimers(); });

test('the seasons table shows only upcoming ranges — a past one is dropped, not rendered greyed', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Basse saison');

  const row = rowFor('Basse saison');
  expect(row.textContent).toContain('29/08/2026');
  expect(row.textContent).toContain('01/04/2027');
  // January-April 2026 is over: showing it would pad the table with dates nobody can sell.
  expect(row.textContent).not.toContain('01/01/2026');
});

test('upcoming ranges are grouped under a discreet year heading', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Basse saison');

  const row = rowFor('Basse saison');
  // Both years present, and each appears as its own separator label.
  expect(within(row).getByText('2026')).toBeInTheDocument();
  expect(within(row).getByText('2027')).toBeInTheDocument();
});

test('an event range is named in the table, so the table alone explains a high-season week', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Haute saison');

  const row = rowFor('Haute saison');
  expect(row.textContent).toContain('07/06/2027');
  expect(within(row).getAllByText("L'Ardéchoise").length).toBeGreaterThan(0);
  // The plain summer range carries no event label.
  expect(row.textContent).toContain('10/07/2027');
});

test('a season entirely inside a closure keeps its data but shows no sellable date', async () => {
  const closed = [{
    ...SEASONS[0],
    dateRanges: [{ startDate: '2026-11-01', endDate: '2026-12-31' }],
    dateRangesVisible: [],
  }];
  mockProperty({
    pricingRules: closed,
    closureRanges: [{ startDate: '2026-10-15', endDate: '2027-03-31', label: 'Fermeture hivernale' }],
  });
  renderPage();
  await screen.findByText('Basse saison');

  const row = rowFor('Basse saison');
  expect(row.textContent).toContain('entièrement en fermeture');
  // The stored range is intact — the message must not be mistaken for « no ranges configured ».
  expect(row.textContent).not.toContain('aucune plage');
});

test('a season with ranges but none upcoming says so, distinctly from having no range at all', async () => {
  const past = [{
    ...SEASONS[0],
    dateRanges: [{ startDate: '2026-01-01', endDate: '2026-02-01' }],
    dateRangesVisible: [{ startDate: '2026-01-01', endDate: '2026-02-01' }],
  }];
  mockProperty({ pricingRules: past });
  renderPage();
  await screen.findByText('Basse saison');
  expect(rowFor('Basse saison').textContent).toContain('aucune date à venir');
});

test('the min–max column reads the season, and the recipe/manual origin is visible', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Haute saison');

  const row = rowFor('Haute saison');
  expect(row.textContent).toContain('1 – 7');
  expect(row.textContent).toContain('recette · high');
});

test('a manual season is labelled as such — a recipe apply will never touch it', async () => {
  mockProperty({
    pricingRules: withVisible([{ ...SEASONS[0], id: 9, label: 'Peinte à la main', seasonKey: null }]),
  });
  renderPage();
  await screen.findByText('Peinte à la main');
  expect(rowFor('Peinte à la main').textContent).toContain('Manuelle');
});

test('the calendar is navigated by year, and the removed controls stay removed', async () => {
  mockProperty();
  renderPage();
  await screen.findByText('Haute saison');

  // The current year is the entry point, FRAMED by the two chevrons — scoped to their own row,
  // because « 2026 » also appears as a year separator inside the seasons table.
  const prev = screen.getByRole('button', { name: /année précédente/i });
  const next = screen.getByRole('button', { name: /année suivante/i });
  expect(prev.parentElement).toBe(next.parentElement);
  expect(prev.parentElement.textContent).toContain('2026');
  // Deliberately deleted — their return would mean the redesign was reverted by a merge.
  expect(screen.queryByText(/Année de départ/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Nombre d'années affichées/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Retour au logement/i)).not.toBeInTheDocument();
});
