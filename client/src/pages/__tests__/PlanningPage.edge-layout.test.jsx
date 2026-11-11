// specs/dashboard-planning-scroll.md rules 20 (start-edge skeleton out of the layout) and 31 (the browser's own
// scroll anchoring is off on the timeline: the hook is the only mechanism that compensates a shift).
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const slots = {};
vi.mock('../../plugins/sdk/useSlot', () => ({ useSlot: (name) => slots[name] || [] }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { roles: ['admin'], enabledPlugins: [] } }) }));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../components/DialogProvider', () => ({ useToast: () => ({ showError: vi.fn(), showSuccess: vi.fn() }) }));
const { getPlanningDays, getToday } = vi.hoisted(() => ({ getPlanningDays: vi.fn(), getToday: vi.fn() }));
vi.mock('../../api', () => ({
  default: {
    getPlanningDays: (...args) => getPlanningDays(...args),
    getToday: (...args) => getToday(...args),
    markPayment: vi.fn(),
  },
}));

import PlanningPage from '../PlanningPage';
import { addIsoDays } from '../../utils/isoDay';
import { daysPayload, stubWindowScroll } from './planningDaysFixtures';

const TODAY = '2026-10-25';
const at = (offset) => addIsoDays(TODAY, offset);
const windowRange = (k) => ({ from: at(14 * k), to: at(14 * k + 13) });

let scrollY;
let scrollHeight;
let scrollTo;
let todayTop;

function installGeometry() {
  scrollY = 0;
  scrollHeight = 100000;
  todayTop = 3000;
  scrollTo = stubWindowScroll();
  scrollTo.mockImplementation(({ top }) => { scrollY = top; });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    const top = this.getAttribute?.('data-scroll-anchor') === `day-${TODAY}` ? todayTop : 0;
    return { top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100 };
  });
}

const cards = (byDate) => (range) => daysPayload(range, { today: TODAY, cardsByDate: byDate });

function renderPage(url = '/planning') {
  return render(<MemoryRouter initialEntries={[url]}><PlanningPage /></MemoryRouter>);
}
// Each call is its own gesture: the operator was quiet for longer than the hook's settle time.
const scrollWindowTo = async (y) => {
  await new Promise((resolve) => setTimeout(resolve, 230));
  act(() => { scrollY = y; window.dispatchEvent(new Event('scroll')); });
};
const opened = async () => { await screen.findByTestId('planning-timeline'); await waitFor(() => expect(scrollTo).toHaveBeenCalled()); };

beforeEach(() => {
  vi.restoreAllMocks();
  getPlanningDays.mockReset().mockImplementation(async (range) => cards({})(range));
  getToday.mockReset().mockResolvedValue({ today: TODAY });
  Object.keys(slots).forEach((k) => delete slots[k]);
  installGeometry();
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { delete window.matchMedia; });


test('rule 31 — the timeline switches the browser\'s scroll anchoring off', async () => {
  renderPage();
  await opened();
  expect(screen.getByTestId('planning-timeline')).toHaveStyle({ overflowAnchor: 'none' });
});

test('rule 20 — a past window in flight shows a thin progress bar glued under the page bar, out of the layout', async () => {
  getPlanningDays.mockImplementation((range) => (range.from === windowRange(-2).from
    ? new Promise(() => {})
    : Promise.resolve(cards({})(range))));
  renderPage();
  await opened();
  expect(screen.queryByTestId('page-action-bar-progress')).toBeNull();
  await scrollWindowTo(100);
  const progress = await screen.findByTestId('page-action-bar-progress');
  expect(progress).toHaveAttribute('aria-label', 'Chargement des jours précédents');
  expect(progress).toHaveStyle({ position: 'absolute', height: '2px' });
  expect(screen.getByTestId('planning-timeline').querySelector('[aria-busy="true"]')).toBeNull();
});
