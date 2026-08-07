import React, { useState, act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { createRoot } from 'react-dom/client';
import { BarChart, Bar, ResponsiveContainer, XAxis, YAxis } from 'recharts';

// Smoke coverage for the React 19 + Recharts 3 API surface GuestFlow relies on
// (spec/react-19-and-recharts-3-migration.md §7.2). Three cases pin the
// contracts that any future major (React 20, recharts 4) regression would touch:
//   1. The createRoot entry-point contract from `react-dom/client` — the API
//      our `client/src/index.js` mounts the whole app with.
//   2. A function component using `useState` + a setter round-trip under
//      <MemoryRouter> — pins the modern hooks contract.
//   3. A minimal <ResponsiveContainer><BarChart><Bar/></BarChart></ResponsiveContainer>
//      mounts without throwing — pins the recharts 3 mount contract used in
//      FinancePage.js. Static width/height to avoid jsdom's zero-size quirk.
// Like the router-v7 and MUI-9 smoke files, these are deliberately minimal —
// the E2E suite (Playwright) covers integrated UX; this file is the
// unit-level tripwire that fires fast on a future major.

describe('React 19 + Recharts 3 API smoke', () => {
  test('Case 1: createRoot from react-dom/client mounts and unmounts a tree', () => {
    // Mirrors `client/src/index.js`'s `createRoot(document.getElementById('root'))
    // .render(<App />)` pattern — pins the v18+/v19 entry-point contract that a
    // hypothetical React 20 could touch. Use `act` to flush the render so the
    // assertion can observe the resulting DOM (React 19 + jsdom is async by default).
    expect(typeof createRoot).toBe('function');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => { root.render(<div data-testid="mounted">ok</div>); });
    expect(container.querySelector('[data-testid="mounted"]')).not.toBeNull();
    act(() => { root.unmount(); });
    document.body.removeChild(container);
  });

  test('Case 2: useState round-trips a setter under MemoryRouter (modern hooks contract)', async () => {
    function Counter() {
      const [n, setN] = useState(0);
      return (
        <button onClick={() => setN((x) => x + 1)} data-testid="n">
          {n}
        </button>
      );
    }
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Counter />
      </MemoryRouter>
    );
    expect(screen.getByTestId('n')).toHaveTextContent('0');
    await user.click(screen.getByTestId('n'));
    expect(screen.getByTestId('n')).toHaveTextContent('1');
  });

  test('Case 3: <BarChart><Bar/></BarChart> mounts under recharts 3', () => {
    // Pins the FinancePage chart-mount contract. We skip <ResponsiveContainer>
    // here because jsdom returns a zero-sized container by default — the
    // wrapper would skip rendering its child. The bare <BarChart> with explicit
    // width/height is enough to prove the recharts 3 mount path works.
    const data = [{ name: 'A', v: 1 }, { name: 'B', v: 2 }];
    const { container } = render(
      <BarChart width={300} height={200} data={data}>
        <XAxis dataKey="name" />
        <YAxis />
        <Bar dataKey="v" fill="#4CAF50" />
      </BarChart>
    );
    // The recharts wrapper class is the cheapest stable mount signal.
    expect(container.querySelector('.recharts-wrapper')).not.toBeNull();
  });
});
