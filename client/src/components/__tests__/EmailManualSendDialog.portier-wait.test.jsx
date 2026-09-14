// specs/gate-access-portier.md §3.2 — a manual « Envoyer » while Portier is down is queued, and the dialog
// says so: « Portier ne répond pas : l'email partira dès qu'il répond. »
import { vi, test, expect } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getEmailTemplates: vi.fn(),
    previewEmail: vi.fn(),
    sendEmail: vi.fn(),
  },
}));

import api from '../../api';
import EmailManualSendDialog from '../EmailManualSendDialog';

test('the queued email keeps the dialog open on the server\'s sentence until « Fermer »', async () => {
  const user = userEvent.setup();
  const queued = { ok: true, waitingPortier: true, emailLogId: 9, message: "Portier ne répond pas : l'email partira dès qu'il répond." };
  api.getEmailTemplates.mockResolvedValue([{ id: 1, name: 'Rappel J-7', dayOffset: -7, enabled: 1 }]);
  api.previewEmail.mockResolvedValue({ to: 'camille@example.com', subject: 'Votre séjour approche', body: 'Bonjour', missingVariables: [] });
  api.sendEmail.mockResolvedValue(queued);
  const onSent = vi.fn();
  const onClose = vi.fn();

  render(<EmailManualSendDialog open reservationId={10} defaultTemplateId={1} onSent={onSent} onClose={onClose} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Envoyer' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Envoyer' }));

  expect(await screen.findByText(queued.message)).toBeInTheDocument();
  expect(onSent).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Envoyer' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Fermer' }));
  expect(onSent).toHaveBeenCalledWith(queued);
  expect(onClose).toHaveBeenCalled();
});
