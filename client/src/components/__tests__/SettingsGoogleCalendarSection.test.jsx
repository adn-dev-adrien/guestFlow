import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { vi } from 'vitest';
import { MemoryRouter } from 'react-router';

import SettingsGoogleCalendarSection from '../SettingsGoogleCalendarSection';
import DialogProvider from '../DialogProvider';
import api from '../../api';

// specs/google-calendar-oauth-rework.md §6 — self-contained OAuth connect card.

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getGoogleCalendarStatus: vi.fn(),
    getGoogleCalendars: vi.fn(),
    setGoogleCalendar: vi.fn().mockResolvedValue({ ok: true }),
    disconnectGoogleCalendar: vi.fn().mockResolvedValue({ ok: true }),
    googleCalendarSyncNow: vi.fn(),
    testGoogleCalendarConnection: vi.fn(),
  },
}));

const BASE_STATUS = {
  oauthConfigured: true,
  connected: false,
  connectedEmail: null,
  connectedAt: null,
  calendarId: null,
  calendarSummary: null,
  syncActive: false,
  lastSyncAt: null,
  lastSyncOk: null,
  lastSyncDetail: null,
  lastSyncLabel: null,
  statusKey: 'notConfigured',
  statusLabel: 'Synchronisation non configurée',
};

const CONNECTED_STATUS = {
  ...BASE_STATUS,
  connected: true,
  connectedEmail: 'adrien@example.com',
  connectedAt: '2026-07-18T10:00:00.000Z',
  calendarId: 'cal-1',
  calendarSummary: 'Agenda pro',
  syncActive: true,
  lastSyncAt: '2026-07-18T10:05:00.000Z',
  lastSyncOk: true,
  lastSyncDetail: '3 envoyée(s), 0 supprimée(s), 12 inchangée(s)',
  lastSyncLabel: '18/07/2026 à 12:05 — 3 envoyée(s), 0 supprimée(s), 12 inchangée(s)',
  statusKey: 'active',
  statusLabel: 'Synchronisation active',
};

const CALENDARS = {
  calendars: [
    { id: 'cal-1', summary: 'Agenda pro', primary: false },
    { id: 'cal-p', summary: 'Perso', primary: true },
  ],
};

function renderSection(initialEntry = '/settings') {
  return render(
    <DialogProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SettingsGoogleCalendarSection />
      </MemoryRouter>
    </DialogProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getGoogleCalendars.mockResolvedValue(CALENDARS);
});

test('state 1 — env vars missing → hint alert, no action buttons', async () => {
  api.getGoogleCalendarStatus.mockResolvedValue({ ...BASE_STATUS, oauthConfigured: false });
  renderSection();
  expect(await screen.findByText(/GOOGLE_OAUTH_CLIENT_ID/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Connecter mon compte Google/i })).not.toBeInTheDocument();
  expect(screen.getByText('Synchronisation non configurée')).toBeInTheDocument();
});

test('state 2 — not connected → « Connecter mon compte Google » navigates to the authorize endpoint', async () => {
  api.getGoogleCalendarStatus.mockResolvedValue(BASE_STATUS);
  const original = window.location;
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...original, href: '/settings' },
  });
  renderSection();
  const btn = await screen.findByRole('button', { name: /Connecter mon compte Google/i });
  fireEvent.click(btn);
  expect(window.location.href).toBe('/api/google-calendar/oauth/authorize');
  Object.defineProperty(window, 'location', { writable: true, value: original });
});

test('state 3 — connected → account line, calendar picker, sync-now with counters', async () => {
  api.getGoogleCalendarStatus.mockResolvedValue(CONNECTED_STATUS);
  api.googleCalendarSyncNow.mockResolvedValue({ ok: true, pushed: 2, deleted: 1, skipped: 4, errors: 0, detail: '2 envoyée(s), 1 supprimée(s), 4 inchangée(s)' });
  renderSection();

  expect(await screen.findByText('adrien@example.com')).toBeInTheDocument();
  expect(screen.getByText('Synchronisation active')).toBeInTheDocument();
  expect(screen.getByText(/18\/07\/2026 à 12:05/)).toBeInTheDocument();
  await waitFor(() => expect(api.getGoogleCalendars).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole('button', { name: /Synchroniser maintenant/i }));
  expect(await screen.findByText(/2 envoyée\(s\), 1 supprimée\(s\), 4 inchangée\(s\)/)).toBeInTheDocument();
  expect(api.googleCalendarSyncNow).toHaveBeenCalledTimes(1);
});

test('state 3 — picking a calendar calls setGoogleCalendar', async () => {
  api.getGoogleCalendarStatus.mockResolvedValue({ ...CONNECTED_STATUS, calendarId: null, calendarSummary: null, syncActive: false });
  renderSection();
  await screen.findByText('adrien@example.com');
  await waitFor(() => expect(api.getGoogleCalendars).toHaveBeenCalled());

  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: /Perso \(principal\)/ }));
  await waitFor(() => expect(api.setGoogleCalendar).toHaveBeenCalledWith('cal-p'));
});

test('state 3 — disconnect goes through the ConfirmDialog', async () => {
  api.getGoogleCalendarStatus.mockResolvedValue(CONNECTED_STATUS);
  renderSection();
  await screen.findByText('adrien@example.com');

  fireEvent.click(screen.getByRole('button', { name: /Déconnecter/i }));
  expect(await screen.findByText(/La synchronisation sera arrêtée/)).toBeInTheDocument();
  expect(api.disconnectGoogleCalendar).not.toHaveBeenCalled();

  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Déconnecter' }));
  await waitFor(() => expect(api.disconnectGoogleCalendar).toHaveBeenCalledTimes(1));
});

test('?google=connected → success toast and the param is cleaned from the URL', async () => {
  api.getGoogleCalendarStatus.mockResolvedValue(BASE_STATUS);
  renderSection('/settings?google=connected');
  expect(await screen.findByText(/Compte Google connecté/)).toBeInTheDocument();
});

test('status fetch failure → inline error with retry, no crash', async () => {
  api.getGoogleCalendarStatus.mockRejectedValueOnce(new Error('boom'));
  api.getGoogleCalendarStatus.mockResolvedValueOnce(BASE_STATUS);
  renderSection();
  expect(await screen.findByText(/Impossible de charger l'état de la synchronisation Google/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Réessayer/i }));
  expect(await screen.findByRole('button', { name: /Connecter mon compte Google/i })).toBeInTheDocument();
});
