// specs/hosting-h2-account-security.md rule 26 — the « Second code » card asks for the password as
// « Mot de passe (confirmation) », never a second « Mot de passe actuel » on « Mon compte ».
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTwoFactorStatus: vi.fn(), startTwoFactor: vi.fn(), confirmTwoFactor: vi.fn(), disableTwoFactor: vi.fn(), regenerateBackupCodes: vi.fn() },
}));

import api from '../../api';
import TwoFactorSection from '../TwoFactorSection';

test('rule 26: the password field reads « Mot de passe (confirmation) »', async () => {
  api.getTwoFactorStatus.mockResolvedValue({ enabled: false, emailAvailable: true, events: [] });
  render(<TwoFactorSection account="marie@x.fr" />);
  expect(await screen.findByLabelText(/^Mot de passe \(confirmation\)/)).toBeInTheDocument();
  expect(screen.queryByLabelText(/^Mot de passe actuel/)).toBeNull();
});
