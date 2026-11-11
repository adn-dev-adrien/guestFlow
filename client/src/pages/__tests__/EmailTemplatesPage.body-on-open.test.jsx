// specs/inte-performance.md rule 11 — the list carries no template body: the editor reads both when it
// opens, shows a loading state, and « Enregistrer » waits for them.
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(), getEmailTemplatesTimeline: vi.fn(), getEmailTemplate: vi.fn(), describeTemplateWhen: vi.fn(),
    getEmailTemplateVariables: vi.fn(), getPendingEmails: vi.fn(), createEmailTemplate: vi.fn(), updateEmailTemplate: vi.fn(), deleteEmailTemplate: vi.fn(),
  },
}));
vi.mock('../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  const stableDialogs = { confirm: vi.fn(), alert: vi.fn() };
  return { __esModule: true, useAppDialogs: () => stableDialogs, useToast: () => stableToast };
});

import api from '../../api';
import EmailTemplatesPage from '../EmailTemplatesPage';

const ROW = {
  id: 2, stableKey: null, textsSection: null, shipped: false, name: 'Promo', displayName: 'Promo', subject: 'Sujet',
  dayOffset: -2, sendMode: 'manual', enabled: 1,
  when: { editable: true, label: '2 jours avant l’arrivée', sentence: 'Envoyé 2 jours avant l’arrivée', days: 2, direction: 'before', anchorLabel: 'l’arrivée' },
};
const deferred = () => { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTemplatesTimeline.mockResolvedValue({ groups: [{ id: 'before', label: 'Avant l’arrivée', templates: [ROW] }] });
  api.getEmailTemplates.mockResolvedValue([]);
  api.getEmailTemplateVariables.mockResolvedValue({ variables: [], conditions: [] });
  api.getPendingEmails.mockResolvedValue([]);
  api.updateEmailTemplate.mockResolvedValue({});
  api.describeTemplateWhen.mockResolvedValue({ offsetDays: -2, sentence: 'Envoyé 2 jours avant l’arrivée', example: '' });
});

async function openEditor() {
  render(<MemoryRouter><EmailTemplatesPage /></MemoryRouter>);
  fireEvent.click(await screen.findByText('Promo'));
}

test('rule 11: the body is read when the editor opens, a loading state shows, saving waits for it', async () => {
  const body = deferred();
  api.getEmailTemplate.mockReturnValue(body.promise);
  await openEditor();
  await waitFor(() => expect(api.getEmailTemplate).toHaveBeenCalledWith(2));
  const save = await screen.findByRole('button', { name: 'Enregistrer' });
  expect(save).toBeDisabled();
  expect(screen.queryByLabelText(/Corps du message/)).not.toBeInTheDocument();
  body.resolve({ ...ROW, body: 'Bonjour {{clientFirstName}}', bodyEn: 'Hello' });
  expect(await screen.findByDisplayValue(/Bonjour/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled());
});

test('rule 11: a body that cannot be read says so, offers to retry, and cannot be saved empty', async () => {
  api.getEmailTemplate.mockRejectedValueOnce(new Error('boom'));
  await openEditor();
  expect(await screen.findByText('Impossible de charger le texte du modèle.')).toBeInTheDocument();
  fireEvent.change(screen.getByDisplayValue('Sujet'), { target: { value: 'Sujet retouché' } });
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
  api.getEmailTemplate.mockResolvedValueOnce({ ...ROW, body: 'Corps', bodyEn: '' });
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(await screen.findByDisplayValue('Corps')).toBeInTheDocument();
  expect(screen.getByDisplayValue('Sujet retouché')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toHaveTextContent('Promo');
  expect(api.getEmailTemplateVariables).toHaveBeenCalledTimes(1);
});

test('rule 11: the saved payload carries the body that was read, with what was typed on top', async () => {
  api.getEmailTemplate.mockResolvedValue({ ...ROW, body: 'Corps lu', bodyEn: 'Body read' });
  await openEditor();
  expect(await screen.findByDisplayValue('Corps lu')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
  await waitFor(() => expect(api.updateEmailTemplate).toHaveBeenCalledWith(2, expect.objectContaining({ body: 'Corps lu', bodyEn: 'Body read' })));
});
