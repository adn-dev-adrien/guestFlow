// @ts-check
// specs/laundry-extra-trip.md §7 — Playwright smoke for the extra laundry trip.
//
// Same discipline as skip-laundry-trip.spec.js: materialising a non-empty laundry card in the
// E2E DB is non-trivial and the arithmetic is pinned by the server suites (ledger, engine,
// end-to-end regression). This spec exercises the API contract (PUT / GET / preview / DELETE,
// the laundry-day refusal) and confirms `/planning` still mounts with an extra trip stored.
import { test, expect } from '@playwright/test';

const FAR_FUTURE_THURSDAY = '2099-09-10'; // Date.getUTCDay() === 4 — a free date for the default Tuesday.
const FAR_FUTURE_TUESDAY = '2099-09-08';  // Date.getUTCDay() === 2 — the default laundry weekday.

test('extra laundry trip — API round-trip + planning page still renders with a trip stored', async ({ page, request }) => {
  // Preview first: the trip does not exist yet, the payload still describes the date.
  const previewResp = await request.get(`/api/laundry/extra-trips/preview?date=${FAR_FUTURE_THURSDAY}`);
  expect(previewResp.ok()).toBeTruthy();
  const preview = await previewResp.json();
  expect(preview.date).toBe(FAR_FUTURE_THURSDAY);
  expect(preview.dropOff).toHaveProperty('singleBeds');
  expect(preview.atLaundry).toHaveProperty('singleBeds');

  // Create (PUT upsert) as a partial pick-up.
  const putResp = await request.put(`/api/laundry/extra-trips/${FAR_FUTURE_THURSDAY}`, {
    data: { pickUpAll: false, pickUp: { singleBeds: 1 } },
  });
  expect(putResp.ok()).toBeTruthy();
  const putBody = await putResp.json();
  expect(putBody.ok).toBe(true);
  expect(putBody.trip.pickUpAll).toBe(false);
  expect(putBody.trip.pickUp.singleBeds).toBe(1);

  // Confirm via GET.
  const listResp = await request.get('/api/laundry/extra-trips');
  expect(listResp.ok()).toBeTruthy();
  const listBody = await listResp.json();
  expect(listBody.trips.map((t) => t.date)).toContain(FAR_FUTURE_THURSDAY);

  // The planning summary lists it as an extra trip.
  const summaryResp = await request.get(`/api/planning/laundry?from=${FAR_FUTURE_THURSDAY}&to=${FAR_FUTURE_THURSDAY}`);
  expect(summaryResp.ok()).toBeTruthy();
  const summary = await summaryResp.json();
  const entry = summary.laundryDays.find((d) => d.date === FAR_FUTURE_THURSDAY);
  expect(entry).toBeTruthy();
  expect(entry.kind).toBe('extra');
  expect(entry.pickUpAll).toBe(false);
  expect(entry).toHaveProperty('leftAtLaundry');

  // Navigate to /planning and assert it still mounts cleanly with the trip stored.
  await page.goto('/planning');
  await expect(page.getByRole('heading', { name: 'Planning', exact: true })).toBeVisible({ timeout: 10_000 });
  // Admin session → the action-bar entry point is present.
  await expect(page.getByRole('button', { name: 'Ajouter un voyage blanchisserie exceptionnel' })).toBeVisible();

  // Cleanup — DELETE the trip so subsequent E2E runs aren't polluted. Idempotent server-side.
  const delResp = await request.delete(`/api/laundry/extra-trips/${FAR_FUTURE_THURSDAY}`);
  expect(delResp.ok()).toBeTruthy();
  const afterDelete = await (await request.get('/api/laundry/extra-trips')).json();
  expect(afterDelete.trips.map((t) => t.date)).not.toContain(FAR_FUTURE_THURSDAY);
});

test('PUT /api/laundry/extra-trips on the laundry weekday returns 400 EXTRA_TRIP_ON_LAUNDRY_DAY', async ({ request }) => {
  const res = await request.put(`/api/laundry/extra-trips/${FAR_FUTURE_TUESDAY}`, { data: { pickUpAll: true } });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.code).toBe('EXTRA_TRIP_ON_LAUNDRY_DAY');
});

test('PUT /api/laundry/extra-trips with a malformed date returns 400 INVALID_DATE', async ({ request }) => {
  const res = await request.put('/api/laundry/extra-trips/2099-09-10x', { data: { pickUpAll: true } });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.code).toBe('INVALID_DATE');
});
