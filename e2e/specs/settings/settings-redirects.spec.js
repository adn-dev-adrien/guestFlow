// @ts-check
// settings/settings-redirects — specs/settings-rationalization.md rules 1-8. The old settings URLs
// land on their new page, and the « Paramètres » submenu lists the pages by family.
import { test, expect } from '@playwright/test';

const REDIRECTS = [
  { from: '/settings',          to: /\/settings\/etablissement$/,                     heading: 'Établissement' },
  { from: '/parametres/tarifs', to: /\/parametres\/options-ressources\?tab=sas$/,    heading: 'Facturables au SAS' },
  { from: '/account',           to: /\/mon-compte$/,                                  heading: 'Mon compte' },
  { from: '/comptes',           to: /\/mon-compte$/,                                  heading: 'Mon compte' },
];

for (const { from, to, heading } of REDIRECTS) {
  test(`${from} redirects to its new page`, async ({ page }) => {
    await page.goto(from);
    await expect(page).toHaveURL(to, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible({ timeout: 10_000 });
  });
}

test('the Paramètres submenu lists the new pages; Clients and Mon compte sit outside it', async ({ page }) => {
  await page.goto('/settings/etablissement');
  const nav = page.getByRole('navigation').first().or(page.locator('.MuiDrawer-root').first());
  for (const label of ['Établissement', 'Logements', 'Plateformes', 'Options & ressources', 'Recettes tarifaires',
    'Vacances & fermetures', 'Linge', 'Paiements en ligne', 'TVA & exercice', 'Emails & notifications',
    'Intégrations', 'Utilisateurs', 'Système']) {
    await expect(nav.getByRole('link', { name: label, exact: true }).first()).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Clients', exact: true }).first()).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Mon compte', exact: true }).first()).toBeVisible();
  // The former entries are gone.
  for (const gone of ['Générale', 'Blanchisserie', 'Tarifs facturables', 'Gestion utilisateur']) {
    await expect(nav.getByRole('link', { name: gone, exact: true })).toHaveCount(0);
  }
});

test('the Linge page opens from the submenu and has no dead back arrow', async ({ page }) => {
  await page.goto('/parametres/stock-blanchisserie');
  await expect(page.getByRole('heading', { name: 'Linge' }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Retour' })).toHaveCount(0);
});
