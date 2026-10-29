// specs/dashboard-planning-scroll.md rule 33 — « Aujourd'hui » still lands on today when a window request
// releases today's window while its smooth scroll runs (the flaky E2E timeline-scroll, audit round 4):
// the timeline is reopened on today, unless the operator took the scroll back.
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
import { daysPayload, stay, stubWindowScroll } from './planningDaysFixtures';

const TODAY = '2026-10-25';
const at = (offset) => addIsoDays(TODAY, offset);
const windowRange = (k) => ({ from: at(14 * k), to: at(14 * k + 13) });
const asked = () => getPlanningDays.mock.calls.map(([range]) => range);
const askedWindows = (k) => asked().filter((r) => r.from === windowRange(k).from);

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


const reachWindowSeven = async () => {
  await opened();
  for (let i = 0; i < 12 && askedWindows(7).length === 0; i += 1) {
    await scrollWindowTo(99000 + i);
    await waitFor(() => expect(asked().length).toBeGreaterThan(3 + i));
  }
  await waitFor(() => expect(askedWindows(7)).toHaveLength(1));
};

test('rule 33 — a request that releases today\'s window during the smooth scroll reopens the timeline on today', async () => {
  renderPage();
  await reachWindowSeven();
  scrollTo.mockClear();
  fireEvent.click(screen.getByRole('button', { name: "Aujourd'hui" }));
  expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  expect(askedWindows(0)).toHaveLength(1);
  // The end edge asks window 8 while the scroll runs: the ninth window releases window 0.
  await scrollWindowTo(99500);
  await waitFor(() => expect(askedWindows(8)).toHaveLength(1));
  await waitFor(() => expect(askedWindows(0)).toHaveLength(2));
  await waitFor(() => expect(askedWindows(-1)).toHaveLength(2));
});

test('rule 33 — the operator taking the scroll back cancels the return to today', async () => {
  renderPage();
  await reachWindowSeven();
  fireEvent.click(screen.getByRole('button', { name: "Aujourd'hui" }));
  fireEvent.wheel(window, { deltaY: 300 });
  await scrollWindowTo(99500);
  await waitFor(() => expect(askedWindows(8)).toHaveLength(1));
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(askedWindows(0)).toHaveLength(1);
});
