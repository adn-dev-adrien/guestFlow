import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PasswordField from '../PasswordField';

test('hides the value by default and reveals it when the eye toggle is clicked', async () => {
  const user = userEvent.setup();
  render(<PasswordField label="Mot de passe" value="secret123" onChange={() => {}} />);

  const input = screen.getByLabelText('Mot de passe');
  expect(input).toHaveAttribute('type', 'password');

  await user.click(screen.getByRole('button', { name: 'Afficher le mot de passe' }));
  expect(input).toHaveAttribute('type', 'text');

  await user.click(screen.getByRole('button', { name: 'Masquer le mot de passe' }));
  expect(input).toHaveAttribute('type', 'password');
});
