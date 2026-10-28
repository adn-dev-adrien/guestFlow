// specs/dashboard-planning-scroll.md rules 11-23 — the planning is a timeline of 14-day windows on a fixed
// grid: one server call per window, opening on today, both edges extending, an empty fortnight never
// stopping the scroll, past days toned down, « Aujourd'hui » as a bar action, 8 windows at most, edge
// errors that retry, targeted reloads, no date input, a rebuild when the server day moves on.
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
const scrollWindowTo = (y) => act(() => { scrollY = y; window.dispatchEvent(new Event('scroll')); });
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

test('rule 11 — each window is asked once, with every plugin contribution for the same range', async () => {
  const load = vi.fn(async () => ({}));
  slots['planning.days'] = [{ pluginId: 'p', key: 'k', rank: 1, load, Component: () => null }];
  renderPage();
  await opened();
  expect(asked()).toHaveLength(3);
  [-1, 0, 1].forEach((k) => {
    expect(askedWindows(k)).toHaveLength(1);
    expect(load).toHaveBeenCalledWith(windowRange(k));
  });
  // A burst of scroll events at the top asks the window before once, never twice.
  scrollWindowTo(10);
  scrollWindowTo(20);
  scrollWindowTo(30);
  await waitFor(() => expect(askedWindows(-2)).toHaveLength(1));
  const froms = asked().map((r) => r.from);
  expect(new Set(froms).size).toBe(froms.length);
});

test('rule 12 — opens on windows -1, 0 and 1, and puts today\'s header right under the page bar', async () => {
  renderPage();
  await opened();
  expect(asked().map((r) => r.from).sort()).toEqual([windowRange(-1).from, windowRange(0).from, windowRange(1).from]);
  // The bar's bottom edge is the app bar (64) plus the bar (0 in jsdom): today's top at 700 moves to 64.
  expect(scrollTo).toHaveBeenCalledWith({ top: 3000 - 64, behavior: 'instant' });
});

test('rule 14 — an empty fortnight never stops the scroll: windows keep coming until the stays of December', async () => {
  const december = stay(9, { startDate: at(43), endDate: at(46) });
  getPlanningDays.mockImplementation(async (range) => cards({ [at(43)]: { arrivals: [december] } })(range));
  renderPage();
  await opened();
  scrollY = 99000;
  scrollWindowTo(99100);
  await waitFor(() => expect(askedWindows(3)).toHaveLength(1));
  expect((await screen.findAllByText(/Client9/)).length).toBeGreaterThan(0);
  expect(screen.getAllByTestId('planning-fold').length).toBeGreaterThan(0);
});

test('rule 17 — past days are toned down, today is filled primary', async () => {
  getPlanningDays.mockImplementation(async (range) => cards({
    [at(-2)]: { departures: [stay(1, { startDate: at(-6), endDate: at(-2) })] },
    [at(0)]: { arrivals: [stay(2)] },
    [at(2)]: { arrivals: [stay(3, { startDate: at(2) })] },
  })(range));
  renderPage();
  await opened();
  const tones = screen.getAllByTestId('planning-day-header').map((h) => h.firstChild.getAttribute('data-tone'));
  expect(tones).toEqual(['past', 'today', 'upcoming']);
  expect(screen.getByText(/Aujourd'hui/, { selector: 'p, span' })).toBeInTheDocument();
});

test('rule 18 — « Aujourd\'hui » scrolls back smoothly, and is disabled while today\'s header is at the top', async () => {
  renderPage();
  await opened();
  const button = screen.getByRole('button', { name: "Aujourd'hui" });
  expect(button).toBeEnabled();
  scrollTo.mockClear();
  scrollY = 5000;
  fireEvent.click(button);
  expect(scrollTo).toHaveBeenCalledWith({ top: 5000 + 3000 - 64, behavior: 'smooth' });
  todayTop = 64;
  scrollWindowTo(7936);
  await waitFor(() => expect(screen.getByRole('button', { name: "Aujourd'hui" })).toBeDisabled());
});

test('rule 19 — a ninth window releases the farthest one on the other side, and it is asked again if the scroll comes back', async () => {
  const early = stay(5, { startDate: at(-10), endDate: at(-7) });
  getPlanningDays.mockImplementation(async (range) => cards({ [at(-10)]: { arrivals: [early] } })(range));
  renderPage();
  await opened();
  expect((await screen.findAllByText(/Client5/)).length).toBeGreaterThan(0);
  for (let i = 0; i < 4 && askedWindows(7).length === 0; i += 1) {
    scrollWindowTo(99000 + i);
    await waitFor(() => expect(asked().length).toBeGreaterThan(3 + 4 * i));
  }
  await waitFor(() => expect(askedWindows(7)).toHaveLength(1));
  await waitFor(() => expect(screen.queryByText(/Client5/)).not.toBeInTheDocument());
  expect(askedWindows(-1)).toHaveLength(1);
  scrollWindowTo(100);
  await waitFor(() => expect(askedWindows(-1)).toHaveLength(2));
});

test('rule 20 — a failed window says so at its edge with a retry; the other edge keeps extending', async () => {
  let failing = true;
  getPlanningDays.mockImplementation(async (range) => {
    if (range.from === windowRange(2).from && failing) throw new Error('boom');
    return cards({})(range);
  });
  renderPage();
  await opened();
  scrollWindowTo(99500);
  expect(await screen.findByText("Ces jours n'ont pas pu être chargés.")).toBeInTheDocument();
  const before = asked().length;
  scrollWindowTo(99600);
  expect(asked()).toHaveLength(before);
  scrollWindowTo(100);
  await waitFor(() => expect(askedWindows(-2)).toHaveLength(1));
  failing = false;
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  await waitFor(() => expect(askedWindows(2)).toHaveLength(2));
  await waitFor(() => expect(screen.queryByText("Ces jours n'ont pas pu être chargés.")).not.toBeInTheDocument());
});

test('rule 20 — a failed opening shows the page error with a retry', async () => {
  let failing = true;
  getPlanningDays.mockImplementation(async (range) => {
    if (failing) throw new Error('boom');
    return cards({})(range);
  });
  renderPage();
  expect(await screen.findByText('Impossible de charger le planning.')).toBeInTheDocument();
  failing = false;
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByTestId('planning-timeline')).toBeInTheDocument();
});

test('rule 21 — a committed SAS reloads the windows holding the stay\'s two days, not the whole timeline', async () => {
  const sas = stay(5, { startDate: at(1), endDate: at(16) });
  getPlanningDays.mockImplementation(async (range) => cards({
    [at(1)]: { arrivals: [sas] },
    [at(16)]: { departures: [sas] },
  })(range));
  slots['sas.dialog'] = [{
    pluginId: 'sas', key: 'dialog', Component: ({ open, onDone }) => (open ? <button type="button" onClick={onDone}>Valider le SAS</button> : null),
  }];
  renderPage('/planning?sas=arrival&reservationId=5');
  await opened();
  fireEvent.click(await screen.findByRole('button', { name: 'Valider le SAS' }));
  await waitFor(() => expect(askedWindows(0)).toHaveLength(2));
  await waitFor(() => expect(askedWindows(1)).toHaveLength(2));
  expect(askedWindows(-1)).toHaveLength(1);
});

test('rule 22 — no date input or arrows in the bar; « Aujourd\'hui » and the plugin buttons are there', async () => {
  slots['planning.actions'] = [{ pluginId: 'linen', key: 'trip', Component: () => <button type="button">Voyage</button> }];
  renderPage();
  await opened();
  expect(screen.queryByLabelText('Date de début')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Jour précédent')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Jour suivant')).not.toBeInTheDocument();
  expect(screen.queryByText(/Rien de prévu sur les 14 prochains jours/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: "Aujourd'hui" })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Voyage' })).toBeInTheDocument();
});

test('rule 23 — when the server day moves on the timeline is rebuilt on the new today', async () => {
  renderPage();
  await opened();
  expect(askedWindows(0)).toHaveLength(1);
  getToday.mockResolvedValue({ today: at(1) });
  act(() => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(asked().some((r) => r.from === at(1))).toBe(true));
  await waitFor(() => expect(asked().some((r) => r.from === at(15))).toBe(true));
});
