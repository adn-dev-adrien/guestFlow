// specs/stay-profile.md §3 rule 29 (verification V5-3) — the server's « Autres » row reaches the share
// table as such: grey, never a recycled hue, its hover naming the channels it holds.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { vi } from 'vitest';

vi.mock('../../api', () => ({ __esModule: true, default: { getFinanceStayProfile: vi.fn(), getToday: vi.fn() } }));

import api from '../../api';
import StayProfilePage from '../StayProfilePage';
import { PROFILE, setupMatchMedia } from './stayProfileFixtures';
import { chart } from '../../utils/chartColors';

const row = (key, label, count, amount, share, extra = {}) => ({
  key, label, count, amount, countPercent: share, amountPercent: share, countShare: share / 100, amountShare: share / 100, countBar: 1, amountBar: 1, ...extra,
});

beforeEach(() => {
  setupMatchMedia();
  api.getToday.mockReset().mockResolvedValue({ today: '2026-11-05' }); // date-literal-ok: a mocked server day
  api.getFinanceStayProfile.mockReset().mockResolvedValue({
    ...PROFILE,
    dimensions: PROFILE.dimensions.map((d) => (d.key !== 'channel' ? d : {
      ...d,
      rows: [
        row('direct', 'Direct', 3, 900, 40), row('platform:airbnb', 'Airbnb', 2, 700, 20), row('platform:booking', 'Booking', 2, 500, 15),
        row('platform:gdf', 'Gîtes de France', 1, 400, 10), row('other', 'Autres', 3, 410, 15, { other: true, parts: ['Abracadaroom', 'Abritel', 'GreenGo'] }),
      ],
    })),
  });
});

test('rule 29 — « Autres » is grey and its segment names what it holds; the four others keep their hues', async () => {
  render(
    <MemoryRouter initialEntries={['/finance/profil']}>
      <Routes><Route path="/finance/profil" element={<StayProfilePage />} /></Routes>
    </MemoryRouter>,
  );
  const other = await screen.findByTestId('share-segment-other');
  expect(other).toHaveAttribute('title', 'Autres : Abracadaroom, Abritel, GreenGo');
  expect(other).toHaveStyle({ backgroundColor: chart.other });
  const hues = ['direct', 'platform:airbnb', 'platform:booking', 'platform:gdf']
    .map((k) => getComputedStyle(screen.getByTestId(`share-segment-${k}`)).backgroundColor);
  expect(new Set(hues).size).toBe(4);
  expect(hues).not.toContain(getComputedStyle(other).backgroundColor);
});
