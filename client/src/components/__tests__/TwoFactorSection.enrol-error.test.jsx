// specs/hosting-h2-account-security.md rule 34 (review of PR #720) — the enrolment's wrong code is said
// under the cells like at login (role="alert"), the digits stay; typing again clears it.
import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../api', () => ({
  __esModule: true,
  default: { getTwoFactorStatus: vi.fn(), startTwoFactor: vi.fn(), confirmTwoFactor: vi.fn(), disableTwoFactor: vi.fn(), regenerateBackupCodes: vi.fn() },
}));

import api from '../../api';
import TwoFactorSection from '../TwoFactorSection';

test('rule 34: a wrong enrolment code sits under the cells and the digits stay', async () => {
  api.getTwoFactorStatus.mockResolvedValue({ enabled: false, emailAvailable: true, events: [] });
  api.startTwoFactor.mockResolvedValue({ method: 'email', sentTo: 'm•••e@x.fr' });
  api.confirmTwoFactor.mockRejectedValue(Object.assign(new Error('Code incorrect.'), { error: 'BAD_CODE' }));
  render(<TwoFactorSection account="marie@x.fr" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Code par email' }));
  fireEvent.change(screen.getByLabelText(/^Mot de passe \(confirmation\)/), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Activer' }));
  const field = await screen.findByLabelText('Code à 6 chiffres');
  fireEvent.change(field, { target: { value: '000000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
  const alert = await screen.findByText('Code incorrect.');
  expect(alert.getAttribute('role')).toBe('alert');
  expect(field.getAttribute('aria-describedby')).toBe(alert.id);
  expect(field.value).toBe('000000');
  fireEvent.change(field, { target: { value: '1' } });
  expect(screen.queryByText('Code incorrect.')).toBeNull();
});
