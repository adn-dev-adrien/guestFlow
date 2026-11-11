// specs/inte-performance.md rule 10 — a page's chunk starts at boot for the URL asked, and the main
// pages are fetched when the browser is idle, unless the visitor asked to save data.
import React from 'react';
import { vi } from 'vitest';
import { lazyPage } from '../LazyPage';
import { preloadRoute, prefetchOnIdle } from '../../utils/pagePreload';

const page = () => {
  const loader = vi.fn(() => Promise.resolve({ default: () => null }));
  return Object.assign(lazyPage(loader), { loader });
};

test('rule 10: preload() imports once, however many callers', async () => {
  const Clients = page();
  Clients.preload();
  Clients.preload();
  await Clients.preload();
  expect(Clients.loader).toHaveBeenCalledTimes(1);
});

test('rule 10: a failed preload is forgotten so the real navigation can try again', async () => {
  const loader = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue({ default: () => null });
  const Clients = lazyPage(loader);
  await Clients.preload();
  await Clients.preload();
  expect(loader).toHaveBeenCalledTimes(2);
});

test('rule 10: the route table starts the page whose pattern matches the path, and only that one', () => {
  const home = page(); const detail = page(); const other = page();
  const routes = [['/', home], ['/properties/:id', detail], ['/clients', other]];
  expect(preloadRoute(routes, '/properties/12')).toBe(true);
  expect(detail.loader).toHaveBeenCalledTimes(1);
  expect(home.loader).not.toHaveBeenCalled();
  expect(other.loader).not.toHaveBeenCalled();
  expect(preloadRoute(routes, '/inconnue')).toBe(false);
});

function fakeWindow() {
  const queue = [];
  return {
    requestIdleCallback: (fn) => { queue.push(fn); return queue.length; },
    cancelIdleCallback: vi.fn(),
    run: () => { const fn = queue.shift(); if (fn) fn(); return queue.length; },
  };
}

test('rule 10: idle prefetch imports one page per idle slot', () => {
  const win = fakeWindow();
  const a = page(); const b = page();
  prefetchOnIdle([a, b], { win, nav: {} });
  expect(a.loader).not.toHaveBeenCalled();
  win.run();
  expect(a.loader).toHaveBeenCalledTimes(1);
  expect(b.loader).not.toHaveBeenCalled();
  win.run();
  expect(b.loader).toHaveBeenCalledTimes(1);
});

test('rule 10: nothing is prefetched when the visitor saves data, and cancel stops the rest', () => {
  const win = fakeWindow();
  const a = page();
  prefetchOnIdle([a], { win, nav: { connection: { saveData: true } } });
  win.run();
  expect(a.loader).not.toHaveBeenCalled();
  const b = page();
  const cancel = prefetchOnIdle([b], { win, nav: {} });
  cancel();
  win.run();
  expect(b.loader).not.toHaveBeenCalled();
});

test('rule 10: without requestIdleCallback a timer takes its place', () => {
  vi.useFakeTimers();
  try {
    const a = page();
    prefetchOnIdle([a], { win: window, nav: {} });
    vi.advanceTimersByTime(1500);
    expect(a.loader).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

test('rule 10: a page whose chunk is already loaded renders at once, without suspending', async () => {
  const { render, screen } = await import('@testing-library/react');
  const Clients = lazyPage(() => Promise.resolve({ default: () => <h1>Clients</h1> }));
  await Clients.preload();
  render(<Clients />);
  expect(screen.getByRole('heading', { name: 'Clients' })).toBeInTheDocument();
});
