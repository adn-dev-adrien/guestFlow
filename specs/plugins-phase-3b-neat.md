# Plugins — phase 3b: the quote post-processor, and Neat cancellation insurance moves out of the core

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/plugins-phase-3b` (stacked on `feature/plugins-phase-3`, PR #651) |
| **Created** | 2026-10-02 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`, after #651) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) — §6 extension points, phasing §12 |
| **Previous phase** | [`specs/plugins-phase-3a-online-payment.md`](plugins-phase-3a-online-payment.md) (PR #651) |
| **Feature spec** | [`specs/neat-cancellation-insurance-subscription.md`](neat-cancellation-insurance-subscription.md) — its rules hold unchanged |
| **Summary for review** | [`docs/specs/2026-10-02-plugins-phase-3b-neat.html`](../docs/specs/2026-10-02-plugins-phase-3b-neat.html) |

---

## 1. Context

Phase 3 is three chained PRs (decision P9, 2026-10-01): **3a** online payment behind a payment-provider
interface (#651), **3b** Neat behind a quote post-processor (this spec), **3c** hourly resources behind
price-line contributors.

Neat touches two things:

- **The price of the insurance line.** With a margin configured, the line's unit price is Neat's premium
  for the stay plus the margin, rounded up to the euro (feature spec rule 13). The core calls
  `utils/neatGuestPricing.js` from five places:
  - two live previews, which may call Neat: the fiche's `calculate-price` and website-booking's public
    `/quote`;
  - three saves, which read the cache only: devis compute, reservation create and reservation update.

  The website-booking plugin also reads `isNeatPricingActive` to keep a 0 € insurance on sale and label
  it « Tarif calculé pour vos dates ».
- **The subscription at Neat** once the deposit is paid:
  - `neatController`, `neatSubscriptionRunner`, `neatClient`, `neatFieldMapping` and
    `neatSubscriptionsModel` (two tables);
  - a 5-minute pass in `scheduledTasks.js`;
  - three direct kicks: reservation create, reservation update, and the payment recorder (3a);
  - 13 `neat*` columns in `app_settings`, one of them secret;
  - the fiche's `neat` block, its chip and two actions on the insurance row;
  - the Intégrations card;
  - a push preference.

Phase 0 gated only the subscription pass and the client surfaces. The mapping of 2026-10-02 found three
defects that follow from it:

1. **With the plugin off, the insurance is still priced by Neat.** `pricingConfig` reads the settings
   and never asks whether the plugin is live. A configured but deactivated Neat keeps re-pricing every
   quote, and keeps **calling Neat** on every fiche preview and every public quote.
2. **With the plugin off, the public site still says « Tarif calculé pour vos dates »** and keeps a 0 €
   insurance on sale. This has the same cause.
3. **The push preference « Souscriptions Neat »** shows in every user's settings, plugin or not.

Decision P10 (2026-10-01) sets the behaviour of a plugin turned off: **what is sold stays frozen to
the cent.** Its second half, « what is not sold falls back to the standard tariff », was replaced on
2026-10-02 by decision P13, after the mock:

- **Without an active Neat, the cancellation insurance is not offered anywhere.** No tile on the fiche
  or the devis, no block on the public site, no line in Paramètres › Options. This holds whether Neat is
  not installed, deactivated or out of plan.
- **A line already on a stay or a devis stays visible, frozen and read-only.**
- **The insurance option is hidden from Paramètres › Options** and comes back, with its settings, when
  Neat is active again.

Decision P12 (2026-10-01): **erasing Neat while subscriptions are active warns, then erases.** This
went against the recommendation to refuse.

Two things are pending at Neat and are not part of this PR:

- the new APIs and the « data provider » status announced at the September meeting;
- the 3.1 %-of-stay premium.

This phase moves the code as it is; the amendment for the new APIs comes when their documentation
arrives.

## 2. Goal

- The core owns the quote and its engine. A plugin can adjust it through **a quote post-processor**: a
  small, closed interface whose single output today is the insurance unit price. The engine stays pure,
  and the freeze of sold lines stays the engine's.
- Neat becomes the plugin `neat`. Its pricing, subscription pass, client, settings, tables, routes, fiche
  block, card and actions live in `server/src/plugins/neat/` and `client/src/plugins/neat/`.
- With the plugin off:
  - no Neat call;
  - the cancellation insurance offered nowhere: no tile, no public block, no line in Options;
  - no chip, card or push toggle;
  - every line already on a stay or a devis shown, unchanged and read-only.
- No contract changes: `/api/neat/*`, the public quote payload, the fiche's `neat` field, the settings
  and the subscriptions already made.

## 3. Functional rules

### 3.A The quote post-processor (core)

1. **The interface.** A plugin declares a processor with `ctx.quotePostProcessor(processor)`:

   | Member | Contract |
   |---|---|
   | `id` | `'neat'` |
   | `isReady()` | configured and usable; false = treated as no processor |
   | `priceSync(snapshot)` | `{ cancellationInsurancePrice } \| null`, synchronous, no network (cache only) |
   | `priceLive(snapshot)` | `Promise<{ cancellationInsurancePrice } \| null>`, may call the outside (and warm the cache) |

   - `snapshot` is the stay snapshot the core builds today: `startDate`, `endDate`, `nights`, `guests`,
     `accommodationAmount`, `insuranceAmount` (0), `totalAmount` (insurance excluded), `propertyName`,
     `reservationRef`.
   - **One output key, closed.** The core reads `cancellationInsurancePrice` (a finite number ≥ 0) and
     nothing else. Any other key, or a non-finite value, is ignored and logged. A future output is a new
     key added to this rule, not free-form engine input.
   - At most one processor per output key per instance: a second declaration fails that plugin's
     registration, as with the payment provider (3a rule 4).
   - A processor that throws, or a live call that fails, leaves the quote as computed (static tariff).
     The error is logged with the plugin id. Pricing never fails because of a plugin.
2. **The core applies it.** `server/src/utils/quotePostProcessors.js` exposes:
   - `applySync({ engineInput, quote, calculate })` and `applyLive(...)`.
     - Each builds the snapshot from the first engine run (today's `prepareReprice` and
       `buildQuoteSnapshot`: the insurance option, its line excluded from `totalAmount`, the property
       name).
     - Each asks the processor of a **live** plugin that `isReady()`, then re-runs the engine with
       `cancellationInsurancePriceOverride`.
     - Each returns the original quote when there is no processor, no insurance option, a `null`
       answer, or a re-run error.
   - `dynamicInsurance()`: true when a live, ready processor prices the insurance. It drives the public
     visibility of a 0 € insurance and its label.

   The five call sites of today call these two functions in place of `neatGuestPricing`, with the same
   sync/live split: previews live, saves sync.
3. **Sold lines stay frozen by the engine.** Nothing changes in `pricing.js`. A sold insurance line is
   replayed from its locked snapshot (`lockedInsuranceLine`, feature spec rule 13 « price lock
   unchanged »), whatever the override says or whether it comes at all. A devis keeps its quoted lines
   while its quote holds (tariff-recipes rule 12bis), exactly as today.

### 3.B The plugin turned off (decisions P10 and P13, defects 1–2)

4. **Plugin off = no processor.** A deactivated, out-of-plan or uninstalled `neat` declares nothing the
   core will call:
   - `applyLive` makes no Neat call;
   - `applySync` reads no Neat cache;
   - `dynamicInsurance()` is false.
5. **What that means on a stay** (P13). `quotePostProcessors.insuranceOffered()` is true only while a
   live plugin declares an insurance processor (Neat installed, active and in plan; configured or not).
   While it is false:
   - **nothing new gets the insurance.** A new devis, a new reservation, or an existing stay without the
     line cannot add it. A save whose payload adds it answers 422 `INSURANCE_NOT_OFFERED`
     « L’assurance annulation n’est pas proposée sans le plugin Neat. »;
   - **a line already there is kept as stored.** A sold reservation and a devis, quote still valid or
     expired, keep the line's unit price, billed units and billed amount to the cent through every later
     save. The server replays it from the stored line even where the devis lock would have expired.
   - **that line is read-only.** A payload that removes it, or changes its quantity, is ignored for that
     line: the stored line wins, and the rest of the save goes through. Only reactivating Neat lets
     someone remove it.
6. **The public site follows** `insuranceOffered()`:
   - `cancellationInsurance` is `null` in the catalogue and the quote: the site asks no question;
   - a booking request that sends the insurance has it ignored, as for an option the property does not
     offer.

   The WordPress contract (`cancellationInsurance` and its fields) is unchanged: `null` is already a
   value it handles (unpriced insurance, today).

### 3.C The plugin `neat`

7. **What moves into `server/src/plugins/neat/`.**
   - `neatClient.js`, `neatFieldMapping.js`, `neatSubscriptionRunner.js`, `neatSubscriptionsModel.js`.
   - `neatController.js`, built over the plugin store and the plugin's `ctx.db`.
   - `pricing.js`: what remains of `neatGuestPricing.js` once the snapshot moves to the core.
     - It keeps `computeGuestPrice` (whole-euro ceil, margin absent = inactive), `pricingConfig`, the
       24-hour cache ladder (fresh cache → live → stale cache → `null`) and `hashFieldValues`.
     - It implements the rule 1 processor: `priceSync` = the cache-only resolution, `priceLive` = the
       live one.
   - `settingsStore.js`: rule 10. `routes.js`: rule 8.

   The phase 1 isolation walk applies: inside the plugin, files require each other and `plugins/sdk`,
   nothing else. The core reads `reservations`, `clients`, `options`, `reservation_options` and
   `properties` through `ctx.db`, as today. `isDirectChannel` comes from the SDK's core modules.
8. **Routes, at their current URLs.** The plugin mounts `/api/neat` (`settings`, `test-connection`,
   `discovery`, `selection`, `mapping`, `reservations/:id/retry`, `reservations/:id/void`) through
   `ctx.mount`. `index.js` loses its `requirePlugin(PLUGINS.NEAT)` mount. Roles are unchanged: the
   Réglages endpoints are admin-only, and retry/void follow the fiche's rights.
9. **The subscription pass is the plugin's.**
   - `ctx.jobs.every({ name: 'subscription-pass', intervalMs: 5 min, bootDelayMs: 150 s })`, guarded
     against overlap as today.
   - The three kicks become event listeners: `reservation.created`, `reservation.updated` and
     `reservation.paid`. The bus already carries all three (3a), and the core emits them at the exact
     places it kicks today.
   - `stayPaymentRecorder` loses `afterPayment`.
   - `reservationsController` loses its two `kickPass` calls.
   - `scheduledTasks.js` loses its Neat block.

   A listener runs the pass in the background and never on the request path.
10. **Settings.**
    - The 13 `neat*` columns of `app_settings` are copied once into `plugin_settings` by the migration
      `settings_from_app_settings_v1`, under the same names. The secret is copied as its stored blob.
    - The secret `neatClientSecretEncrypted` is declared secret.
    - The generic `PUT /api/plugins/neat/settings` refuses every key: the Neat card and its
      discovery/selection/mapping flow write them, with their validation (feature spec §4.3).
    - `settingsStore.js` implements `neatConfig()` and `upsert(payload)` over `ctx.settings`, with
      today's shape: environment `'staging'` by default, and `marginPercent` null when unset.
    - `settingsModel` drops `neatConfig` and the Neat columns from its lists. The old columns stay in
      the table, unread. Erase empties them, as 3a does for Qonto.
11. **Tables.**
    - `neat_subscriptions` and `neat_price_cache` become the plugin's. Its migration
      `tables_v1` creates them with today's DDL (`CREATE TABLE IF NOT EXISTS`, so an existing database
      keeps every row).
    - `database.js` and `schema.sql` stop creating them.
    - A database where the plugin was never installed has no Neat table, and nothing in the core
      queries one.
12. **The fiche block is an SDK feature.**
    - `ctx.reservationBlock(key, build)` adds `build(reservation)` under `key` to the payload of
      `GET /api/reservations/:id`, only while the plugin is live.
    - Neat declares `neat` with today's `buildFicheBlock`: `null` for a platform stay, or with no job.
    - The payload field keeps its name and shape. A block that throws gives `null` and a log line,
      never a failed fiche.
    - Retry and void answer `{ neat }`, as today.
13. **Push.**
    - The `neat` push preference column stays core (`user_push_prefs`), and the pass still sends through
      `pushService.sendToPref('neat', …)`.
    - `GET /api/push/preferences` lists, under `available`, the keys a user can toggle; `neat` is in it
      only while the plugin is live (defect 3).
    - A stored preference is kept as it is when the plugin goes, and applies again when it comes back.
14. **Uninstall (decision P12).**
    - Deactivating keeps everything. Unlike Qonto's open links, nothing blocks it: an active
      subscription lives at Neat on its own, and a pending job simply waits.
    - « Effacer aussi ses données » erases:
      - the plugin settings;
      - the two tables;
      - the old columns, emptied.
    - Before it, the uninstall dialog lists what goes, with counts: the connection, then « N
      souscriptions en attente ou en échec ». **Active subscriptions get their own line, marked as a
      warning**: « N souscriptions actives chez Neat — elles restent en vigueur chez Neat et ne pourront
      plus être résiliées depuis GuestFlow ». The erase button stays available (P12: warn, then erase).
    - The insurance lines on the stays are core data and stay, at their price.

### 3.D Client

15. **The card moves.**
    - `SettingsNeatSection` moves to `client/src/plugins/neat/` and contributes to
      `settings.integrations` with `order: 20`, its place today.
    - `IntegrationsSettingsPage` loses its hard-coded Neat card and its `NEAT_ORDER` split: every card
      is a contribution.
    - The page bar still saves the card's draft through its ref, as Météo does.
16. **The chip and actions on the insurance row become a slot.**
    - `reservation.optionLine` takes contributions
      `{ id, appliesTo(option), Component }`. `OptionRow` renders, under the line, each live
      contribution whose `appliesTo` matches.
    - Each contribution receives the plugin's fiche block (`blocks[id]`) and an `onBlockChange` to
      replace it.
    - Neat contributes `appliesTo: (o) => o.isCancellationInsurance` and the chip, the premium line, the
      « ligne retirée » warning, « Relancer » and « Résilier chez Neat » (with its confirmation). It
      calls `/api/neat/...` itself.
    - `ReservationPage` and `OptionRow` lose every Neat state, callback and import. The page keeps the
      payload's plugin blocks, generically.
17. **Push preferences** render the toggles the server lists as `available`.
18. **Uninstall dialog.** `PluginCard` renders the data lines as a list; a line with `warning: true`
    shows in the warning colour with its icon, above the erase checkbox. Today the lines are joined on
    one line.

### 3.E Existing databases, new customers

19. **Upgrade.**
    - The settings copy and `tables_v1` run at the plugin's first boot.
    - A Solio-like database keeps:
      - its configuration (today: empty, staging);
      - its subscriptions;
      - its price cache;
      - every insurance line.

    In production today Neat is unconfigured and the insurance option is at 0 €: nothing visible
    changes.
20. **A new customer** starts with the plugin not installed (phase 0): the insurance is offered nowhere
    (P13). Installing Neat offers it at its Options price. Configuring Neat and setting a margin is the
    only way to get the Neat price and the subscriptions.

### 3.F The insurance offer follows Neat (decision P13)

21. **The option catalogue hides the insurance while it is not offered.** The core seeder keeps the
    option row (`cancellationInsuranceSeed`, untouched) and its settings. These hide it while
    `insuranceOffered()` is false:
    - `GET /api/options`;
    - the property's `options` and `optionGroups` (`GET /api/properties/:id`);
    - the public catalogue;
    - the SAS and mid-stay sale lists, which already exclude it.

    `GET /api/options/:id` on it answers 404, and `PUT` answers 404. A `POST` or `PUT` that sets
    `isCancellationInsurance` answers 400 « L’assurance annulation demande le plugin Neat. »
22. **A stay that carries the line gets it back, read-only.**
    - The fiche payload (`GET /api/reservations/:id`, `GET /api/devis/:id`) lists, under
      `frozenOptions`, the catalogue entry of each option the stay carries but the catalogue now hides.
      Today that is the insurance; the field is generic.
    - Each entry is marked `readOnly: true`, with the reason « Assurance annulation : plugin Neat
      inactif ».
    - The client merges these entries into the stay's option list. It renders their tile with the
      line's quantity and price, without the switch or the quantity control.
23. **The Options page** hides the « Assurance annulation » flag of the option form while Neat is not
    live (`usePlugin(NEAT)`, as for every plugin surface since phase 0; the server's 400 of rule 21 is the
    guard). The page follows `GET /api/options`, so the option row is gone with it. Reactivating
    Neat brings both back with the stored price, type and properties.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | Status | Responsibility |
|---|---|---|---|
| `utils/` | `quotePostProcessors.js` | C | Rules 1–6: the declared processor, `applySync`, `applyLive`, `dynamicInsurance`, `insuranceOffered`, the snapshot |
| `utils/` | `insuranceOffer.js` | C | Rules 5, 21–22: hide the insurance from option lists; keep a stored line as stored; 422 on an addition; `frozenOptions` |
| `utils/` | `neatGuestPricing.js` | D | Split: snapshot → `quotePostProcessors`, the rest → `plugins/neat/pricing.js` |
| `utils/` | `neatClient.js`, `neatFieldMapping.js`, `neatSubscriptionRunner.js` | M | → `plugins/neat/` |
| `utils/` | `stayPaymentRecorder.js` | T | `afterPayment` removed (rule 9) |
| — | `scheduledTasks.js` | T | Neat block removed |
| `models/` | `neatSubscriptionsModel.js` | M | → `plugins/neat/`, built over `ctx.db` |
| `models/` | `settingsModel.js` | T | `neatConfig` and the Neat columns removed |
| `models/` | `devisModel.js` | T | `applySync` in place of `repriceQuoteWithNeatSync` |
| `models/` | `pushSubscriptionsModel.js` | T | `available` keys (rule 13) |
| `controllers/` | `neatController.js` | M | → `plugins/neat/controller.js`, over the plugin store |
| `controllers/` | `reservationsController.js` | T | `applyLive` / `applySync`; kicks removed; plugin blocks in `getById` (rule 12) |
| `controllers/` | `reservationsController.js`, `devisController.js`, `models/devisModel.js` | T | Stored insurance line kept, addition refused, `frozenOptions` (rules 5, 22) |
| `controllers/` | `optionsController.js`, `models/optionsModel.js` | T | Insurance hidden, 404, flag refused (rule 21) |
| `models/` | `propertiesModel.js` | T | Property `options` / `optionGroups` without the insurance (rule 21) |
| `controllers/` | push preferences controller (`routes/push.js`) | T | `available` in the preferences answer |
| `routes/` | `neat.js` | M | → `plugins/neat/routes.js` |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `index.js` | T | `ctx.quotePostProcessor`, `ctx.reservationBlock`; `CORE_MODULES`: `quotePostProcessors` in, the three `neat*` out, `platformNameFormat` for `isDirectChannel` |
| `plugins/` | `index.js` | T | Registers the module |
| `plugins/neat/` | `index.js`, `pricing.js`, `settingsStore.js`, `controller.js`, `routes.js`, `client.js`, `fieldMapping.js`, `subscriptionRunner.js`, `subscriptionsModel.js`, `migrations.js`, `tests/` | C (mostly moved) | Rules 7–14 |
| `plugins/website-booking/` | `controllers/publicQuoteController.js`, `controllers/publicCatalogController.js` | T | `applyLive` and `dynamicInsurance()` from the core (rule 6) |
| `controllers/` | `pluginsController.js` | T | Data lines may carry `warning: true` (rule 14) |
| — | `index.js` | T | `/api/neat` mount removed |
| — | `database.js`, `schema.sql` | T | Neat tables no longer created by the core (rule 11) |

`optionsModel.getCancellationInsurance(propertyId, { neatPricingActive })` keeps its signature; the flag
is renamed `dynamicPrice` and fed by `dynamicInsurance()`.

### 4.2 Client side (`client/src/`)

| Layer | File | Status | Responsibility |
|---|---|---|---|
| `plugins/neat/` | `index.js`, `SettingsNeatSection.jsx`, `NeatInsuranceStatus.jsx` | C (card moved) | `settings.integrations` (rule 15), `reservation.optionLine` (rule 16) |
| `components/reservation/` | `OptionRow.jsx` | T | Renders the `reservation.optionLine` slot; read-only tile for a `frozenOptions` entry (rule 22); Neat code removed |
| `pages/` | `OptionsPage.jsx` | T | Insurance flag behind `usePlugin(NEAT)` (rule 23) |
| `pages/` | `ReservationPage.jsx` | T | Keeps the payload's plugin blocks; Neat state and callbacks removed |
| `pages/settings/` | `IntegrationsSettingsPage.jsx` | T | Contributions only |
| `components/` | `SettingsPushNotificationsSection.jsx` | T | Toggles from `available` |
| `components/` | `PluginCard.jsx` | T | Data lines as a list; warning lines (rule 18) |
| — | `api.js` | T | The `neat` calls move into the plugin, which uses the SDK's `request` |

It reuses `StatusBadge`, `ConfirmDialog`, `ErrorAlert` and `HelpedTextField`. `NeatInsuranceStatus` is
specific (one plugin, one line). The slot is generic.

### 4.3 API contract

| Endpoint | Change |
|---|---|
| `/api/neat/*` | Same URLs, mounted by the plugin; 404 `PLUGIN_INACTIVE` when off (as today) |
| `GET /api/reservations/:id` | `neat` unchanged in shape; present only while the plugin is live |
| `GET /api/reservations/:id`, `GET /api/devis/:id` | + `frozenOptions: [{ …option, readOnly: true, readOnlyReason }]` |
| `POST /api/reservations`, `PUT /api/reservations/:id`, devis create/update | 422 `INSURANCE_NOT_OFFERED` on an addition while not offered; a stored line is kept as stored |
| `GET /api/options`, `GET /api/properties/:id` | Insurance absent while not offered |
| `GET\|PUT /api/options/:id` (insurance) | 404 while not offered; the flag answers 400 |
| `POST /api/reservations/calculate-price`, `/public/v1/quote` | Neat price only while the plugin is live and ready |
| `/public/v1/properties/:id/options` | `cancellationInsurance`: `null` at 0 €, static price label, while off (rule 6) |
| `GET /api/push/preferences` | + `available: string[]` |
| `GET /api/plugins` | A data line may carry `warning: true` |
| `PUT /api/plugins/neat/settings` | 400 on every key |

## 5. Data model

- **`plugin_settings`** (`neat`): the 13 Neat keys, one of them secret.
- **`neat_subscriptions`, `neat_price_cache`**: unchanged columns. They are now created by the plugin
  migration `tables_v1`, and dropped on erase.
- **`app_settings`**: the 13 `neat*` columns stay, unread, and are emptied on erase.
- **`user_push_prefs.neat`**: unchanged, core.
- **Migration note** in `changelog.d/migration--plugins-phase-3b-neat.md`.

## 6. UI / UX

- **Paramètres › Intégrations:** unchanged order (Google, Neat, Météo, Sowel). The Neat card goes with
  the plugin.
- **Fiche, insurance row:** unchanged look (chip, premium line, warning, buttons), now drawn by the
  plugin. With the plugin off, the row shows its price and nothing else.
- **Fiche and devis, plugin off:**
  - no « Assurance annulation » tile on a stay without it;
  - on a stay with it, the tile shows its frozen price, greyed, without a switch, with the tooltip
    « Assurance annulation : plugin Neat inactif ».
- **Public site, plugin off:** no insurance block, no question.
- **Paramètres › Options, plugin off:** no insurance option, and no « Assurance annulation » box in the
  option form.
- **Profil › Notifications:** « Souscriptions Neat » only while the plugin is live.
- **Plugins › Neat › Désinstaller:** the data lines as a list. With active subscriptions, an ochre
  warning line above « Effacer aussi ses données », and the button stays available.
- **Mobile:** the uninstall dialog's list stacks at 375 px; the insurance row's buttons stay full-width
  under the line, as today.

## 7. Test plan

### Server — new tests

| File | Covers |
|---|---|
| `quote-post-processor.unit.test.js` | Rules 1–4: missing member; one per key; unknown keys ignored; throw → quote unchanged; live vs sync; inactive plugin → no call, `dynamicInsurance()` false |
| `insurance-price-plugin-off.unit.test.js` | Rules 3, 5, 6: sold line frozen to the cent across a save; expired devis keeps its line; removal or quantity change ignored; adding → 422; public quote and catalogue `null`; booking request ignores it |
| `insurance-offer-follows-neat.unit.test.js` | Rules 21–23: catalogue, property options and public catalogue hide it; 404 on get/put; 400 on the flag; `frozenOptions` on a stay that carries it; back with its settings on reactivation |
| `plugins/neat/tests/phase-3b-neat.unit.test.js` | Rules 7–14, 19–20: routes at their URLs; settings copy and secret; tables kept on upgrade; job cadence; the three events start a pass; fiche block only while live; push `available`; erase with active subscriptions → warning line, then erased; new customer |

### Moved and updated tests

- The six Neat suites and `neatFixtures.js` move under `plugins/neat/tests/`:
  `neat-client`, `neat-controller`, `neat-field-mapping`, `neat-guest-pricing`,
  `neat-subscription-scan`, `neat-subscription-worker`.
- `reservation-engine-input-card-options`, `stay-payment-recorder`, `plugins-phase-0`,
  `plugins-phase-1-sdk`, `push-subscriptions-model` and website-booking's suites assert the new seams.

### Client (Vitest)

- `plugins/neat/__tests__/NeatInsuranceStatus.test.jsx`: the chip per status; retry; void after
  confirmation.
- `OptionRow.plugin-slot.test.jsx`: a contribution renders under a matching line only.
- `PluginCard.erase-warning.test.jsx`: the warning line.
- `SettingsPushNotificationsSection.available.test.jsx`: no Neat toggle when not available.
- Moved: `SettingsNeatSection.*`, `ExtrasSection.neat-status` (rewritten over the slot),
  `IntegrationsSettingsPage.neat-save`.

### E2E

- `e2e/specs/plugins/neat.spec.js`:
  - plugin off: no Neat card, no push toggle, no « Tarif calculé pour vos dates » on the public options;
  - erase dialog lists the data lines.

### Manual verification

- **Shadow on :4101** (a copy of the dev database, secrets purged):
  - upgrade: settings and tables kept;
  - a Neat-priced sold line, seeded through the cache, stays at its price after deactivation and a
    save, while a new devis has no insurance tile;
  - the uninstall dialog with a seeded active subscription;
  - 375 px.
- **No Neat sandbox check:** Neat's staging credentials have still not been received. The subscription
  flow is moved untouched and covered by its moved suites.

## 8. Out of scope

- **Neat's new APIs, the data-provider status and the 3.1 % premium.** They need an amendment of the
  feature spec when the documentation arrives.
- **Voiding at Neat on erase or on cancellation.** Voiding stays a manual act (feature spec rule 15).
- **Hourly resources** (3c).
- **A second insurance provider.** The interface allows one per output key; none is written.

## 9. Open questions

None.

- **P10 and P12** were decided on 2026-10-01.
- **P13, decided 2026-10-02:**
  - the insurance is offered nowhere without an active Neat (not installed, deactivated or out of plan);
  - a line already on a stay or a devis is shown, frozen and read-only;
  - the option is hidden from Paramètres › Options.
