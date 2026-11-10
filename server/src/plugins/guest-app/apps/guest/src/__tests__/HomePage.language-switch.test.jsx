// specs/guest-app.md rule 19 (audit R36-C-L1) — « EN » on the home reads the orders and the booklet again IN ENGLISH:
// the home's own reads ran before the session set the API's language, so they asked in the old one and nothing read
// them again (« Sur votre note » stayed on an English home).
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { baseRoutes, renderApp, stubApi } from './guestFixtures';

it('rule 19: after « EN », the orders and the booklet are read with lang=en', async () => {
  const { calls } = stubApi(baseRoutes());
  renderApp('/');
  await screen.findByRole('heading', { name: 'Bonjour Marie' });
  const before = calls.length;
  fireEvent.click(screen.getByRole('button', { name: /^EN,/ }));
  await waitFor(() => {
    const after = calls.slice(before);
    expect(after.some((c) => c.path === '/orders' && /lang=en/.test(c.url))).toBe(true);
    expect(after.some((c) => c.path === '/booklet' && /lang=en/.test(c.url))).toBe(true);
  });
  const stale = calls.slice(before).filter((c) => ['/orders', '/booklet'].includes(c.path) && !/lang=en/.test(c.url));
  expect(stale).toEqual([]);
});
