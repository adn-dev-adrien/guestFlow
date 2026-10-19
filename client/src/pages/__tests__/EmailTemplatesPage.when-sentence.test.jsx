// specs/guest-email-texts-made-simple.md rule 43 (UI/UX review 2026-10-18, decision 11) — « Quand ? » is
// one sentence the server reads live: the refusal under the number, the day it would leave, the
// signed offset it answers saved as it is; a moment counted elsewhere reads as a fixed sentence.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(), getEmailTemplatesTimeline: vi.fn(), describeTemplateWhen: vi.fn(), getEmailTemplateVariables: vi.fn(),
    getPendingEmails: vi.fn(), createEmailTemplate: vi.fn(), updateEmailTemplate: vi.fn(), deleteEmailTemplate: vi.fn(),
  },
}));
vi.mock('../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  const stableDialogs = { confirm: vi.fn(), alert: vi.fn() };
  return { __esModule: true, useAppDialogs: () => stableDialogs, useToast: () => stableToast };
});

import api from '../../api';
import EmailTemplatesPage from '../EmailTemplatesPage';

const OWN = {
  id: 2, stableKey: null, textsSection: null, shipped: false, name: 'Promo', displayName: 'Promo', subject: 'S', body: 'B',
  dayOffset: -2, sendMode: 'manual', enabled: 1,
  when: { editable: true, label: '2 jours avant l’arrivée', sentence: 'Envoyé 2 jours avant l’arrivée', days: 2, direction: 'before', anchorLabel: 'l’arrivée' },
};
const J2 = {
  id: 1, stableKey: 'arrival_reminder_1d', textsSection: 'j2', shipped: true, name: 'Séquence — J-2', displayName: 'Accès et arrivée',
  subject: 'S', body: 'B', dayOffset: -2, sendMode: 'manual', enabled: 1,
  when: { editable: false, label: '2 jours avant l’arrivée', sentence: 'Envoyé 2 jours avant l’arrivée' },
};

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTemplatesTimeline.mockResolvedValue({ groups: [{ id: 'before', label: 'Avant l’arrivée', templates: [J2, OWN] }] });
  api.getEmailTemplateVariables.mockResolvedValue({ variables: [], conditions: [] });
  api.getPendingEmails.mockResolvedValue([]);
  api.updateEmailTemplate.mockResolvedValue({});
});

const renderPage = () => render(<MemoryRouter><EmailTemplatesPage /></MemoryRouter>);

test('the number is refused live, in words, and the save waits', async () => {
  api.describeTemplateWhen.mockRejectedValue(Object.assign(new Error('90 jours au plus.'), { field: 'days', message: '90 jours au plus.' }));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier : Promo' }));
  const days = await screen.findByLabelText('Nombre de jours');
  expect(days).toHaveValue('2');
  fireEvent.change(days, { target: { value: '120' } });
  expect(await screen.findByText('90 jours au plus.')).toBeInTheDocument();
  expect(api.describeTemplateWhen).toHaveBeenCalledWith({ templateId: 2, days: '120', direction: 'before' });
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('a valid sentence shows the day it would leave and saves the server’s offset', async () => {
  api.describeTemplateWhen.mockResolvedValue({ offsetDays: 3, sentence: 'Envoyé 3 jours après l’arrivée', example: 'Prochain séjour (Gite, vendredi 23 octobre au lundi 26 octobre) : envoyé le lundi 26 octobre.' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier : Promo' }));
  fireEvent.change(await screen.findByLabelText('Nombre de jours'), { target: { value: '3' } });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Avant ou après' }));
  fireEvent.click(await screen.findByRole('option', { name: 'après' }));
  expect(await screen.findByText(/envoyé le lundi 26 octobre/)).toBeInTheDocument();
  // « Enregistrer » waits for the last reading (the direction's): click once it is enabled.
  const save = screen.getByRole('button', { name: 'Enregistrer' });
  await waitFor(() => expect(save).not.toBeDisabled());
  fireEvent.click(save);
  // The sentence itself is saved; the server reads it (no offset kept from an earlier answer).
  await waitFor(() => expect(api.updateEmailTemplate).toHaveBeenCalledWith(2, expect.objectContaining({ when: { days: '3', direction: 'after' } })));
  expect(api.updateEmailTemplate.mock.calls[0][1]).not.toHaveProperty('dayOffset');
});

test('« Enregistrer » waits while a reading is on its way; a late answer to an earlier reading is dropped', async () => {
  let resolveFirst;
  api.describeTemplateWhen
    .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
    .mockResolvedValueOnce({ offsetDays: -12, sentence: 'Envoyé 12 jours avant l’arrivée', example: 'Douze.' });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Modifier : Promo' }));
  const days = await screen.findByLabelText('Nombre de jours');
  fireEvent.change(days, { target: { value: '3' } });
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  await waitFor(() => expect(api.describeTemplateWhen).toHaveBeenCalledTimes(1));
  fireEvent.change(days, { target: { value: '12' } });
  expect(await screen.findByText('Douze.')).toBeInTheDocument();
  resolveFirst({ offsetDays: -3, sentence: 'x', example: 'Trois.' });
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText('Trois.')).toBeNull();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateEmailTemplate).toHaveBeenCalledWith(2, expect.objectContaining({ when: { days: '12', direction: 'before' } })));
});

test('a shipped email counted by the sequence reads its moment as a fixed sentence', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Plus d’actions : Accès et arrivée' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Modifier le modèle' }));
  expect(await screen.findByText('Envoyé 2 jours avant l’arrivée')).toBeInTheDocument();
  expect(screen.queryByLabelText('Nombre de jours')).toBeNull();
});
