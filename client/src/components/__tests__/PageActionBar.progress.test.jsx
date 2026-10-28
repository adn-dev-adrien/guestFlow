// specs/dashboard-planning-scroll.md rule 20 — `progress` draws a thin bar glued under the page bar.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import SyncIcon from '@mui/icons-material/Sync';
import theme from '../../theme';
import { PageTitleProvider, TopBarActionSlot } from '../../hooks/usePageTitle';
import { setViewport, resetViewport } from './viewportFixture';

import PageActionBar from '../PageActionBar';

const renderBar = (props) => render(<MemoryRouter><PageActionBar title="Planning" onSave={() => {}} {...props} /></MemoryRouter>);

test('no progress bar unless asked', () => {
  renderBar({});
  expect(screen.queryByTestId('page-action-bar-progress')).toBeNull();
});

test('progress: a 2 px bar under the bar, named by the string, out of the layout', () => {
  renderBar({ progress: 'Chargement' });
  const bar = screen.getByTestId('page-action-bar-progress');
  expect(bar).toHaveAttribute('aria-label', 'Chargement');
  expect(bar).toHaveStyle({ position: 'absolute', height: '2px' });
});

describe('when the bar is not drawn on a phone', () => {
  afterEach(resetViewport);
  const Shell = ({ children }) => (
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <PageTitleProvider>
          <header data-testid="top"><TopBarActionSlot /></header>
          <main>{children}</main>
        </PageTitleProvider>
      </ThemeProvider>
    </MemoryRouter>
  );

  test('a bar with no action at all still draws the progress, fixed under the top bar', () => {
    setViewport(390);
    render(<Shell><PageActionBar title="Planning" progress="Chargement" /></Shell>);
    expect(document.querySelector('[data-sticky-bar]')).toBeNull();
    const bar = screen.getByTestId('page-action-bar-progress');
    expect(bar).toHaveAttribute('aria-label', 'Chargement');
    expect(bar).toHaveStyle({ position: 'fixed', top: '56px', height: '2px' });
  });

  test('a lone action handed to the top bar still draws the progress', () => {
    setViewport(390);
    render(<Shell><PageActionBar title="Planning" progress="Chargement" actionsBefore={[{ icon: <SyncIcon />, tooltip: 'Actualiser', onClick: () => {} }]} /></Shell>);
    expect(screen.getByTestId('top')).toContainElement(screen.getByRole('button', { name: 'Actualiser' }));
    expect(screen.getByTestId('page-action-bar-progress')).toHaveStyle({ position: 'fixed', top: '56px' });
  });
});
