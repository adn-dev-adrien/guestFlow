// specs/plugins-phase-0-foundation.md rule 25 (2026-10-27 audit) — on the Plugins page the Neat and
// Qonto cards dropped their version onto a line of its own, and « Actif · identifiant partenaire
// manquant » was cut by an ellipsis. The version now flows inside the name's line and the status
// badge wraps instead of being cut.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import PluginCard from '../PluginCard';

const plugin = {
  id: 'google-vacation-rentals', name: 'Google Vacation Rentals', version: '1.0.0',
  description: 'Envoie à Google les prix du site.', icon: 'travel-explore', surfaces: [], requires: [],
  state: 'active', blocker: null, erasable: false, data: [],
  setup: { needed: true, label: 'Actif · identifiant partenaire manquant', path: '/settings/integrations', action: 'Configurer' },
};

test('the version is part of the name line, not a separate flex item', () => {
  render(<ThemeProvider theme={theme}><PluginCard plugin={plugin} onAction={vi.fn()} /></ThemeProvider>);
  const version = screen.getByText('1.0.0');
  expect(version.tagName).toBe('SPAN');
  expect(version.parentElement).toHaveTextContent('Google Vacation Rentals1.0.0');
});

test('a long status label wraps instead of ending in an ellipsis', () => {
  render(<ThemeProvider theme={theme}><PluginCard plugin={plugin} onAction={vi.fn()} /></ThemeProvider>);
  const label = screen.getByText('Actif · identifiant partenaire manquant');
  expect(getComputedStyle(label).whiteSpace).toBe('normal');
});
