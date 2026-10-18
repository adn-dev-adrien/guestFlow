// specs/ds-components.md rule 22 — review #8, m-6: « Planning ressources › Nouvelle réservation »
// opened as a floating box on a phone instead of full screen, like every other dialog.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getOccupiedSlots: vi.fn().mockResolvedValue({ occupiedSlots: [] }),
    getClients: vi.fn().mockResolvedValue([]),
    getProperties: vi.fn().mockResolvedValue([]),
  },
}));

import ResourceBookingDialog from '../ResourceBookingDialog';

const compactScreen = () => {
  window.matchMedia = (query) => ({
    matches: /max-width/.test(query), media: query,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    onchange: null, dispatchEvent: () => false,
  });
};
afterEach(() => { delete window.matchMedia; });

const RESOURCE = { id: 3, name: 'Bain nordique', isComplex: 1, openTime: '08:00', closeTime: '22:00', slotDuration: 60 };

test('rule 22 — the booking dialog is full screen on a phone', async () => {
  compactScreen();
  render(<ResourceBookingDialog open resource={RESOURCE} initialDate="2026-10-20" onClose={() => {}} onSave={() => {}} />);
  expect((await screen.findByRole('dialog')).className).toMatch(/MuiDialog-paperFullScreen/);
});

test('rule 22 — and a centred dialog from sm up', async () => {
  render(<ResourceBookingDialog open resource={RESOURCE} initialDate="2026-10-20" onClose={() => {}} onSave={() => {}} />);
  expect((await screen.findByRole('dialog')).className).not.toMatch(/MuiDialog-paperFullScreen/);
});
