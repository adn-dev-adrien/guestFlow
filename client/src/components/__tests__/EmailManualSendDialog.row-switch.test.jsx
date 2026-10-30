/**
 * EmailManualSendDialog — the dialog is reused from one row to the next and from one template to
 * the next: nothing of the previous row or of a superseded preview may leave in the email
 * (specs/email-automation.md rules 21-22, audit round 6).
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getEmailTemplates: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn() },
}));

import api from '../../api';
import EmailManualSendDialog from '../EmailManualSendDialog';

const TEMPLATES = [
  { id: 1, name: 'Préparation', dayOffset: -7, enabled: 1 },
  { id: 13, name: 'Échéance', dayOffset: -30, enabled: 1 },
  { id: 9, name: 'Paiement', dayOffset: -10, enabled: 1 },
];
const deferred = () => { let resolve; const promise = new Promise((a) => { resolve = a; }); return { promise, resolve }; };
const answer = (templateId) => ({ to: 'camille@example.fr', subject: `Sujet ${templateId}`, body: `Corps ${templateId}`, missingVariables: [] });

beforeEach(() => {
  Object.values(api).forEach((m) => m?.mockReset?.());
  api.getEmailTemplates.mockResolvedValue(TEMPLATES);
  api.previewEmail.mockImplementation(async ({ templateId }) => answer(templateId));
  api.sendEmail.mockResolvedValue({ ok: true });
});

test('reopened on another row, the dialog previews and sends that row\'s template', async () => {
  const user = userEvent.setup();
  const props = { reservationId: 5, onClose: () => {} };
  const { rerender } = render(<EmailManualSendDialog {...props} open defaultTemplateId={1} />);
  await screen.findByDisplayValue('Sujet 1');
  rerender(<EmailManualSendDialog {...props} open={false} defaultTemplateId={1} />);
  rerender(<EmailManualSendDialog {...props} open defaultTemplateId={13} occurrenceKey="installment:1" />);
  await screen.findByDisplayValue('Sujet 13');
  expect(api.previewEmail).toHaveBeenLastCalledWith(expect.objectContaining({ templateId: 13, occurrenceKey: 'installment:1' }));
  await user.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  await waitFor(() => expect(api.sendEmail).toHaveBeenCalled());
  expect(api.sendEmail.mock.calls[0][0]).toEqual(expect.objectContaining({
    templateId: 13, occurrenceKey: 'installment:1', overrides: expect.objectContaining({ subject: 'Sujet 13' }),
  }));
});

test('reopened on another row, the language choice and the typed address of the previous row are gone', async () => {
  api.previewEmail.mockImplementation(async ({ templateId }) => ({ ...answer(templateId), to: '' }));
  const props = { reservationId: 5, onClose: () => {} };
  const { rerender } = render(<EmailManualSendDialog {...props} open defaultTemplateId={1} />);
  fireEvent.change(await screen.findByLabelText('Adresse email du client'), { target: { value: 'quelquun@example.fr' } });
  rerender(<EmailManualSendDialog {...props} open={false} defaultTemplateId={1} />);
  rerender(<EmailManualSendDialog {...props} open defaultTemplateId={13} />);
  await screen.findByDisplayValue('Sujet 13');
  expect(screen.getByLabelText('Adresse email du client')).toHaveValue('');
});

test('a preview that answers late for the template just left is dropped, and sends nothing under the new one', async () => {
  const slow = deferred();
  api.previewEmail.mockImplementation(({ templateId }) => (templateId === 13 ? slow.promise : Promise.resolve(answer(templateId))));
  render(<EmailManualSendDialog reservationId={5} open defaultTemplateId={1} onClose={() => {}} />);
  await screen.findByDisplayValue('Sujet 1');

  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: /Échéance/ }));
  expect(screen.getByRole('button', { name: /^Envoyer$/ })).toBeDisabled();
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: /Paiement/ }));
  await screen.findByDisplayValue('Sujet 9');

  slow.resolve(answer(13));
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.getByDisplayValue('Sujet 9')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Sujet 13')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^Envoyer$/ }));
  await waitFor(() => expect(api.sendEmail).toHaveBeenCalled());
  expect(api.sendEmail.mock.calls[0][0]).toEqual(expect.objectContaining({
    templateId: 9, overrides: expect.objectContaining({ subject: 'Sujet 9', body: 'Corps 9' }),
  }));
});

test('« Envoyer » stays disabled from the moment another template is picked until its own preview is in', async () => {
  const slow = deferred();
  api.previewEmail.mockImplementation(({ templateId }) => (templateId === 13 ? slow.promise : Promise.resolve(answer(templateId))));
  render(<EmailManualSendDialog reservationId={5} open defaultTemplateId={1} onClose={() => {}} />);
  await screen.findByDisplayValue('Sujet 1');
  fireEvent.mouseDown(screen.getByRole('combobox'));
  fireEvent.click(await screen.findByRole('option', { name: /Échéance/ }));
  expect(screen.getByRole('button', { name: /^Envoyer$/ })).toBeDisabled();
  slow.resolve(answer(13));
  await screen.findByDisplayValue('Sujet 13');
  expect(screen.getByRole('button', { name: /^Envoyer$/ })).toBeEnabled();
});
