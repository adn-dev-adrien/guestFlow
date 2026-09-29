/**
 * SelectableTile — specs/finance-dashboard-redesign.md rule 13: a tile says whether its table is
 * open, and names the panel it controls.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import SelectableTile from '../SelectableTile';

test('rule 13 — a closed tile offers to show its detail, and clicking it asks to open', () => {
  const onClick = vi.fn();
  render(<SelectableTile label="Encaissé" value="18 227 €" caption="81 % du chiffre d'affaires" selected={false} onClick={onClick} controls="detail" />);
  const tile = screen.getByRole('button', { name: 'Encaissé : afficher le détail' });
  expect(tile).toHaveAttribute('aria-expanded', 'false');
  expect(tile).toHaveAttribute('aria-controls', 'detail');
  expect(tile).toHaveTextContent('18 227 €');
  fireEvent.click(tile);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test('rule 13 — the open tile offers to hide it', () => {
  render(<SelectableTile label="Encaissé" value="18 227 €" selected onClick={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Encaissé : masquer le détail' })).toHaveAttribute('aria-expanded', 'true');
});
