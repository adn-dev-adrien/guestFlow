// specs/options-resources-ux.md rule 16 — the editor mirrors the server's checks inline and shows a 422
// detail on its field.
import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../../api';
import { renderEditor, storedOption } from './optionEditorFixtures';
import { amountProblem, parseAmount, validateOptionForm } from '../optionForm';

vi.mock('../../../api', () => ({
  default: { getOption: vi.fn(), createOption: vi.fn(), updateOption: vi.fn(), getOptionPropertyDefaults: vi.fn() },
}));
vi.mock('../../../hooks/usePlugins', () => ({ usePlugin: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  api.getOption.mockResolvedValue(storedOption());
});

const open = async () => {
  const user = userEvent.setup();
  renderEditor();
  await screen.findByRole('heading', { name: 'Ménage' });
  return user;
};
const base = () => screen.getByLabelText('Prix de base');

test('rule 16: amounts are parsed with a comma or a point; anything else is not a number', () => {
  expect(parseAmount('12,5')).toBe(12.5);
  expect(parseAmount(' 7.25 ')).toBe(7.25);
  expect(parseAmount('1 200')).toBe(1200);
  expect(Number.isNaN(parseAmount('abc'))).toBe(true);
  expect(Number.isNaN(parseAmount(''))).toBe(true);
});

test('rule 16: amountProblem gives the server’s messages', () => {
  expect(amountProblem('x')).toBe('Nombre attendu');
  expect(amountProblem('-1')).toBe('Positif ou nul');
  expect(amountProblem('1,234')).toBe('2 décimales max');
  expect(amountProblem('101', { percent: true })).toBe('100 % max');
  expect(amountProblem('100', { percent: true })).toBe('');
  expect(amountProblem('0')).toBe('');
});

test('rule 16: validateOptionForm keys its errors like the server’s details', () => {
  const errors = validateOptionForm({
    title: ' ', priceType: 'per_stay', price: '-1', propertyIds: [1, 2], propertyPrices: { 1: 'x', 2: '' },
  });
  expect(errors).toEqual({ title: 'Nom requis', price: 'Positif ou nul', 'propertyPrices.1': 'Nombre attendu' });
  expect(validateOptionForm({ title: 'A', priceType: 'free', price: 'x', propertyIds: [1], propertyPrices: { 1: '-4' } })).toEqual({});
});

test('rule 16: an override of a property that is not proposed is not judged', () => {
  expect(validateOptionForm({ title: 'A', priceType: 'per_stay', price: '1', propertyIds: [1], propertyPrices: { 2: '-4' } })).toEqual({});
});

test('rule 16: « Nom requis » shows under the name once it is emptied', async () => {
  const user = await open();
  await user.clear(screen.getByLabelText(/^Nom/));
  expect(screen.getByText('Nom requis')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeDisabled();
});

test('rule 16: the base price shows « Positif ou nul », « 2 décimales max » and « Nombre attendu »', async () => {
  const user = await open();
  await user.clear(base());
  await user.type(base(), '-3');
  expect(screen.getByText('Positif ou nul')).toBeInTheDocument();
  await user.clear(base());
  await user.type(base(), '1,234');
  expect(screen.getByText('2 décimales max')).toBeInTheDocument();
  await user.clear(base());
  await user.type(base(), 'abc');
  expect(screen.getByText('Nombre attendu')).toBeInTheDocument();
});

test('rule 16: a per-property price is judged on its own line', async () => {
  const user = await open();
  await user.type(screen.getByLabelText('Prix · Estiva'), '-5');
  expect(screen.getByText('Positif ou nul')).toBeInTheDocument();
  expect(screen.getByText('1 champ à corriger')).toBeInTheDocument();
});

test('rule 16: a percentage above 100 is refused', async () => {
  api.getOption.mockResolvedValue(storedOption({ priceType: 'percent_of_stay', price: 4, title: 'Assurance' }));
  const user = userEvent.setup();
  renderEditor();
  await screen.findByRole('heading', { name: 'Assurance' });
  const field = screen.getByLabelText('Pourcentage de base');
  await user.clear(field);
  await user.type(field, '101');
  expect(screen.getByText('100 % max')).toBeInTheDocument();
});

test('rule 16: a 422 detail lands on its field and goes away on the next edit', async () => {
  api.updateOption.mockRejectedValue(Object.assign(new Error('VALIDATION_FAILED'), {
    status: 422, details: [{ field: 'propertyPrices.1', message: 'Positif ou nul' }],
  }));
  const user = await open();
  await user.type(screen.getByLabelText('Prix · Granja'), '5');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Positif ou nul')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Logements et prix' })).toHaveAttribute('data-has-error', 'true');
  await user.type(screen.getByLabelText('Prix · Granja'), '0');
  expect(screen.queryByText('Positif ou nul')).not.toBeInTheDocument();
});

test('rule 16: a 422 on the title shows under the name', async () => {
  api.updateOption.mockRejectedValue(Object.assign(new Error('VALIDATION_FAILED'), {
    status: 422, details: [{ field: 'title', message: 'Nom requis' }],
  }));
  const user = await open();
  await user.type(screen.getByLabelText(/^Description/), '!');
  await user.click(screen.getByRole('button', { name: 'Enregistrer' }));
  expect(await screen.findByText('Nom requis')).toBeInTheDocument();
});
