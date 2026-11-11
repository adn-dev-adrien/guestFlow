// specs/plugins-phase-2-hosts.md rules 5-6 — the planning is a host: plugins add day cards through
// `planning.days` and buttons through `planning.actions`, without the page knowing them. The
// contributions here are fakes; the laundry is one of them in production.
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';

const slots = {};
vi.mock('../../plugins/sdk/useSlot', () => ({ useSlot: (name) => slots[name] || [] }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { roles: ['admin'], enabledPlugins: [] } }) }));
vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => false }));
const showError = vi.fn();
vi.mock('../../components/DialogProvider', () => ({ useToast: () => ({ showError, showSuccess: vi.fn() }) }));
vi.mock('../../components/sas/ReservationSasDialog', () => ({ default: () => null }));
vi.mock('../../api', () => ({
  default: {
    getPlanningDays: vi.fn(async (range) => (await import('./planningDaysFixtures')).daysPayload(range)),
    // The server's date, in the week the clocks go back: the windows must still be 14 days long,
    // whatever the time zone the suite runs in (specs/ds-sweep-planning.md rule 28).
    getToday: vi.fn().mockResolvedValue({ today: '2026-10-25' }),
  },
}));

import PlanningPage from '../PlanningPage';
import { addIsoDays } from '../../utils/isoDay';
import { stubWindowScroll } from './planningDaysFixtures';

const iso = (offset) => addIsoDays('2026-10-25', offset);
const TODAY = iso(0);
const LATER = iso(3);

function Card({ label }) {
  return function ContributedCard({ date, entry, reload }) {
    return (
      <div data-testid="contributed">
        <span>{`${label} ${date} ${entry.n}`}</span>
        <button type="button" onClick={reload}>{`Recharger ${label}`}</button>
      </div>
    );
  };
}

function dayContribution(pluginId, key, rank, byDate, extra = {}) {
  let n = 0;
  return {
    pluginId,
    key,
    rank,
    load: vi.fn(async () => {
      n += 1;
      return Object.fromEntries(Object.entries(byDate).map(([date, label]) => [date, { label, n }]));
    }),
    Component: Card({ label: key }),
    ...extra,
  };
}

function renderPage() {
  return render(<MemoryRouter><PlanningPage /></MemoryRouter>);
}

// The page loads once the server date is known: wait until the counts stop moving, and compare
// against them.
async function settled(...contributions) {
  await waitFor(() => contributions.forEach((c) => expect(c.load).toHaveBeenCalled()));
  // The windows chain while the (empty) timeline is short: wait until the loads stop coming.
  let counts = [];
  for (let stable = 0; stable < 3;) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    const now = contributions.map((c) => c.load.mock.calls.length);
    stable = now.join() === counts.join() ? stable + 1 : 0;
    counts = now;
  }
  return counts;
}

beforeEach(() => {
  stubWindowScroll();
  vi.clearAllMocks();
  Object.keys(slots).forEach((k) => delete slots[k]);
});

test('specs/plugins-phase-2-hosts.md rule 5: planning.days dates join the day set and the cards are ordered by rank', async () => {
  const laundry = dayContribution('linen', 'laundry', 100, { [TODAY]: 'x', [LATER]: 'y' });
  const other = dayContribution('other', 'notes', 50, { [TODAY]: 'z' });
  slots['planning.days'] = [laundry, other];
  renderPage();

  // LATER has no arrival, departure or core card: it renders because a contribution returned it.
  expect(await screen.findByText(new RegExp(`^laundry ${LATER} `))).toBeInTheDocument();
  // Each window of the timeline asks the contribution for its own range (specs/dashboard-planning-scroll.md rule 11).
  expect(laundry.load).toHaveBeenCalledWith({ from: TODAY, to: iso(13) });
  expect(laundry.load).toHaveBeenCalledWith({ from: iso(-14), to: iso(-1) });
  expect(laundry.load).toHaveBeenCalledWith({ from: iso(14), to: iso(27) });
  // On TODAY, the lower rank comes first whatever the order of the contributions.
  const today = screen.getAllByTestId('contributed').filter((el) => el.textContent.includes(TODAY));
  expect(today.map((el) => el.querySelector('span').textContent.split(' ')[0])).toEqual(['notes', 'laundry']);
});

test('specs/plugins-phase-2-hosts.md rule 5: reload() reloads that contribution only', async () => {
  const laundry = dayContribution('linen', 'laundry', 100, { [TODAY]: 'x' });
  const other = dayContribution('other', 'notes', 50, { [TODAY]: 'z' });
  slots['planning.days'] = [laundry, other];
  renderPage();
  const [l, o] = await settled(laundry, other);

  fireEvent.click(await screen.findByText('Recharger laundry'));
  // That contribution again over every loaded window (specs/dashboard-planning-scroll.md rule 21).
  await waitFor(() => expect(laundry.load).toHaveBeenCalledTimes(l * 2));
  expect(await screen.findByText(new RegExp(`^laundry ${TODAY} (${[...Array(l)].map((_, i) => l + i + 1).join('|')})$`))).toBeInTheDocument();
  expect(other.load).toHaveBeenCalledTimes(o);
});

test('specs/plugins-phase-2-hosts.md rule 5: a failed load says so with the contribution message, and the other cards render', async () => {
  const broken = {
    pluginId: 'linen', key: 'laundry', rank: 100, load: vi.fn().mockRejectedValue(new Error('500')),
    Component: Card({ label: 'laundry' }), errorMessage: "Le linge n'a pas pu être chargé.",
  };
  const other = dayContribution('other', 'notes', 50, { [TODAY]: 'z' });
  slots['planning.days'] = [broken, other];
  renderPage();

  expect(await screen.findByText(new RegExp(`^notes ${TODAY} \\d+$`))).toBeInTheDocument();
  await waitFor(() => expect(showError).toHaveBeenCalledWith("Le linge n'a pas pu être chargé."));
  expect(screen.queryByText(/^laundry /)).not.toBeInTheDocument();
});

test('specs/plugins-phase-2-hosts.md rule 6: planning.actions renders in the action bar, and its reload() reloads its plugin\'s cards', async () => {
  const laundry = dayContribution('linen', 'laundry', 100, { [TODAY]: 'x' });
  const other = dayContribution('other', 'notes', 50, { [TODAY]: 'z' });
  slots['planning.days'] = [laundry, other];
  slots['planning.actions'] = [{
    pluginId: 'linen',
    key: 'extra-trip',
    Component: ({ reload }) => <button type="button" onClick={reload}>Voyage exceptionnel</button>,
  }];
  const { container } = renderPage();
  const [l, o] = await settled(laundry, other);

  const bar = container.querySelector('.MuiBox-root');
  fireEvent.click(within(bar).getByText('Voyage exceptionnel'));
  await waitFor(() => expect(laundry.load).toHaveBeenCalledTimes(l * 2));
  expect(await screen.findByText(new RegExp(`^laundry ${TODAY} (${[...Array(l)].map((_, i) => l + i + 1).join('|')})$`))).toBeInTheDocument();
  expect(other.load).toHaveBeenCalledTimes(o);
});

test('specs/plugins-phase-2-hosts.md rule 7: the day chip counts what a contribution says it holds to tick', async () => {
  const tasks = dayContribution('other', 'tasks', 10, { [LATER]: 'x' }, { countTasks: () => ({ done: 1, total: 2 }) });
  const laundry = dayContribution('linen', 'laundry', 100, { [LATER]: 'y' });
  slots['planning.days'] = [tasks, laundry];
  renderPage();

  expect(await screen.findByText(new RegExp(`^tasks ${LATER} `))).toBeInTheDocument();
  expect(screen.getByText('1/2')).toBeInTheDocument();
});
