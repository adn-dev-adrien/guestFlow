# Plugins — phase 3b: the quote post-processor, and Neat cancellation insurance moves out of the core

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/plugins-phase-3b` (from `feature/plugins-phase-3`; #651 merged into `inte/plugins` meanwhile) |
| **Created** | 2026-10-02 |
| **Author** | Adrien |
| **Related PR** | [#652](https://github.com/adn-dev-adrien/guestFlow/pull/652) (target `inte/plugins`) |
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
- No contract changes for anything outside the app: `/api/neat/*`, the public quote payload, the
  settings and the subscriptions already made. The fiche's `neat` block moves under `pluginBlocks`.

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
   - a quote or a booking request that sends the insurance is refused like any option the property
     does not offer: 422 `VALIDATION_FAILED` « optionUnavailable »;
   - the public quote prices the insurance through `quotePostProcessors.livePrice()`, whether or not the
     visitor ticked it, so the amount beside the Oui/Non choice is the amount billed.

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
      today's shape: environment `'staging'` by default, and `marginPercent` null when unset. Its
      `isConfigured()` feeds the erase description.
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
    - `ctx.reservationBlock(key, build)` adds `build(reservation)` under `pluginBlocks[key]` in the
      payload of `GET /api/reservations/:id`, only while the plugin is live.
    - Neat declares `neat` with today's `buildFicheBlock`: `null` for a platform stay, or with no job.
    - The block keeps today's shape; it moves from `neat` to `pluginBlocks.neat`, which only the fiche
      reads. A block that throws gives `null` and a log line, never a failed fiche.
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
      `{ key, appliesTo(option), Component }`. `OptionRow` renders, under the line, each live
      contribution whose `appliesTo` matches.
    - Each contribution receives `option`, its plugin's block (`pluginBlocks[pluginId]`), an
      `onBlockChange` to replace it, and the stay's `reservationId` and `guestName`.
    - Neat contributes `NeatInsuranceStatus`, for `appliesTo: (o) => o.isCancellationInsurance`: the chip,
      the premium line, the « ligne retirée » warning, « Réessayer maintenant » and « Résilier chez
      Neat » (with its confirmation). It calls `/api/neat/...` itself, through the `api` client that
      keeps every endpoint, as for the other plugins.
    - The chip, once beside the option's title, opens the block under the line.
    - `ReservationPage` and `OptionRow` lose every Neat state, callback and import. The page keeps the
      payload's plugin blocks, generically.
17. **Push preferences** render the toggles the server lists as `available`.
18. **Uninstall dialog.** In `PluginCard`, a data line with `warning: true` shows apart, in the
    warning colour with its icon, above « Effacer aussi ses données », before the operator chooses. The
    other lines stay in the « Seront effacés : … C’est définitif. » sentence, as today.

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
    - The client adds these entries to the stay's option list and to its ungrouped options. Their tile
      reads « Prix figé : 23,00 € » and « Lecture seule »; its switch is disabled, with the reason as
      tooltip; the quantity, complement and moments controls are not drawn.
23. **The Options page** follows `GET /api/options`: without Neat the insurance row is not listed, so it
    cannot be edited. The form has no « Assurance annulation » control (the seeder sets the flag), so
    nothing else changes; the 400 of rule 21 guards the API. Reactivating Neat brings the row back with
    its stored price, type and properties.

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
| `controllers/` | `neatController.js` | M | → `plugins/neat/controller.js`, over the plugin store |
| `controllers/` | `reservationsController.js` | T | `applyLive` / `applySync`; kicks removed; plugin blocks in `getById` (rule 12) |
| `controllers/` | `reservationsController.js`, `devisController.js`, `models/devisModel.js` | T | Stored insurance line kept, addition refused, `frozenOptions` (rules 5, 22) |
| `controllers/` | `optionsController.js`, `models/optionsModel.js` | T | Insurance hidden, 404, flag refused (rule 21) |
| `models/` | `propertiesModel.js` | T | Property `options` / `optionGroups` without the insurance (rule 21) |
| `controllers/` | `pushController.js` | T | `available` in the preferences answer (rule 13) |
| `utils/` | `pluginReservationBlocks.js` | C | Rule 12: the blocks of live plugins, a throwing one as `null` |
| `routes/` | `neat.js` | M | → `plugins/neat/routes.js` |
| `plugins/sdk/` | `createContext.js`, `registry.js`, `index.js` | T | `ctx.quotePostProcessor`, `ctx.reservationBlock`; `CORE_MODULES`: the three `neat*` out; `quotePostProcessors`, `insuranceOffer` (website-booking), `reservationEngineInput`, `pushService` (neat) in |
| `plugins/` | `index.js` | T | Registers the module |
| `plugins/neat/` | `index.js`, `pricing.js`, `settingsStore.js`, `controller.js`, `routes.js`, `client.js`, `fieldMapping.js`, `subscriptionRunner.js`, `subscriptionsModel.js`, `migrations.js`, `tests/` | C (mostly moved) | Rules 7–14 |
| `plugins/website-booking/` | `controllers/publicQuoteController.js`, `controllers/publicCatalogController.js`, `publicProjections.js` | T | `livePrice()` and `dynamicInsurance()` from the core (rule 6) |
| — | `index.js` | T | `/api/neat` mount removed |
| — | `database.js`, `schema.sql` | T | Neat tables no longer created by the core (rule 11) |

`optionsModel.getCancellationInsurance(propertyId, { dynamicPrice })` and the public projection rename
their `neatPricingActive` flag `dynamicPrice`, fed by `dynamicInsurance()`. `pluginsController` is
unchanged: the data lines of `describe` reach the client as they are, `warning` included.

### 4.2 Client side (`client/src/`)

| Layer | File | Status | Responsibility |
|---|---|---|---|
| `plugins/neat/` | `index.js`, `SettingsNeatSection.jsx`, `NeatInsuranceStatus.jsx` | C (card moved) | `settings.integrations` (rule 15), `reservation.optionLine` (rule 16) |
| `components/reservation/` | `OptionRow.jsx` | T | Renders the `reservation.optionLine` slot; read-only tile for a `frozenOptions` entry (rule 22); Neat code removed |
| `components/reservation/` | `mockReservationForm.js` | T | The test context carries `pluginBlocks`, `setPluginBlock`, `pluginLineContext` |
| `pages/` | `ReservationPage.jsx` | T | Keeps the payload's plugin blocks and adds the `frozenOptions`; Neat state and callbacks removed |
| `pages/settings/` | `IntegrationsSettingsPage.jsx` | T | Contributions only |
| `components/` | `SettingsPushNotificationsSection.jsx` | T | Toggles from `available` |
| `components/` | `PluginCard.jsx` | T | Warning lines apart, before the choice (rule 18) |

It reuses `StatusBadge`, `ErrorAlert`, `MaskedTextField` and the app dialogs. `NeatInsuranceStatus` is
specific (one plugin, one line). The slot is generic. `api.js` and `OptionsPage.jsx` are unchanged.

### 4.3 API contract

| Endpoint | Change |
|---|---|
| `/api/neat/*` | Same URLs, mounted by the plugin; 404 `PLUGIN_INACTIVE` when off (as today) |
| `GET /api/reservations/:id` | `neat` → `pluginBlocks.neat`, same shape; present only while the plugin is live |
| `GET /api/reservations/:id`, `GET /api/devis/:id` | + `frozenOptions: [{ …option, readOnly: true, readOnlyReason }]` |
| `POST /api/reservations`, `PUT /api/reservations/:id`, devis create/update | 422 `INSURANCE_NOT_OFFERED` on an addition while not offered; a stored line is kept as stored |
| `GET /api/options`, `GET /api/properties/:id` | Insurance absent while not offered |
| `GET\|PUT /api/options/:id` (insurance) | 404 while not offered; `POST`/`PUT` with the flag answer 400 |
| `POST /api/reservations/calculate-price`, `/public/v1/quote` | Neat price only while the plugin is live and ready; the insurance refused while not offered (422) |
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
- **Fiche, insurance row:** the chip, the premium line, the warning and the buttons, now drawn by the
  plugin in one block under the line (the chip used to sit beside the title).
- **Fiche and devis, plugin off:**
  - no « Assurance annulation » tile on a stay without it;
  - on a stay with it, the tile reads « Prix figé : 23,00 € » and « Lecture seule », its switch
    disabled with the tooltip « Assurance annulation : plugin Neat inactif ».
- **Public site, plugin off:** no insurance block, no question.
- **Paramètres › Options, plugin off:** no insurance option in the list.
- **Profil › Notifications:** « Souscriptions Neat » only while the plugin is live.
- **Plugins › Neat › Désinstaller:** with active subscriptions, an ochre warning line above « Effacer
  aussi ses données »; the other lines in the « Seront effacés » sentence; the button stays available.
- **Mobile:** the warning wraps at 375 px; the insurance row's buttons stay full-width under the line,
  as today.

## 7. Test plan

### Server — new tests (24)

| File | Tests | Covers |
|---|---|---|
| `quote-post-processor.unit.test.js` | 6 | Rules 1–4: missing member; one per key; sync vs live; unknown keys and non-amounts ignored; a throw leaves the quote; an inactive plugin is never called, offered or dynamic |
| `insurance-price-plugin-off.unit.test.js` | 5 | Rules 3, 5: a sold line kept at 23 € with the lock dropped; removal and quantity change ignored; a devis keeps its line; an addition → 422, a default never adds it; with Neat the gate steps aside |
| `insurance-offer-follows-neat.unit.test.js` | 5 | Rules 6, 21–23: catalogue, property and site lists hide it, row kept; 404 and the flag refused; `frozenOptions`; the site refuses it like an unavailable option; back with its settings |
| `plugins/neat/tests/phase-3b-neat.unit.test.js` | 8 | Rules 1, 7–14, 19–20: the processor declared, gone when off; `/api/neat` only while live; settings copied, secret encrypted, tables kept; the job and its three events; the fiche block only while live; push `available`; erase warns, then erases, reinstall empty; a new customer has no insurance |

### Moved and updated tests

- The six Neat suites and `neatFixtures.js` moved under `plugins/neat/tests/` (`neat-client`,
  `neat-controller`, `neat-field-mapping`, `neat-guest-pricing`, `neat-subscription-scan`,
  `neat-subscription-worker`); `neat-guest-pricing` now drives the pricing through the core's
  post-processor.
- A shared non-test module `tests/insuranceOfferFixture.js` offers the insurance in the suites that
  exercise it (`cancellation-insurance-option-crud`, website-booking's `public-cancellation-insurance`).
- `plugins-phase-0`, `plugins-phase-1-sdk` (Neat joins the modules and the jobs; `hourly-resources` is
  now the module-less example), `stay-payment-recorder` (the event is the only follow-up),
  `public-projections-language` and `public-quote-catalogue-language` assert the new seams.
- Server total: 4,789.

### Client (Vitest) — new tests (5)

- `plugins/neat/__tests__/NeatInsuranceStatus.test.jsx` (6, rewritten from
  `ExtrasSection.neat-status` over the slot): the chip per status; retry; void after confirmation;
  the answer handed back to the fiche.
- `OptionRow.plugin-slot.test.jsx` (2): a contribution under the matching line only; a frozen option
  read-only at its price.
- `PluginCard.erase-warning.test.jsx` (1): the warning before the choice; erasing still possible.
- `SettingsPushNotificationsSection.available.test.jsx` (2): the Neat toggle follows `available`.
- Moved: `SettingsNeatSection.*`, `IntegrationsSettingsPage.neat-save`, `neatSectionFixtures`.
- Client total: 1,504.

### E2E (96: 95 passed, 1 skipped as before)

- `e2e/specs/plugins/neat.spec.js` (1): switched off, the insurance leaves the catalogue (404 on the
  option), the Neat card and the push toggle go and `/api/neat` answers 404; switched on, the option
  comes back with its price and type.

### Manual verification (done 2026-10-02)

- **Shadow on :4102**, a copy of the 3a shadow (dev database v3.8, secrets purged):
  - upgrade: the settings copy and `tables_v1` ran;
  - a stay sold with the insurance at 24 € (8 € × 3 nights), Neat active; Neat deactivated: the
    catalogue, the property tiles and its groups lose the insurance, `GET /api/options/32` → 404;
  - the option raised to 12 € a night, then a save without the line and with « Utiliser les tarifs
    actuels », then one with quantity 4: the line stays 1 × 24,00 €;
  - a new stay or a preview asking for it → 422 `INSURANCE_NOT_OFFERED`; the preview of the sold stay
    shows 24 €; the push preferences no longer list `neat`;
  - the fiche at 1280 and 375 px: « Prix figé : 24,00 € », « Lecture seule », switch disabled; a save
    from the fiche keeps the line;
  - Neat back with a seeded active subscription: « Neat : souscrite », the premium and « Résilier chez
    Neat » under the line at 375 px;
  - Plugins › Neat at 375 px: the warning before « Effacer aussi ses données »; erase → tables and
    settings gone, the line kept and shown read-only; reinstall → no subscription, the option back.
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
