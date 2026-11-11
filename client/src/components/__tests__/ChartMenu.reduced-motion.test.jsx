/**
 * specs/report-grammar.md §3 rule 33 — under prefers-reduced-motion the « ⋯ » menu opens at once,
 * with no grow animation.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ChartMenu from '../ChartMenu';

// jsdom lays nothing out: give the menu paper a height so MUI's « auto » duration is not 0 ms.
let height;
beforeEach(() => { height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300); });
afterEach(() => { delete window.matchMedia; height.mockRestore(); });

const mockReduce = (reduce) => Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn((q) => ({
    matches: reduce && q.includes('prefers-reduced-motion'), media: q, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })),
});

test('rule 33 — reduced motion: the menu paper has no transition', async () => {
  mockReduce(true);
  render(<ChartMenu view="chart" onViewChange={() => {}} getCsv={() => ''} />);
  await userEvent.click(screen.getByRole('button', { name: 'Options du graphique' }));
  const paper = screen.getByRole('menu').closest('.MuiPaper-root');
  expect(paper.style.transition).toMatch(/opacity 0ms/);
});

test('rule 33 — otherwise the menu grows in', async () => {
  mockReduce(false);
  render(<ChartMenu view="chart" onViewChange={() => {}} getCsv={() => ''} />);
  await userEvent.click(screen.getByRole('button', { name: 'Options du graphique' }));
  const paper = screen.getByRole('menu').closest('.MuiPaper-root');
  expect(paper.style.transition).toMatch(/opacity [1-9][0-9]*ms/);
});
