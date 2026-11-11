// specs/calendar-property-parity.md rules 13-15 — one fetch per month, a stale answer is dropped, a scope
// change empties the cache and keeps the month in view, a failed month retries alone, « Aujourd'hui » goes
// back to the current month.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import InfiniteMonthScroller from '../InfiniteMonthScroller';
import useMonthDataCache from '../../hooks/useMonthDataCache';

function Harness({ scope = 'a', loadMonth, initialMonth }) {
  const cache = useMonthDataCache(scope, loadMonth);
  return (
    <ThemeProvider theme={theme}>
      <InfiniteMonthScroller
        cache={cache}
        initialMonth={initialMonth}
        renderMonth={({ year, month, data }) => <div data-testid={`m-${year}-${month}`}>{data ? data.text : 'vide'}</div>}
      />
    </ThemeProvider>
  );
}

describe('InfiniteMonthScroller + useMonthDataCache', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-16T12:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  it('rule 15 — each month is fetched once, however often the view re-renders', async () => {
    const loadMonth = vi.fn(async (y, m) => ({ text: `${y}-${m}` }));
    const { rerender } = render(<Harness loadMonth={loadMonth} />);
    await waitFor(() => expect(screen.getByTestId('m-2026-6')).toHaveTextContent('2026-6'));
    rerender(<Harness loadMonth={loadMonth} />);
    rerender(<Harness loadMonth={loadMonth} />);
    const keys = loadMonth.mock.calls.map(([y, m]) => `${y}-${m}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['2026-5', '2026-6', '2026-7']));
  });

  it('rule 15 — an answer for a scope that is no longer shown is dropped', async () => {
    const pending = {};
    const loadMonth = vi.fn((y, m, signal) => new Promise((resolve) => { pending[`${loadMonth.scope}-${y}-${m}`] = { resolve, signal }; }));
    loadMonth.scope = 'a';
    const { rerender } = render(<Harness scope="a" loadMonth={loadMonth} />);
    await waitFor(() => expect(pending['a-2026-6']).toBeDefined());
    loadMonth.scope = 'b';
    rerender(<Harness scope="b" loadMonth={loadMonth} />);
    await waitFor(() => expect(pending['b-2026-6']).toBeDefined());
    expect(pending['a-2026-6'].signal.aborted).toBe(true);
    await act(async () => { pending['a-2026-6'].resolve({ text: 'ancien' }); });
    expect(screen.getByTestId('m-2026-6')).toHaveTextContent('vide');
    await act(async () => { pending['b-2026-6'].resolve({ text: 'nouveau' }); });
    expect(screen.getByTestId('m-2026-6')).toHaveTextContent('nouveau');
  });

  it('rule 15 — a scope change empties the cache and opens on the month that was in view', async () => {
    const loadMonth = vi.fn(async (y, m) => ({ text: `${y}-${m}` }));
    const { rerender } = render(<Harness scope="a" loadMonth={loadMonth} initialMonth={{ year: 2026, month: 2 }} />);
    await waitFor(() => expect(screen.getByTestId('m-2026-2')).toHaveTextContent('2026-2'));
    const before = loadMonth.mock.calls.length;
    rerender(<Harness scope="b" loadMonth={loadMonth} initialMonth={{ year: 2026, month: 2 }} />);
    await waitFor(() => expect(loadMonth.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByTestId('m-2026-2')).toHaveTextContent('2026-2'));
    expect(screen.queryByTestId('m-2026-6')).toBeNull();
  });

  it('a failed month shows a retry, the others render; the retry reloads that month only', async () => {
    let fail = true;
    const loadMonth = vi.fn(async (y, m) => {
      if (m === 6 && fail) throw new Error('boom');
      return { text: `${y}-${m}` };
    });
    render(<Harness loadMonth={loadMonth} />);
    expect(await screen.findByText("Ce mois n'a pas pu être chargé.")).toBeInTheDocument();
    expect(screen.getByTestId('m-2026-5')).toHaveTextContent('2026-5');
    fail = false;
    const calls = loadMonth.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.getByTestId('m-2026-6')).toHaveTextContent('2026-6'));
    expect(loadMonth.mock.calls.length).toBe(calls + 1);
  });

  it('rule 14 — « Aujourd\'hui » is the only navigation and brings the current month back', async () => {
    const loadMonth = vi.fn(async (y, m) => ({ text: `${y}-${m}` }));
    render(<Harness loadMonth={loadMonth} initialMonth={{ year: 2026, month: 2 }} />);
    await waitFor(() => expect(screen.getByTestId('m-2026-2')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Mois (précédent|suivant)/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Aujourd'hui/ }));
    await waitFor(() => expect(screen.getByTestId('m-2026-6')).toBeInTheDocument());
  });
});
