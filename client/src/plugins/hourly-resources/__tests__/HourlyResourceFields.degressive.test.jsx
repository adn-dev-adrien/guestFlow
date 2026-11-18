// specs/gift-voucher-campaigns.md rule 43 — the degressivity table editor in the hourly block of the resource form.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

import HourlyResourceFields from '../HourlyResourceFields';

const DRAFT = {
  priceType: 'per_hour', price: 50, isComplex: true, showsPlanningCard: true, minimumUsageMinutes: 60,
};

test('an empty table says every hour is at the same rate and a row can be added', () => {
  const onChange = vi.fn();
  render(<HourlyResourceFields draft={{ ...DRAFT, hourlyDegressiveTiers: [] }} onChange={onChange} />);
  expect(screen.getByText('Aucune remise : chaque heure au même tarif.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
  expect(onChange).toHaveBeenLastCalledWith({ hourlyDegressiveTiers: [{ fromHour: 2, percent: 0 }] });
});

test('a row is edited and removed as a patch, the next row starts one hour later', () => {
  const onChange = vi.fn();
  const tiers = [{ fromHour: 2, percent: 10 }, { fromHour: 3, percent: 20 }];
  render(<HourlyResourceFields draft={{ ...DRAFT, hourlyDegressiveTiers: tiers }} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText('Ligne 2 · remise'), { target: { value: '25' } });
  expect(onChange).toHaveBeenLastCalledWith({ hourlyDegressiveTiers: [tiers[0], { fromHour: 3, percent: 25 }] });
  fireEvent.click(screen.getByRole('button', { name: 'Retirer la ligne 1' }));
  expect(onChange).toHaveBeenLastCalledWith({ hourlyDegressiveTiers: [tiers[1]] });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter une ligne' }));
  expect(onChange).toHaveBeenLastCalledWith({ hourlyDegressiveTiers: [...tiers, { fromHour: 4, percent: 0 }] });
});

test('a draft without the field (an older payload) still renders the editor empty', () => {
  render(<HourlyResourceFields draft={DRAFT} onChange={vi.fn()} />);
  expect(screen.getByText('Dégressivité par heure')).toBeInTheDocument();
});
