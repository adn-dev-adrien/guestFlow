// specs/inte-performance.md rules 2–3 — pages load on demand inside the shell; a failed chunk reloads
// once, then shows « Page indisponible. » with « Recharger ».
import React, { lazy } from 'react';
import { vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import LazyPage, { lazyPage } from '../LazyPage';

const reload = vi.fn();
const original = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  Object.defineProperty(window, 'location', { configurable: true, value: { ...original, pathname: '/clients', reload } });
});
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: original });
  vi.useRealTimers();
});

const Shell = ({ children }) => <div><nav>Menu</nav><main>{children}</main></div>;
const Page = ({ title }) => <h1>{title}</h1>;
const deferred = () => {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('rule 2: the shell stays while the chunk loads, the spinner only after 150 ms, then the page', async () => {
  vi.useFakeTimers();
  const chunk = deferred();
  const Clients = lazyPage(() => chunk.promise);
  render(<Shell><Clients title="Clients" /></Shell>);
  expect(screen.getByText('Menu')).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(150); });
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  expect(screen.getByText('Menu')).toBeInTheDocument();
  await act(async () => { chunk.resolve({ default: Page }); });
  expect(screen.getByRole('heading', { name: 'Clients' })).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('rule 2: a failed chunk reloads the page once', async () => {
  const Broken = lazyPage(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
  render(<Shell><Broken /></Shell>);
  await act(async () => { await Promise.resolve(); });
  expect(reload).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem('guestflow.chunkReloaded')).toBe('/clients');
  expect(screen.queryByText('Page indisponible.')).not.toBeInTheDocument();
});

test('rule 2: the second failure shows the error with « Recharger », and the menu stays', async () => {
  sessionStorage.setItem('guestflow.chunkReloaded', '/clients');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = lazyPage(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
  render(<Shell><Broken /></Shell>);
  expect(await screen.findByText('Page indisponible.')).toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
  expect(screen.getByText('Menu')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Recharger' }));
  expect(reload).toHaveBeenCalledTimes(1);
});

test('rule 18: the route that renders clears its own reload flag, so a later release can reload again', async () => {
  sessionStorage.setItem('guestflow.chunkReloaded', '/clients');
  const Clients = lazyPage(() => Promise.resolve({ default: Page }));
  render(<Shell><Clients title="Clients" /></Shell>);
  expect(await screen.findByRole('heading', { name: 'Clients' })).toBeInTheDocument();
  expect(sessionStorage.getItem('guestflow.chunkReloaded')).toBeNull();
});

test('rule 3: a plugin route goes through the same boundary', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const PluginPage = lazy(() => Promise.resolve({ default: Page }));
  const BrokenPlugin = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
  const { unmount } = render(<Shell><LazyPage><PluginPage title="Plugin" /></LazyPage></Shell>);
  expect(await screen.findByRole('heading', { name: 'Plugin' })).toBeInTheDocument();
  unmount();
  sessionStorage.setItem('guestflow.chunkReloaded', '/clients');
  render(<Shell><LazyPage><BrokenPlugin /></LazyPage></Shell>);
  expect(await screen.findByText('Page indisponible.')).toBeInTheDocument();
});

test('rule 3: a plugin chunk failing for the first time reloads once as well', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const BrokenPlugin = lazy(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
  render(<Shell><LazyPage><BrokenPlugin /></LazyPage></Shell>);
  await act(async () => { await Promise.resolve(); });
  expect(reload).toHaveBeenCalledTimes(1);
});

test('a render crash of a page is not a chunk failure: it reaches the app error boundary', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Crashing = lazyPage(() => Promise.resolve({ default: () => { throw new Error('boom'); } }));
  class Catcher extends React.Component {
    state = { error: null };
    static getDerivedStateFromError(error) { return { error }; }
    render() { return this.state.error ? <p>caught: {this.state.error.message}</p> : this.props.children; }
  }
  render(<Catcher><Crashing /></Catcher>);
  expect(await screen.findByText('caught: boom')).toBeInTheDocument();
  expect(reload).not.toHaveBeenCalled();
});

test('rule 18: a prefetch that succeeds does not clear the flag of a route that keeps failing: one reload, then the error', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = lazyPage(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
  const Other = lazyPage(() => Promise.resolve({ default: Page }));
  const first = render(<Shell><Broken /></Shell>);
  await act(async () => { await Promise.resolve(); });
  expect(reload).toHaveBeenCalledTimes(1);
  first.unmount();
  // What happens after the reload: another page is prefetched while the failing one is asked for again.
  await Other.preload();
  render(<Shell><Broken /></Shell>);
  expect(await screen.findByText('Page indisponible.')).toBeInTheDocument();
  expect(reload).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem('guestflow.chunkReloaded')).toBe('/clients');
});

test('rule 18: the flag of another route does not stop the reload of this one', async () => {
  sessionStorage.setItem('guestflow.chunkReloaded', '/planning');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Broken = lazyPage(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
  render(<Shell><Broken /></Shell>);
  await act(async () => { await Promise.resolve(); });
  expect(reload).toHaveBeenCalledTimes(1);
});
