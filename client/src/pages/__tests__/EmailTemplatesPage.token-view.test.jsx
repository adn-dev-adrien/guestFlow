// specs/email-automation.md rules 16–18 — the full template editor shows each variable by its French
// label, like « Textes des emails », and saves the raw token (rule 17); a refusal lands under its
// field in those labels; « Quand » reads the server's label (rule 16); a pending email has its own
// « Envoyer » button (rule 18).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(), getEmailTemplatesTimeline: vi.fn(), describeTemplateWhen: vi.fn(), getEmailTemplateVariables: vi.fn(), createEmailTemplate: vi.fn(),
    updateEmailTemplate: vi.fn(), deleteEmailTemplate: vi.fn(), getPendingEmails: vi.fn(),
    acknowledgePendingEmail: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn(),
  },
}));
vi.mock('../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  const stableDialogs = { confirm: vi.fn().mockResolvedValue(true), alert: vi.fn().mockResolvedValue() };
  return { __esModule: true, useAppDialogs: () => stableDialogs, useToast: () => stableToast };
});
vi.mock('react-router', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => vi.fn() }));

import api from '../../api';
import EmailTemplatesPage from '../EmailTemplatesPage';

const J2 = {
  id: 1, stableKey: 'arrival_reminder_1d', name: 'Séquence — J-2', subject: 'À {{arrivalWeekday}}',
  body: 'Bonjour {{clientFirstName}},\n{{#if hasParkingLine}}{{parkingLine}}{{/if}}', subjectEn: '', bodyEn: '',
  dayOffset: -2, sendMode: 'manual', enabled: 1, whenLabel: '2 jours avant l’arrivée', textsSection: 'j2', shipped: true, displayName: 'Accès et arrivée',
  when: { editable: false, label: '2 jours avant l’arrivée', sentence: 'Envoyé 2 jours avant l’arrivée' },
};
const CONFIRMATION = { id: 2, stableKey: 'reservation_confirmation', name: 'Confirmation', subject: 'S', body: 'B', dayOffset: 0, sendMode: 'manual', enabled: 1, whenLabel: 'À la réservation', textsSection: 'confirmation', shipped: true, displayName: 'Confirmation', when: { editable: false, label: 'À la réservation', sentence: 'Envoyé à la réservation' } };
const CHIPS = {
  variables: [{ name: 'clientFirstName', label: 'Prénom du voyageur' }, { name: 'parkingLine', label: 'Ligne parking' }, { name: 'arrivalWeekday', label: 'Jour d’arrivée' }],
  conditions: [{ name: 'hasParkingLine', label: 'Si parking' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTemplates.mockResolvedValue([J2, CONFIRMATION]);
  api.getEmailTemplatesTimeline.mockResolvedValue({ groups: [{ id: 'booking', label: 'À la réservation', templates: [CONFIRMATION] }, { id: 'before', label: 'Avant l’arrivée', templates: [J2] }] });
  api.getEmailTemplateVariables.mockResolvedValue(CHIPS);
  api.getPendingEmails.mockResolvedValue([]);
});

const renderPage = () => render(<MemoryRouter><EmailTemplatesPage /></MemoryRouter>);

test('rule 16: « Quand » reads the server label — « À la réservation », not « Jour J »', async () => {
  renderPage();
  expect((await screen.findAllByText('À la réservation')).length).toBeGreaterThan(0);
  expect(screen.queryByText('Jour J')).toBeNull();
});

test('rule 17: the body shows labels, no {{#if}}; a typed edit is saved as tokens', async () => {
  api.updateEmailTemplate.mockResolvedValue({});
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Plus d’actions : Accès et arrivée' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier le modèle' }));
  const body = await screen.findByDisplayValue((v) => v.startsWith('Bonjour ⟦Prénom du voyageur⟧'));
  expect(body.value).toBe('Bonjour ⟦Prénom du voyageur⟧,\n⟦Si parking⟧⟦Ligne parking⟧⟦fin si⟧');
  expect(document.body.textContent).not.toMatch(/\{\{#if/);
  fireEvent.change(body, { target: { value: 'Salut ⟦Prénom du voyageur⟧' } });
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateEmailTemplate).toHaveBeenCalledWith(1, expect.objectContaining({ body: 'Salut {{clientFirstName}}', subject: 'À {{arrivalWeekday}}' })));
});

test('rule 17: a refusal lands under its field, in labels', async () => {
  api.updateEmailTemplate.mockRejectedValue(Object.assign(new Error('x'), { field: 'body', message: 'Variable inconnue : {{prenom}}' }));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Plus d’actions : Accès et arrivée' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier le modèle' }));
  await screen.findByDisplayValue((v) => v.startsWith('Bonjour'));
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Variable inconnue : ⟦prenom⟧')).toBeInTheDocument();
});

test('rule 18: a pending email has its own « Envoyer » button', async () => {
  api.getPendingEmails.mockResolvedValue([{ templateId: 1, reservationId: 100, templateName: 'Séquence — J-2', clientFullName: 'Jane S.', clientEmail: 'jane@s.com', propertyName: 'Villa A', startDate: '2026-07-10' }]);
  api.previewEmail.mockResolvedValue({ to: 'jane@s.com', subject: 'Sujet', body: 'Corps', missingVariables: [] });
  renderPage();
  const card = (await screen.findByText('Emails à envoyer')).closest('.MuiCard-root');
  fireEvent.click(within(card).getByRole('button', { name: 'Envoyer' }));
  expect(await screen.findByText('Aperçu de l\'email')).toBeInTheDocument();
});
