/**
 * SettingsEmailAutomationSection — "Envoi automatique des emails" card in /settings.
 * Pure presentational: one master switch + a warning that only makes sense when it is ON.
 * See specs/no-automatic-email-without-approval.md §6.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsEmailAutomationSection from '../SettingsEmailAutomationSection';

const SWITCH_LABEL = 'Autoriser GuestFlow à envoyer les emails sans validation';

function renderSection(values, props = {}) {
  const onChange = vi.fn();
  const utils = render(
    <SettingsEmailAutomationSection
      values={{ autoSendEnabled: false, ...values }}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange, ...utils };
}

test('the switch is off by default, and the card says what that means', () => {
  renderSection();
  expect(screen.getByLabelText(SWITCH_LABEL)).not.toBeChecked();
  expect(screen.getByText(/attendent votre validation/)).toBeInTheDocument();
});

test('the consequences warning shows only when automatic sending is authorised', () => {
  const { unmount } = renderSection({ autoSendEnabled: false });
  expect(screen.queryByText(/partent seuls à 08:00/)).not.toBeInTheDocument();
  unmount();

  renderSection({ autoSendEnabled: true });
  expect(screen.getByText(/partent seuls à 08:00/)).toBeInTheDocument();
  expect(screen.getByText(/dès qu'un paiement en ligne est confirmé/)).toBeInTheDocument();
});

test('toggling fires onChange(autoSendEnabled, true)', async () => {
  const user = userEvent.setup();
  const { onChange } = renderSection();
  await user.click(screen.getByLabelText(SWITCH_LABEL));
  expect(onChange).toHaveBeenCalledWith('autoSendEnabled', true);
});

test('toggling back fires onChange(autoSendEnabled, false)', async () => {
  const user = userEvent.setup();
  const { onChange } = renderSection({ autoSendEnabled: true });
  await user.click(screen.getByLabelText(SWITCH_LABEL));
  expect(onChange).toHaveBeenCalledWith('autoSendEnabled', false);
});

test('the card names what the switch does NOT govern', () => {
  // The operator must not read this as « nothing will ever be emailed »: their own notifications and
  // the password-reset mail are out of its reach.
  renderSection();
  expect(screen.getByText(/mot de passe oublié/)).toBeInTheDocument();
});

test('disabled while the form is saving', () => {
  renderSection({}, { disabled: true });
  expect(screen.getByLabelText(SWITCH_LABEL)).toBeDisabled();
});
