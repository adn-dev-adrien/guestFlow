// specs/finance-data-checks.md §3 rules 12, 13, 14 and 15 — the generic « À vérifier » list.
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DataChecksPanel from '../DataChecksPanel';
import { CHECKS } from './dataChecksFixtures';

const href = (item) => (item.reservationId != null ? `/reservations/${item.reservationId}` : null);
const renderPanel = (props = {}) => render(
  <ThemeProvider theme={theme}><MemoryRouter><DataChecksPanel checks={CHECKS} itemHref={href} {...props} /></MemoryRouter></ThemeProvider>,
);
const rowButton = (label) => screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded') && b.textContent.includes(label));

test('rule 12: one row per check holding something, with its count, label and severity words', () => {
  renderPanel();
  expect(screen.getByRole('heading', { name: 'À vérifier' })).toBeInTheDocument();
  expect(screen.queryByText(CHECKS[2].label)).not.toBeInTheDocument();
  const row = rowButton(CHECKS[0].label);
  expect(row).toHaveTextContent('2');
  expect(row).toHaveTextContent('à corriger');
  expect(rowButton(CHECKS[3].label)).toHaveTextContent('à vérifier');
  expect(rowButton(CHECKS[3].label)).toHaveTextContent('23');
});

test('rule 13: the info severity reads « information »', () => {
  renderPanel({ checks: [{ ...CHECKS[0], severity: 'info' }] });
  expect(rowButton(CHECKS[0].label)).toHaveTextContent('information');
});

test('rule 14: a row opens and closes its items; an item with a target is a link, the detail under it', () => {
  renderPanel();
  const row = rowButton(CHECKS[0].label);
  expect(row).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Taxe calculée : 4,80 €')).not.toBeInTheDocument();
  fireEvent.click(row);
  expect(row).toHaveAttribute('aria-expanded', 'true');
  const list = document.getElementById(row.getAttribute('aria-controls'));
  const link = within(list).getByRole('link', { name: /202609011/ });
  expect(link).toHaveAttribute('href', '/reservations/412');
  expect(link.closest('li')).toHaveTextContent('Taxe calculée : 4,80 €');
  expect(link).not.toHaveTextContent('Taxe calculée');
  fireEvent.click(row);
  expect(row).toHaveAttribute('aria-expanded', 'false');
});

test('rule 14: an item without a target is plain text; the rest-count reads « + N autres »', () => {
  renderPanel();
  fireEvent.click(rowButton(CHECKS[1].label));
  expect(screen.getByText('Septembre 2026')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Septembre 2026/ })).not.toBeInTheDocument();
  fireEvent.click(rowButton(CHECKS[3].label));
  expect(screen.getByText('+ 22 autres')).toBeInTheDocument();
});

test('rule 14: one item left over reads « + 1 autre »', () => {
  renderPanel({ checks: [{ ...CHECKS[3], count: 2, moreCount: 1 }] });
  fireEvent.click(rowButton(CHECKS[3].label));
  expect(screen.getByText('+ 1 autre')).toBeInTheDocument();
});

test('rule 14: each check carries its definition behind the « i »', () => {
  renderPanel();
  fireEvent.click(screen.getByRole('button', { name: `Définition : ${CHECKS[0].label}` }));
  expect(screen.getByText(CHECKS[0].hint)).toBeInTheDocument();
});

test('rule 15: with nothing to check, one line and no row', () => {
  renderPanel({ checks: CHECKS.map((c) => ({ ...c, count: 0, items: [] })), emptyText: 'Rien à vérifier sur l’exercice.' });
  expect(screen.getByText('Rien à vérifier sur l’exercice.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { expanded: false })).not.toBeInTheDocument();
});
