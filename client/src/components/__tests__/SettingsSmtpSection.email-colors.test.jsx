/**
 * SettingsSmtpSection — « Couleurs des e-mails » (specs/emails/guest-email-branding.md rules 5–6): three colour fields
 * (swatch + hex), the server's refusal shown under the field it concerns.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsSmtpSection from '../SettingsSmtpSection';

const VALUES = {
  host: 'smtp.gmail.com',
  secure: false,
  username: '',
  passwordSet: true,
  fromEmail: '',
  fromName: '',
  emailColorPage: '',
  emailColorAccent: '#B87B2A',
  emailColorLink: '',
  derived: { fromEmail: 'me@s.com', username: 'me@s.com', fromName: 'Domaine Solio' },
};

function renderSection(props = {}) {
  const onChange = vi.fn();
  render(
    <SettingsSmtpSection
      values={VALUES}
      onChange={onChange}
      onChangePassword={vi.fn()}
      onSendTest={vi.fn()}
      {...props}
    />,
  );
  return { onChange };
}

test('rule 5: the card offers the page, accent and link colours, each with a swatch, an empty one showing Maison’s default', () => {
  renderSection();
  expect(screen.getByText('Couleurs des e-mails')).toBeInTheDocument();
  expect(screen.getByLabelText('Fond de page')).toHaveValue('');
  expect(screen.getByLabelText('Fond de page')).toHaveAttribute('placeholder', '#F8F5EF');
  expect(screen.getByLabelText('Filet')).toHaveValue('#B87B2A');
  expect(screen.getByLabelText('Liens')).toHaveAttribute('placeholder', '#2F5D46');
  expect(screen.getByLabelText('Choisir la couleur : Liens')).toHaveAttribute('type', 'color');
  expect(screen.getByLabelText('Choisir la couleur : Filet')).toHaveValue('#b87b2a');
});

test('rule 5: typing a colour or picking one with the swatch reports it under the same field', async () => {
  const { onChange } = renderSection();
  await userEvent.type(screen.getByLabelText('Liens'), '#');
  expect(onChange).toHaveBeenLastCalledWith('emailColorLink', '#');
  fireEvent.change(screen.getByLabelText('Choisir la couleur : Fond de page'), { target: { value: '#f5f0e6' } });
  expect(onChange).toHaveBeenLastCalledWith('emailColorPage', '#F5F0E6');
});

test('rule 6: the server’s refusal, with its measured ratio, shows under the link field and marks it invalid', () => {
  renderSection({
    values: { ...VALUES, emailColorLink: '#C99038' },
    errors: { emailColorLink: 'Contraste 2,7:1 sur fond blanc — 4,5:1 minimum pour les liens' },
  });
  expect(screen.getByText('Contraste 2,7:1 sur fond blanc — 4,5:1 minimum pour les liens')).toBeInTheDocument();
  expect(screen.getByLabelText('Liens')).toBeInvalid();
  expect(screen.getByLabelText('Filet')).toBeValid();
});

test('rule 5: the three fields are disabled while the page saves', () => {
  renderSection({ disabled: true });
  for (const name of ['Fond de page', 'Filet', 'Liens']) expect(screen.getByLabelText(name)).toBeDisabled();
});
