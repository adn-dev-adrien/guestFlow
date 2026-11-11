// specs/plugins-phase-p-productisation.md rule 34 — on a phone the closures page keeps a title, and
// « Aucune fermeture configurée. » is shown whole, outside the table's inner scroll.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getEstablishmentClosures: vi.fn(), getProperties: vi.fn() },
}));

import api from '../../api';
import EstablishmentClosuresPage from '../EstablishmentClosuresPage';

const media = (matches) => (query) => ({
  matches, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
});
let orig;
beforeEach(() => {
  orig = window.matchMedia;
  api.getEstablishmentClosures.mockResolvedValue([]);
  api.getProperties.mockResolvedValue([]);
});
afterEach(() => { window.matchMedia = orig; });

test('phone: short title shown, empty state outside any table', async () => {
  window.matchMedia = media(true);
  render(<MemoryRouter><DialogProvider><EstablishmentClosuresPage /></DialogProvider></MemoryRouter>);
  const empty = await screen.findByText('Aucune fermeture configurée.');
  expect(empty.closest('table')).toBeNull();
  expect(screen.getByText('Fermetures')).toBeVisible();
  expect(screen.queryByRole('table')).toBeNull();
});
