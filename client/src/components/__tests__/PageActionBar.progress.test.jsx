// specs/dashboard-planning-scroll.md rule 20 — `progress` draws a thin bar glued under the page bar.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

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
