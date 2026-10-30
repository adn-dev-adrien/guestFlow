// specs/payment-link-lifecycle.md rule 50 — a request e-mail sent from the dialog and refused 409
// LINK_ALREADY_PAID has booked the payment: the dialog keeps the refusal on screen and asks its page to
// re-read the money (`onMoneyChanged`, the installment card's hook); any other refusal re-reads nothing, and
// `onSent` stays for a mail that left.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getEmailTemplates: vi.fn(), previewEmail: vi.fn(), sendEmail: vi.fn() },
}));

import api from '../../api';
import EmailManualSendDialog from '../EmailManualSendDialog';

const PAID_BOOKED = 'Le lien en cours vient d’être payé : paiement enregistré, aucun nouveau lien créé.';

beforeEach(() => {
  vi.clearAllMocks();
  api.getEmailTemplates.mockResolvedValue([{ id: 30, name: 'Demande de solde', enabled: 1 }]);
  api.previewEmail.mockResolvedValue({ to: 'guest@example.test', subject: 'Votre solde', body: 'Bonjour', missingVariables: [] });
});

async function sendRefused(error) {
  api.sendEmail.mockRejectedValue(error);
  const onMoneyChanged = vi.fn();
  const onSent = vi.fn();
  render(<EmailManualSendDialog open reservationId={5} defaultTemplateId={30} onClose={() => {}} onSent={onSent} onMoneyChanged={onMoneyChanged} />);
  await screen.findByDisplayValue('Votre solde');
  await userEvent.setup().click(screen.getByRole('button', { name: /^Envoyer$/ }));
  return { alert: await screen.findByRole('alert'), onMoneyChanged, onSent };
}

test('rule 50 — refused as already paid: the message stays and the page re-reads the money', async () => {
  const { alert, onMoneyChanged, onSent } = await sendRefused(Object.assign(new Error(PAID_BOOKED), { error: 'LINK_ALREADY_PAID', status: 409 }));
  expect(alert).toHaveTextContent(PAID_BOOKED);
  await waitFor(() => expect(onMoneyChanged).toHaveBeenCalledTimes(1));
  expect(onSent).not.toHaveBeenCalled();
});

test('rule 50 — another refusal re-reads nothing', async () => {
  const { onMoneyChanged } = await sendRefused(Object.assign(new Error('Prestataire de paiement injoignable : réessayer.'), { error: 'PROVIDER_UNREACHABLE', status: 502 }));
  expect(onMoneyChanged).not.toHaveBeenCalled();
});
