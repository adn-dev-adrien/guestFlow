// The pages smoke of the removal matrix (specs/plugin-removal-resilience.md rule 10).
const fs = require('fs');
const path = require('path');
const { WORK } = require('./helpers');

const toRegExp = (apiPath) => new RegExp(`^${apiPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z]+/g, '[^/]+')}(?:[/?]|$)`);

/** → the matchers for the API paths the removed plugins registered (recorded before their removal). */
function removedApiMatchers(removedIds) {
  const file = path.join(WORK, 'routes.json');
  if (!fs.existsSync(file)) return [];
  const all = JSON.parse(fs.readFileSync(file, 'utf8'));
  return removedIds.flatMap((id) => {
    const r = all[id] || { mounts: [], routes: [], webhooks: [] };
    return [...r.mounts, ...r.routes, ...r.webhooks].filter((p) => p.startsWith('/api/')).map(toRegExp);
  });
}

/**
 * Visits `pages` and returns the problems met: a page error, the error boundary, an `/api` answer ≥ 500,
 * a `404 PLUGIN_INACTIVE`, a call to a removed plugin's API, a link to one of `hiddenLinks`.
 */
async function smoke(page, pages, { matchers = [], hiddenLinks = [] } = {}) {
  const problems = [];
  let current = '';
  page.on('pageerror', (err) => problems.push(`${current}: page error ${err.message}`));
  page.on('response', async (res) => {
    const url = new URL(res.url());
    if (!url.pathname.startsWith('/api/')) return;
    if (res.status() >= 500) problems.push(`${current}: ${res.status()} ${url.pathname}`);
    if (res.status() === 404 && (await res.text().catch(() => '')).includes('PLUGIN_INACTIVE')) problems.push(`${current}: PLUGIN_INACTIVE ${url.pathname}`);
    if (matchers.some((m) => m.test(url.pathname))) problems.push(`${current}: called a removed plugin's API ${url.pathname}`);
  });
  for (const target of pages) {
    current = target;
    await page.goto(target);
    await page.waitForLoadState('networkidle');
    if (!(await page.locator('main').first().isVisible().catch(() => false))) problems.push(`${target}: no main`);
    if (await page.getByText('Une erreur est survenue').first().isVisible().catch(() => false)) problems.push(`${target}: error boundary`);
    for (const href of hiddenLinks) {
      if (await page.locator(`a[href="${href}"]`).count()) problems.push(`${target}: links to ${href}`);
    }
  }
  page.removeAllListeners('pageerror');
  page.removeAllListeners('response');
  return problems;
}

module.exports = { smoke, removedApiMatchers };
