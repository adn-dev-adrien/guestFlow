/**
 * ExternalSaleFields — the catalogue's « Vendable hors séjour » block (owner Q-C11; specs/outside-booking-sas.md rule 11): the switch, the VAT class, the external customer's rate of the whole class
 * (shown from the server's list, retyped only on purpose), and the server's refusals under their field. The rate of a class changes with the class chosen.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import ExternalSaleFields from '../ExternalSaleFields';

const CLASSES = [{ vatClass: 'options', externalRate: 20 }, { vatClass: 'drinks', externalRate: 5.5 }, { vatClass: 'catering', externalRate: null }, { vatClass: 'resources', externalRate: 20 }];
const base = { sellableExternally: false, vatClass: '', externalVatRate: '' };

test('the switch and the class go to the parent as patches; choosing a class forgets a rate typed for another', () => {
  const onChange = vi.fn();
  render(<ExternalSaleFields value={base} onChange={onChange} classes={CLASSES} defaultClass="options" />);
  fireEvent.click(screen.getByRole('switch', { name: 'Vendable hors séjour' }));
  expect(onChange).toHaveBeenCalledWith({ sellableExternally: true });
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Classe de TVA' }));
  fireEvent.click(screen.getByRole('option', { name: 'Boissons' }));
  expect(onChange).toHaveBeenCalledWith({ vatClass: 'drinks', externalVatRate: '' });
});

test('the rate shown is the class\'s own from the server\'s list, the phrase says it is the whole class\'s, and typing sends the typed text', () => {
  const onChange = vi.fn();
  const { rerender } = render(<ExternalSaleFields value={{ ...base, vatClass: 'drinks' }} onChange={onChange} classes={CLASSES} defaultClass="options" />);
  expect(screen.getByLabelText('Taux client extérieur (%)')).toHaveValue('5,5');
  expect(screen.getByText(/Taux de toute la classe « Boissons » pour une vente sans séjour/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Taux client extérieur (%)'), { target: { value: '10' } });
  expect(onChange).toHaveBeenCalledWith({ externalVatRate: '10' });
  rerender(<ExternalSaleFields value={base} onChange={onChange} classes={CLASSES} defaultClass="resources" />);
  expect(screen.getByRole('combobox', { name: 'Classe de TVA' })).toHaveTextContent('Ressources');
  rerender(<ExternalSaleFields value={{ ...base, vatClass: 'catering' }} onChange={onChange} classes={CLASSES} />);
  expect(screen.getByLabelText('Taux client extérieur (%)')).toHaveValue('');
});

test('the server\'s refusals show under their field, and a disabled block changes nothing', () => {
  const errors = { sellableExternally: 'Un article lié au séjour ne se vend pas hors séjour.', externalVatRate: 'Taux du client extérieur requis pour cette classe.' };
  render(<ExternalSaleFields value={{ ...base, sellableExternally: true }} onChange={() => {}} classes={CLASSES} errors={errors} disabled />);
  expect(screen.getByText('Un article lié au séjour ne se vend pas hors séjour.')).toBeInTheDocument();
  expect(screen.getByText('Taux du client extérieur requis pour cette classe.')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Vendable hors séjour' })).toBeDisabled();
});
