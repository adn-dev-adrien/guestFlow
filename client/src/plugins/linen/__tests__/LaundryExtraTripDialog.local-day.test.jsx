// specs/upcoming-reservations-cards.md rule 7 (amended 2026-10-18) — the extra laundry trip proposes
// the browser's calendar day, not the UTC one, which read yesterday between midnight and 2 a.m. in
// Paris (review of PR #700, finding 4).
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const previewLaundryExtraTrip = vi.fn();
vi.mock('../../../api', () => ({ default: { previewLaundryExtraTrip: (...args) => previewLaundryExtraTrip(...args) } }));

import LaundryExtraTripDialog from '../LaundryExtraTripDialog';

afterEach(() => { vi.useRealTimers(); });

test('rule 7 — without a date the dialog opens on the 18th at 01:54 in Paris', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-17T23:54:00Z'));
  previewLaundryExtraTrip.mockResolvedValue({ date: 'x', dropOff: {}, atLaundry: {} });
  render(<LaundryExtraTripDialog open mode="create" onSave={() => {}} onClose={() => {}} />);
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (process.env.TZ === 'Europe/Paris') expect(local).toBe('2026-10-18');
  await waitFor(() => expect(previewLaundryExtraTrip).toHaveBeenCalledWith(local));
  expect(screen.getByLabelText('Date du voyage')).toHaveValue(local);
});
