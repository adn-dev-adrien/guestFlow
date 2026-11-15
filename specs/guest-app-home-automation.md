# Guest app — a « Domotique » page fed by Sowel: temperatures, weather, rain, consumption, lights

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/guest-app-home-automation` |
| **Created** | 2026-11-15 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Interactive summary** | [`guest-app-home-automation-maquette.html`](guest-app-home-automation-maquette.html) |
| **Amends** | [`guest-app.md`](guest-app.md) rule 10 (module list), §6.6 (screens); [`gate-access-sowel-connector.md`](gate-access-sowel-connector.md) (the connector gains a second tree) |
| **Depends on** | [`gate-access-sowel-connector.md`](gate-access-sowel-connector.md) (the house-pulls model, its key and signature), [`sowel-stays-in-keys.md`](sowel-stays-in-keys.md) (Sowel knows each `propertyId` and when it is occupied) |
| **Sowel half** | `sowel-plugin-guestflow` `specs/002-home/spec.md` (plugin v0.5.0 + new recipe `sowel-recipe-guest-home` v0.1.0) |

---

## 1. Context

Some lodgings of the domain are automated with Sowel: room thermometers, a Netatmo weather station with a rain
gauge, a Legrand energy meter, and outdoor lighting such as the garden tree's. Guests see none of it. Adrien
(2026-11-15) wants the guest app to show it on a page of its own, chosen per lodging in Studio, « très beau et
facile à comprendre », with the guest able to switch only what was given to them — and only if that is safe.

Three facts frame the design:

- **A Sowel API token controls the whole house.** Sowel's tokens have no scope: no read-only token, no restriction
  to a zone or an equipment (`sowel-core/src/auth/auth-middleware.ts`). A token stored in GuestFlow would let
  anyone who compromises GuestFlow — a public, internet-facing app — open the gate, cut the heating, or switch
  every equipment of the owner's own house.
- **GuestFlow never calls the house** (`gate-access-sowel-connector.md` rule 1, `guest-gate-access.md` §1). The
  house pulls: Sowel's `guestflow` plugin calls GuestFlow with a key and an HMAC signature, and the VM's firewall
  drops outbound traffic to the LAN. That rule is kept.
- **Sowel already separates talking from acting.** A Sowel plugin cannot read other integrations' equipment; a
  recipe can, and the guest-gate recipe « n'actionne jamais qu'un équipement de type portail » whatever the plugin
  asks. The same split carries this feature.

## 2. Goal

During their stay, a guest of an automated lodging opens « Domotique » in the guest app and sees, at a glance, how
warm each room is, the weather outside, how much it has rained and what the lodging consumes — and can switch on
and off the lights the owner gave them. The owner chooses all of it per lodging in Studio.

## 3. Functional rules

### 3.A The channel — the house pushes, GuestFlow never holds a key

1. GuestFlow holds **no Sowel credential** and makes **no outbound call** to Sowel. Every exchange is a call from
   Sowel's `guestflow` plugin to a new public tree `/public/v1/home/**`.
2. The tree is served by the **existing Sowel connector** (`gate-access` plugin) and authenticated by **the same
   key and signing secret as the gate** (`GATE_API_KEY`, `GATE_SIGNING_SECRET`): Bearer key plus HMAC-SHA256 of
   method, path with query, timestamp and body hash, ±2 min freshness, every answer signed, fail closed when a
   secret is missing (`gate-access-sowel-connector.md` rules 19-22). Nothing new to enter in Sowel.
3. The house publishes a **catalogue**: the equipments it is willing to describe — types `sensor`, `thermostat`,
   `weather`, `energy_meter`, `main_energy_meter`, `light_onoff`, `light_dimmable`, `light_color` and `switch` with
   a light category — each with its id, name, zone path (« Gîte › Chambre »), type and readable values
   (alias, category, unit), and for a light a `guestSwitchable` flag (rule 9bis). **No value**, no gate, no lock,
   no heating order. Sent on start, every hour, and within a minute of a change in Sowel.
4. GuestFlow answers the catalogue call with its **selection**: the `(equipmentId, alias)` pairs at least one
   lodging's configuration uses (rule 12). The house sends values **only for those pairs** — the rest of the house
   never leaves it.
5. The house pushes **readings** every 60 s (value, unit, measured-at) and **series** every 15 min (the last 24
   hourly buckets of `rain` and of `energy`/`power` for the selected equipments). GuestFlow keeps only the latest
   reading and the latest 24 buckets per pair, overwritten in place: no long-term history of a guest's
   consumption is ever built. A reading older than the one stored never replaces it (a batch retried after a
   reconnection), and a measured-at later than its receipt is dated at its receipt: a house clock ahead of ours
   must not keep a silent house « fresh » (review of 2026-11-15).
6. A reading or a series names an equipment the selection does not hold, or one gone from the catalogue → dropped,
   never stored.

### 3.B What a guest may switch — the boundary lives in Sowel's code

7. A guest may switch only a light that Studio marked **« Pilotable »** on **their** lodging, only in `stay` mode
   (`guest-app.md` rule 2): one tap switches it on, the next switches it off. No timer: the light stays as the
   guest left it (Adrien, 2026-11-15).
8. GuestFlow records the request as a **command** (`propertyId`, `equipmentId`, `on|off`, issued-at) and the house
   collects it by long-polling `GET /public/v1/home/commands?wait=25`. A command not collected within 30 s
   **expires**: it is never executed later, and the guest reads « La maison ne répond pas. Réessayer dans un
   instant. »
9. Whatever GuestFlow sends, the Sowel recipe executes a command only when **all** hold — these checks are code
   in the recipe, not settings, so no GuestFlow compromise can widen them:
   - the equipment is a light (rule 3's light types), never anything else;
   - the light is on the recipe's **whitelist** (rule 9bis);
   - its issued-at is less than 60 s old;
   - no more than 20 commands per **light** per hour — the property is GuestFlow's word, so a limit keyed on it
     would bound nothing (review of 2026-11-15);
   - its id was not handled in the last hour.
   The recipe also sends values only for selected pairs that its catalogue describes: the selection is GuestFlow's
   word too.
   A refused command is reported back with its reason and never retried. Before that, the Sowel `guestflow` plugin
   drops a command whose `propertyId` is not **occupied now** according to the stays it already holds
   (`sowel-stays-in-keys.md`) — a guard against a GuestFlow bug, not against a compromised GuestFlow, since the
   stays themselves come from GuestFlow. Sowel-side detail: `sowel-plugin-guestflow` spec 002.
9bis. **The one setting in Sowel** (Adrien, 2026-11-15), on the same model as the gate's « + portail » in Accès
   partagés: the `guest-home` recipe has a single multi-select slot, « Lumières confiées aux voyageurs », filled
   once. It is the security boundary: no command reaches a light outside it, whatever GuestFlow sends. Everything
   else — which lodging shows what, labels, which whitelisted light is « Pilotable » for which lodging — stays in
   Studio.

> **Sans test** — the whitelist is code in the Sowel recipe, tested in `sowel-recipe-guest-home` (`src/index.test.ts`);
> guestFlow's side of it — « Pilotable » refused on a light that is not `guestSwitchable` — is rules 7 and 14's tests.

10. GuestFlow applies its own limit before the house's: 6 commands per stay per 10 min (« Trop de demandes.
    Réessayer dans quelques minutes. »). The same tap twice within 2 s — same light, same value — is one command,
    and the repeat does not use one of the 6. A tap then its opposite within 2 s are two commands: the guest
    changed their mind, and the house executes both in order.
11. **Worst case, accepted by Adrien on 2026-11-15:** an attacker who fully controls GuestFlow can switch **the
    whitelisted lights** (rule 9bis) on or off, at any time — GuestFlow can forge a stay, so the occupancy check
    does not bind it — at most 20 times an hour each. With no timer, a light switched on stays on until
    someone switches it off. No other light, and nothing else in the house, can be reached by this channel.

> **Sans test** — a statement of accepted risk, not a behaviour; the boundaries it rests on are rules 7, 9, 9bis
> and 10, each tested (here and in the Sowel recipe).


### 3.C Studio — what each lodging shows

12. Studio gets a **« Domotique »** page per lodging (`/studio/:propertyId/domotique`). It lists the lodging's
    **blocks**, in order, each on/off:
    - **Extérieur** — one weather equipment: temperature, today's min/max, humidity, wind when the station has it.
    - **Pièces** — a list of rooms, each `{ label, equipment, alias }` picked from the catalogue's temperature
      readings; humidity shown when the same equipment has it.
    - **Pluie** — one rain equipment: last hour, today, last 24 h as 24 bars.
    - **Électricité** — one energy meter: power now (W), today (kWh), last 24 h as a curve.
    - **Éclairage** — a list of lights, each `{ label, equipment, pilotable }`.
13. Every equipment picker lists only the catalogue's equipments of the right kind, by zone path then name. An
    equipment that disappeared from the catalogue stays in the configuration, flagged « Introuvable dans Sowel
    depuis le … », and its block is hidden from guests until it returns or is replaced.
14. Validation, refused on save with the field in error: label 1-24 characters; at most 8 rooms and 6 lights; the
    same equipment twice in one list; a « Pilotable » light whose catalogue entry is not `guestSwitchable` (the
    checkbox is disabled with « Non confiée aux voyageurs dans Sowel »); a block switched
    on with no equipment, or a list block switched on with an empty list.
15. The page shows the channel's state at the top: « Reçu de Sowel il y a 2 min », « Sowel n'a encore rien
    envoyé » (with the link to Réglages › Intégrations), or « Plus de nouvelles de Sowel depuis le … ».
16. An **aperçu** beside the form (below it on the phone) renders the guest page with the latest real readings,
    so the owner sees exactly what the guest will see.

### 3.D The guest page

17. New module `home`, labelled « Domotique » / « Smart home », in rule 10's list, **off by default**,
    `MODES_OF: ['stay']`. Prerequisite: the connector plugin is live, at least one block is on with a known
    equipment, and the house has reported in the last 6 h. Otherwise the tile does not appear — a lodging without
    automation never shows an empty page.
18. `GET /public/v1/guest/home` returns the page **ready to render**: blocks in order, each value already rounded
    and formatted (« 21,4 °C », « 2,3 mm », « 1,8 kWh »), trends (`up | down | flat`, over the last 30 min), the
    24 bars already scaled 0-1, a freshness phrase, and each light's state. The client computes nothing.
19. Rounding: temperatures to 0.5 °C on the hero and 0.1 °C in rooms; rain to 0.1 mm; power to 10 W under 1 kW,
    else 0.1 kW; energy to 0.1 kWh.
20. Freshness, per reading: under 5 min → shown plainly; 5 min to 6 h → shown muted with « à 14 h 02 »; over 6 h
    → the value is hidden and its block reads « Mesure indisponible ». The page header reads « En direct · il y a
    1 min » from the freshest reading; when the whole house is silent, « Dernière mesure · à 20 h 50 » and a
    banner « La maison ne donne plus de nouvelles depuis 20 h 50. »
21. The page refreshes every 60 s while visible, never in the background; offline it shows the last values with
    « Hors connexion » and the light switches are disabled (`guest-app.md` rule 21).
22. A light switch: tap → « Allumage… » / « Extinction… » immediately (the switch moves on press) → on the house's
    report, « Allumé » / « Éteint », or back to its previous state with the reason (« La maison ne répond pas.
    Réessayer dans un instant. », « Trop de demandes… », « Possible uniquement pendant le séjour »). A light that
    is not « Pilotable » shows its state only.
23. A light's state always comes from the house, whoever switched it (the guest, the owner, a Sowel recipe): its
    readings, or — until the next reading — the switch the house confirmed after the last one, so the switch never
    goes back while the lamp is lit (review of 2026-11-15).

**Edge cases:**
- House offline for days → the module disappears from the home after 6 h (rule 17); Studio says so (rule 15).
- Equipment renamed in Sowel → the catalogue updates the name in Studio; the guest-facing label is Studio's own.
- Guest leaves with a light on → it stays on (rule 11); the house refuses any new command once the stay device
  reads unoccupied, so the next guest's tap still works once their stay starts.
- A light removed from the Sowel whitelist → the next catalogue clears its `guestSwitchable`; Studio shows it
  « Non confiée aux voyageurs dans Sowel », the guest sees its state only, and the recipe refuses any command
  already queued.
- Two lodgings share the weather station → one equipment, selected once, shown in both.
- A dimmable or colour light → only on/off in v1.
- The night register → the page follows the app's register like every other page.

---

## 4. Architecture

> **Fat backend, thin frontend.** Rounding, trends, scaling of the bars, freshness and every guest-facing phrase
> are computed on the server (`homeView.js`). The guest page and the Studio preview only render.

### 4.1 Server side

The **`gate-access`** plugin is GuestFlow's Sowel connector: it gains the `/public/v1/home` tree behind its
existing `requireConnector` and `signResponse`, stores what the house sends, and exposes it through a new SDK
extension point. Its name stays « Accès au portail (Sowel) »: the console sells it as an option under that name, and renaming a sold option is a commercial decision, not a side effect of this spec (2026-11-15). The **`guest-app`** plugin owns the
per-lodging configuration, the module and the guest routes. Plugins never import each other: two typed extension
points, **SDK 2.28.0**, on the model of `resourceScheduler`:

- `ctx.homeData(provider)` — declared by `gate-access`, one per instance, read as `ctx.core.homeData()`:
  `channel()`, `catalog()`, `readings(pairs)`, `series(pairs)`, `queueCommand(command)`, `command(id)`,
  `confirmed(equipmentIds)` (the last command the house confirmed per light, rule 23).
- `ctx.homeSelection(fn)` — declared by `guest-app`, read as `ctx.core.homeSelection()`: `() → [{ equipmentId,
  alias }]`, the union the connector answers the catalogue call with (rule 4).

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| plugin | `plugins/gate-access/manifest.json` | T | Description, surfaces, version 1.4.0, changelog entry (name unchanged, see above). |
| sdk | `plugins/sdk/createContext.js`, `registry.js`, `coreServices.js`, `version.js` | T | `homeData` / `homeSelection` extension points and their `ctx.core` readers; SDK 2.28.0. |
| plugin | `plugins/gate-access/index.js` | T | Mounts the home router, declares `homeData`, daily purge of old commands; manifest `sdk ^2.28.0`. |
| routes | `plugins/gate-access/homeRoutes.js` | C | `/public/v1/home`: `ping`, `catalog`, `readings`, `series`, `commands`, `commands/results`; the gate's connector auth + signed answers on the router, behind a limiter of its own (600 / 15 min per address — the channel's ~210 calls an hour fit), so guests' phones behind the same address never share the house's budget. |
| utils | `plugins/gate-access/homePayloads.js` | C | Pure: each payload checked field by field, all-or-nothing (`400 INVALID_PAYLOAD` with the field). |
| controllers | `plugins/gate-access/homeController.js` | C | The six routes; the long poll (in-memory waiters woken by a queued command, 25 s cap); the `homeData` provider. |
| models | `plugins/gate-access/homeModel.js` | C | The four `home_*` tables plus `home_connector_state`: catalogue upsert and disappearance, readings overwritten with 45 min of samples (trend), series overwritten, unselected pairs dropped (rule 6), commands queued / collected / expired / answered, 2 s dedupe, 7-day purge. |
| database | `plugins/gate-access/index.js` | T | Migration `home_tables_v1`, appended inline like `tables_v1`. |
| plugin | `plugins/guest-app/modules.js` | T | Module `home` (off, `MODES_OF ['stay']`, prerequisite rule 17). |
| controllers | `plugins/guest-app/controllers/sessionController.js` | T | `factsOf` gains `homeReady`. |
| controllers | `plugins/guest-app/controllers/homeController.js` | C | Guest: page payload, switch command, command status. Studio: blocks read/save, catalogue, preview. |
| models | `plugins/guest-app/homeBlocksModel.js` | C | `guest_home_blocks` read/write in one transaction; the selection union (rule 4), declared as `homeSelection`. |
| utils | `plugins/guest-app/homeRoles.js` | C | Pure: which readings of an equipment a block shows, found by Sowel category with Sowel's aggregator aliases as fall-back (`rain_1h`, `rain_today`, `energy_day`, `energy_hour`…) — Studio never asks for an alias; the selection union (rule 4). |
| utils | `plugins/guest-app/homeView.js` | C | Pure: blocks + readings + series + now → guest payload (rules 18-20, 23). |
| utils | `plugins/guest-app/homeBlocksValidation.js` | C | Pure: rule 14. |
| middleware | `plugins/guest-app/rateLimiters.js` | T | `homeCommand`: 6 / 10 min / stay (rule 10). |
| routes | `plugins/guest-app/routes/public.js`, `routes/admin.js` | T | Guest and Studio routes of §4.3. |
| database | `plugins/guest-app/migrations.js` | T | `guest_home_blocks` (new migration appended). |

### 4.2 Client side

Two Vite apps of the guest-app plugin. The GuestFlow `client/` keeps the connector's existing Intégrations tab, which
gains a « Domotique » line (last catalogue, last readings).

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| guest `pages/` | `apps/guest/src/pages/HomeAutomationPage.jsx` | C | Route `/domotique`, `Guard module="home"`; renders the payload. |
| guest `pages/` | `HomeAutomationPage.jsx` exports `SmartHomeBody` | C | The page under its app bar, drawn from the payload; the studio's phone preview draws the same component. |
| guest `components/` | `Sparkbars.jsx`, `EnergyCurve.jsx`, `LightSwitch.jsx`; `Icon.jsx` (T) | C | The rain bars, the consumption curve, a light row with its switch; the new Lucide icons. |
| guest `hooks/` | `useHome.js`, `useLightSwitch.js` | C | 60 s refresh while visible; a tap followed every second until the house answers (40 tries). |
| guest `App.jsx`, `HomePage.jsx` | | T | Route and tile. |
| studio `pages/` | `apps/studio/src/pages/HomeAutomationPage.jsx` | C | Blocks list, pickers, the server's inline errors (live through the preview), « Aperçu figé » while refused. |
| studio `App.jsx`, `StudioShell.jsx`, `ModuleIcon.jsx`, `constants/studio.js` | | T | Route and nav entry `/:propertyId/domotique`, module `home`, `HOME_BLOCKS` labels. |
| studio `preview/PreviewApp.jsx`, `utils/previewViews.js` | | T | The `smartHome` view: `SmartHomeBody` from the server's preview payload. |
| studio `services/api.js` | | T | `home`, `saveHome`, `homePreview`; `toError` keeps a 422's `errors` map. |
| `client/src/plugins/gate-access/` | its Intégrations section | T | The « Domotique » status line. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| Consumed | guest app `Guard`, sheets, `.eb` eyebrow, photo hero + scrim; Studio `PageActionBar`, `StatusBadge`, `HelpedTextField`, `EmptyState` | Existing. |
| Created (generic, guest app) | `Sparkbars` (any 24-bucket series scaled 0-1) | Generic: an hourly count elsewhere uses it as is. |
| Specific | `SmartHomeBody` (with its hero, rooms, rain and energy sections), `LightSwitch`, `EnergyCurve` | Tied to this page's blocks. |

### 4.3 API contract

**House → GuestFlow** (`/public/v1/home`, the gate's key + signature, answers signed):

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/ping` | — | `{ ok, contract: 1 }` |
| PUT | `/catalog` | `{ equipments: [{ id, name, zonePath, type, guestSwitchable?, readings: [{ alias, category, unit }] }] }` | `{ selection: [{ equipmentId, alias }] }` |
| POST | `/readings` | `{ readings: [{ equipmentId, alias, value, unit, measuredAt }] }` | `{ stored, dropped }` |
| POST | `/series` | `{ series: [{ equipmentId, alias, buckets: [{ time, value }] }] }` | `{ stored, dropped }` |
| GET | `/commands?wait=25` | — | `{ commands: [{ id, propertyId, equipmentId, value: 'on'\|'off', issuedAt }] }` (empty after `wait` s) |
| POST | `/commands/results` | `{ results: [{ id, ok, reason? }] }` | `{ stored }` |

**Guest** (`/public/v1/guest`, `gf_guest` cookie, `requireModule('home')`, `requireStayGuest` on every route — the module gate already keeps a pre-arrival session out, since `home` shows in the `stay` mode only):

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/home` | — | `{ updated: 'il y a 1 min', blocks: [...] }` ready to render (rule 18) |
| POST | `/home/lights/:lightId` | `{ on: boolean }` | `202 { data: { id, state, on } }` · `429 TOO_MANY_REQUESTS` · `403 NOT_PILOTABLE` |
| GET | `/home/commands/:id` | — | `{ data: { id, state: 'pending'\|'done'\|'refused'\|'expired', on, message? } }`; its limit is per stay (300 / 10 min), not per address |

**Studio** (`/api/guest-app`, admin):

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/lodgings/:propertyId/home` | — | `{ channel, blocks, catalog }` |
| PUT | `/lodgings/:propertyId/home` | `{ blocks }` | `200 { blocks }` · `422 { errors: { 'blocks.1.rooms.2.label': '…' } }` |
| POST | `/lodgings/:propertyId/home/preview?lang=fr\|en` | `{ blocks? }` (the draft; none = the saved blocks) | the guest payload of `/home` for those blocks · `422 { error, errors }` for a draft the save would refuse — the studio's live inline errors |

---

## 5. Data model

All new tables; nothing existing changes.

- **`guest_home_blocks`** (guest-app): `id`, `propertyId`, `position`, `kind` (`outdoor|rooms|rain|energy|lights`),
  `on`, `equipmentId` (null for lists), `itemsJson` (rooms / lights), `updatedAt`. Unique `(propertyId, kind)`.
- **`home_catalog`** (gate-access): `equipmentId` PK, `name`, `zonePath`, `type`, `guestSwitchable`,
  `readingsJson`, `lastSeenAt`, `goneAt`.
- **`home_readings`**: PK `(equipmentId, alias)`, `valueJson`, `unit`, `measuredAt`, `receivedAt`, `samplesJson` (the
  30-minute trend).
- **`home_series`**: PK `(equipmentId, alias)`, `bucketsJson` (24 buckets), `updatedAt`.
- **`home_commands`**: `id`, `stayId`, `propertyId`, `equipmentId`, `lightId`, `value`, `issuedAt`, `collectedAt`,
  `state`, `reason`, `answeredAt`. Rows older than 7 days purged by the plugin's daily task.
- **`home_connector_state`**: one row — `lastCatalogAt`, `lastReadingsAt`, `lastSeriesAt`, `lastPollAt` (rules 15, 17).
- `home_readings` keeps `samplesJson` (≈ 45 min of numeric samples) rather than a single previous value: a trend
  measured against one anchor reads « flat » right after each refresh.

**Data impact:** new tables only, empty on first start. No guest personal data is sent to Sowel beyond what the
gate already sends (`propertyId`).

## 6. UI / UX

The interactive summary [`guest-app-home-automation-maquette.html`](guest-app-home-automation-maquette.html) is
the reference: the guest page in its states and the Studio page driving it live.

**Guest page « Domotique »** (Domaine Solio identity, `apps/guest/DESIGN.md`):
- Hero: the lodging's photo under the scrim, eyebrow « EN DIRECT · il y a 1 min », the outdoor temperature large
  in Marcellus, beneath it « min 4° · max 12° · humidité 82 % » and one sentence of rain (« Sec depuis hier
  18 h », « 2,3 mm aujourd'hui »).
- Pièces: a two-column grid of room cards — label, temperature in Karla `tabular-nums`, a trend arrow, humidity in
  small text.
- Éclairage: one row per light — name, « Allumé » / « Éteint », a 44 px switch. Not pilotable → no switch, a
  « Consultation » chip.
- Pluie: today's total, 24 thin bars for the last 24 h, the hour scale under them.
- Électricité: power now, today's kWh, a 24 h curve. No moralising, no comparison to other guests.
- Motion: the page's single moment is the switch: it moves on press, then the lamp glyph warms in ocre on the
  house's confirmation. `prefers-reduced-motion` → colour change only.
- **Mobile (< 900 px):** one column, tab bar. **From 900 px:** rail; rooms on 3 columns, rain and electricity side
  by side. **From 1200 px:** content capped at 1200 px.

**Studio « Domotique »** (« Maison » MUI theme):
- `PageActionBar` title « Domotique — <lodging> », Save / Cancel.
- Channel badge (rule 15), then the blocks as cards that can be switched on/off and reordered, with their pickers;
  inline errors (rule 14). Preview to the right from 1200 px, below the form under it.
- **Mobile:** blocks full width, pickers as full-screen dialogs, preview below.

## 7. Test plan

Counts after the review of 2026-11-15: server 63 new (`sdk-home-extension-points` 5, `sowel-home-connector` 7,
`sowel-home-ingest` 10, `sowel-home-commands` 10, `guest-home-view` 10, `guest-home-blocks-validation` 10,
`guest-home-routes` 11); guest app Vitest 11 (`HomeAutomationPage.render` 6, `.lights` 4,
`useLightSwitch.strict-mode` 1); studio Vitest 6 (`HomeAutomationPage`). Full server suite 12 596 / 12 596.

### Server unit tests (one file per subject)
- [x] `sowel-home-connector.unit.test.js` — rules 1-2: the home tree refuses a missing secret, a wrong signature,
      a stale timestamp; answers are signed; the gate's pinned vectors still pass.
- [x] `sowel-home-ingest.unit.test.js` — rules 3-6: catalogue upsert/disappearance, selection answer, unselected
      readings dropped, series overwrite, all-or-nothing on a bad field.
- [x] `sowel-home-commands.unit.test.js` — rules 7-10: non-pilotable refused, non-stay refused, 30 s expiry,
      dedupe within 2 s, rate limit, result recording.
- [x] `guest-home-view.unit.test.js` — rules 17-20, 23: rounding table, trends, freshness thresholds, bar scaling,
      module prerequisite, light state from readings.
- [x] `guest-home-blocks-validation.unit.test.js` — rule 14, each refusal, including « Pilotable » on a light that
      is not `guestSwitchable`.

### Sowel half (its own repos)
- [x] Recipe refuses a non-light, a light off the whitelist, a command older than 60 s, the 21st command of the
      hour for a light whatever property is named, a command id seen before (rule 9); sends no value outside the
      catalogue; the catalogue flags exactly the whitelisted lights (rule 9bis). The plugin refuses an unoccupied
      property after re-reading the stays once.

### Manual UI verification
- [x] Studio: configure the Granja with 3 rooms, the station, the meter and the tree light; preview matches.
- [x] Guest (stay link, phone): tile shown, values fresh, tree switched on then off, house unplugged → « La maison
      ne répond pas ».
- [x] Pre-arrival link and visitor poster: no tile, `/domotique` redirects home.
- [x] Lodging without automation: no tile.
- [x] Night register, 900 px and 1200 px layouts.
- [x] `npm run test:e2e` and the guest app's Vitest suites.

## 8. Out of scope

- Heating set-points, shutters, the gate, any order other than a light's on/off.
- Dimming, colour, timers and automatic switch-off.
- Long-term history and charts beyond 24 h.
- Push notifications (frost, rain) to guests.
- Energy cost in euros.
- Pre-arrival weather (rejected 2026-11-15: the page exists during the stay only).

## 9. Open questions

None open.

### Resolved
- 2026-11-15 — the house pushes; GuestFlow holds no Sowel key (Adrien, questionnaire).
- 2026-11-15 — configuration in Studio only (amended by rule 9bis: one whitelist of lights in the Sowel recipe); the safety limits are code in the Sowel
  recipe, not settings (Adrien, questionnaire).
- 2026-11-15 — v1 blocks: rooms, outdoor, rain, electricity, plus lights (Adrien, questionnaire).
- 2026-11-15 — visible in `stay` mode only (Adrien, questionnaire).
- 2026-11-15 — tile and page named « Domotique » (Adrien).
- 2026-11-15 — a pilotable light is a plain toggle: one tap on, one tap off, no timer (Adrien).
- 2026-11-15 — rule 11's worst case accepted (Adrien), then narrowed: since stays come from GuestFlow, the
  occupancy check cannot bind a compromised GuestFlow, so the recipe carries a whitelist of the lights entrusted
  to guests — the only setting made in Sowel, on the gate's « + portail » model (Adrien, rule 9bis).
- 2026-11-15 — the home tree reuses the gate connector's key and signing secret, so it lives in the `gate-access`
  plugin (Adrien).
