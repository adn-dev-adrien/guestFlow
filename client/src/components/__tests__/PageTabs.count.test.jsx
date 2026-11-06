/**
 * specs/report-grammar.md §3 rule 6 — a tab can carry the size of its list (« Encaissements 40 »),
 * part of its accessible name; 0 is a count too.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import PageTabs from '../PageTabs';

test('rule 6 — the count rides after the label and is read with it', () => {
  render(<PageTabs value="cash" onChange={() => {}} items={[{ value: 'cash', label: 'Encaissements', count: 40 }, { value: 'vat', label: 'TVA', count: 0 }, { value: 'x', label: 'Autre' }]} />);
  expect(screen.getByRole('tab', { name: 'Encaissements 40' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'TVA 0' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Autre' })).toBeInTheDocument();
  expect(screen.getAllByTestId('tab-count')).toHaveLength(2);
});
