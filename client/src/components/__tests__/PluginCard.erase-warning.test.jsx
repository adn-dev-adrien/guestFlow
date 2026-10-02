// specs/plugins-phase-3b-neat.md rules 14, 18 — what an erasure cannot undo elsewhere is said apart,
// before the choice; the erasure stays possible (decision P12: warn, then erase).
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import PluginCard from '../PluginCard';

const WARNING = '2 souscriptions actives chez Neat — elles restent en vigueur chez Neat et ne pourront plus être résiliées depuis GuestFlow';
const neat = {
  id: 'neat', name: 'Assurance annulation Neat', description: 'Souscription automatique', icon: 'umbrella',
  surfaces: ['Intégrations › Neat'], requires: [], state: 'active', blocker: null, hasModule: true, erasable: true,
  data: [
    { label: WARNING, count: 2, warning: true },
    { label: 'la connexion Neat (identifiants, contrat, mappage, marge)', count: 1 },
    { label: 'le cache des primes', count: 4 },
  ],
};

test('the warning shows before the choice; the erase list keeps the other lines; erasing still goes through', async () => {
  const onAction = vi.fn();
  render(<ThemeProvider theme={theme}><PluginCard plugin={neat} onAction={onAction} /></ThemeProvider>);
  await userEvent.click(screen.getByText('Assurance annulation Neat'));
  expect(screen.getByText(WARNING)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Effacer aussi ses données' }));
  expect(screen.getByText('Seront effacés : la connexion Neat (identifiants, contrat, mappage, marge) · le cache des primes. C’est définitif.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Désinstaller' }));
  await userEvent.click(screen.getByRole('button', { name: 'Désinstaller et effacer' }));
  expect(onAction).toHaveBeenCalledWith('uninstall', { purge: true });
});
