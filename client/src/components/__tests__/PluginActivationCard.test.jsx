// specs/plugin-engine-backport.md rule 11 — the « Modules » card: one switch per plugin, nothing else.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import PluginActivationCard from '../PluginActivationCard';

const PLUGINS = [
  { id: 'gites-de-france-intake', name: 'Saisie Gîtes de France', description: 'Remplit les fiches depuis le mail de la centrale.', enabled: false },
  { id: 'booking-intake', name: 'Import Booking', description: 'Remplit les fiches depuis la page de l’extranet.', enabled: true },
];

test('rule 11: lists every plugin with its description and a switch showing its state', () => {
  render(<PluginActivationCard plugins={PLUGINS} onToggle={() => {}} />);
  expect(screen.getByText('Modules')).toBeInTheDocument();
  expect(screen.getByText('Remplit les fiches depuis le mail de la centrale.')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Saisie Gîtes de France' })).not.toBeChecked();
  expect(screen.getByRole('switch', { name: 'Import Booking' })).toBeChecked();
});

test('rule 11: flipping a switch asks the page to activate or deactivate that plugin', async () => {
  const onToggle = vi.fn();
  render(<PluginActivationCard plugins={PLUGINS} onToggle={onToggle} />);
  await userEvent.click(screen.getByRole('switch', { name: 'Saisie Gîtes de France' }));
  expect(onToggle).toHaveBeenCalledWith('gites-de-france-intake', true);
  await userEvent.click(screen.getByRole('switch', { name: 'Import Booking' }));
  expect(onToggle).toHaveBeenCalledWith('booking-intake', false);
});

test('rule 11: the switch of a plugin whose call is in flight is disabled, the others are not', () => {
  render(<PluginActivationCard plugins={PLUGINS} busyId="booking-intake" onToggle={() => {}} />);
  expect(screen.getByRole('switch', { name: 'Import Booking' })).toBeDisabled();
  expect(screen.getByRole('switch', { name: 'Saisie Gîtes de France' })).toBeEnabled();
});
