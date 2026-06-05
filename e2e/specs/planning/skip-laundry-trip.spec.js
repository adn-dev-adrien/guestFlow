// @ts-check
// specs/skip-laundry-trip.md §7.3 — Playwright smoke for the laundry-trip skip toggle.
//
// The seed-data complexity of materializing a non-empty `LaundryDayCard` in the E2E DB
// (= a reservation with a bed-linen option that ends just before a Tuesday in the
// visible horizon) is non-trivial — covered by the server unit tests
// `linen-inventory-skipped-trip.unit.test.js` and the model integration
// `linen-inventory-model-skip-propagation.unit.test.js`. This E2E test exercises the
// API contract (round-trip via `/api/laundry/skips`) and confirms the `/planning` page
// still mounts cleanly with the skip set non-empty — proving the wiring through
// `api.listLaundrySkips → useState → LaundryDayCard` doesn't crash.
import { test, expect } from '@playwright/test';

const FAR_FUTURE_TUESDAY = '2099-09-08'; // Date.getUTCDay() === 2 for this date.

test('laundry trip skip — API round-trip + planning page still renders with a skip set', async ({ page, request }) => {
  // Add via the API. The shared Playwright `request` context inherits the admin session
  // cookie from `e2e/.auth/admin.json` (set by globalSetup), so this is admin-authenticated.
  const addResp = await request.post('/api/laundry/skips', {
    data: { date: FAR_FUTURE_TUESDAY },
  });
  expect(addResp.ok()).toBeTruthy();
  const addBody = await addResp.json();
  expect(addBody.ok).toBe(true);
  expect(addBody.skips).toContain(FAR_FUTURE_TUESDAY);

  // Confirm via GET.
  const listResp = await request.get('/api/laundry/skips');
  expect(listResp.ok()).toBeTruthy();
  const listBody = await listResp.json();
  expect(listBody.skips).toContain(FAR_FUTURE_TUESDAY);

  // Navigate to /planning and assert it still mounts cleanly with the skip set non-empty.
  // The page may not surface this far-future date in the visible horizon, but the mount +
  // initial render must not crash on the toggle wiring. We use the page's PageActionBar
  // title as the render-success anchor (same pattern as the sidebar-navigation specs).
  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toBeVisible({ timeout: 10_000 });

  // Cleanup — DELETE the skip so subsequent E2E runs aren't polluted with this date.
  // Idempotent on the server side, so safe to call even if a prior test cleaned it up.
  const delResp = await request.delete(`/api/laundry/skips/${FAR_FUTURE_TUESDAY}`);
  expect(delResp.ok()).toBeTruthy();
  const delBody = await delResp.json();
  expect(delBody.skips).not.toContain(FAR_FUTURE_TUESDAY);
});

test('POST /api/laundry/skips with a malformed date returns 400', async ({ request }) => {
  const res = await request.post('/api/laundry/skips', { data: { date: '2099/09/08' } });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.code).toBe('INVALID_DATE');
});
