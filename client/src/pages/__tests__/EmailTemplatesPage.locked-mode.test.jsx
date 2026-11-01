// specs/payment-link-lifecycle.md rule 45 — the one email that leaves without validation shows its mode
// « Automatique (exception) », read-only: no mode menu item, no mode select in its editor; other templates keep both.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(), getEmailTemplatesTimeline: vi.fn(), getEmailTemplate: vi.fn(), describeTemplateWhen: vi.fn(), getEmailTemplateVariables: vi.fn(), getPendingEmails: vi.fn(),
    createEmailTemplate: vi.fn(), updateEmailTemplate: vi.fn(), deleteEmailTemplate: vi.fn(),
  },
}));
vi.mock('../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  const stableDialogs = { confirm: vi.fn(), alert: vi.fn() };
  return { __esModule: true, useAppDialogs: () => stableDialogs, useToast: () => stableToast };
});

import api from '../../api';
import EmailTemplatesPage from '../EmailTemplatesPage';

const NOTICE = {
  id: 5, stableKey: 'dates_unavailable_notice', textsSection: null, shipped: true, displayName: 'Dates plus disponibles',
  when: { editable: false, label: 'Quand les dates sont prises', sentence: 'Envoyé quand les dates sont prises' },
  name: 'Dates plus disponibles', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual', enabled: 1,
  sendModeLocked: true, sendModeLabel: 'Automatique (exception)',
};
const OWN = { id: 2, stableKey: null, textsSection: null, shipped: false, displayName: 'Bienvenue', when: { editable: true, label: 'Le jour de l’arrivée', days: 0, direction: 'same', anchorLabel: 'l’arrivée' }, name: 'Bienvenue', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual', enabled: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTemplatesTimeline.mockResolvedValue({ groups: [{ id: 'booking', label: 'À la réservation', templates: [NOTICE, OWN] }] });
  api.getEmailTemplate.mockImplementation(async (id) => [NOTICE, OWN].find((t) => t.id === id));
  api.getEmailTemplateVariables.mockResolvedValue({ variables: [], conditions: [] });
  api.getPendingEmails.mockResolvedValue([]);
});

test('rule 45 — the exception reads « Automatique (exception) » and offers no mode change', async () => {
  render(<MemoryRouter><EmailTemplatesPage /></MemoryRouter>);
  expect(await screen.findByText('Automatique (exception)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Plus d’actions : Dates plus disponibles' }));
  expect(screen.queryByRole('menuitem', { name: /Envoi automatique|Revenir à l’envoi manuel/ })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier le modèle' }));
  await screen.findByRole('heading', { name: 'Dates plus disponibles' });
  expect(screen.queryByText('Manuel : attend ma validation')).toBeNull();
  expect(screen.getAllByText('Automatique (exception)').length).toBeGreaterThan(1);
});

test('rule 45 — any other template keeps its mode menu and select', async () => {
  render(<MemoryRouter><EmailTemplatesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Plus d’actions : Bienvenue' }));
  expect(screen.getByRole('menuitem', { name: 'Envoi automatique…' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier le modèle' }));
  await screen.findByRole('heading', { name: 'Bienvenue' });
  expect(screen.getByText('Manuel : attend ma validation')).toBeInTheDocument();
});
