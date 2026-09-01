import { vi } from 'vitest';
/**
 * Regression test for AccountingPage — the client-name in each journal entry card must be a
 * clickable link to the reservation file when the current user is admin.
 *
 * History of the regression this test pins down:
 *   - Pre-admin-account-management refactor: the session carried `user.role = 'admin'` (string).
 *     AccountingPage read `user?.role === 'admin'` to gate the link.
 *   - Post-refactor: sessions carry `user.roles = ['admin']` (array). `user.role` is undefined.
 *     The gate silently flipped to false → link never rendered → Adrien lost the ability to jump
 *     from a journal entry to its reservation file.
 *
 * The fix uses the central `userHasRole(user, ADMIN)` helper (constants/roles.js), which:
 *   - reads `user.roles` (array) for the new shape, and
 *   - has a back-compat shim for the old string `user.role` so in-flight sessions still work.
 *
 * This test exercises both shapes so a future refactor that breaks either path is caught.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import theme from '../../theme';
import DialogProvider from '../../components/DialogProvider';

// Mock the API + auth BEFORE importing AccountingPage so the page picks up the mocks.
vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getAccountingPlatforms: vi.fn(),
    getAccountingSales: vi.fn(),
    downloadAccountingSalesCsv: vi.fn(),
    // specs/cancellation-compensation.md §6.3 — the page now mounts the compensations card.
    getCancellationCompensations: vi.fn(() => Promise.resolve({ pending: [], received: [], totals: { pendingExpected: 0, receivedInMonth: 0 } })),
  },
}));
vi.mock('../../hooks/useAuth', () => ({
  __esModule: true,
  useAuth: vi.fn(),
}));

import api from '../../api';
import { useAuth } from '../../hooks/useAuth';
import AccountingPage from '../AccountingPage';

function setAuth(user) {
  useAuth.mockReturnValue({ user });
}

// Minimal sales fixture — one entry with one journal line. Enough for the page to render the
// JournalEntryCard whose libellé is what we assert on.
const SAMPLE_SALES = {
  totals: { entriesCount: 1, allBalanced: true, totalDebits: 100 },
  entries: [
    {
      reservationId: 42,
      kind: 'balance',
      day: 15,
      month: 8,
      year: 2026,
      libelle: 'Jean Dupont',
      encaissementTtc: 100,
      finalPrice: 100,
      fraction: 1,
      balanced: true,
      sumDebits: 100,
      sumCredits: 100,
      platform: { platform: null, gross: null, commission: null },
      lines: [
        { type: 'client',  compte: 'CDUPONJ', libelle: 'Jean Dupont', debit: 100, credit: null },
        { type: 'revenue', compte: '706000',  libelle: 'Hébergement', debit: null, credit: 100 },
      ],
    },
  ],
};

const SAMPLE_PLATFORMS = { rows: [], totalCommission: 0 };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/comptabilite?month=8&year=2026']}>
      <ThemeProvider theme={theme}><DialogProvider><AccountingPage /></DialogProvider></ThemeProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.getAccountingPlatforms.mockReset();
  api.getAccountingSales.mockReset();
  api.downloadAccountingSalesCsv.mockReset();
  api.getAccountingPlatforms.mockResolvedValue(SAMPLE_PLATFORMS);
  api.getAccountingSales.mockResolvedValue(SAMPLE_SALES);
});

describe('AccountingPage — clickable client name in journal entries', () => {
  // specs/accountant-accounting-export.md rule 25
  test('admin (new roles array shape): client name is a link to the reservation', async () => {
    setAuth({ id: 1, email: 'adrien@example.com', roles: ['admin'] });
    renderPage();

    // Wait for the fetched sales fixture to render.
    const link = await screen.findByRole('link', { name: 'Jean Dupont' });
    expect(link).toHaveAttribute('href', '/reservations/42');
  });

  test('admin (legacy string role shape — back-compat shim): client name is still a link', async () => {
    // Pre-M2 sessions persisted before the multi-role refactor still carry `role: 'admin'`
    // (string). `userHasRole` has a back-compat shim for this; the link must still render.
    setAuth({ id: 1, email: 'adrien@example.com', role: 'admin' });
    renderPage();

    const link = await screen.findByRole('link', { name: 'Jean Dupont' });
    expect(link).toHaveAttribute('href', '/reservations/42');
  });

  test('admin + accountant (multi-role): client name is still a link (admin wins)', async () => {
    setAuth({ id: 1, email: 'a@b.c', roles: ['admin', 'accountant'] });
    renderPage();

    const link = await screen.findByRole('link', { name: 'Jean Dupont' });
    expect(link).toHaveAttribute('href', '/reservations/42');
  });

  // specs/accountant-accounting-export.md rule 25
  test('accountant-only: NO link rendered for the client name', async () => {
    // Server already 403s `/api/reservations/:id` for accountants, but the UI hides the link too
    // so the click leads nowhere instead of a refused fetch. Note: "Jean Dupont" appears twice
    // in the DOM (header + journal line libellé) so we don't assert with getByText (would throw
    // on multiple matches) — the link absence is what actually pins the regression.
    setAuth({ id: 2, email: 'compta@example.com', roles: ['accountant'] });
    renderPage();

    // Wait for the JournalEntryCard to render — "Équilibré" is the chip that surfaces once
    // `sales` resolves, so its presence proves the card has been rendered.
    await screen.findByText('Équilibré');
    expect(screen.queryByRole('link', { name: 'Jean Dupont' })).not.toBeInTheDocument();
  });

  test('no user (logged out): NO link rendered for the client name', async () => {
    setAuth(null);
    renderPage();

    await screen.findByText('Équilibré');
    expect(screen.queryByRole('link', { name: 'Jean Dupont' })).not.toBeInTheDocument();
  });

  test('user with empty roles array: NO link rendered (defense in depth)', async () => {
    setAuth({ id: 3, email: 'broken@example.com', roles: [] });
    renderPage();

    await screen.findByText('Équilibré');
    expect(screen.queryByRole('link', { name: 'Jean Dupont' })).not.toBeInTheDocument();
  });
});

// specs/accountant-accounting-export.md rule 27 — sous le montant de chaque carte, la part du séjour
// que cet encaissement représente et le total du séjour. Sans ce contexte, une carte à 100 € ne dit
// pas si c'est un acompte de 30 % ou la totalité : le comptable ne peut pas la rapprocher.
describe('AccountingPage — le contexte de chaque carte', () => {
  test('rule 27 — la carte annonce la part du séjour et le total', async () => {
    setAuth({ id: 1, roles: ['admin'] });
    renderPage();
    expect(await screen.findByText(/100 % du séjour \(100,00 €\)/)).toBeInTheDocument();
  });

  test('rule 27 — un acompte partiel annonce sa part, pas le total', async () => {
    setAuth({ id: 1, roles: ['admin'] });
    api.getAccountingSales.mockResolvedValue({
      ...SAMPLE_SALES,
      entries: [{ ...SAMPLE_SALES.entries[0], kind: 'deposit', encaissementTtc: 30, fraction: 0.3, finalPrice: 100 }],
    });
    renderPage();
    expect(await screen.findByText(/30 % du séjour \(100,00 €\)/)).toBeInTheDocument();
  });

  // specs/accountant-accounting-export.md rule 26 — le mois et l'année vivent dans l'URL, si bien
  // qu'un retour arrière — ou un lien envoyé au comptable — retombe sur le même mois.
  test('rule 26 — le mois et l’année de l’URL pilotent la requête', async () => {
    setAuth({ id: 1, roles: ['admin'] });
    renderPage();
    await waitFor(() => expect(api.getAccountingSales).toHaveBeenCalled());
    expect(api.getAccountingSales.mock.calls[0].slice(0, 2)).toEqual([8, 2026]);
  });
});
