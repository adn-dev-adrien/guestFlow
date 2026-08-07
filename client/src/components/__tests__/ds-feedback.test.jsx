/**
 * DS phase-2 feedback system (specs/ds-components.md §3.2-§3.3) — useToast + fullScreen-on-xs
 * dialog primitives + DataPageScaffold PageActionBar swap.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { TableRow, TableCell } from '@mui/material';
import { vi } from 'vitest';

import theme from '../../theme';
import DialogProvider, { useToast } from '../DialogProvider';
import FormDialog from '../FormDialog';
import ConfirmDialog from '../ConfirmDialog';
import DataPageScaffold from '../DataPageScaffold';

const mockXs = () => {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: true, media: query, addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false, onchange: null,
  }));
  return () => { window.matchMedia = original; };
};

function ToastButtons() {
  const { showSuccess, showError } = useToast();
  return (
    <>
      <button type="button" onClick={() => showSuccess('Enregistré.')}>ok</button>
      <button type="button" onClick={() => showError('Échec.')}>ko</button>
    </>
  );
}

describe('useToast', () => {
  test('showSuccess / showError render the bottom snackbar with the message', () => {
    render(
      <ThemeProvider theme={theme}>
        <DialogProvider><ToastButtons /></DialogProvider>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByText('ok'));
    expect(screen.getByText('Enregistré.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ko'));
    expect(screen.getByText('Échec.')).toBeInTheDocument(); // replaces the success toast
  });

  test('throws outside DialogProvider (explicit contract)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ToastButtons />)).toThrow(/useToast must be used inside DialogProvider/);
    spy.mockRestore();
  });
});

describe('fullScreen-on-xs dialog primitives', () => {
  test('FormDialog goes fullScreen under sm', () => {
    const restore = mockXs();
    render(
      <ThemeProvider theme={theme}>
        <FormDialog open onClose={() => {}} title="Test" onSubmit={() => {}}>x</FormDialog>
      </ThemeProvider>,
    );
    expect(document.querySelector('.MuiDialog-paperFullScreen')).toBeTruthy();
    restore();
  });
  test('ConfirmDialog goes fullScreen under sm', () => {
    const restore = mockXs();
    render(
      <ThemeProvider theme={theme}>
        <ConfirmDialog open onClose={() => {}} onConfirm={() => {}} message="Sûr ?" />
      </ThemeProvider>,
    );
    expect(document.querySelector('.MuiDialog-paperFullScreen')).toBeTruthy();
    restore();
  });
});

describe('DataPageScaffold (PageActionBar swap)', () => {
  const base = {
    title: 'Clients',
    head: <TableRow><TableCell>Nom</TableCell></TableRow>,
    emptyColSpan: 1,
    emptyText: 'Aucun client',
  };
  test('renders the sticky PageActionBar title + the labeled create CTA', () => {
    const onAction = vi.fn();
    render(
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <DataPageScaffold {...base} actionLabel="Nouveau client" onAction={onAction} hasItems>
            <TableRow><TableCell>Jean</TableCell></TableRow>
          </DataPageScaffold>
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Clients')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nouveau client' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
  test('empty list renders the shared EmptyState row', () => {
    render(
      <MemoryRouter>
        <ThemeProvider theme={theme}>
          <DataPageScaffold {...base} hasItems={false}>{null}</DataPageScaffold>
        </ThemeProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Aucun client')).toBeInTheDocument();
  });
});
