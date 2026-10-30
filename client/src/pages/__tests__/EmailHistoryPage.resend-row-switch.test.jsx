// specs/email-automation.md rule 21 — « Renvoyer » on a second row opens on that row's template,
// not on the one of the row resent before.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getEmailHistory: vi.fn(), getEmailTemplates: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn() },
}));

import api from '../../api';
import { MemoryRouter } from 'react-router';
import DialogProvider from '../../components/DialogProvider';
import EmailHistoryPage from '../EmailHistoryPage';

const row = (id, templateId, recipientEmail) => ({
  id, templateId, reservationId: 40 + id, reservationStartDate: '2027-07-10', sentAt: '2027-07-03 08:00:00',
  templateName: `Modèle ${templateId}`, clientFullName: 'Jane S.', propertyName: 'Villa A', recipientEmail,
  status: 'sent', renderedSubject: `Sent ${id}`, renderedBody: 'Bonjour',
});

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  api.getEmailTemplates.mockResolvedValue([{ id: 3, name: 'Confirmation', enabled: 1 }, { id: 9, name: 'Paiement', enabled: 1 }]);
  api.getEmailHistory.mockResolvedValue({ rows: [row(1, 3, 'a@s.com'), row(2, 9, 'b@s.com')], total: 2 });
  api.previewEmail.mockImplementation(async ({ templateId }) => ({ to: 'x@s.com', subject: `Sujet ${templateId}`, body: 'B', missingVariables: [] }));
  api.sendEmail.mockResolvedValue({ ok: true });
});

test('rule 21: resending row B after row A previews and sends B\'s template', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><DialogProvider><EmailHistoryPage /></DialogProvider></MemoryRouter>);
  const resendOf = async (email) => within((await screen.findByText(email)).closest('tr') || (await screen.findByText(email)).closest('[class*=MuiCard]')).getAllByRole('button', { name: 'Renvoyer cet email' })[0];
  await user.click(await resendOf('a@s.com'));
  await screen.findByDisplayValue('Sujet 3');
  await user.click(screen.getByRole('button', { name: 'Annuler' }));
  await waitFor(() => expect(screen.queryByDisplayValue('Sujet 3')).not.toBeInTheDocument());

  await user.click(await resendOf('b@s.com'));
  await screen.findByDisplayValue('Sujet 9');
  await waitFor(() => expect(screen.getByRole('button', { name: /^Envoyer$/ })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  await waitFor(() => expect(api.sendEmail).toHaveBeenCalled());
  expect(api.sendEmail.mock.calls[0][0]).toEqual(expect.objectContaining({ templateId: 9, reservationId: 42 }));
});
