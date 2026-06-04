// @ts-check
// Test 3/24 — auth/sidebar-navigation (spec §3.4 row 2 — covers the navigation surface).
// Visits each top-level page reachable from the sidebar and asserts the documented page
// header is visible. Pins the routing graph in App.js + the page rendering.
import { test, expect } from '@playwright/test';

const ROUTES = [
  { url: '/',                            heading: 'Tableau de bord' },
  { url: '/planning',                    heading: 'Planning' },
  { url: '/calendar',                    heading: 'Calendrier des réservations' },
  { url: '/finance',                     heading: 'Suivi financier' },
  { url: '/comptabilite',                heading: 'Comptabilité' },
  { url: '/devis',                       heading: 'Devis' },
  { url: '/settings',                    heading: 'Paramètres', exact: true },
  { url: '/properties',                  heading: 'Logements' },
  { url: '/clients',                     heading: 'Clients' },
  { url: '/school-holidays',             heading: 'Vacances scolaires' },
  { url: '/establishment-closures',      heading: /Fermetures/ },
  { url: '/parametres/stock-blanchisserie', heading: 'Stock blanchisserie' },
];

for (const { url, heading, exact = false } of ROUTES) {
  test(`Direct nav to ${url} renders its header`, async ({ page }) => {
    await page.goto(url);
    await expect(
      page.getByRole('heading', { name: heading, exact }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
}
