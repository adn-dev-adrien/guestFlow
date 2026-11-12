// @ts-check
// plugins/hourly-resources — specs/resource-booking-client-picker.md rules 1-8. In a new session of a resource, the
// « Client enregistré » list opens on the guest on site, then the one arriving within 7 days, then the later one, then
// the past one and the client without a stay; typing narrows it on every word, accents ignored.
import { test, expect } from '@playwright/test';
import { createClient, createProperty, createReservation, createHourlyResource } from '../../fixtures/apiSeed';
import { setReservationDates } from '../../fixtures/dbSeed';

test.describe.configure({ mode: 'serial' });

const localDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TAG = `Pickère${Date.now().toString(36)}`;
const NAMES = {
  onSite: `Surplace ${TAG}`,
  soon: `Bientot ${TAG}`,
  later: `Plustard ${TAG}`,
  past: `Parti ${TAG}`,
  none: `Sansejour ${TAG}`,
};

test.beforeAll(async () => {
  const property = await createProperty({ name: `Gîte picker ${TAG}` });
  await createHourlyResource({ name: `Bain picker ${TAG}`, propertyIds: [property.id] });
  const stay = async (key, start, end) => {
    const [firstName, lastName] = NAMES[key].split(' ');
    const client = await createClient({ firstName, lastName });
    if (start === null) return;
    // The API refuses a stay in the past: book it ahead, then move it where the case needs it.
    const booked = await createReservation({ propertyId: property.id, clientId: client.id, startDate: localDay(90 + start), endDate: localDay(90 + end) });
    setReservationDates(booked.id, localDay(start), localDay(end));
  };
  // Created in shuffled order: the list's order must come from the server, not from the ids.
  await stay('past', -60, -55);
  await stay('none', null, null);
  await stay('later', 40, 44);
  await stay('soon', 3, 5);
  await stay('onSite', -1, 2);
});

async function openPicker(page) {
  await page.goto('/resource-planning');
  // The page shows its empty state until the resources arrive; the first visit also builds the route.
  const create = page.getByRole('button', { name: 'Nouvelle réservation' }).first();
  await expect(create).toBeVisible({ timeout: 15_000 });
  await create.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('switch', { name: 'Client enregistré' }).check();
  const input = dialog.getByRole('combobox', { name: 'Client *' });
  await input.click();
  return input;
}

const ours = (page) => page.getByRole('option').filter({ hasText: new RegExp(TAG, 'i') });

test('the list opens on stays around the session day, then later, then past and stay-less; typing narrows it', async ({ page }) => {
  const input = await openPicker(page);
  await input.fill(TAG.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''));
  await expect(ours(page)).toHaveCount(5);
  const order = await ours(page).evaluateAll((els) => els.map((el) => el.querySelector('div').textContent.toLowerCase()));
  expect(order).toEqual([NAMES.onSite, NAMES.soon, NAMES.later, NAMES.past, NAMES.none].map((n) => n.toLowerCase()));
  await expect(page.getByText(/^En séjour ou bientôt · 2$/)).toBeVisible();
  await expect(page.getByText(/^À venir · 1$/)).toBeVisible();
  await expect(page.getByText(/^Passés · 2$/)).toBeVisible();
  await expect(ours(page).first()).toContainText(new RegExp(`Gîte picker ${TAG}`, 'i'));

  await input.fill(`${TAG} surplace`);
  await expect(ours(page)).toHaveCount(1);
  await expect(ours(page).first()).toContainText(new RegExp(NAMES.onSite, 'i'));

  await input.fill(`${TAG} zzz`);
  await expect(page.getByText('Aucun client trouvé')).toBeVisible();
});

test.describe('phone (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the options keep one line per name and per stay, with touch-sized rows and no horizontal scroll', async ({ page }) => {
    const input = await openPicker(page);
    await input.fill(TAG);
    await expect(ours(page)).toHaveCount(5);
    for (const box of await ours(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
