// @ts-check
// The `test` every spec that uses the `request` fixture imports (specs/tech/e2e-playwright-smoke-suite.md rule 19, reading of
// 2026-11-16, loop t6): Playwright builds that fixture with the 5 s UI `actionTimeout`, so one call stalled on the runner → Vite
// proxy → server hop failed `plugins/online-payment` while the server answered every other call in 2-13 ms. Here the fixture
// carries `API_TIMEOUT`, as every context the suite creates itself; baseURL and storageState still come from the config.

const base = require('@playwright/test');
const { API_TIMEOUT } = require('../clientUrl');

const test = base.test.extend({
  request: async ({ playwright }, use) => {
    const request = await playwright.request.newContext({ timeout: API_TIMEOUT });
    await use(request);
    await request.dispose();
  },
});

module.exports = { test, expect: base.expect };
