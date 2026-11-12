// specs/plugins-phase-4-registry.md rules 51 and 54 (audit r3 N-R3-1, audit r4 N-R4-1) — a plugin whose behaviour
// rests on a hardening of the CORE (the linear e-mail check, the mailbox reader's caps, the Qonto timeout, the scoped
// cancellation retry) asks for the SDK that ships it: a core older than that SDK refuses the package instead of
// running it without the hardening.
//
// The list of relying plugins is DISCOVERED: HARDENINGS maps a core feature, recognised by the call that reaches it,
// to the SDK that shipped it, and every plugin source file is scanned. A new plugin (or a new call) that reaches a
// listed feature without the floor fails here. What it cannot do is know a hardening nobody listed: shipping one
// still means adding a row to HARDENINGS (a reviewer's check), and a module name built at run time is not seen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { readSourceManifest } = require('../plugins/manifest');
const { SDK_VERSION } = require('../plugins/sdk/version');
const { satisfies } = require('../utils/semverRange');
const { missingPlugins } = require('../plugins/sdk/testing');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const HARDENED_AT = '2.15.0';

const HARDENINGS = [
  { feature: 'linear e-mail check', sdk: HARDENED_AT, pattern: /validateEmail\(/ },
  { feature: 'mailbox reader caps and parser version', sdk: HARDENED_AT, pattern: /\breadMailsFrom\b|\bmanifestVersion\(/ },
  { feature: 'scoped cancellation retry', sdk: HARDENED_AT, pattern: /retryPendingCancellations/ },
  { feature: 'mail cap report and unverifiable-mailbox reading', sdk: '2.16.0', pattern: /\bonCap\b/ },
  { feature: 'internal settings refused by the PUT', sdk: '2.17.0', pattern: /\binternal:\s*true\b/ },
  { feature: 'Qonto request timeout', sdk: HARDENED_AT, pattern: /coreModule\(\s*['"`]qonto['"`]\s*[,)]/ },
  // specs/plugins-phase-1-sdk.md rule 35 (specs/payment-link-lifecycle.md rule 16).
  { feature: 'payment link lifecycle pass', sdk: '2.18.0', pattern: /\brunLinkLifecycle\b/ },
  // specs/plugins-phase-1-sdk.md rule 36 (specs/payment-schedule-and-cancellation.md rule 55).
  { feature: 'stored-money split shared with the cancellation', sdk: '2.19.0', pattern: /coreModule\(\s*['"`]storedMoneySplit['"`]/ },
  // specs/plugins-phase-1-sdk.md rule 37 (specs/reservations-backend-mvc.md rule 13) — audit R20-P1.
  { feature: 'entered-date window', sdk: '2.20.0', pattern: /coreModule\(\s*['"`]stayDates['"`]/ },
  // specs/plugins-phase-1-sdk.md rule 38 (audit R20, E20-1).
  { feature: 'the stored update body of a reservation', sdk: '2.21.0', pattern: /\breservations\.updateBody\b/ },
  // specs/plugins-phase-1-sdk.md rule 39 (specs/non-card-option-served-persons.md rule 12) — audit R21-P1, C4. The draft
  // that sends `{ optionId, persons }` lives on the client, which this scan skips: `soldOptions` is its server end.
  { feature: 'SAS sale by people served', sdk: '2.21.0', pattern: /\bsoldOptions\b/ },
  // specs/plugins-phase-4-registry.md rule 54 reading of 2026-11-05 (specs/reservation-refunds.md rule 52) — audit R24 NEW-1.
  { feature: 'take-back refused while a refund needs the money', sdk: '2.21.0', pattern: /\btakeBackRefusal\b/ },
  // specs/plugins-phase-1-sdk.md rule 40 (specs/public-api.md rule 24) — audit R24 public finding 1.
  { feature: 'visitor times judged against the neighbours', sdk: '2.22.0', pattern: /\bstayTimesRefused\b/ },
  // specs/guest-app.md rules 28-31, 35 — the hourly slots a plugin schedules or holds through the core.
  { feature: 'resource scheduler and holds', sdk: '2.26.0', pattern: /\b(?:resourceScheduler|resourceHolds)\(/ },
  // specs/plugins-phase-1-sdk.md rule 47 — the card payment of a plugin's basket and its paid effect.
  { feature: 'payment baskets', sdk: '2.26.0', pattern: /\b(?:paymentBasket\(|core\.payments\b)/ },
  // specs/plugins-phase-1-sdk.md rule 48 — a web app the plugin serves on its own host or under its own path.
  { feature: 'web apps', sdk: '2.26.0', pattern: /\bctx\.webApp\(/ },
  // specs/plugins-phase-1-sdk.md rule 41 (specs/accounting-synthesis.md rules 7-9).
  { feature: 'finance readings of the accounting synthesis', sdk: '2.23.0', pattern: /coreModule\(\s*['"`]financeDashboardModel['"`]/ },
  // specs/plugins-phase-1-sdk.md rule 42 (specs/mixed-method-payments.md rules 26-28, 32).
  { feature: 'payments split over several methods', sdk: '2.24.0', pattern: /coreModule\(\s*['"`]payment(Tenders|SettlementsModel|SettlementService)['"`]/ },
  // specs/resource-booking-pricing-and-invoicing.md rules 1, 14, 20-21 — the invoice issuer and the sales outside a stay.
  { feature: 'invoice issuer and sales outside a stay', sdk: '2.25.0', pattern: /coreModule\(\s*['"`](invoiceIssuers|standaloneSales)['"`]|ctx\.(invoiceIssuer|standaloneSales)\(/ },
  // specs/plugins-phase-1-sdk.md rule 50 (specs/pricing-components.md rules 5, 47) — a pricing family for the Articles head.
  { feature: 'article families', sdk: '2.27.0', pattern: /\bctx\.articleFamily\(/ },
  { feature: 'article fulfilment', sdk: '2.28.0', pattern: /\bctx\.articleFulfilment\(/ },
  { feature: 'slot availability', sdk: '2.28.0', pattern: /\bctx\.slotAvailability\(/ },
  // specs/plugins-phase-1-sdk.md rule 52 (specs/pricing-components.md rule 38) — the shared money helpers.
  { feature: 'shared money helpers', sdk: '2.29.0', pattern: /coreModule\(\s*['"`]money['"`]/ },
  { feature: 'sale events', sdk: '2.28.0', pattern: /['"]extraSale\.(sold|lineMoved|lineCancelled|refundOwed)['"]/ },
];

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'client' || entry.name === 'tests') continue;
      out.push(...sourceFiles(full));
    } else if (/\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}

const hardeningsIn = (text) => HARDENINGS.filter((h) => h.pattern.test(text));

const relying = new Map();
for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory() || !fs.existsSync(path.join(PLUGINS_DIR, entry.name, 'manifest.json'))) continue;
  const text = sourceFiles(path.join(PLUGINS_DIR, entry.name)).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const hits = hardeningsIn(text);
  if (hits.length) relying.set(entry.name, hits);
}

test('rule 51: the SDK that ships the hardenings is at least 2.15.0', () => {
  assert.ok(satisfies(SDK_VERSION, `>=${HARDENED_AT}`), SDK_VERSION);
});

test('rule 54: the discovery sees double quotes, a destructured readMailsFrom and a spread-out coreModule call', () => {
  const features = (text) => hardeningsIn(text).map((h) => h.feature);
  assert.ok(features('sdk.coreModule("qonto").qontoService').includes('Qonto request timeout'));
  assert.ok(features("sdk.coreModule(\n  `qonto`,\n)").includes('Qonto request timeout'));
  assert.ok(features('const { readMailsFrom } = sdk.mailbox;\nawait readMailsFrom({});').includes('mailbox reader caps and parser version'));
  assert.deepEqual(features('sdk.coreModule("dateFr")'), []);
});

test('rule 50: ctx.articleFamily forces the 2.27.0 floor, so a plugin declaring ^2.26.0 and calling it is refused', () => {
  const [hit] = hardeningsIn("ctx.articleFamily('hourly', family);");
  assert.equal(hit.feature, 'article families');
  const [major, minor] = hit.sdk.split('.').map(Number);
  assert.equal(satisfies(`${major}.${minor - 1}.0`, '^2.26.0'), true, 'a ^2.26.0 manifest would load on the SDK before it');
  assert.equal(satisfies(SDK_VERSION, `>=${hit.sdk}`), true);
});

test('rule 54: the discovery finds the plugins audit r3 and r4 named', () => {
  const named = ['website-booking', 'booking-intake', 'airbnb-intake', 'gites-de-france-intake', 'online-payment'];
  for (const id of named) {
    if (missingPlugins([id]).length) continue;
    assert.ok(relying.has(id), `${id} is not discovered as relying on a core hardening`);
  }
});

for (const [id, hits] of relying) {
  test(`rule 54: ${id} refuses a core whose SDK predates ${hits.map((h) => h.feature).join(', ')}, and loads on this one`, () => {
    const m = readSourceManifest(id);
    for (const h of hits) {
      const [major, minor] = h.sdk.split('.').map(Number);
      const before = `${major}.${minor - 1}.0`;
      assert.equal(satisfies(before, m.sdk), false, `${id} ${m.sdk} still loads on SDK ${before} (${h.feature})`);
    }
    // « This one » is the running SDK. The floor may sit above the newest hardening: a plugin can need a later
    // SDK for another reason (website-booking 1.8.12 reads `publicCatalogProjection`, SDK 2.26.0).
    assert.ok(satisfies(SDK_VERSION, m.sdk), `${id} ${m.sdk} refuses SDK ${SDK_VERSION}`);
    assert.ok((m.changelog[m.version] || []).some((line) => /SDK 2\.\d+/.test(line)), `${id} ${m.version} names its SDK`);
  });
}

// specs/plugins-phase-1-sdk.md rule 51 (SDK 2.28.0) — declaring a fulfilment adapter or a slot availability provider asks for the 2.28.0 floor.
test('rule 51: ctx.articleFulfilment and ctx.slotAvailability force the 2.28.0 floor', () => {
  assert.equal(hardeningsIn("ctx.articleFulfilment('hourly-slot', adapter);")[0].sdk, '2.28.0');
  assert.equal(hardeningsIn('ctx.slotAvailability(provider);')[0].sdk, '2.28.0');
});
