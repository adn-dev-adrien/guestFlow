// specs/linen-laundry-days.md §3.3 rule 18 and §6.3 — the shortage alert says when the laundry brings the linen back.
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, vi } from 'vitest';

vi.mock('../../../api', () => ({ default: { getLinenShortageAlert: vi.fn() } }));
vi.mock('../../../components/AttentionCard', () => ({ default: ({ children }) => <div>{children}</div> }));

import api from '../../../api';
import LinenShortageAlert from '../LinenShortageAlert';

const payload = (over = {}) => ({
  horizon: '2026-08-30',
  shortagesByType: [{
    type: 'double', label: 'Drap double', firstShortageDate: '2026-06-24', lastShortageDate: '2026-06-29', laterShortage: false,
    maxMissing: 2, impactedReservations: [], ...over,
  }],
});

// Only Date is faked, so waitFor keeps its real timers. Pinned before the fixtures' June 2026: a date of
// another year says its year (rule 18), so on the real clock these labels grew « 2026 » from 2027 on.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-06-20T10:00:00')); });
afterEach(() => vi.useRealTimers());

const renderAlert = () => render(<MemoryRouter><LinenShortageAlert attention={{}} /></MemoryRouter>);
const lineOf = async () => {
  await waitFor(() => expect(screen.getByText('Drap double')).toBeInTheDocument());
  return screen.getByText('Drap double').parentElement;
};

test('specs/linen-laundry-days.md rule 18: the first spell reads « du mer. 24 au lun. 29 juin » — both dates in one format, the last day of the shortage', async () => {
  api.getLinenShortageAlert.mockResolvedValue(payload());
  renderAlert();
  const line = await lineOf();
  expect(line).toHaveTextContent("jusqu'à 2 manquants");
  expect(line).toHaveTextContent('du mer. 24 au lun. 29 juin');
  expect(line).not.toHaveTextContent('puis');
});

test('specs/linen-laundry-days.md rule 18: a spell across two months names both', async () => {
  api.getLinenShortageAlert.mockResolvedValue(payload({ firstShortageDate: '2026-06-29', lastShortageDate: '2026-07-02' }));
  renderAlert();
  expect(await lineOf()).toHaveTextContent('du lun. 29 juin au jeu. 2 juil.');
});

test('specs/linen-laundry-days.md rule 18: a one-day spell reads « le … »', async () => {
  api.getLinenShortageAlert.mockResolvedValue(payload({ lastShortageDate: '2026-06-24' }));
  renderAlert();
  expect(await lineOf()).toHaveTextContent('le mer. 24 juin');
});

test('specs/linen-laundry-days.md rule 18: a later spell is announced next to the first', async () => {
  api.getLinenShortageAlert.mockResolvedValue(payload({ laterShortage: true }));
  renderAlert();
  const line = await lineOf();
  expect(line).toHaveTextContent('du mer. 24 au lun. 29 juin · puis d’autres périodes');
});

test('specs/linen-laundry-days.md rule 18: while the first spell runs at the horizon (no last day) it reads « à partir du … »', async () => {
  api.getLinenShortageAlert.mockResolvedValue(payload({ lastShortageDate: null }));
  renderAlert();
  const line = await lineOf();
  expect(line).toHaveTextContent('à partir du mer. 24 juin');
  expect(line).not.toHaveTextContent(' au ');
});
