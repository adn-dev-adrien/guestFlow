// specs/plugins-phase-3c-hourly-resources.md rule 21 — the hourly block of the resource form, drawn
// by the plugin through `resources.fields`.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import HourlyResourceFields from '../HourlyResourceFields';

const DRAFT = { priceType: 'per_hour', price: 30, isComplex: false, minimumUsageMinutes: 60 };

test('the slots appear once the resource is slotted, and every change is a patch', () => {
  const onChange = vi.fn();
  const { rerender } = render(<HourlyResourceFields draft={DRAFT} onChange={onChange} />);
  expect(screen.queryByLabelText("Heure d'ouverture")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('switch', { name: /Ressource à créneaux/ }));
  expect(onChange).toHaveBeenCalledWith({ isComplex: true });

  rerender(<HourlyResourceFields draft={{ ...DRAFT, isComplex: true }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Montée en chauffe (min)'), { target: { value: '-30' } });
  expect(onChange).toHaveBeenLastCalledWith({ heatUpMinutes: 0 });
});

test('the evening and external rates come with the planning card', () => {
  const onChange = vi.fn();
  render(<HourlyResourceFields draft={{ ...DRAFT, isComplex: true, showsPlanningCard: true }} onChange={onChange} />);
  expect(screen.getByText('Tarif de jour : le prix général (30 €/h).')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Tarif horaire soir (€/h)'), { target: { value: '50' } });
  expect(onChange).toHaveBeenLastCalledWith({ hourlyEveningRate: 50 });
});
