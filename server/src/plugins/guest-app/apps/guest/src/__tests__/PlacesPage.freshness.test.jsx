// specs/guest-app/guest-app-local-amenities.md rule 13 — a state is never shown past its `until`: a payload whose `until` has passed,
// or read without network, shows no open / closed line (list and sheet) and keeps the week's table; the page reads `/places` again
// when a shown `until` passes and when the app comes back to the foreground. The map is a stand-in.
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp, stubApi } from './guestFixtures';
import { BAKERY, BAKERY_2, PLACES, placesRoutes } from './placesFixtures';

vi.mock('../components/PlacesMap', () => ({ default: () => <div data-testid="map" /> }));

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2099-07-07T10:00:00Z') }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const at = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();
const payload = (until, label = 'Ouvert · ferme à 13 h') => ({
  ...PLACES,
  places: [{ ...BAKERY, open: { state: 'open', label, until } }, { ...BAKERY_2, open: { ...BAKERY_2.open, until } }],
  categories: [{ key: 'boulangerie', label: 'Boulangeries', count: 2 }],
});
const listView = async (user) => {
  await user.click(await screen.findByRole('button', { name: 'Liste' }));
};
const placesCalls = (calls) => calls.filter((c) => c.path === '/places').length;

describe('PlacesPage — a state is never shown past its until (rule 13)', () => {
  it('a state still valid is shown; one whose until has passed is hidden, and the week\'s table stays in the sheet', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubApi(placesRoutes({ 'GET /places': payload(at(-1000)) }));
    renderApp('/pratique');
    await listView(user);
    const row = await screen.findByRole('button', { name: /Maison Roux/ });
    expect(row).not.toHaveTextContent('Ouvert');
    await user.click(row);
    const sheet = await screen.findByRole('dialog', { name: 'Maison Roux' });
    expect(within(sheet).queryByText(/Ouvert/)).toBeNull();
    expect(within(sheet).getAllByRole('row')).toHaveLength(7);
    expect(within(sheet).getByText('mardi').closest('tr')).not.toHaveClass('today');
  });

  it('shows the state while its until is ahead', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubApi(placesRoutes({ 'GET /places': payload(at(3_600_000)) }));
    renderApp('/pratique');
    await listView(user);
    expect(await screen.findByRole('button', { name: /Maison Roux/ })).toHaveTextContent('Ouvert · ferme à 13 h');
  });

  it('without network no state is shown, even one still ahead of its until', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    stubApi(placesRoutes({ 'GET /places': payload(at(3_600_000)) }));
    renderApp('/pratique');
    expect(await screen.findByRole('button', { name: /Maison Roux/ })).not.toHaveTextContent('Ouvert');
  });

  it('reads the places again when a shown until passes, and shows the new state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let answer = payload(at(60_000));
    const { calls } = stubApi(placesRoutes({ 'GET /places': () => answer }));
    renderApp('/pratique');
    await listView(user);
    expect(await screen.findByRole('button', { name: /Maison Roux/ })).toHaveTextContent('Ouvert · ferme à 13 h');
    expect(placesCalls(calls)).toBe(1);
    answer = payload(at(3_600_000 + 61_000), 'Fermé · ouvre à 15 h');
    await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
    await waitFor(() => expect(placesCalls(calls)).toBe(2));
    expect(await screen.findByRole('button', { name: /Maison Roux/ })).toHaveTextContent('Fermé · ouvre à 15 h');
  });

  it('reads them again when the app comes back to the foreground', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { calls } = stubApi(placesRoutes({ 'GET /places': payload(at(3_600_000)) }));
    renderApp('/pratique');
    await listView(user);
    await screen.findByRole('button', { name: /Maison Roux/ });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(placesCalls(calls)).toBe(2));
  });
});
