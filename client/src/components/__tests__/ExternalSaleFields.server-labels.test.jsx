/**
 * ExternalSaleFields — the VAT classes come from the server (specs/sas/outside-booking-sas.md rules 11, 48; round-1 finding UI-7, §6.0 fat backend): the menu lists the
 * `classes` of `GET /api/standalone-sales/vat-rates` with their `label`, and the « Taux de toute la classe … » phrase names the server's label. No client list.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import ExternalSaleFields from '../ExternalSaleFields';

const base = { sellableExternally: true, vatClass: '', externalVatRate: null };

test('the menu holds exactly the server\'s classes, under the server\'s words', () => {
  const classes = [{ vatClass: 'options', label: 'Prestations', externalRate: 20 }, { vatClass: 'drinks', label: 'Boissons fraîches', externalRate: 5.5 }];
  render(<ExternalSaleFields value={base} onChange={() => {}} classes={classes} defaultClass="options" />);
  expect(screen.getByRole('combobox', { name: 'Classe de TVA' })).toHaveTextContent('Prestations');
  expect(screen.getByText(/Taux de toute la classe « Prestations »/)).toBeInTheDocument();
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Classe de TVA' }));
  const options = within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
  expect(options).toEqual(['Prestations', 'Boissons fraîches']);
});

test('while the classes load, no class and no phrase are drawn (no stale client label)', () => {
  render(<ExternalSaleFields value={base} onChange={() => {}} classes={[]} defaultClass="options" />);
  expect(screen.queryByText(/Taux de toute la classe/)).toBeNull();
  expect(screen.getByRole('combobox', { name: 'Classe de TVA' })).not.toHaveTextContent('Options');
});
