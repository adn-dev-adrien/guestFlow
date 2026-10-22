// @ts-check
// specs/plugins-phase-0-foundation.md rule 28 — the bare install: a new customer with NO plugin
// (rule 11), after the start assistant. Nothing of a plugin shows, nothing calls a plugin's API, the
// plugin pages say which plugin they need, and the core runs a stay from property to PDF quote,
// planning, iCal feed, finance and emails. `npm run test:e2e:bare` (playwright.bare.config.js).
import { test, expect } from '@playwright/test';
import { createClient, createProperty } from '../fixtures/apiSeed.js';

// The pages plugin modules add, and the plugin each reads (client/src/plugins/*/index.js).
const PLUGIN_PAGES = [
  ['/comptabilite', 'Export comptable'],
  ['/comptabilite/plateformes', 'Export comptable'],
  ['/parametres/paiements', 'Paiement en ligne (Qonto)'],
  ['/parametres/recettes', 'Recettes tarifaires'],
  ['/parametres/stock-blanchisserie', 'Linge et blanchisserie'],
  ['/resource-planning', 'Ressources à l’heure'],
  ['/school-holidays', 'Vacances scolaires'],
];

const CORE_PAGES = ['/', '/calendar', '/planning', '/clients', '/devis', '/emails', '/emails/historique',
  '/finance', '/finance/tourist-tax', '/options', '/parametres/options-ressources', '/parametres/vacances-fermetures',
  '/parametres/conditions-generales', '/properties', '/reservations/new', '/reservations/upcoming', '/settings',
  '/settings/emails', '/settings/emails/textes', '/settings/etablissement', '/settings/plateformes',
  '/settings/systeme', '/settings/tva-exercice', '/settings/utilisateurs', '/mon-compte'];

// What a plugin would add to a core page (rule 16), as the operator would read it.
const PLUGIN_WORDS = /blanchisserie|lessive|portail|neat|qonto|paiement en ligne|demande de paiement|google agenda|météo|vigilance|vacances scolaires|zone [abc]\b|recette tarifaire|facturables au sas|objets trouvés|à l['’]heure|demandes du site|gîtes de france|saisie booking/i;

/** Every API answer « plugin inactive » the page provoked: the client must never ask (rule 18). */
function watchPluginCalls(page) {
  const calls = [];
  page.on('response', async (res) => {
    if (res.status() !== 404 || !res.url().includes('/api/')) return;
    const body = await res.text().catch(() => '');
    if (body.includes('PLUGIN_INACTIVE')) calls.push(`${res.url()} ${body.slice(0, 80)}`);
  });
  return calls;
}

const isoIn = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('rules 28 + 30 — no core page shows a plugin, links to its page or calls its API', async ({ page }) => {
  test.setTimeout(180_000);
  const calls = watchPluginCalls(page);
  for (const path of CORE_PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main').first(), path).toBeVisible();
    // Rule 30: the planning is still empty here (this test runs first in the file) and names no
    // plugin's cards.
    if (path === '/planning') await expect(page.getByText(/^Rien de prévu sur les \d+ prochains jours\.$/)).toBeVisible();
    const text = await page.locator('main').first().innerText();
    // The Plugins page and the option catalogue are the two places that may NAME a plugin's subject:
    // the first offers them, the second holds the core's sellable linen options.
    if (!['/parametres/options-ressources', '/options'].includes(path)) {
      expect(text.match(PLUGIN_WORDS), `${path} names a plugin`).toBeNull();
    }
    for (const [href] of [...PLUGIN_PAGES, ['/settings/integrations']]) {
      await expect(page.locator(`a[href="${href}"]`), `${path} links to ${href}`).toHaveCount(0);
    }
  }
  // The menu did render: the core entries are links.
  await expect(page.locator('a[href="/planning"]').first()).toBeAttached();
  expect(calls).toEqual([]);
});

// specs/plugins-phase-p-productisation.md rule 42 — for an administrator the address stays and reads
// « Plugin inactif » (it amends specs/plugins-phase-0-foundation.md rule 19).
test('a plugin page typed by hand says which plugin it needs', async ({ page }) => {
  for (const [path, name] of PLUGIN_PAGES) {
    await page.goto(path);
    await expect(page.getByText(`Cette page dépend du plugin « ${name} », qui n’est pas activé.`), path).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ouvrir Plugins' }).or(page.getByRole('link', { name: 'Ouvrir Plugins' }))).toBeVisible();
  }
  // Intégrations only holds plugin sections (rule 17): no entry, and typed by hand it says so.
  await page.goto('/settings');
  await expect(page.getByText('Établissement').first()).toBeVisible();
  await expect(page.getByText('Intégrations')).toHaveCount(0);
  await page.goto('/settings/integrations');
  await expect(page.getByText('Cette page dépend de plugins qui ne sont pas activés.')).toBeVisible();
});

test('rule 28 — the Plugins page has nothing installed and every plugin available', async ({ page }) => {
  await page.goto('/parametres/plugins');
  await expect(page.getByRole('tab', { name: 'Installés (0)' })).toBeVisible();
  const available = page.getByRole('tab', { name: /^Disponibles \(\d+\)$/ });
  await expect(available).toBeVisible();
  const count = Number((await available.innerText()).match(/\d+/)[0]);
  expect(count).toBeGreaterThanOrEqual(14);
  await available.click();
  await expect(page.getByRole('button', { name: /^Installer/ })).toHaveCount(count);
  await expect(page.getByRole('button', { name: /^(Désactiver|Désinstaller|Configurer)/ })).toHaveCount(0);
});

test('rule 28 — the core runs a stay: reservation, quote PDF, planning, iCal feed, finance, emails', async ({ page }) => {
  test.setTimeout(120_000);
  const calls = watchPluginCalls(page);
  const property = await createProperty({ name: 'Maison nue', basePrice: 120 });
  const client = await createClient({ firstName: 'Nadia', lastName: 'Sansplugin', email: 'nadia@example.org' });

  // A reservation through the form: the price comes from the server, no plugin block on the fiche.
  await page.goto(`/reservations/new?propertyId=${property.id}`);
  await expect(page.getByRole('heading', { name: 'Nouvelle réservation' })).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type=date]').first().fill(isoIn(3));
  await page.locator('input[type=date]').nth(1).fill(isoIn(6));
  await page.getByRole('combobox', { name: 'Rechercher un client' }).fill(client.lastName);
  await page.getByRole('option').first().click();
  await expect(page.getByText('Total du séjour').locator('..')).not.toContainText(/^Total du séjour\s*0,00/);
  await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
  // A saved reservation goes back to the planning; its fiche is read again from the server.
  await expect(page).toHaveURL(/\/planning/, { timeout: 15_000 });
  const listed = await (await page.request.get('/api/reservations')).json();
  const saved = (Array.isArray(listed) ? listed : listed.reservations || []).find((r) => r.clientId === client.id);
  expect(saved, 'the reservation was stored').toBeTruthy();
  const reservationId = saved.id;
  await page.goto(`/reservations/${reservationId}`);
  await expect(page.getByText('Total du séjour').first()).toBeVisible({ timeout: 15_000 });
  const fiche = await page.locator('main').first().innerText();
  expect(fiche.match(PLUGIN_WORDS), 'the fiche names a plugin').toBeNull();
  expect(fiche).not.toMatch(/conditions générales acceptées/i);
  // specs/normalize-platform-names.md rule 21 — the channel menu shows the label, not the stored value.
  await expect(page.getByRole('combobox', { name: 'Plateforme' })).toHaveText('Direct');

  // A quote, saved, and its PDF downloaded through the bar.
  await page.goto(`/reservations/new?mode=devis&propertyId=${property.id}`);
  await expect(page.getByRole('heading', { name: 'Nouveau devis' })).toBeVisible({ timeout: 15_000 });
  await page.locator('input[type=date]').first().fill(isoIn(40));
  await page.locator('input[type=date]').nth(1).fill(isoIn(44));
  await page.getByRole('combobox', { name: 'Rechercher un client' }).fill(client.lastName);
  await page.getByRole('option').first().click();
  await page.getByRole('button', { name: 'Enregistrer le devis' }).click();
  await expect(page).toHaveURL(/devisId=\d+/, { timeout: 15_000 });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Télécharger PDF' }).click();
  const pdf = await downloading;
  const head = await new Promise((resolve, reject) => {
    pdf.createReadStream().then((stream) => {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => resolve(Buffer.concat(chunks).subarray(0, 5).toString()));
      stream.on('error', reject);
    }, reject);
  });
  expect(head).toBe('%PDF-');

  // The planning shows the stay, with nothing of the sas, the linen or the resources.
  await page.goto('/planning');
  await expect(page.getByText('Sansplugin').first()).toBeVisible({ timeout: 15_000 });
  const planning = await page.locator('main').first().innerText();
  expect(planning.match(PLUGIN_WORDS), 'the planning names a plugin').toBeNull();
  expect(planning).not.toMatch(/\bsas\b|linge/i);

  // The iCal export of the property carries the stay.
  const tokenRes = await page.request.get(`/api/ical/token/${property.id}`);
  expect(tokenRes.ok()).toBeTruthy();
  const { token } = await tokenRes.json();
  const feed = await page.request.get(`/api/ical/export/${token}`);
  expect(feed.ok()).toBeTruthy();
  expect(feed.headers()['content-type']).toContain('text/calendar');
  expect(await feed.text()).toContain('BEGIN:VEVENT');

  // Finance and emails open on their own data.
  await page.goto('/finance');
  await expect(page.locator('main').first()).toBeVisible();
  await expect(page.getByText(/Impossible de charger/)).toHaveCount(0);
  await page.goto('/emails');
  await expect(page.locator('main').first()).toBeVisible();
  await expect(page.getByText(/Impossible de charger/)).toHaveCount(0);

  expect(reservationId).toBeGreaterThan(0);
  expect(calls).toEqual([]);
});

test('rule 29 — the API refuses a role whose plugin is not active', async ({ page }) => {
  for (const [role, plugin] of [['reception', 'sas'], ['accountant', 'accounting-export']]) {
    const res = await page.request.post('/api/users', {
      data: { firstName: 'Role', lastName: 'Sansplugin', email: `${role}@example.org`, roles: [role] },
    });
    expect(res.status(), role).toBe(400);
    expect(await res.json()).toEqual({ error: 'ROLE_PLUGIN_INACTIVE', field: 'roles', role, plugin });
  }
});

test('rule 31 — the old « Tarifs » address names no tab of an absent plugin', async ({ page }) => {
  await page.goto('/parametres/tarifs');
  await expect(page).toHaveURL(/\/parametres\/options-ressources$/, { timeout: 15_000 });
});
