# Google Vacation Rentals — price and availability feed (plugin)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/google-vacation-rentals-feed` (targets `inte/plugins`) |
| **Created** | 2026-10-26 |
| **Author** | Adrien |
| **Related PR** | [#787](https://github.com/adn-dev-adrien/guestFlow/pull/787) |

---

## 1. Context

Until 2026-10-26 the two Solio properties appeared in Google Vacation Rentals (the « Locations de
vacances » results of Search and Maps) through Lodgify, a Google-approved connectivity partner.
Lodgify is gone (`specs/lodgify-decommission.md`): both listings were delisted from Google the same
day, so Google no longer shows a price or a « Réserver » button for Solio. The Business Profile of
the domain is a lodging profile (« Vacances à la ferme »): it has no free booking-link field — on a
lodging profile, the booking module only exists when someone feeds Google prices.

On 2026-10-26 the operator filled Google's *Vacation Rentals interest form* as an individual owner,
committing to an **ARI** connection (pushed nightly rates, availability and restrictions) and a
real-time feed. Google decides whether to onboard us; if it does, a Technical Account Manager drives
the onboarding, and the account goes live only after three consecutive days of an *Excellent* price
accuracy score — the price Google caches must equal what domainesolio.com charges.

What GuestFlow already has (measured on `inte/plugins`, 2026-10-26):

- One pricing authority: `calculateReservationQuote` (`server/src/utils/pricing.js:1254`). The
  website quote (`POST /public/v1/quote`, `website-booking/controllers/publicQuoteController.js`)
  calls it with `platform: 'direct'` and the property's default options. Whatever Google shows must
  come out of that same call.
- A night's price depends on its **position in the stay** (`pricingMode: 'progressive'`, tiers from
  the second night) and the stay can carry a length-of-stay discount, an extra-guest supplement and a
  tourist tax per adult and night. A single "price per date" therefore cannot reproduce the website.
- Availability: `computeBlockedDates` (`utils/blockedDates.js:14`) — reservations, iCal imports and
  closures; minimum stay and changeover days from the pricing rules (`pricing.js:1075`,
  `utils/changeover.js:73`).
- No event fires when a price, a closure or a pricing rule changes; reservations emit
  `reservation.*` and `ical.imported` (`plugins/sdk/eventBus.js:14`).
- The site's structured data already carries `VacationRental` on `/la-granja/` (crawled listing feed
  prerequisite). The WordPress booking block does not read dates or guests from its URL.

## 2. Goal

Once Google accepts the partnership, a traveller who searches the Solio properties on Google sees the
exact price of their dates on domainesolio.com and lands on the site with those dates and that party
size already filled in — with no channel manager in between.

## 3. Functional rules

**Scope and packaging**

1. Everything ships as the plugin **`google-vacation-rentals`** (`server/src/plugins/google-vacation-rentals/`,
   `client/src/plugins/google-vacation-rentals/`). Without the plugin installed, no table, route, job
   or screen exists. The core receives one generic brick only: the `pricing.changed` event (rule 12),
   inert when no plugin listens to it.
2. The plugin is inert until configured: no Google partner id → no job runs, the settings tab says
   what is missing (`setupStatus`).

**What is sent**

3. Each enabled property is one Google listing with exactly one room type and one rate plan
   (Google's vacation-rental model). Its `HotelCode` is set per property in the plugin settings
   (default: the `identifier` the website's structured data already uses, e.g. `solio-la-granja`).
4. **Prices are length-of-stay totals computed by `calculateReservationQuote`**, never re-derived:
   for every arrival date in the horizon and every stay length from the property's minimum to
   `maxLos` (setting, default 14 nights), and for every party size from 1 to the public guest cap
   (amended at the 2026-10-27 audit: it started at the included guests when the tourist tax ignored
   the headcount, but a per-person default option still makes a smaller party cheaper on the site —
   230 € on the site, 260 € sent for 2 guests of 4 included), the plugin asks the quote engine for
   `platform: 'direct'` with the same default options as the website, and sends the resulting total
   **tax included** (accommodation + extra-guest supplement + default options + tourist tax).
5. A stay the website would refuse is not priced: an itinerary that breaches minimum/maximum stay,
   changeover days or crosses a blocked night is omitted (and expressed as a restriction, rule 7).
6. **Inventory** is 1 on a free night and 0 on a night blocked by a reservation, an imported iCal
   event or a closure — the same `computeBlockedDates` the website uses, including the early
   check-in / late check-out blocking of the adjacent night.
7. **Restrictions**: minimum stay per arrival date (`SetMinLOS`), maximum stay, closed-to-arrival
   and closed-to-departure on the days the changeover rules forbid, and a master close on closures.
8. **Horizon**: from today to `horizonDays` ahead (setting, default 365, never beyond the last date
   the tariff recipe has generated). Dates past the horizon are sent closed.
9. Prices are in EUR, amounts rounded exactly as the quote engine rounds them.

**When it is sent**

10. The plugin keeps a snapshot of what it last sent per property (itinerary → amount, date →
    inventory/restrictions). It sends **only the difference** (Google merges ARI messages).
11. A reservation event (`reservation.created|updated|cancelled|deleted`, `ical.imported`) triggers
    a recompute of the affected property's inventory and restrictions within one minute.
12. **A tariff change is pushed as soon as it is saved** (decision of 2026-10-26: GuestFlow knows
    when a price changes, so no polling). The core emits a new plugin event
    `pricing.changed { propertyId | null, source }` (`null` = every property) after every write that
    can move a price, a minimum stay, a changeover day or a closed night:
    - pricing rules: add, update, delete, apply-to, assign-dates (`routes/properties.js:26-30`);
    - a property update touching a price-bearing field (extra-guest price and included guests,
      tourist tax settings, max guests, default check-in/check-out);
    - the property's options and option defaults (`routes/properties.js:38-43`) — the website quote
      merges the default options;
    - establishment closures: create, update, delete (`establishmentClosuresController.js`);
    - a tariff recipe applied or its horizon extended (`tariff-recipes`, through the SDK's emit);
    - the shared option catalogue: an option updated or deleted (`null`), since a property's default
      option is part of its website quote (added at implementation, 2026-10-26).
    A plugin may emit `pricing.changed` and nothing else (`ctx.events.emit`, SDK 2.4.0).
    The plugin recomputes the affected property, debounced 30 seconds so that a recipe that writes
    dozens of rules triggers one run, and pushes the diff.
13. A daily full re-send (not a diff) at a quiet hour repairs any drift between Google and the
    snapshot and sends the new last day of the rolling horizon. It is the safety net for a write path
    that would forget to emit `pricing.changed`.
14. A failed send (HTTP error, timeout) leaves the snapshot unchanged for the failed part, so the next
    run re-sends it; Google's error/warning body is stored and shown, never swallowed.

**Modes**

15. **Simulation** (default): everything is computed and the XML is written to the plugin's data
    directory and to the push log, nothing leaves the server. This is the mode until Google gives us a
    partner account and allowlists the production IP.
16. **Envoi**: messages are POSTed to `https://www.google.com/travel/hotels/uploads/...` with
    `Content-Type: application/xml`. Switching to Envoi requires the partner id and at least one
    enabled property.

**Price accuracy**

17. A *check* action draws N random itineraries (dates, length, party size) and compares, for each,
    the total the plugin sends with the total `POST /public/v1/quote` returns. Any difference is a bug
    and is listed with both amounts. This is the gate before switching to Envoi and the tool to answer
    a Google accuracy complaint.

**Landing page**

18. The point-of-sale URL template given to Google points to the property's page on the website with
    the dates and party size: `https://domainesolio.com/<slug>/?checkin=DD%2FMM%2FYYYY&checkout=DD%2FMM%2FYYYY&guests=N`
    plus `utm_source=google&utm_medium=vacation-rentals`. The WordPress booking block opens with those
    dates and that party size prefilled (WordPress plugin change, rule 19).
19. The WordPress booking block reads `checkin`, `checkout` (DD/MM/YYYY) and `guests` from the URL
    when present; invalid or past values are ignored silently and the block opens empty, as today.

**Edge cases**
- A property with no pricing rule on a date → no price sent for itineraries touching it, the date is
  closed, and the check (rule 17) lists it.
- A reservation imported by iCal on a night already sent as available → rule 11 closes it within a
  minute; Google may still sell it during that minute, as on any channel — the website quote refuses
  it anyway (it re-checks availability).
- A recipe re-applied mid-day → one `pricing.changed` per write, one debounced run (rule 12); the
  change reaches Google within a minute of the save.
- A direct SQL edit of prices (never done in production) → no event; repaired by the nightly full
  re-send (rule 13).
- Party size above `maxGuests` → never priced.
- Plugin disabled → jobs stop; the operator is told to remove the listings in Hotel Center (Google
  keeps cached prices otherwise).

---

## 4. Architecture

### 4.1 Server side

| Path | Responsibility |
|---|---|
| `plugins/google-vacation-rentals/manifest.json` | Plugin identity, version, `requires: ['website-booking']` (the landing page is the website). |
| `plugins/google-vacation-rentals/index.js` | `register(ctx)`: settings declaration, migrations, routes, jobs, event subscriptions, `setupStatus`, `data` (tables + purge). |
| `.../settings.js` | Declared settings: `partnerId`, `mode` (`simulation`/`envoi`), `horizonDays`, `maxLos`, `fullResendHour`, per-property `{enabled, hotelCode, slug}`. Validation. |
| `.../itineraries.js` | Pure: enumerates the itineraries to price for a property (arrival × length × party size) from the rules, minimum stay and horizon. |
| `.../calendar.js` | Orchestration: for each itinerary calls the website's quote (`coreModule('directQuote')`); for each date computes inventory and restrictions from `computeBlockedDates`, the engine's per-night minimum/maximum and the changeover helper. Async: yields to the event loop after each stay length. Returns a normalized state. |
| `.../source.js` | Everything read from the core through the SDK: property, rules, blocked nights, closures, the quote bound to a per-run statement cache, and the website's own quote for the check. |
| `.../snapshot.js` | Diffs the computed state against the stored snapshot; commits only acknowledged parts. |
| `.../ariXml.js` | Pure: builds `Transaction` (property data), `OTA_HotelRateAmountNotifRQ`, `OTA_HotelInvCountNotifRQ`, `OTA_HotelAvailNotifRQ`, `Taxes` messages from a diff. String templates with escaping, no XML dependency. |
| `.../googleClient.js` | POSTs a message, timeout via AbortController, injectable `fetchImpl`; parses the response body for success/warnings/errors. In simulation, writes to `ctx.dataDir` instead. |
| `.../pushService.js` | One run: compute → diff → build → send → commit → log. Serialized per property (no two runs overlap). Triggers: `schedule(propertyId, 'availability' | 'pricing')` (debounce 10 s / 30 s, a pending availability run becomes a pricing one if a price change joins it), `nightlyTick()` (hourly job). |
| `.../accuracyCheck.js` | Rule 17: random itineraries, plugin amount vs public quote amount. |
| `.../controller.js` + routes | `GET /api/google-vacation-rentals/status`, `POST .../push` (run now, optional `full`), `POST .../check`, `GET .../log`. Mounted with `ctx.mount('/api/google-vacation-rentals', …)`. |
| `.../model.js` | Tables of §5. |
| `.../tests/*.unit.test.js` | §7. |

Core — one generic brick, inert without a listener:

| Path | Change |
|---|---|
| `plugins/sdk/eventBus.js` | `pricing.changed` added to `EVENTS`. |
| `plugins/sdk/createContext.js` | `ctx.events.emit(name, payload)`, restricted to core-declared events, so `tariff-recipes` can announce a recipe apply. |
| `controllers/propertiesController.js` (pricing, update, options) | `emit('pricing.changed', { propertyId, source })` after a successful write. |
| `controllers/propertyOptionDefaultsController.js` (or wherever `option-defaults` lives) | same. |
| `controllers/establishmentClosuresController.js` | same, `propertyId: null` for an establishment-wide closure. |
| `plugins/tariff-recipes/{model,index}.js` | emit after apply and after the daily horizon extension. |
| `tests/pricing-changed-event.unit.test.js` | every write path above emits exactly once; a failed write emits nothing. |
| `utils/pricingChanged.js` (new) | `emitPricingChanged(propertyId, source)` and the price-bearing columns a property update is compared on. |
| `controllers/optionsController.js` | emits `null` after an option update or delete. |
| `utils/directQuote.js` (new) | The website's quote (`buildEngineQuote`, default options merged), moved unchanged out of `website-booking/controllers/publicQuoteController.js`. A factory `createDirectQuote(deps)`: website-booking binds it to the modules it reaches through the SDK (its tests mock them there), the feed binds it to a per-run statement cache; `buildEngineQuote` is the core-bound default. On the SDK allowlist as `directQuote` (`sdk/index.js`, `coreModules.json`). |
| `controllers/pluginsController.js` | A declared setting's `validate(value, body)` receives the whole write as a second argument, for a key that depends on another sent with it (Envoi needs the partner id, rule 16). Additive. |
| `plugins/sdk/version.js` | SDK 2.4.0 (two entry points added: `ctx.events.emit`, `coreModule('directQuote')`). tariff-recipes 1.2.0 and website-booking 1.7.1 declare `^2.4.0`. |

The plugin otherwise uses `coreModule('pricing' | 'blockedDates' | 'changeover' |
'propertiesModel')`, all already on the SDK allowlist. If the quote's default-options merge lives
only inside `website-booking`, it is exported from there through the SDK rather than copied.

WordPress (`integrations/wordpress/guestflow-booking/blocks/booking/view.js`): read
`checkin`/`checkout`/`guests` from the URL (rule 19). Plugin version 1.17.0 (header, constant, readme).

### 4.2 Client side

| Path | Responsibility |
|---|---|
| `client/src/plugins/google-vacation-rentals/index.js` | Contributes a « Google Vacation Rentals » tab to `settings.integrations`. |
| `.../SettingsGoogleVrSection.jsx` | Partner id, mode, per-property toggle + HotelCode + page slug, horizon/LOS; status card (last run, sent/failed counts, last Google error); actions « Pousser maintenant », « Tout renvoyer », « Vérifier les prix »; the last check's mismatches; the push log. Uses existing `StatusCard`, `SummaryItem`, `TableCard`, `ConfirmDialog`. |

No computation on the client: every count, status and mismatch comes from the endpoints. The HTTP
wrappers (`getGoogleVrStatus`, `pushGoogleVr`, `checkGoogleVr`, `getGoogleVrLog`) live in the core
`api.js` like the other plugins'. The plugin card's icon `travel-explore` joins `PluginCard`. No new
generic component: the tab uses `ConfirmDialog`, `StatusBadge` and `SummaryItem` (there is no
`StatusCard` or `TableCard` use — the per-property card and the log list stack the same way on every
width).

### 4.3 API contract

- `GET /api/google-vacation-rentals/status` → `{ mode, configured, enabledCount, properties: [{id, name, enabled, hotelCode, slug, landingUrl, lastRunAt, lastResult, lastResultLabel, itineraries, pendingDiff, scheduled}], lastError: {at, propertyId, text} | null, lastCheck }` — `landingUrl` is the rule 18 template with Google's point-of-sale variables, null without a website origin; `pendingDiff` is what the last run failed to deliver.
- `POST /api/google-vacation-rentals/push` `{ propertyId?, full? }` → `{ mode, runs: [{propertyId, result, resultLabel, messages, rates, days, failed, quotes, durationMs, notes}] }`; 409 when no property is enabled, 404 for a property not enabled.
- `POST /api/google-vacation-rentals/check` `{ propertyId?, samples? }` → `{ checked, mismatches: [{propertyId, checkin, nights, guests, sent, website}] }`
- `GET /api/google-vacation-rentals/log?limit=` → `{ runs: [{id, propertyId, propertyName, startedAt, finishedAt, mode, full, reason, messages, rates, days, failed, httpStatus, result, resultLabel, googleBody}] }`.

## 5. Data model

Plugin-owned tables (created by the plugin's migrations, purged by « Effacer aussi ses données »):

- `gvr_rate_snapshot(propertyId, checkin, nights, guests, amountCents, sentAt)` — PK on the first four.
- `gvr_day_snapshot(propertyId, date, inventory, minLos, maxLos, closedToArrival, closedToDeparture, closed, sentAt)`.
- `gvr_push_log(id, propertyId, startedAt, finishedAt, mode, full, reason, messages, rates, days, failed, httpStatus, result, googleBody)` — kept 90 days. `reason` (manual, full, pricing, availability, nightly) finds the day's nightly run; `failed` counts what was not delivered.

Settings in `plugin_settings` (no secret: Google authenticates by source IP).

## 6. UI / UX

A single tab under Réglages → Intégrations, like the other plugins. Mobile: the status card stacks,
the property table becomes one card per property, the log becomes a list; actions stack full-width.
« Tout renvoyer » and the switch to Envoi go through a `ConfirmDialog`. The interactive mock is in
`docs/specs/2026-10-26-google-vacation-rentals-feed.html`.

## 7. Test plan

### Server unit tests (`plugins/google-vacation-rentals/tests/`)
- Itineraries: minimum stay, maximum LOS, every party size from 1 to the cap (2026-10-27), horizon cap.
- `tests/small-party-pricing.unit.test.js` (2026-10-27): with a per-person default option and no headcount tax, a party of 2 is sent the website's 230 €, not the 4-guest 260 €.
- Calendar: an itinerary's amount equals `calculateReservationQuote` + tourist tax for the gîte
  recipe (progressive 3–6 nights, weekly discount, supplement above 10 guests) and the tente recipe.
- Blocked night, closure, changeover → itinerary omitted and the right restriction emitted.
- `pricing.changed` → one debounced run for the property; two events within 30 s → one run.
- Diff: unchanged state → nothing to send; one price changed → one rate message; failed send →
  snapshot unchanged.
- XML: each message matches a golden file; escaping of codes.
- Accuracy check: sent amount vs public quote — zero mismatch on fixtures; a forced mismatch is reported.
- Simulation mode never calls `fetch`.

### Implemented (2026-10-26)
- Server, plugin (`plugins/google-vacation-rentals/tests/`): `itineraries` 6, `settings` 6, `ari-xml` 8
  (golden files `tests/golden/*.xml`, inputs in `tests/goldenInputs.js`), `calendar-recipes` 9 (the
  shipped gîte and tente recipes on the real engine), `push-service` 11, `accuracy-check` 5,
  `plugin-routes` 7 — 52 tests.
- Server, core: `tests/pricing-changed-event.unit.test.js` 9, `tests/wordpress-plugin-landing-stay.unit.test.js` 5
  (rules 18-19, the block's URL readers run in a sandbox). Amended: `plugins-phase-0` (16 plugins, the
  first with a `requires`), `plugins-phase-1-sdk` (module list, the hourly job, google-calendar ignores
  `pricing.changed`), `plugin-page-owner` (nine Intégrations plugins).
- Server suite: 6198 → 6264 tests, all passing.
- Client: `plugins/google-vacation-rentals/__tests__/SettingsGoogleVrSection.test.jsx` 6; registry and
  Intégrations-tab tests list the plugin. Client suite: 2147 → 2153 tests, all passing.
- E2E `plugins-page.spec.js`: 16 plugins installed by the seed (15 after the uninstall step).

### Manual verification
- On a copy of production: full run in simulation, XML inspected, check on 200 itineraries → 0 mismatch.
- Settings tab at xs / md / lg.
- WordPress: `/la-granja/?checkin=12%2F12%2F2026&checkout=14%2F12%2F2026&guests=4` opens the block prefilled; an invalid date opens it empty.
- After Google onboarding: Hotel Center feed status clean, accuracy *Excellent* 3 days in a row.

## 8. Out of scope

- The listing feed: the crawled feed (structured data + sitemap on the website) is Google's
  recommended path for small inventories and already exists; an XML list feed is only built if the
  Technical Account Manager asks for it.
- Google Hotels (non vacation-rental) and paid Hotel Ads.
- Promotions/RateModifications messages: length-of-stay totals already carry the weekly discount.
- Any other operator than Solio until Google accepts individual owners in general.

## 9. Open questions

- Q1: `maxLos` default — 14 nights?
  - A: **Resolved 2026-10-26** — 14 nights.
- Q2: How soon must a price change reach Google?
  - A: **Resolved 2026-10-26** — as soon as it is saved: GuestFlow knows when a tariff changes (the
    pricing pages, a recipe apply), so the core emits `pricing.changed` and the plugin pushes on it
    (rule 12). No periodic recompute; the nightly full re-send stays as a safety net (rule 13).
- Q3: Exact XML shape of LOS-based amounts and of the tourist tax (per adult per night) — to be
  confirmed with the ARI reference and the Technical Account Manager before the XML module is frozen.
- Q4: Which production IP is allowlisted in Hotel Center (the public IP of the host running GuestFlow).

## 10. Implementation notes (2026-10-26)

- **Measured cost** (two properties, the shipped recipes, horizon 365 days, 14 nights): a full run
  quotes 63 826 stays for the gîte (14 party sizes, the tourist tax counts each adult) and 5 424 for the
  tente — 65 to 86 s in all over four measurements, of which 61 to 82 s for the gîte and 4 s for the
  tente; a reservation run 5 s; a 200-stay check 0.2 s with 0 mismatch.
  The engine's own per-night parsing dominates; the feed does not touch the engine. Two measures keep it
  usable: the feed's quote reuses compiled SQL statements for the whole run (a quarter of the time), and
  a run caused by a reservation or an iCal import keeps the amounts already sent (a booking moves no
  price) and only quotes the stays that became sellable. A run yields to the event loop after each
  stay length, so the server stays responsive. Consequence for rule 12's edge case: a tariff change
  reaches Google about 30 s (debounce) + up to a minute and a half (the gîte's recomputation) after
  the save, not « within a minute ».
- **Party sizes** (rule 4): every size from 1 to the public cap is priced (2026-10-27 audit; it used
  to start at the included guests when the tourist tax ignored the headcount, which overpriced small
  parties whenever a per-person default option existed).
- **Taxes** (rule 4, Q3): the tourist tax travels inside each length-of-stay amount
  (`AmountAfterTax`, with `AmountBeforeTax` beside it) instead of a separate Taxes message; the whole
  length-of-stay shape is isolated in `ariXml.losAmountMessage`, to be confirmed with Google (Q3).
- **Inert without partner id** (rule 2): the triggers and the nightly job wait for it; the manual
  « Pousser » and « Vérifier » work in simulation without it, so the feed can be checked before Google
  opens the account.
- **Days past the horizon** (rule 8): `maxLos` more days are sent closed, so no stay reaches an unsent
  date.

## 11. Go-live runbook — resume when Google answers

Everything on GuestFlow's side is done; the only thing left is Google. This section is the
checklist to pick the work up again the day Google replies.

### 11.1 Where things stand (2026-10-27)

- **Google**: the *Vacation Rentals interest form* was sent on 2026-10-26 (legal name Solio, trade
  name Domaine Solio, contact address `contact@domainesolio.com`). No answer yet. Google may also
  decline: individual owners are onboarded case by case.
- **Plugin**: `google-vacation-rentals` merged into `inte/plugins` (#787), Simulation mode by default.
  Not on `master`, so not in any release and not in production (production runs the `master` line,
  v3.17.0 / v3.18.0).
- **WordPress plugin 1.17.0** (booking block opened with the stay of its address, rule 18): also only
  on `inte/plugins`. The site runs 1.14.3, the latest published. Decision of 2026-10-27: no backport,
  it ships with the `inte/plugins` → `master` integration — nothing needs it before Google opens the
  account.
- **Lodgify**: cancelled, both listings delisted from Google on 2026-10-26
  (`specs/lodgify-decommission.md`). Until go-live, Google shows no price for Solio.

### 11.2 Prerequisite — get the code into production

1. `inte/plugins` integrated into `master` (the user's merge), then a release (`/guestflow-release`).
2. Operator installs the release (Réglages → Système et mises à jour), then updates the WordPress
   plugin to ≥ 1.17.0 from the WordPress admin.
3. Check on the live site: `/la-granja/?checkin=DD%2FMM%2FYYYY&checkout=DD%2FMM%2FYYYY&guests=4`
   opens the booking block prefilled; an invalid date opens it empty.

### 11.3 When Google answers — the questions to settle with the Technical Account Manager

- **Q3** — the exact XML shape of length-of-stay amounts and of the tourist tax (per adult and
  night, currently inside `AmountAfterTax`, §10). The answer only touches
  `ariXml.losAmountMessage` and its golden test.
- **Q4** — the production public IP to allowlist in Hotel Center: measure it from the production
  host (`curl -s https://ifconfig.me`), do not guess it from the router.
- The **partner id** and Hotel Center access; whether Google assigns the `HotelCode` of each
  property or lets us choose it (rule 3 accepts `^[a-z0-9-]{3,40}$`).
- Confirm the **crawled listing feed** (structured data on `/la-granja/` and the tente page) is
  enough, or whether an XML listing feed is required (§8 — out of scope until asked).
- The **landing page template** to register: rule 18,
  `https://domainesolio.com/<slug>/?checkin=DD%2FMM%2FYYYY&checkout=DD%2FMM%2FYYYY&guests=N`.

### 11.4 Go-live steps, in order

1. Réglages → Intégrations → Google Vacation Rentals: enter the partner id, enable both properties
   with their `HotelCode` and page slug. Mode stays **Simulation**.
2. « Tout renvoyer » then « Vérifier les prix »: 0 mismatch expected; read the simulated XML in the
   plugin's data directory against the ARI reference.
3. Apply the Q3 answer to `ariXml.losAmountMessage` if Google wants another shape (PR, spec §10
   updated, release).
4. Allowlist the Q4 IP in Hotel Center.
5. Switch the mode to **Envoi** (confirmation dialog), then « Tout renvoyer ». The push log and the
   Hotel Center feed status must show no error.
6. Watch the price accuracy score in Hotel Center: *Excellent* three days in a row, then Google
   turns the listings live. A mismatch reported by Google → « Vérifier les prix » on those dates, and
   the cause goes into this spec.
7. After go-live: the nightly full re-send (rule 13) runs at `fullResendHour`; check the push log the
   first week, then the Hotel Center status after any recipe change.

### 11.5 If Google declines

The lodging Business Profile has no free booking-link field (§1), so there is no direct fallback:
Solio stays out of the « Locations de vacances » results unless it goes back through an approved
connectivity partner. That would be a new decision and a new spec; the plugin stays installed in
Simulation, harmless.
