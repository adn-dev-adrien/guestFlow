// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 1, 2, 28 (amends specs/resources/hourly-extra-hour-rates.md §6) — the price grids of an hourly resource, in « Prix »:
// « Clients logés » and « Prix pour les extérieurs » (Semaine / Week-end), every field required, no fallback, the server's sentence under its own field.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import HourlyPriceGrids from '../HourlyPriceGrids';
import { hourlyPriceForm } from '../hourlyPriceForm';
import { emptyResourceFor, formFromResource, toResourcePayload, validateResourceForm } from '../../../pages/options/resourceForm';

const FORMS = [hourlyPriceForm];
const FILLED = {
  priceType: 'per_hour', price: '50', showsPlanningCard: true, hourlyEveningStart: '20:00', sellableExternally: true,
  hourlyEveningRate: '60', hourlyNextDayRate: '40', hourlyNextEveningRate: '50',
  hourlyExternalDayRate: '50', hourlyExternalNextDayRate: '45', hourlyExternalEveningRate: '70', hourlyExternalNextEveningRate: '65',
  hourlyExternalWeekendDayRate: '70', hourlyExternalWeekendNextDayRate: '60', hourlyExternalWeekendEveningRate: '90', hourlyExternalWeekendNextEveningRate: '80',
};
const draftOf = (over = {}) => ({ ...FILLED, ...over });
const show = (draft, props = {}) => render(<HourlyPriceGrids draft={draft} onChange={props.onChange || vi.fn()} errors={props.errors} />);

test('rule 1 — « Clients logés » has a day row and an evening row (with the switch time), a first hour and a following hours column; the day first hour is the price itself', () => {
  show(draftOf());
  expect(screen.getByText('Clients logés')).toBeInTheDocument();
  expect(screen.getAllByText('Soirée (dès 20:00)')).toHaveLength(3);
  expect(screen.getByLabelText('Clients logés · Journée · 1re heure')).toHaveValue('50');
  expect(screen.getByLabelText('Clients logés · Soirée · heures suivantes')).toHaveValue('50');
  expect(screen.getByLabelText('Clients logés · Journée · 1re heure')).not.toBeDisabled();
});

test('rule 1 — the outside grid shows a « Semaine » and a « Week-end » group, and the line that says what the week-end is', () => {
  show(draftOf());
  expect(screen.getByText('Prix pour les extérieurs')).toBeInTheDocument();
  expect(screen.getByLabelText('Extérieurs · Semaine · Journée · 1re heure')).toHaveValue('50');
  expect(screen.getByLabelText('Extérieurs · Week-end · Soirée · 1re heure')).toHaveValue('90');
  expect(screen.getByText('Week-end : du vendredi 20:00 au dimanche soir, et les jours fériés.')).toBeInTheDocument();
});

test('rule 1 — a resource not sold outside a stay has no outside grid; one without an evening switch has no evening row', () => {
  show(draftOf({ sellableExternally: false, hourlyEveningStart: '' }));
  expect(screen.queryByText('Prix pour les extérieurs')).not.toBeInTheDocument();
  expect(screen.queryByText(/Soirée/)).not.toBeInTheDocument();
});

test('rule 2 — typing patches the draft with the text typed, a decimal comma kept; no placeholder stands for a missing price', () => {
  const onChange = vi.fn();
  show(draftOf({ hourlyExternalWeekendNextDayRate: '' }), { onChange });
  const field = screen.getByLabelText('Extérieurs · Week-end · Journée · heures suivantes');
  expect(field).not.toHaveAttribute('placeholder');
  fireEvent.change(field, { target: { value: '37,5' } });
  expect(onChange).toHaveBeenLastCalledWith({ hourlyExternalWeekendNextDayRate: '37,5' });
});

test('rule 2 — a refusal sentence is drawn under its own field only', () => {
  const sentence = 'Le tarif extérieurs (week-end, soirée, heures suivantes) doit être un montant positif.';
  show(draftOf({ hourlyExternalWeekendNextEveningRate: 'abc' }), { errors: { hourlyExternalWeekendNextEveningRate: sentence } });
  expect(screen.getByText(sentence)).toBeInTheDocument();
  expect(screen.getByLabelText('Extérieurs · Week-end · Soirée · heures suivantes')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Extérieurs · Week-end · Soirée · 1re heure')).not.toHaveAttribute('aria-invalid', 'true');
});

const formOf = (over = {}) => ({ ...emptyResourceFor(FORMS), name: 'Bain', quantity: '1', ...FILLED, ...over });

test('rule 2 — the form checks the same sentence before saving: a blank field, a letter, a negative, three decimals and 10 000,01 are refused; 0 is fine', () => {
  expect(validateResourceForm(formOf(), FORMS)).toEqual({});
  const sentence = 'Le tarif extérieurs (week-end, soirée, heures suivantes) doit être un montant positif.';
  ['', 'abc', '-1', '1,234', '10000,01'].forEach((bad) => {
    expect(validateResourceForm(formOf({ hourlyExternalWeekendNextEveningRate: bad }), FORMS).hourlyExternalWeekendNextEveningRate).toBe(sentence);
  });
  ['0', '40', '37,5', '10000'].forEach((fine) => expect(validateResourceForm(formOf({ hourlyExternalWeekendNextEveningRate: fine }), FORMS)).toEqual({}));
});

test('rule 2 — the outside grid is checked only when the resource is sold outside a stay, the evening only with an evening switch', () => {
  expect(validateResourceForm(formOf({ sellableExternally: false, hourlyExternalWeekendDayRate: '' }), FORMS)).toEqual({});
  expect(validateResourceForm(formOf({ hourlyEveningStart: '', hourlyEveningRate: '', hourlyNextEveningRate: '' }), FORMS).hourlyEveningRate).toBeUndefined();
  expect(validateResourceForm(formOf({ price: '' }), FORMS).price).toBe('Le tarif hébergés (journée, 1re heure) doit être un montant positif.');
});

test('rule 28 — the payload carries a number per field and null for a blank one; nothing priced without the planning card; the core form alone knows none of these fields', () => {
  const payload = toResourcePayload(formOf({ hourlyExternalWeekendNextDayRate: '37,5', hourlyNextDayRate: '' }), FORMS);
  expect(payload.hourlyExternalWeekendNextDayRate).toBe(37.5);
  expect(payload.hourlyNextDayRate).toBeNull();
  expect(payload.hourlyExternalWeekendEveningRate).toBe(90);
  expect(toResourcePayload(formOf({ showsPlanningCard: false }), FORMS).hourlyExternalWeekendEveningRate).toBeNull();
  const alone = toResourcePayload(formOf());
  expect('hourlyExternalWeekendEveningRate' in alone).toBe(false);
  expect('hourlyEveningRate' in alone).toBe(false);
});

test('rule 28 — a stored resource reads back as text, a missing following rate stays empty (no placeholder, no fallback)', () => {
  const form = formFromResource({
    priceType: 'per_hour', price: 50, hourlyEveningRate: 60.5, hourlyNextDayRate: null, hourlyExternalWeekendDayRate: 70,
  }, FORMS);
  expect(form.hourlyEveningRate).toBe('60,5');
  expect(form.hourlyNextDayRate).toBe('');
  expect(form.hourlyExternalWeekendDayRate).toBe('70');
});
