// specs/guest-email-texts-made-simple.md rule 12 — the former entry points stay as links: a shipped
// template (the J-7 and its per-property hook included) points to its section of « Textes des
// emails »; a template of the operator's own has no section.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(), getEmailTemplatesTimeline: vi.fn(), describeTemplateWhen: vi.fn(), getEmailTemplateVariables: vi.fn(), getPendingEmails: vi.fn(),
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

const J7 = { id: 1, stableKey: 'arrival_reminder_7d', textsSection: 'j7', shipped: true, displayName: 'Préparation du séjour', when: { editable: false, label: '7 jours avant l’arrivée', sentence: 'Envoyé 7 jours avant l’arrivée' }, name: 'Séquence — J-7', subject: 'S', body: 'B', dayOffset: -7, sendMode: 'manual', enabled: 1 };
const OWN = { id: 2, stableKey: null, textsSection: null, shipped: false, displayName: 'Bienvenue', when: { editable: true, label: 'Le jour de l’arrivée', days: 0, direction: 'same', anchorLabel: 'l’arrivée' }, name: 'Bienvenue', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual', enabled: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTemplatesTimeline.mockResolvedValue({ groups: [{ id: 'before', label: 'Avant l’arrivée', templates: [J7] }, { id: 'during', label: 'Pendant le séjour', templates: [OWN] }] });
  api.getEmailTemplateVariables.mockResolvedValue({ variables: [], conditions: [] });
  api.getPendingEmails.mockResolvedValue([]);
});

test('rule 12: the J-7 dialog links its hooks and sentences to the J-7 section', async () => {
  render(<MemoryRouter><EmailTemplatesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Plus d’actions : Préparation du séjour' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier le modèle' }));
  const link = await screen.findByRole('link', { name: 'Accroche par logement et phrases : Textes des emails' });
  expect(link).toHaveAttribute('href', '/settings/emails/textes#j7');
  expect(screen.queryByText('Accroche par logement')).toBeNull();
});

test('rule 12: a template of the operator\'s own has no section', async () => {
  render(<MemoryRouter><EmailTemplatesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier : Bienvenue' }));
  await screen.findByRole('heading', { name: 'Bienvenue' });
  expect(screen.queryByRole('link', { name: /Textes des emails/ })).toBeNull();
});
