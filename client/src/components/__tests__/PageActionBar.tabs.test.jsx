// specs/ds-tabs.md rules 2-3 — a page hands its PageTabs to the bar's `tabs` slot: the tabs live in
// the bar (one single instance in the DOM), and their presence forces the title to show on xs so a
// mobile bar can never be an anonymous row of actions again.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import PageActionBar from '../PageActionBar';
import PageTabs from '../PageTabs';

const ITEMS = [
  { value: 'options', label: 'Options' },
  { value: 'resources', label: 'Ressources' },
];

function renderBar(props = {}) {
  return render(
    <MemoryRouter>
      <PageActionBar title="Options de séjour" {...props} />
    </MemoryRouter>,
  );
}

test('the tabs node is rendered inside the bar, exactly once', () => {
  renderBar({ tabs: <PageTabs value="options" onChange={() => {}} items={ITEMS} /> });
  expect(screen.getAllByRole('tablist')).toHaveLength(1);
  expect(screen.getByRole('tab', { name: 'Options' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Ressources' })).toBeInTheDocument();
});

test('tabs imply the title on xs — it is rendered without passing titleOnXs', () => {
  renderBar({ tabs: <PageTabs value="options" onChange={() => {}} items={ITEMS} /> });
  const title = screen.getByText('Options de séjour');
  expect(title).toBeInTheDocument();
  // `display: none` on xs is what used to hide it; with tabs the xs breakpoint keeps it visible.
  expect(title).not.toHaveStyle({ display: 'none' });
});

test('a bar without tabs is unchanged (no tablist)', () => {
  renderBar({ onSave: () => {} });
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();
});
