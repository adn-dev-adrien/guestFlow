// specs/reception-role-checkin-only.md rule 14 (2026-10-27 spec review) — GET /api/settings is
// admin-only, so the favicon hook does not ask for it on behalf of another role: a reception account
// logged a 403 on every page, the arrival SAS included.
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getSettings: vi.fn() },
}));
vi.mock('../../utils/setFavicon', () => ({
  __esModule: true,
  setFavicon: vi.fn(),
}));

import api from '../../api';
import { useDynamicFavicon } from '../useDynamicFavicon';

function Probe({ enabled }) {
  useDynamicFavicon({ refreshKey: 7, enabled });
  return null;
}

beforeEach(() => {
  api.getSettings.mockReset();
  api.getSettings.mockResolvedValue({ company: { logoPath: '' }, updatedAt: 'x' });
});

test('a non-admin user never requests the settings', async () => {
  render(<Probe enabled={false} />);
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  expect(api.getSettings).not.toHaveBeenCalled();
});

test('an admin still gets the logo favicon', async () => {
  render(<Probe enabled />);
  await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(1));
});
