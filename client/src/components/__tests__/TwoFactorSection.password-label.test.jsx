// specs/hosting-h2-account-security.md rule 30 — the activation asks for the password as
// « Mot de passe (confirmation) », never a second « Mot de passe actuel » on « Mon compte »; it
// now lives in the dialog's step 1 (rule 40), not in the card (rule 39).
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { apiMock, STATUS_OFF } from './twoFactorFixtures';

vi.mock('../../api', () => apiMock());

import api from '../../api';
import TwoFactorSection from '../TwoFactorSection';

test('rule 30: the password field of the activation reads « Mot de passe (confirmation) »', async () => {
  api.getTwoFactorStatus.mockResolvedValue(STATUS_OFF);
  render(<TwoFactorSection account="marie@x.fr" />);
  expect(screen.queryByLabelText(/Mot de passe/)).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Activer' }));
  expect(await screen.findByLabelText(/^Mot de passe \(confirmation\)/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/^Mot de passe actuel/)).toBeNull();
});
