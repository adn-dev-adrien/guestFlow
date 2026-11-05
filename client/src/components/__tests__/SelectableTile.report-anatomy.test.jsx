/**
 * specs/report-grammar.md §3 rules 2, 4 and 16 — the KPI tile of a report: label and « i »
 * definition, value, secondary line, year-over-year pill; the definition opens on a click and closes
 * on a second click, a click outside or Escape (focus back on the button).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import SelectableTile from '../SelectableTile';
import { KPI_TILES } from '../../pages/reportGrammarFixtures';

const r = (ui) => render(<ThemeProvider theme={theme}><button type="button">ailleurs</button>{ui}</ThemeProvider>);
const CA = KPI_TILES[0];

test('rule 2 — a static tile shows label, value, secondary line and the pill, and is not a button', () => {
  r(<SelectableTile label={CA.label} value={CA.value} caption={CA.caption} info={CA.info} comparison={CA.comparison} />);
  const tile = screen.getByTestId('kpi-tile');
  expect(tile.tagName).toBe('DIV');
  expect(tile).toHaveTextContent('CA HT');
  expect(tile).toHaveTextContent('18 450 €');
  expect(tile).toHaveTextContent('TTC : 20 295 €');
  expect(tile).toHaveTextContent('↑ +21,3 %(N-1 : 15 210 €)');
  expect(screen.queryByRole('button', { name: /afficher le détail/ })).toBeNull();
});

test('rule 2 — the definition opens, closes on a second click and on a click outside', async () => {
  r(<SelectableTile label={CA.label} value={CA.value} info={CA.info} />);
  const i = screen.getByRole('button', { name: 'Définition : CA HT' });
  await userEvent.click(i);
  expect(i).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('tooltip')).toHaveTextContent(CA.info);
  await userEvent.click(i);
  expect(screen.queryByRole('tooltip')).toBeNull();
  await userEvent.click(i);
  await userEvent.click(screen.getByRole('button', { name: 'ailleurs' }));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('rule 2 — Escape closes the definition and gives the focus back to its button', async () => {
  r(<SelectableTile label={CA.label} value={CA.value} info={CA.info} />);
  const i = screen.getByRole('button', { name: 'Définition : CA HT' });
  await userEvent.click(i);
  fireEvent.keyDown(screen.getByRole('tooltip'), { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(i).toHaveFocus();
});

test('rule 4 — a tile without a comparable year shows « — vs N-1 »', () => {
  r(<SelectableTile label="Encaissé" value="21 981 €" comparison={{ change: null }} />);
  expect(screen.getByText('— vs N-1')).toBeInTheDocument();
});

test('rule 2 — a selectable tile with a definition keeps the « i » outside its own button', async () => {
  const onClick = vi.fn();
  r(<SelectableTile label="Encaissé" value="21 981 €" info="Paiements reçus." selected={false} onClick={onClick} controls="d" />);
  const tile = screen.getByRole('button', { name: 'Encaissé : afficher le détail' });
  const i = screen.getByRole('button', { name: 'Définition : Encaissé' });
  expect(tile.contains(i)).toBe(false);
  await userEvent.click(i);
  expect(onClick).not.toHaveBeenCalled();
  await userEvent.click(tile);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('rule 16 — the « i » carries the 44 px touch hit area', () => {
  r(<SelectableTile label="CA HT" value="1 €" info="x" />);
  const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');
  const cls = Array.from(screen.getByRole('button', { name: 'Définition : CA HT' }).classList).find((c) => c.startsWith('css-'));
  expect(css).toMatch(new RegExp(`@media \\(pointer: coarse\\)\\{\\.${cls}\\{position:relative;\\}\\.${cls}::after\\{[^}]*max\\(100%, 44px\\)`));
});
