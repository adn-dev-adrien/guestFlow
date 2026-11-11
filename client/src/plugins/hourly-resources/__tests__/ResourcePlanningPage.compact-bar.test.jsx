// specs/ds-components.md rule 24 — review #8, m-7: at 900 px the bar showed « P. » and a clipped
// « Nouvell / réservati » button. Below lg (1200 px) the bar also carries the week controls, so the
// button becomes its « + » icon with the label as tooltip; from lg up it keeps its text.
import React from 'react';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../../theme';
import DialogProvider from '../../../components/DialogProvider';

vi.mock('../../../api', () => ({
  __esModule: true,
  default: {
    getResources: vi.fn().mockResolvedValue([{ id: 3, name: 'Bain nordique', isComplex: 1, openTime: '08:00', closeTime: '22:00' }]),
    getResourceBookings: vi.fn().mockResolvedValue([]),
  },
}));

import ResourcePlanningPage from '../ResourcePlanningPage';

const viewport = (width) => {
  window.matchMedia = (query) => {
    const min = /min-width:\s*([\d.]+)px/.exec(query);
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const matches = (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return {
      matches, media: query, onchange: null, dispatchEvent: () => false,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
    };
  };
};
afterEach(() => { delete window.matchMedia; });

const renderPage = () => render(
  <MemoryRouter>
    <ThemeProvider theme={theme}><DialogProvider><ResourcePlanningPage /></DialogProvider></ThemeProvider>
  </MemoryRouter>,
);

test('rule 24 — at 900 px « Nouvelle réservation » is an icon button', async () => {
  viewport(900);
  renderPage();
  const button = await screen.findByRole('button', { name: 'Nouvelle réservation' });
  expect(button).not.toHaveTextContent('Nouvelle réservation');
});

test('rule 24 — at 1280 px it keeps its label', async () => {
  viewport(1280);
  renderPage();
  const button = await screen.findByRole('button', { name: 'Nouvelle réservation' });
  expect(button).toHaveTextContent('Nouvelle réservation');
});
