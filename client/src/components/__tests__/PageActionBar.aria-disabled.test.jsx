// specs/dashboard-planning-scroll.md rule 29 — an `ariaDisabled` action is dimmed, focusable and inert, in
// the bar and in the phone's overflow menu alike.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import PageActionBar from '../PageActionBar';

vi.mock('../../hooks/usePageTitle', () => ({ usePublishPageTitle: () => {}, useTopBarActionSlot: () => null }));

const mount = (actions) => render(<MemoryRouter><ThemeProvider theme={theme}><PageActionBar title="Planning" actionsBefore={actions} /></ThemeProvider></MemoryRouter>);

test('rule 29 — in the bar: aria-disabled, still focusable, click does nothing', () => {
  const onClick = vi.fn();
  mount([{ icon: <i />, tooltip: 'Aller', onClick, ariaDisabled: true }]);
  const button = screen.getByRole('button', { name: 'Aller' });
  expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(button).not.toBeDisabled();
  button.focus();
  fireEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
  expect(button).toHaveFocus();
});

test('rule 29 — in the phone overflow menu the item is disabled and runs nothing', () => {
  window.matchMedia = (query) => ({ matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try {
    const onClick = vi.fn();
    const other = vi.fn();
    mount([
      { icon: <i />, tooltip: 'Aller', onClick, ariaDisabled: true },
      { icon: <i />, tooltip: 'Autre', onClick: other },
      { icon: <i />, tooltip: 'Encore', onClick: other },
    ]);
    fireEvent.click(screen.getByRole('button', { name: "Plus d'actions" }));
    const item = screen.getByRole('menuitem', { name: 'Aller' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(item);
    expect(onClick).not.toHaveBeenCalled();
  } finally {
    delete window.matchMedia;
  }
});
