// specs/ds-tabs.md rules 2-3 — a page hands its PageTabs to the bar's `tabs` slot: the tabs live in
// the bar (one single instance in the DOM). Since 2026-10-19 the title of a phone is the top bar's
// (specs/shell-and-home-day-first.md rule 15), so a mobile bar is never anonymous, tabs or not.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import PageActionBar from '../PageActionBar';
import PageTabs from '../PageTabs';
import { PageTitleProvider, usePageTitle } from '../../hooks/usePageTitle';

function TopBarTitle() {
  return <span data-testid="top-bar-title">{usePageTitle()}</span>;
}

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

test('with tabs the page is still named on a phone — by the top bar, which the bar feeds', () => {
  render(
    <MemoryRouter>
      <PageTitleProvider>
        <TopBarTitle />
        <PageActionBar title="Options de séjour" tabs={<PageTabs value="options" onChange={() => {}} items={ITEMS} />} />
      </PageTitleProvider>
    </MemoryRouter>,
  );
  expect(screen.getByTestId('top-bar-title')).toHaveTextContent('Options de séjour');
});

test('a bar without tabs is unchanged (no tablist)', () => {
  renderBar({ onSave: () => {} });
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();
});

// specs/ds-tabs.md rule 11 — beside tabs the row does not wrap on sm+: the tabs shrink and scroll in
// the room the title and the actions leave, so Save / Cancel never drop onto a row of their own; a
// bar under 720 px still gives the tabs a second row.
test('rule 11: beside tabs the row never wraps on sm+, and the tabs shrink to the room left', () => {
  renderBar({ onSave: () => {}, tabs: <PageTabs value="options" onChange={() => {}} items={ITEMS} /> });
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  expect(css).toMatch(/@media \(min-width: ?600px\)\s*\{[^}]*flex-wrap:\s*nowrap/);
  expect(css).toMatch(/@container \(max-width: ?719\.98px\)\s*\{[^}]*flex-wrap:\s*wrap/);
  expect(getComputedStyle(screen.getByRole('tablist').closest('.MuiTabs-root')).maxWidth).toBe('100%');
});
