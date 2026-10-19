// @ts-check
// settings/settings-redirects — specs/settings-rationalization.md rules 1-8. The old settings URLs
// land on their new page, and the « Paramètres » submenu lists the pages by group (rule 26: the
// group of the open page unfolds; `/settings` is the summary since rule 24, settings-summary.spec.js).
import { test, expect } from '@playwright/test';

const REDIRECTS = [
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

const GROUPS = {
  etablissement: ['Établissement', 'Logements', 'Plateformes', 'Conditions générales'],
  sejours: ['Options & ressources', 'Recettes tarifaires', 'Vacances & fermetures', 'Linge'],
  'paiements-emails': ['Paiements en ligne', 'TVA & exercice', 'Emails & notifications'],
  'compte-systeme': ['Utilisateurs', 'Intégrations', 'Système', 'Plugins'],
};

test('the Paramètres submenu lists the new pages; Clients and Mon compte sit outside it', async ({ page }) => {
  const nav = page.getByRole('navigation').first().or(page.locator('.MuiDrawer-root').first());
  for (const [group, labels] of Object.entries(GROUPS)) {
    await page.goto(`/settings#${group}`);
    for (const label of labels) {
      await expect(nav.getByRole('link', { name: label, exact: true }).first()).toBeVisible({ timeout: 10_000 });
    }
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
