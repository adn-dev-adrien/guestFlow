/**
 * SettingsNotificationsSection — "Notifications de réservation" card in /parametres.
 * Pure presentational: master toggle + per-channel iCal toggle + recipient field.
 * See specs/site-booking-notifications.md §3 rule 9b + §6.
 */

import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SettingsNotificationsSection from '../SettingsNotificationsSection';

function renderSection(values, props = {}) {
  const onChange = vi.fn();
  render(
    <SettingsNotificationsSection
      values={{ enabled: true, icalReservationEnabled: true, recipientEmail: '', ...values }}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

const icalSwitch = () => screen.getByLabelText('Email à chaque nouvelle réservation plateforme (iCal)');

test('renders the master toggle + the per-channel iCal toggle', () => {
  renderSection();
  expect(screen.getByLabelText('Activer les notifications par email')).toBeChecked();
  expect(icalSwitch()).toBeChecked();
});

test('toggling the iCal switch fires onChange(icalReservationEnabled, false)', async () => {
  const user = userEvent.setup();
  const { onChange } = renderSection();
  await user.click(icalSwitch());
  expect(onChange).toHaveBeenCalledWith('icalReservationEnabled', false);
});

test('the iCal toggle is disabled when the master switch is OFF', () => {
  renderSection({ enabled: false });
  expect(icalSwitch()).toBeDisabled();
});
