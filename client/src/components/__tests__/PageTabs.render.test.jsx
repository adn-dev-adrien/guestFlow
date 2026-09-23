// specs/ds-tabs.md rules 7-8 — what a strip does once it is drawn: one role="tab" per item, the
// active one marked, onChange called with the VALUE (not the event), an optional badge riding after
// the label (rule 8), and an overflow that SCROLLS instead of wrapping or truncating (rule 7).
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import PageTabs from '../PageTabs';

const ITEMS = [
  { value: 'general', label: 'Général' },
  { value: 'tarifs', label: 'Tarifs' },
  { value: 'sejour', label: 'Séjour' },
];

test('renders one tab per item and marks the active one', () => {
  render(<PageTabs value="tarifs" onChange={() => {}} items={ITEMS} ariaLabel="Onglets du logement" />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs).toHaveLength(3);
  expect(screen.getByRole('tablist', { name: 'Onglets du logement' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Tarifs' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Général' })).toHaveAttribute('aria-selected', 'false');
});

test('onChange receives the clicked value', async () => {
  const onChange = vi.fn();
  render(<PageTabs value="general" onChange={onChange} items={ITEMS} />);
  await userEvent.click(screen.getByRole('tab', { name: 'Séjour' }));
  expect(onChange).toHaveBeenCalledWith('sejour');
});

test('a badge rides along with its label (the property « modifié » dot)', () => {
  const items = [
    { value: 'general', label: 'Général', badge: <span aria-label="modifié" /> },
    { value: 'tarifs', label: 'Tarifs' },
  ];
  render(<PageTabs value="general" onChange={() => {}} items={items} />);
  // The tab is still reachable by its label, and the badge is part of it.
  const tab = screen.getByRole('tab', { name: /Général/ });
  expect(tab).toBeInTheDocument();
  expect(tab.querySelector('[aria-label="modifié"]')).not.toBeNull();
  expect(screen.getByRole('tab', { name: 'Tarifs' }).querySelector('[aria-label="modifié"]')).toBeNull();
});

test('rule 7 — the strip scrolls its overflow (never wraps, never truncates)', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ value: `t${i}`, label: `Onglet ${i}` }));
  const { container } = render(<PageTabs value="t0" onChange={() => {}} items={many} />);
  const scroller = container.querySelector('.MuiTabs-scroller');
  expect(scroller.className).toMatch(/MuiTabs-scrollableX/);
  expect(screen.getAllByRole('tab')).toHaveLength(8);
});

test('labels are rendered in their own casing (no uppercase transform in the markup)', () => {
  render(<PageTabs value="general" onChange={() => {}} items={ITEMS} />);
  expect(screen.getByRole('tab', { name: 'Général' })).toHaveTextContent('Général');
});
