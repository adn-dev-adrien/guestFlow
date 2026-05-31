import React from 'react';
import { render, waitFor } from '@testing-library/react';

jest.mock('../../api', () => ({
  __esModule: true,
  default: { getSettings: jest.fn() },
}));
jest.mock('../../utils/setFavicon', () => ({
  __esModule: true,
  setFavicon: jest.fn(),
}));

import api from '../../api';
import { setFavicon } from '../../utils/setFavicon';
import { useDynamicFavicon } from '../useDynamicFavicon';

function Probe({ refreshKey }) {
  useDynamicFavicon({ refreshKey });
  return null;
}

beforeEach(() => {
  api.getSettings.mockReset();
  setFavicon.mockClear();
});

describe('useDynamicFavicon', () => {
  test('fetches settings on mount and forwards logoPath + updatedAt to setFavicon', async () => {
    api.getSettings.mockResolvedValueOnce({
      company: { logoPath: '/uploads/company-logo.png' },
      updatedAt: '2026-05-31 10:00:00',
    });

    render(<Probe refreshKey={1} />);

    await waitFor(() => expect(setFavicon).toHaveBeenCalledTimes(1));
    expect(setFavicon).toHaveBeenCalledWith({
      href: '/uploads/company-logo.png',
      version: '2026-05-31 10:00:00',
    });
  });

  test('no logo configured → setFavicon called with href: null (restore default)', async () => {
    api.getSettings.mockResolvedValueOnce({
      company: { logoPath: '' },
      updatedAt: '2026-05-31 10:00:00',
    });

    render(<Probe refreshKey={1} />);

    await waitFor(() => expect(setFavicon).toHaveBeenCalledTimes(1));
    expect(setFavicon).toHaveBeenCalledWith({ href: null, version: '2026-05-31 10:00:00' });
  });

  test('settings API rejects (pre-login 401, network error, …) → silent no-op, no throw', async () => {
    api.getSettings.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));

    render(<Probe refreshKey={1} />);

    // Give the promise chain a tick to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(setFavicon).not.toHaveBeenCalled();
  });

  test('changing refreshKey triggers a re-fetch (e.g. login state changed)', async () => {
    api.getSettings.mockResolvedValue({ company: { logoPath: '/a.png' }, updatedAt: 't' });

    const { rerender } = render(<Probe refreshKey={1} />);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(1));

    rerender(<Probe refreshKey={2} />);
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
  });

  test('stale fetch after unmount does not call setFavicon (cleanup flag)', async () => {
    let resolve;
    api.getSettings.mockReturnValueOnce(new Promise((res) => { resolve = res; }));

    const { unmount } = render(<Probe refreshKey={1} />);
    unmount();
    resolve({ company: { logoPath: '/x.png' }, updatedAt: 't' });
    await new Promise((r) => setTimeout(r, 0));

    expect(setFavicon).not.toHaveBeenCalled();
  });
});
