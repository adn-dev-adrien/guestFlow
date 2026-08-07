/**
 * DS phase-2 generics (specs/ds-components.md §7) — LoadingState, EmptyState, ErrorAlert,
 * StatusBadge (soft restyle), PlatformChip, UnsavedChangesDialog, ResponsiveTable, ErrorBoundary.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';

import theme from '../../theme';
import LoadingState from '../LoadingState';
import EmptyState from '../EmptyState';
import ErrorAlert from '../ErrorAlert';
import StatusBadge from '../StatusBadge';
import PlatformChip from '../PlatformChip';
import UnsavedChangesDialog from '../UnsavedChangesDialog';
import ResponsiveTable from '../ResponsiveTable';
import RouteErrorBoundary from '../ErrorBoundary';
import { PLATFORM_COLORS } from '../../constants/platforms';
import { TableRow, TableCell } from '@mui/material';

const withTheme = (ui) => render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);

describe('LoadingState', () => {
  test('spinner variant renders a progressbar + optional label', () => {
    withTheme(<LoadingState label="Chargement…" />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });
  test('skeleton variant renders the requested row count', () => {
    const { container } = withTheme(<LoadingState variant="skeleton" rows={4} />);
    expect(container.querySelectorAll('.MuiSkeleton-root').length).toBe(4);
  });
});

describe('EmptyState', () => {
  test('renders the message and fires the CTA', () => {
    const onAction = vi.fn();
    withTheme(<EmptyState message="Aucune réservation." actionLabel="Créer" onAction={onAction} />);
    expect(screen.getByText('Aucune réservation.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  test('no CTA button without actionLabel', () => {
    withTheme(<EmptyState message="Vide." />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ErrorAlert', () => {
  test('default French message + « Réessayer » fires onRetry', () => {
    const onRetry = vi.fn();
    withTheme(<ErrorAlert onRetry={onRetry} />);
    expect(screen.getByText('Impossible de charger les données.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  test('no retry button without onRetry', () => {
    withTheme(<ErrorAlert message="Erreur." />);
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  });
});

describe('StatusBadge (soft « Maison » restyle)', () => {
  test.each([
    ['success', 'Payé'],
    ['warning', 'Solde à venir'],
    ['error', 'Caution à percevoir'],
    ['info', 'Acompte reçu'],
    ['neutral', 'Brouillon'],
  ])('renders %s with its soft background', (status, label) => {
    withTheme(<StatusBadge status={status} label={label} />);
    const chip = screen.getByText(label).closest('.MuiChip-root');
    expect(chip).toBeTruthy();
    const bg = window.getComputedStyle(chip).backgroundColor;
    expect(bg).not.toBe('');           // soft token resolved (not transparent default)
    expect(bg).not.toBe('transparent');
  });
});

describe('PlatformChip', () => {
  test('renders the platform label with its canonical color', () => {
    withTheme(<PlatformChip platform="airbnb" />);
    const chip = screen.getByText('airbnb').closest('.MuiChip-root');
    // #FF5A5F-style hex resolves to an rgb() computed background.
    expect(window.getComputedStyle(chip).backgroundColor).toBe(hexToRgb(PLATFORM_COLORS.airbnb));
  });
  test('renders nothing without a platform', () => {
    const { container } = withTheme(<PlatformChip platform="" />);
    expect(container.firstChild).toBeNull();
  });
});

function hexToRgb(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

describe('UnsavedChangesDialog (canonical wording + stay-first order)', () => {
  test('renders the canonical copy and routes each action', () => {
    const onStay = vi.fn(); const onDiscard = vi.fn(); const onSaveAndQuit = vi.fn();
    withTheme(<UnsavedChangesDialog open onStay={onStay} onDiscard={onDiscard} onSaveAndQuit={onSaveAndQuit} />);
    expect(screen.getByText('Modifications non enregistrées')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    // Stay-button FIRST (design-system.md §3.3 canonical order).
    expect(buttons[0]).toHaveTextContent('Rester sur la page');
    expect(buttons[1]).toHaveTextContent('Quitter sans enregistrer');
    expect(buttons[2]).toHaveTextContent('Enregistrer et quitter');
    fireEvent.click(buttons[0]); expect(onStay).toHaveBeenCalled();
    fireEvent.click(buttons[1]); expect(onDiscard).toHaveBeenCalled();
    fireEvent.click(buttons[2]); expect(onSaveAndQuit).toHaveBeenCalled();
  });
});

describe('ResponsiveTable', () => {
  const items = [{ id: 1, name: 'Jean' }, { id: 2, name: 'Marie' }];
  const props = {
    items,
    getKey: (r) => r.id,
    head: <TableRow><TableCell>Nom</TableCell></TableRow>,
    renderRow: (r) => <TableRow key={r.id}><TableCell>{r.name}</TableCell></TableRow>,
    renderMobileCard: (r) => <span>{`carte-${r.name}`}</span>,
  };
  test('renders a real table on desktop (jsdom default: not xs)', () => {
    withTheme(<ResponsiveTable {...props} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Jean')).toBeInTheDocument();
    expect(screen.queryByText('carte-Jean')).toBeNull();
  });
  test('renders stacked cards on xs (matchMedia mock)', () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: true, media: query, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
    }));
    withTheme(<ResponsiveTable {...props} />);
    expect(screen.getByText('carte-Jean')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    window.matchMedia = original;
  });
  test('empty items renders the shared EmptyState', () => {
    withTheme(<ResponsiveTable {...props} items={[]} emptyText="Aucun élément." />);
    expect(screen.getByText('Aucun élément.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('RouteErrorBoundary', () => {
  test('a child render crash shows the recoverable fallback instead of a blank page', () => {
    const Bomb = () => { throw new Error('boom'); };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    withTheme(
      <MemoryRouter>
        <RouteErrorBoundary><Bomb /></RouteErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('Une erreur est survenue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recharger la page' })).toBeInTheDocument();
    spy.mockRestore();
  });
});
