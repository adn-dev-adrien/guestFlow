// specs/guest-email-sequence.md rule 31, reading of 2026-11-03 (audit R20-C4) — « Du » opens on the operator's own day
// and « Au » sixty days later, never the UTC day: early in the morning east of Greenwich the UTC day is still yesterday.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../api', () => ({ __esModule: true, default: { getEmailSequenceSimulation: vi.fn() } }));

import api from '../../api';
import EmailSequenceSimulation from '../EmailSequenceSimulation';
import { addIsoDays, localIsoToday } from '../../utils/isoDay';

const savedTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'Pacific/Kiritimati'; });
afterAll(() => { process.env.TZ = savedTz; vi.useRealTimers(); });

test('at 08:00 in UTC+14 the range starts on the local day, not on yesterday\'s UTC day', async () => {
  const real = new Date();
  const morning = new Date(real.getFullYear(), real.getMonth(), real.getDate(), 8, 0);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(morning);
  expect(morning.toISOString().slice(0, 10)).not.toBe(localIsoToday());
  api.getEmailSequenceSimulation.mockResolvedValue({ rows: [], counts: { send: 0, blocked: 0, alreadySent: 0, toCheck: 0 }, startDate: null, autoMailKeys: [] });
  render(<MemoryRouter><EmailSequenceSimulation tabs={null} /></MemoryRouter>);
  const today = localIsoToday();
  expect(screen.getByLabelText('Du')).toHaveValue(today);
  expect(screen.getByLabelText('Au')).toHaveValue(addIsoDays(today, 60));
  await waitFor(() => expect(api.getEmailSequenceSimulation).toHaveBeenCalledWith({ from: today, to: addIsoDays(today, 60) }));
});
