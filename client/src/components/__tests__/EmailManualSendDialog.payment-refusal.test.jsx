// specs/payment-link-lifecycle.md rule 60 (review of #906) — the preview of a request already known to be refused
// (platform stay, closed nights, payment to settle) carries the server's `refusal`: the dialog shows its message in
// an info alert and « Envoyer » stays disabled. Without a refusal, nothing changes.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getEmailTemplates: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn() },
}));

import api from '../../api';
import EmailManualSendDialog from '../EmailManualSendDialog';

const PREVIEW = { to: 'guest@example.test', subject: 'Votre solde', body: 'Payer le solde en ligne : ', missingVariables: [] };
const MESSAGE = 'Réservation plateforme : aucun lien de paiement.';

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTemplates.mockResolvedValue([{ id: 30, name: 'Demande de solde', enabled: 1 }]);
});

const open = () => render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={30} onClose={() => {}} />);

test('rule 60 — a refused request: the server’s message in an info alert, « Envoyer » disabled', async () => {
  api.previewEmail.mockResolvedValue({ ...PREVIEW, refusal: { error: 'PLATFORM_RESERVATION', message: MESSAGE } });
  open();
  await screen.findByDisplayValue('Votre solde');
  const alert = screen.getByText(MESSAGE).closest('[role="alert"]');
  expect(alert).toHaveClass('MuiAlert-colorInfo');
  expect(screen.getByRole('button', { name: /^Envoyer$/ })).toBeDisabled();
  expect(api.sendEmail).not.toHaveBeenCalled();
});

test('rule 60 — no refusal: no alert, « Envoyer » enabled', async () => {
  api.previewEmail.mockResolvedValue({ ...PREVIEW, refusal: null });
  open();
  await screen.findByDisplayValue('Votre solde');
  expect(screen.queryByText(MESSAGE)).toBeNull();
  await waitFor(() => expect(screen.getByRole('button', { name: /^Envoyer$/ })).toBeEnabled());
});
