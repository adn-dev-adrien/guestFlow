// specs/resources/hourly-extra-hour-rates.md rules 1, 5 and §6 — the rates grid of the resource form: two audience blocks, the first-hour and
// following-hours columns, the first-hour value as the placeholder of an empty following-hours field, the server's refusal under the field.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import HourlyResourceFields from '../HourlyResourceFields';
import {
  emptyResource, formFromResource, toResourcePayload, validateResourceForm,
} from '../../../pages/options/resourceForm';

const DRAFT = {
  priceType: 'per_hour', price: 50, isComplex: true, showsPlanningCard: true, minimumUsageMinutes: 60, hourlyEveningStart: '20:00', hourlyEveningRate: 50,
  hourlyExternalDayRate: 50, hourlyExternalEveningRate: 70,
};
const draftOf = (over = {}) => ({
  ...DRAFT, hourlyNextDayRate: '', hourlyNextEveningRate: '', hourlyExternalNextDayRate: '', hourlyExternalNextEveningRate: '', ...over,
});
const render_ = (draft, props = {}) => render(<HourlyResourceFields draft={draft} onChange={props.onChange || vi.fn()} errors={props.errors} />);

test('rule 1 — two blocks, rows day and evening (with the switch time), columns first hour and following hours', () => {
  render_(draftOf());
  expect(screen.getByText('Clients hébergés')).toBeInTheDocument();
  expect(screen.getByText('Clients extérieurs')).toBeInTheDocument();
  expect(screen.getAllByText('Journée')).toHaveLength(2);
  expect(screen.getAllByText('Soirée (dès 20:00)')).toHaveLength(2);
  expect(screen.getAllByText('1re heure')).toHaveLength(2);
  expect(screen.getAllByText('Heures suivantes')).toHaveLength(2);
  expect(screen.getByLabelText('Clients extérieurs · Soirée · 1re heure')).toHaveValue(70);
  expect(screen.queryByText('Dégressivité par heure')).not.toBeInTheDocument();
});

test('rule 1 — an empty following-hours field shows the first-hour value as its placeholder; the guests\' day first hour is the general price, read only', () => {
  render_(draftOf());
  expect(screen.getByLabelText('Clients extérieurs · Soirée · heures suivantes')).toHaveAttribute('placeholder', '= 70 €');
  expect(screen.getByLabelText('Clients hébergés · Journée · heures suivantes')).toHaveAttribute('placeholder', '= 50 €');
  expect(screen.getByLabelText('Clients hébergés · Journée · 1re heure')).toBeDisabled();
});

test('rule 1 — an outside first hour left at 0 means « same as guests »: its placeholder says so rather than « = 0 € »', () => {
  render_(draftOf({ hourlyExternalDayRate: 0 }));
  expect(screen.getByLabelText('Clients extérieurs · Journée · heures suivantes')).toHaveAttribute('placeholder', '= 1re heure');
});

test('rule 1 — typing a following-hours rate patches the draft with the text typed; 0 and a decimal comma are kept as typed', () => {
  const onChange = vi.fn();
  render_(draftOf(), { onChange });
  fireEvent.change(screen.getByLabelText('Clients extérieurs · Journée · heures suivantes'), { target: { value: '40' } });
  expect(onChange).toHaveBeenLastCalledWith({ hourlyExternalNextDayRate: '40' });
  fireEvent.change(screen.getByLabelText('Clients hébergés · Soirée · heures suivantes'), { target: { value: '0' } });
  expect(onChange).toHaveBeenLastCalledWith({ hourlyNextEveningRate: '0' });
  fireEvent.change(screen.getByLabelText('Clients hébergés · Journée · heures suivantes'), { target: { value: '37,5' } });
  expect(onChange).toHaveBeenLastCalledWith({ hourlyNextDayRate: '37,5' });
});

test('rule 5 — a refusal sentence is drawn under its own field only', () => {
  const sentence = 'Le tarif des heures suivantes (soir, extérieurs) doit être un montant positif.';
  render_(draftOf({ hourlyExternalNextEveningRate: 'abc' }), { errors: { hourlyExternalNextEveningRate: sentence } });
  expect(screen.getByText(sentence)).toBeInTheDocument();
  expect(screen.getByLabelText('Clients extérieurs · Soirée · heures suivantes')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Clients extérieurs · Journée · heures suivantes')).not.toHaveAttribute('aria-invalid', 'true');
});

test('rule 5 — the form checks the same sentence before saving: empty and 0 are fine, a letter, a negative, three decimals and 10 000,01 are refused', () => {
  const form = (value) => ({
    ...emptyResource, name: 'Bain', priceType: 'per_hour', showsPlanningCard: true, hourlyNextDayRate: value,
  });
  ['', '0', '40', '37,5', '10000'].forEach((fine) => expect(validateResourceForm(form(fine)).hourlyNextDayRate).toBeUndefined());
  ['abc', '-1', '1,234', '10000,01'].forEach((bad) => {
    expect(validateResourceForm(form(bad)).hourlyNextDayRate).toBe('Le tarif des heures suivantes (journée, hébergés) doit être un montant positif.');
  });
});

test('rule 1 — the payload sends a number, or null for an empty field, and nothing without the planning card', () => {
  const form = {
    ...emptyResource, name: 'Bain', priceType: 'per_hour', showsPlanningCard: true, hourlyNextDayRate: '40', hourlyNextEveningRate: '', hourlyExternalNextDayRate: '0', hourlyExternalNextEveningRate: '37,5',
  };
  const payload = toResourcePayload(form);
  expect([payload.hourlyNextDayRate, payload.hourlyNextEveningRate, payload.hourlyExternalNextDayRate, payload.hourlyExternalNextEveningRate]).toEqual([40, null, 0, 37.5]);
  expect('hourlyDegressiveTiers' in payload).toBe(false);
  const without = toResourcePayload({ ...form, showsPlanningCard: false });
  expect([without.hourlyNextDayRate, without.hourlyExternalNextEveningRate]).toEqual([null, null]);
  const back = formFromResource({
    id: 1, name: 'Bain', priceType: 'per_hour', hourlyNextDayRate: 40, hourlyNextEveningRate: null, hourlyExternalNextEveningRate: 37.5,
  });
  expect([back.hourlyNextDayRate, back.hourlyNextEveningRate, back.hourlyExternalNextEveningRate]).toEqual(['40', '', '37,5']);
});
