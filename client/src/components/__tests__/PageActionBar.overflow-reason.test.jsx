// specs/payment-link-lifecycle.md rule 46, reading of 2026-11-01 (review of #915: show before refusing) — an action
// whose tooltip carries the reason it is disabled names itself by `label`: on a phone the overflow menu prints the
// action's name with the reason beneath, since no tooltip is reachable there.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import PageActionBar from '../PageActionBar';

vi.mock('../../hooks/usePageTitle', () => ({ usePublishPageTitle: () => {}, useTopBarActionSlot: () => null }));

const REASON = 'Séjour déjà payé : devis non créé.';
const mount = (actions) => render(<MemoryRouter><ThemeProvider theme={theme}><PageActionBar title="Fiche" actionsBefore={actions} /></ThemeProvider></MemoryRouter>);
const phone = () => { window.matchMedia = (query) => ({ matches: /max-width/.test(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }); };
const others = [{ icon: <i />, tooltip: 'Autre', onClick: vi.fn() }, { icon: <i />, tooltip: 'Encore', onClick: vi.fn() }];

test('phone menu: a disabled action prints its label with the reason beneath', () => {
  const saved = window.matchMedia;
  phone();
  try {
    mount([{ icon: <i />, label: 'Transformer en devis', tooltip: REASON, onClick: vi.fn(), disabled: true }, ...others]);
    fireEvent.click(screen.getByRole('button', { name: "Plus d'actions" }));
    const item = screen.getAllByRole('menuitem').find((el) => el.textContent.includes('Transformer en devis'));
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(within(item).getByText(REASON)).toBeInTheDocument();
  } finally { window.matchMedia = saved; }
});

test('phone menu: a label equal to the tooltip is printed once', () => {
  const saved = window.matchMedia;
  phone();
  try {
    mount([{ icon: <i />, label: 'Transformer en devis', tooltip: 'Transformer en devis', onClick: vi.fn() }, ...others]);
    fireEvent.click(screen.getByRole('button', { name: "Plus d'actions" }));
    expect(screen.getByRole('menuitem', { name: 'Transformer en devis' }).textContent).toBe('Transformer en devis');
  } finally { window.matchMedia = saved; }
});
