// specs/calendar-property-parity.md rule 7 — a colour the server refuses shows its message under the swatch,
// and the swatch goes back to the previous colour.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import PlatformColorPicker from '../PlatformColorPicker';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({ __esModule: true, default: { getPlatformSettings: vi.fn(), savePlatformSettings: vi.fn() } }));
vi.mock('../DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  return { __esModule: true, useToast: () => stableToast };
});

import api from '../../api';
import PlatformsSettingsPage from '../../pages/settings/PlatformsSettingsPage';

test('the picker prints the server\'s refusal under the swatch', () => {
  render(<PlatformColorPicker color="#fec700" onChange={() => {}} error="Couleur trop claire pour le calendrier." />);
  expect(screen.getByRole('alert')).toHaveTextContent('Couleur trop claire pour le calendrier.');
});

test('the presets are the built-in palette', () => {
  render(<PlatformColorPicker color="#fec700" onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Changer la couleur' }));
  ['#2F5D46', '#C93848', '#1B3F8B', '#4FA3E0', '#8A55B2', '#8BC34A', '#F2CC3D', '#EF7D22'].forEach((hex) => {
    expect(screen.getByRole('button', { name: hex })).toBeInTheDocument();
  });
});

test('a refused save shows the message and the swatch returns to the previous colour', async () => {
  const platforms = [{ id: 4, name: 'Lodgify', isDirect: false, countsAsDirect: false, color: '#fec700', commissionPercent: 5, takesDeposit: true, touristTaxCollection: 'owner', payoutDueDays: 7 }];
  api.getPlatformSettings.mockResolvedValue({ platforms });
  api.savePlatformSettings.mockRejectedValue(Object.assign(new Error('refus'), { errors: { 4: { color: 'Couleur trop claire pour le calendrier.' } } }));
  render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
  const swatch = (await screen.findAllByRole('button', { name: 'Changer la couleur' }))[0];
  expect(getComputedStyle(swatch).backgroundColor).toBe('rgb(254, 199, 0)');
  fireEvent.click(swatch);
  fireEvent.click(within(document.body).getByRole('button', { name: '#2F5D46' }));
  await waitFor(() => expect(getComputedStyle(screen.getAllByRole('button', { name: 'Changer la couleur' })[0]).backgroundColor).toBe('rgb(47, 93, 70)'));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Couleur trop claire pour le calendrier.')).toBeInTheDocument();
  await waitFor(() => expect(getComputedStyle(screen.getAllByRole('button', { name: 'Changer la couleur' })[0]).backgroundColor).toBe('rgb(254, 199, 0)'));
});

test('rule 7 — the message goes after a while, only that row\'s, and a newer save keeps its own', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const platforms = [
      { id: 4, name: 'Lodgify', isDirect: false, countsAsDirect: false, color: '#fec700', commissionPercent: 5, takesDeposit: true, touristTaxCollection: 'owner', payoutDueDays: 7 },
      { id: 5, name: 'Booking', isDirect: false, countsAsDirect: false, color: '#1B3F8B', commissionPercent: 5, takesDeposit: true, touristTaxCollection: 'owner', payoutDueDays: 7 },
    ];
    api.getPlatformSettings.mockResolvedValue({ platforms });
    api.savePlatformSettings.mockRejectedValue(Object.assign(new Error('refus'), { errors: { 4: { color: 'Couleur trop claire pour le calendrier.' }, 5: { commissionPercent: 'Entre 0 et 99,99 %.' } } }));
    render(<MemoryRouter><PlatformsSettingsPage /></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Changer la couleur' }))[0]);
    fireEvent.click(within(document.body).getByRole('button', { name: '#2F5D46' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Couleur trop claire pour le calendrier.')).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(6100);
    expect(screen.queryByText('Couleur trop claire pour le calendrier.')).toBeNull();
    expect(screen.getAllByText('Entre 0 et 99,99 %.').length).toBeGreaterThan(0);
  } finally {
    vi.useRealTimers();
  }
});
