// specs/ds-tabs.md — PageTabs is the single tab component: one role="tab" per item, the active one
// marked, onChange called with the VALUE (not the event), and an optional badge after the label.
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

test('labels are rendered in their own casing (no uppercase transform in the markup)', () => {
  render(<PageTabs value="general" onChange={() => {}} items={ITEMS} />);
  expect(screen.getByRole('tab', { name: 'Général' })).toHaveTextContent('Général');
});
