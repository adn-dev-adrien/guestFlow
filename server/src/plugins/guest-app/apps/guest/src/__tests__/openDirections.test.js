// specs/guest-app/guest-app-local-amenities.md rule 7 — the Apple chain: Google Maps app, then Plans, then the Google Maps web page;
// an app counts as opened when the page is hidden within the wait, never on a lost focus (Safari's alert causes one).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDirectionsOnApple, WAIT_MS } from '../utils/openDirections';

const LINKS = { google: 'https://g.test/dir', googleApp: 'comgooglemaps://x', appleApp: 'maps://x' };

let visibility;
beforeEach(() => {
  vi.useFakeTimers();
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('openDirectionsOnApple', () => {
  it('stops at the Google Maps app when the page goes hidden', async () => {
    const navigate = vi.fn();
    const done = openDirectionsOnApple(LINKS, { navigate });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(LINKS.googleApp);
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await done;
    await vi.advanceTimersByTimeAsync(WAIT_MS * 3);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('goes on to Plans when nothing opened — a blur (Safari\'s « adresse non valide » alert) is not an opening — and stops there on pagehide', async () => {
    const navigate = vi.fn();
    const done = openDirectionsOnApple(LINKS, { navigate });
    window.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    expect(navigate).toHaveBeenLastCalledWith(LINKS.appleApp);
    window.dispatchEvent(new Event('pagehide'));
    await done;
    await vi.advanceTimersByTimeAsync(WAIT_MS * 3);
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('follows the web link at once when the payload has no app links (cached before them)', async () => {
    const navigate = vi.fn();
    await openDirectionsOnApple({ google: LINKS.google, apple: 'https://maps.apple.com/x', waze: 'https://waze.test' }, { navigate });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(LINKS.google);
  });

  it('opens the Google Maps web page when neither app opened', async () => {
    const navigate = vi.fn();
    const done = openDirectionsOnApple(LINKS, { navigate });
    await vi.advanceTimersByTimeAsync(WAIT_MS * 2);
    await done;
    expect(navigate.mock.calls.map(([url]) => url)).toEqual([LINKS.googleApp, LINKS.appleApp, LINKS.google]);
  });

  it('counts an app as opened when the page was hidden by the time the wait ends, and leaves no listener behind', async () => {
    const navigate = vi.fn();
    const remove = vi.spyOn(window, 'removeEventListener');
    const done = openDirectionsOnApple(LINKS, { navigate });
    visibility = 'hidden';
    await vi.advanceTimersByTimeAsync(WAIT_MS);
    await done;
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });
});
