// @ts-check
// Test 1/24 — auth/dashboard-loads (specs/e2e-playwright-smoke-suite.md §3.4 row 1).
// The smoke baseline: the app boots, the cached admin session lets us reach `/`, the
// Dashboard header is visible, and zero console errors of severity `error` fire during
// the first paint. Pins `security-auth-encryption` + `security-hardening`.
import { test, expect } from '@playwright/test';

test('Dashboard loads with zero console errors and shows the header', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });

  await page.goto('/');
  // The Dashboard's PageHeader renders "Tableau de bord". Existence of the heading proves
  // both the routing chain (`/` → Dashboard) and the cached session worked.
  await expect(page.getByRole('heading', { name: 'Tableau de bord' })).toBeVisible();

  // Hard-fail on real console.error / pageerror events. Common false positives we tolerate
  // explicitly: nothing today — pin the bar high and lower it case by case if needed.
  expect(errors, `console errors during first paint:\n${errors.join('\n')}`).toEqual([]);
});
