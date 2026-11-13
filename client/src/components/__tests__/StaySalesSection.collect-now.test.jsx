// specs/pricing-components.md §3 rules 32 and 85, PR C mock M3 (docs/rapports/2026-11-13-m3-sas-sur-lignes.html) — the departure sales of the arrival SAS
// can be collected now, line by line or all at once; the lines already paid fold; a line a reopened SAS appended says so.
import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import StaySalesSection from '../StaySalesSection';

const section = {
  title: 'Ventes du séjour — au départ',
  lines: [
    { ref: 'option:7', label: 'Bûches', totalCents: 1200, statusLabel: 'À payer au départ', sourceLabel: 'Fiche', block: 'due' },
    { ref: 'option:9', label: 'Limonade artisanale avec un intitulé volontairement très long pour vérifier le retour à la ligne', totalCents: 800, statusLabel: 'À payer au départ', sourceLabel: 'Boutique', block: 'due', addedOnReopen: true },
    { ref: 'option:8', label: 'Bière locale', totalCents: 1300, statusLabel: 'Payée par carte le 12/11', sourceLabel: 'SAS', block: 'paid' },
  ],
  groups: [],
  totalCents: 3300,
  dueCents: 2000,
};

test('each line still to collect offers « Percevoir maintenant » and the handler gets that line only', async () => {
  const onCollectNow = vi.fn().mockResolvedValue();
  render(<StaySalesSection section={section} onCollectNow={onCollectNow} />);
  const buttons = screen.getAllByRole('button', { name: 'Percevoir maintenant' });
  expect(buttons).toHaveLength(2);
  await userEvent.click(buttons[0]);
  expect(onCollectNow).toHaveBeenCalledWith(['option:7']);
});

test('« Tout percevoir maintenant » collects every line still due, and the buttons wait for the answer', async () => {
  let release;
  const onCollectNow = vi.fn(() => new Promise((resolve) => { release = resolve; }));
  render(<StaySalesSection section={section} onCollectNow={onCollectNow} />);
  await userEvent.click(screen.getByRole('button', { name: 'Tout percevoir maintenant' }));
  expect(onCollectNow).toHaveBeenCalledWith(['option:7', 'option:9']);
  expect(screen.getByRole('button', { name: 'Tout percevoir maintenant' })).toBeDisabled();
  release();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Tout percevoir maintenant' })).toBeEnabled());
});

test('a single line due shows no « Tout percevoir maintenant »; the paid lines fold under « Déjà payé » and offer nothing', () => {
  const one = { ...section, lines: [section.lines[0], section.lines[2]], dueCents: 1200 };
  const { container } = render(<StaySalesSection section={one} onCollectNow={vi.fn()} />);
  expect(screen.queryByRole('button', { name: 'Tout percevoir maintenant' })).toBeNull();
  const folded = container.querySelector('details');
  expect(folded).not.toBeNull();
  expect(folded.open).toBe(false);
  expect(within(folded).getByText(/Déjà payé · 1 ligne/)).toBeInTheDocument();
  expect(within(folded).queryByRole('button')).toBeNull();
});

test('a line appended by a reopened SAS carries the chip, a long name still wraps', () => {
  render(<StaySalesSection section={section} onCollectNow={vi.fn()} />);
  expect(screen.getAllByText('Ajoutée à la réouverture')).toHaveLength(1);
  expect(screen.getByText(/très long/)).toBeInTheDocument();
});

test('without a handler the section is a read-only list: no button', () => {
  render(<StaySalesSection section={section} />);
  expect(screen.queryByRole('button')).toBeNull();
});
