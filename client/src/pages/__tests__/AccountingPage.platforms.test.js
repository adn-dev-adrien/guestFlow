import { vi } from 'vitest';
/**
 * Regression test for the Commissions plateformes table on AccountingPage:
 *   - Admin: clicking a row navigates to the reservation file.
 *   - Accountant: row is NOT clickable (server already 403s `/api/reservations/*`, but the UI
 *     hides the navigation too so the click is a no-op instead of a refused fetch).
 *   - New "Logement" column shows `row.propertyName` (added 2026-06-02).
 *
 * Uses the central `userHasRole(user, ADMIN)` helper (constants/roles.js), same gate as the
 * sidebar + journal cards — pinned by AccountingPage.regression.test.js for the journal cards.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../api', () => ({
  __esModule: true,
  default: {
    getAccountingPlatforms: vi.fn(),
    getAccountingSales: vi.fn(),
    downloadAccountingSalesCsv: vi.fn(),
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

const SAMPLE_PLATFORMS = {
  rows: [
    {
      reservationId: 77,
      propertyName: 'Le Petit Gîte',
      date: '2026-08-15',
      kind: 'balance',
      client: 'Jean Dupont',
      platform: 'airbnb',
      gross: 220,
      encaissement: 200,
      commission: 20,
    },
  ],
  totalCommission: 20,
};

const SAMPLE_SALES = {
  totals: { entriesCount: 0, allBalanced: true, totalDebits: 0 },
  entries: [],
};

// Inline route stub: the page navigates with `navigate('/reservations/77')`. We register a
// matching route that simply renders a sentinel text so the assertion can prove the navigation
// happened.
function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/comptabilite?month=8&year=2026']}>
      <Routes>
        <Route path="/comptabilite" element={<AccountingPage />} />
        <Route path="/reservations/:id" element={<div>RESERVATION_FILE_77</div>} />
      </Routes>
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

describe('AccountingPage — platforms commission table', () => {
  test('the new "Logement" column is rendered and shows the property name', async () => {
    setAuth({ id: 1, roles: ['admin'] });
    renderPage();
    expect(await screen.findByText('Logement')).toBeInTheDocument();
    expect(await screen.findByText('Le Petit Gîte')).toBeInTheDocument();
  });

  test('kind badge: each row carries a single-letter A/S/C badge derived from row.kind', async () => {
    // Compact badge between Plateforme and Encaissement so the user can tell apart
    // acompte / solde / complément without eating a full column. Adrien's preference.
    // The header legend (top-right of the table) also renders the same three letters, so
    // we assert ≥ 2 occurrences per kind: 1 in the legend + 1+ in the body rows.
    api.getAccountingPlatforms.mockResolvedValue({
      rows: [
        { ...SAMPLE_PLATFORMS.rows[0], kind: 'deposit', client: 'Acompte Client' },
        { ...SAMPLE_PLATFORMS.rows[0], reservationId: 78, kind: 'balance', client: 'Solde Client' },
        { ...SAMPLE_PLATFORMS.rows[0], reservationId: 79, kind: 'complement', client: 'Complément Client' },
      ],
      totalCommission: 60,
    });
    setAuth({ id: 1, roles: ['admin'] });
    renderPage();
    await screen.findByText('Acompte Client');
    expect(screen.getAllByText('A').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('S').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('C').length).toBeGreaterThanOrEqual(2);
  });

  test('legend at the top-right of the table names each badge (Acompte / Solde / Complément)', async () => {
    setAuth({ id: 1, roles: ['admin'] });
    renderPage();
    // Wait for the table to render, then check the legend's text labels.
    await screen.findByText('Le Petit Gîte');
    expect(screen.getByText('Acompte')).toBeInTheDocument();
    expect(screen.getByText('Solde')).toBeInTheDocument();
    expect(screen.getByText('Complément')).toBeInTheDocument();
  });

  test('admin: clicking a row navigates to the reservation file', async () => {
    setAuth({ id: 1, roles: ['admin'] });
    renderPage();
    const propertyCell = await screen.findByText('Le Petit Gîte');
    // The clickable target is the row itself. Walking up to the row + firing click.
    const row = propertyCell.closest('tr');
    fireEvent.click(row);
    expect(await screen.findByText('RESERVATION_FILE_77')).toBeInTheDocument();
  });

  test('accountant: clicking a row does NOT navigate (UI gate matches the server 403)', async () => {
    setAuth({ id: 2, roles: ['accountant'] });
    renderPage();
    const propertyCell = await screen.findByText('Le Petit Gîte');
    const row = propertyCell.closest('tr');
    fireEvent.click(row);
    // No navigation → the sentinel never renders.
    expect(screen.queryByText('RESERVATION_FILE_77')).not.toBeInTheDocument();
    // And the row carries no `cursor: pointer` style.
    expect(row.style.cursor).not.toBe('pointer');
  });

  test('logged-out user: row is NOT clickable (defense in depth)', async () => {
    setAuth(null);
    renderPage();
    const propertyCell = await screen.findByText('Le Petit Gîte');
    const row = propertyCell.closest('tr');
    fireEvent.click(row);
    expect(screen.queryByText('RESERVATION_FILE_77')).not.toBeInTheDocument();
  });

  test('row with no reservationId stays non-clickable even for admins', async () => {
    // Defensive guard — if the server payload ever omits `reservationId` we don't want a
    // dangling click that navigates to `/reservations/undefined`.
    api.getAccountingPlatforms.mockResolvedValue({
      rows: [{ ...SAMPLE_PLATFORMS.rows[0], reservationId: null }],
      totalCommission: 20,
    });
    setAuth({ id: 1, roles: ['admin'] });
    renderPage();
    const propertyCell = await screen.findByText('Le Petit Gîte');
    const row = propertyCell.closest('tr');
    fireEvent.click(row);
    expect(screen.queryByText('RESERVATION_FILE_77')).not.toBeInTheDocument();
  });

  test('missing propertyName renders as "—" placeholder, not blank', async () => {
    api.getAccountingPlatforms.mockResolvedValue({
      rows: [{ ...SAMPLE_PLATFORMS.rows[0], propertyName: '' }],
      totalCommission: 20,
    });
    setAuth({ id: 1, roles: ['admin'] });
    renderPage();
    await screen.findByText('Jean Dupont');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  test('direct bookings appear in the table too (gross + commission empty as "—")', async () => {
    // Regression: prior to 2026-06-02 the platforms preview filtered out direct bookings, so
    // the table only ever showed non-direct rows — making it diverge from the journal cards
    // below (which always show ALL encaissements). The table now lists every encaissement;
    // direct rows show `—` for the platform-specific columns (gross + commission).
    api.getAccountingPlatforms.mockResolvedValue({
      rows: [
        {
          reservationId: 51,
          propertyName: 'Le Petit Gîte',
          date: '2026-08-12',
          kind: 'balance',
          client: 'Alice Direct',
          platform: 'direct',
          gross: null,
          encaissement: 300,
          commission: null,
        },
      ],
      totalCommission: 0,
    });
    setAuth({ id: 1, roles: ['admin'] });
    renderPage();

    expect(await screen.findByText('Alice Direct')).toBeInTheDocument();
    // The row exists with the platform = "direct" label visible.
    expect(screen.getByText('direct')).toBeInTheDocument();
    // Two `—` placeholders: one for gross, one for commission. Use getAllByText to count.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});
