// specs/shell-and-home-day-first.md rule 15 — on a phone the page title lives in the top bar: the page
// bar publishes it and never draws it on xs, and a bar left with nothing to show is not drawn.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { vi } from 'vitest';
import theme from '../../theme';
import PageActionBar from '../PageActionBar';
import { PageTitleProvider, usePageTitle } from '../../hooks/usePageTitle';

function TopBarTitle() {
  return <span data-testid="top-bar-title">{usePageTitle() || ''}</span>;
}

// MUI reads breakpoints through matchMedia: « phone » answers every max-width query below 600 px.
function emulate(phone) {
  window.matchMedia = vi.fn((query) => ({
    matches: phone && /max-width:\s*599/.test(query),
    media: query,
    onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
}

const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; });

function renderPage(bar) {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <PageTitleProvider>
          <TopBarTitle />
          {bar}
        </PageTitleProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

test('rule 15: the bar publishes its title to the top bar, and hides its own copy on xs', () => {
  emulate(true);
  renderPage(<PageActionBar title="Devis" actionsBefore={[{ icon: <span>+</span>, tooltip: 'Nouveau devis', onClick: () => {} }]} />);
  expect(screen.getByTestId('top-bar-title')).toHaveTextContent('Devis');
  // jsdom applies no media query: pin the emitted rule (none from 0, block from 600 px).
  const own = screen.getByRole('heading', { name: 'Devis', hidden: true });
  const cls = [...own.classList].filter((c) => c.startsWith('css-')).pop();
  const css = [...document.querySelectorAll('style')].map((el) => el.textContent).join('\n');
  expect(css).toMatch(new RegExp(`@media \\(min-width:0px\\)\\{\\.${cls}\\{display:none;`));
  expect(css).toMatch(new RegExp(`@media \\(min-width:600px\\)\\{\\.${cls}\\{display:block;`));
  expect(screen.getByRole('button', { name: 'Nouveau devis' })).toBeInTheDocument();
});

test('rule 15: on xs a bar with no back, subtitle, tabs nor action is not drawn — the title still reaches the top bar', () => {
  emulate(true);
  renderPage(<PageActionBar title="Établissement" center={<span>centre</span>} />);
  expect(screen.queryByTestId('page-action-bar-row')).not.toBeInTheDocument();
  expect(screen.getByTestId('top-bar-title')).toHaveTextContent('Établissement');
});

test('rule 15: from sm nothing changes — the bar draws its title', () => {
  emulate(false);
  renderPage(<PageActionBar title="Établissement" />);
  expect(screen.getByTestId('page-action-bar-row')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Établissement' })).toBeInTheDocument();
});

test('rule 15: leaving the page clears the published title', () => {
  emulate(true);
  const { rerender } = renderPage(<PageActionBar title="Devis" />);
  expect(screen.getByTestId('top-bar-title')).toHaveTextContent('Devis');
  rerender(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <PageTitleProvider><TopBarTitle /></PageTitleProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  expect(screen.getByTestId('top-bar-title')).toHaveTextContent('');
});
