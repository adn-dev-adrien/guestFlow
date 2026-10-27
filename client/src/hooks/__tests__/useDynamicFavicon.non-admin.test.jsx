// 2026-10-27 spec review (F15) — the reception's planning logged a 403 on GET /api/settings: the
// favicon hook read the settings for every role. Disabled, it makes no request at all.
import React from 'react';
import { render } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getSettings: vi.fn() } }));
vi.mock('../../utils/setFavicon', () => ({ __esModule: true, setFavicon: vi.fn() }));

import api from '../../api';
import { useDynamicFavicon } from '../useDynamicFavicon';

function Probe({ enabled }) {
  useDynamicFavicon({ refreshKey: 1, enabled });
  return null;
}

test('disabled (reception, accountant, before login) → GET /api/settings is never called', async () => {
  render(<Probe enabled={false} />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(api.getSettings).not.toHaveBeenCalled();
});
