// @ts-check
// specs/dashboard-planning-scroll.md rules 4-6 — on a day without arrival the home folds the empty lists to one
// line each and shows the next arrival with its date. The shared E2E database holds stays of other
// specs, so the day's lists are fixed by answering GET /api/planning/today; the real answer's shape is
// pinned alongside.
import { test, expect } from '@playwright/test';

const STAY = {
  id: 4242, kind: 'reservation', startDate: '2026-11-06', endDate: '2026-11-09', checkInTime: '16:00',
  propertyName: 'La Granja', firstName: 'Camille', lastName: 'Rivière', doubleBeds: 1, singleBeds: 0, babyBeds: 0,
  options: [], resources: [],
};

test('GET /api/planning/today answers the day lists in one payload', async ({ request }) => {
  const res = await request.get('/api/planning/today');
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(Object.keys(body).sort()).toEqual(['arrivals', 'departures', 'nextArrival', 'today']);
  expect(Array.isArray(body.arrivals)).toBe(true);
});

test('a day without arrival nor departure: both lists fold, the next arrival shows its date', async ({ page }) => {
  await page.route('**/api/planning/today', (route) => route.fulfill({
    json: {
      today: '2026-10-28', departures: [], arrivals: [],
      nextArrival: { date: '2026-11-06', label: 'vendredi 6 novembre', relativeLabel: 'dans 9 jours', reservations: [STAY] },
    },
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Aucun départ aujourd'hui")).toBeVisible();
  await expect(page.getByText("Aucune arrivée aujourd'hui")).toBeVisible();
  await expect(page.getByTestId('folded-day-list')).toHaveCount(2);
  const next = page.getByTestId('next-arrival');
  await expect(next.getByText('vendredi 6 novembre')).toBeVisible();
  await expect(next.getByText('dans 9 jours')).toBeVisible();
  await expect(next.getByTestId('next-arrival-row')).toContainText('La Granja');
  await expect(next.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByLabel('Date affichée')).toHaveCount(0);
});
