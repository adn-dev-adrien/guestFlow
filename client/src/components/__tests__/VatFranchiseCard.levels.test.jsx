// specs/vat-optional-mode.md rules 39-41, §6.7 — the « Seuil de franchise » card renders the server's
// payload: one badge and one sentence per level, last year beside it, an invitation when no threshold is
// set, the way back to VAT when it is crossed, and nothing outside the franchise.
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import VatFranchiseCard from '../VatFranchiseCard';

const BASE = {
  applies: true, year: 2026, asOf: '2026-10-28', threshold: 30000, thresholdSetAt: '2026-03-12',
  collected: 22510.4, projected: 27380.2, ratio: 0.7503, projectedRatio: 0.9127, level: 'ok', tone: 'neutral',
  title: 'Sous le seuil', text: 'Reste 7 490 € avant le seuil.', action: null, previousYear: { year: 2025, collected: 31204.1 },
  settingsPath: '/settings/tva-exercice',
};
const draw = (data, onOpen = () => {}) => render(<ThemeProvider theme={theme}><VatFranchiseCard data={data} onOpen={onOpen} /></ThemeProvider>);
const normal = (text) => text.replace(/[\s  ]/g, ' ');

test('under the threshold: the badge, both figures, the percentage, the sentence and last year', () => {
  draw(BASE);
  expect(screen.getByText('Sous le seuil', { selector: '.MuiChip-label' })).toBeInTheDocument();
  expect(screen.getByText(/Année civile 2026 · tous logements · au 28\/10/)).toBeInTheDocument();
  expect(normal(screen.getByText('Encaissé').nextSibling.textContent)).toBe('22 510 €');
  expect(normal(screen.getByText('Projection au 31/12').nextSibling.textContent)).toBe('27 380 €');
  expect(screen.getByText('75 %')).toBeInTheDocument();
  expect(screen.getByText(/du seuil de/)).toHaveTextContent(/30\s000\s€/);
  expect(screen.getByText('projection 91 %')).toBeInTheDocument();
  expect(screen.getByText('Reste 7 490 € avant le seuil.')).toBeInTheDocument();
  expect(normal(screen.getByText(/^2025 :/).textContent)).toBe('2025 : 31 204 €');
  expect(screen.getByRole('meter', { name: 'Encaissé par rapport au seuil' })).toBeInTheDocument();
});

test('near and projected: a warning badge with the server\'s sentence', () => {
  draw({ ...BASE, level: 'near', tone: 'warning', title: 'Seuil proche', text: 'Reste 4 000 € avant le seuil.' });
  expect(screen.getByText('Seuil proche', { selector: '.MuiChip-label' })).toBeInTheDocument();
  expect(screen.getByText('Reste 4 000 € avant le seuil.')).toBeInTheDocument();
});

test('projection beyond the threshold: its own title and sentence', () => {
  draw({ ...BASE, level: 'projected_over', tone: 'warning', title: 'Projection au-delà du seuil', text: '5 800 € attendus d’ici le 31/12 avec les réservations en cours.' });
  expect(screen.getByText('Projection au-delà du seuil', { selector: '.MuiChip-label' })).toBeInTheDocument();
  expect(screen.getByText(/5 800 € attendus d’ici le 31\/12/)).toBeInTheDocument();
});

test('over: an error badge and « Passer à la TVA… » opens the settings page', async () => {
  const onOpen = vi.fn();
  draw({ ...BASE, collected: 31240, ratio: 1.0413, level: 'over', tone: 'error', title: 'Seuil dépassé', text: '1 240 € au-delà du seuil. Retour à la TVA à prévoir.', action: { label: 'Passer à la TVA…', path: '/settings/tva-exercice' } }, onOpen);
  expect(screen.getByText('Seuil dépassé', { selector: '.MuiChip-label' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Passer à la TVA…' }));
  expect(onOpen).toHaveBeenCalledWith('/settings/tva-exercice');
});

test('no threshold: the figure of the year and « Saisir le seuil », no gauge, no badge', async () => {
  const onOpen = vi.fn();
  draw({ ...BASE, threshold: null, thresholdSetAt: null, ratio: null, projectedRatio: null, level: null, tone: 'neutral', title: null, text: null }, onOpen);
  expect(normal(screen.getByText(/^Encaissé 2026 :/).textContent)).toBe('Encaissé 2026 : 22 510 €');
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  expect(document.querySelector('.MuiChip-root')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Saisir le seuil' }));
  expect(onOpen).toHaveBeenCalledWith('/settings/tva-exercice');
});

test('outside the franchise, or without a payload, nothing is drawn; no last year, no caption', () => {
  const { container, rerender } = draw({ applies: false });
  expect(container).toBeEmptyDOMElement();
  rerender(<ThemeProvider theme={theme}><VatFranchiseCard data={null} onOpen={() => {}} /></ThemeProvider>);
  expect(container).toBeEmptyDOMElement();
  rerender(<ThemeProvider theme={theme}><VatFranchiseCard data={{ ...BASE, previousYear: null }} onOpen={() => {}} /></ThemeProvider>);
  expect(screen.queryByText(/^2025 :/)).not.toBeInTheDocument();
});
