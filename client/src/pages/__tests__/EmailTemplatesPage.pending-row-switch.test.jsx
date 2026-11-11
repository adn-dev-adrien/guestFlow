// specs/email-automation.md rule 21 — one send dialog serves every pending row: the second row opens
// on its own template and sends it, whatever the first row was.
import { vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../hooks/usePlugins', () => ({ usePlugin: () => true }));
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(), getEmailTemplatesTimeline: vi.fn(), getEmailTemplate: vi.fn(), describeTemplateWhen: vi.fn(),
    getEmailTemplateVariables: vi.fn(), getPendingEmails: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn(),
  },
}));
vi.mock('../../components/DialogProvider', () => {
  const stableToast = { showSuccess: vi.fn(), showError: vi.fn() };
  const stableDialogs = { confirm: vi.fn(), alert: vi.fn() };
  return { __esModule: true, useAppDialogs: () => stableDialogs, useToast: () => stableToast };
});

import api from '../../api';
import EmailTemplatesPage from '../EmailTemplatesPage';

const PENDING = [
  { templateId: 1, templateName: 'Préparation', reservationId: 501, startDate: '2027-05-10', clientFullName: 'Alex A', clientEmail: 'a@example.fr', propertyName: 'Gîte', occurrenceKey: '' },
  { templateId: 13, templateName: 'Échéance', reservationId: 502, startDate: '2027-05-12', clientFullName: 'Bea B', clientEmail: 'b@example.fr', propertyName: 'Gîte', occurrenceKey: 'installment:1' },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTemplatesTimeline.mockResolvedValue({ groups: [] });
  api.getEmailTemplates.mockResolvedValue([
    { id: 1, name: 'Préparation', dayOffset: -7, enabled: 1 },
    { id: 13, name: 'Échéance', dayOffset: -30, enabled: 1 },
  ]);
  api.getEmailTemplateVariables.mockResolvedValue({ variables: [], conditions: [] });
  api.getPendingEmails.mockResolvedValue(PENDING);
  api.previewEmail.mockImplementation(async ({ templateId }) => ({ to: 'x@example.fr', subject: `Sujet ${templateId}`, body: 'Corps', missingVariables: [] }));
  api.sendEmail.mockResolvedValue({ ok: true });
});

test('rule 21: after closing the dialog on row 1, row 2 previews and sends its own template', async () => {
  render(<MemoryRouter><EmailTemplatesPage /></MemoryRouter>);
  const rowOf = async (name) => (await screen.findByText(name)).closest('tr');
  fireEvent.click(within(await rowOf('Alex A')).getByRole('button', { name: 'Envoyer' }));
  await screen.findByDisplayValue('Sujet 1');
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  await waitFor(() => expect(screen.queryByDisplayValue('Sujet 1')).not.toBeInTheDocument());

  fireEvent.click(within(await rowOf('Bea B')).getByRole('button', { name: 'Envoyer' }));
  await screen.findByDisplayValue('Sujet 13');
  await waitFor(() => expect(screen.getByRole('button', { name: /^Envoyer$/ })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  await waitFor(() => expect(api.sendEmail).toHaveBeenCalled());
  expect(api.sendEmail.mock.calls[0][0]).toEqual(expect.objectContaining({ templateId: 13, reservationId: 502, occurrenceKey: 'installment:1' }));
});
