# Guest app — a « Domotique » page fed by Sowel: temperatures, weather, rain, consumption, lights

| Field | Value |
|---|---|
| **Status** | Implemented — amendment of 2026-11-17 (§3.E, rules 24-29) implemented |
| **Branch** | `feature/guest-app-home-automation`; amendment `feature/guest-home-shared-sensors` |
| **Created** | 2026-11-15 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Interactive summary** | [`guest-app-home-automation-maquette.html`](guest-app-home-automation-maquette.html) |
| **Amends** | [`guest-app.md`](guest-app.md) rule 10 (module list), §6.6 (screens); [`gate-access-sowel-connector.md`](gate-access-sowel-connector.md) (the connector gains a second tree) |
| **Depends on** | [`gate-access-sowel-connector.md`](gate-access-sowel-connector.md) (the house-pulls model, its key and signature), [`sowel-stays-in-keys.md`](sowel-stays-in-keys.md) (Sowel knows each `propertyId` and when it is occupied) |
| **Sowel half** | `sowel-plugin-guestflow` `specs/002-home/spec.md` (plugin v0.5.0 + new recipe `sowel-recipe-guest-home` v0.1.0; amendment: recipe v0.2.0) |
| **Amendment depends on** | `sowel-core` spec 211 `recipe-history-read` (R1: Sowel's day min/max, spec 134, extended from weather stations to every thermometer; R2: a recipe reads Sowel's own history for hourly buckets) |

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
3. *(Amended by rules 24 and 26.)* The house publishes a **catalogue**: the equipments it is willing to describe — types `sensor`, `thermostat`,
   `weather`, `energy_meter`, `main_energy_meter`, `light_onoff`, `light_dimmable`, `light_color` and `switch` with
   a light category — each with its id, name, zone path (« Gîte › Chambre »), type and readable values
   (alias, category, unit), and for a light a `guestSwitchable` flag (rule 9bis). **No value**, no gate, no lock,
   no heating order. Sent on start, every hour, and within a minute of a change in Sowel.
4. GuestFlow answers the catalogue call with its **selection**: the `(equipmentId, alias)` pairs at least one
   lodging's configuration uses (rule 12). The house sends values **only for those pairs** — the rest of the house
   never leaves it.
5. *(Amended by rules 25 and 26.)* The house pushes **readings** every 60 s (value, unit, measured-at) and **series** every 15 min (the last 24
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

12. *(Amended by rules 28 and 29.)* Studio gets a **« Domotique »** page per lodging (`/studio/:propertyId/domotique`). It lists the lodging's
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
15. *(Amended by rule 27.)* The page shows the channel's state at the top: « Reçu de Sowel il y a 2 min », « Sowel n'a encore rien
    envoyé » (with the link to Réglages › Intégrations), or « Plus de nouvelles de Sowel depuis le … ».
16. An **aperçu** beside the form (below it on the phone) renders the guest page with the latest real readings,
    so the owner sees exactly what the guest will see.

### 3.D The guest page

17. *(Amended by rule 27.)* New module `home`, labelled « Domotique » / « Smart home », in rule 10's list, **off by default**,
    `MODES_OF: ['stay']`. Prerequisite: the connector plugin is live, at least one block is on with a known
    equipment, and the house has reported in the last 6 h. Otherwise the tile does not appear — a lodging without
    automation never shows an empty page.
18. *(Amended by rule 25: no trend.)* `GET /public/v1/guest/home` returns the page **ready to render**: blocks in order, each value already rounded
    and formatted (« 21,4 °C », « 2,3 mm », « 1,8 kWh »), trends (`up | down | flat`, over the last 30 min), the
    24 bars already scaled 0-1, a freshness phrase, and each light's state. The client computes nothing.
19. Rounding: temperatures to 0.5 °C on the hero and 0.1 °C in rooms; rain to 0.1 mm; power to 10 W under 1 kW,
    else 0.1 kW; energy to 0.1 kWh.
20. *(Replaced by rule 27.)* Freshness, per reading: under 5 min → shown plainly; 5 min to 6 h → shown muted with « à 14 h 02 »; over 6 h
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

### 3.E Amendment of 2026-11-17 — only what the owner shares, only what Sowel holds

Wiring the real house on 2026-11-17 showed three defects. The recipe described **all 59 equipments** of the house to
GuestFlow (rule 3 named types, not equipments), when only the gîte's were meant to leave it. Several figures were
**computed** on our side (the trend arrow, the recipe's hourly sampling) although Sowel already holds them, and
Adrien's rule is « on ne fait qu'afficher des informations qui se trouvent dans Sowel ». And every send is an order
on the bridge, which Sowel writes, payload included, into its activity feed: an hourly full catalogue and a reading
batch every minute drowned it. Rules 24-29 amend rules 3, 5, 12, 15, 17, 18 and 20; the amended rules keep their
numbers and point here.

24. **The second setting in Sowel — « Capteurs partagés »** (Adrien, 2026-11-17, amends rule 3). The `guest-home`
    recipe gets a second multi-select slot beside rule 9bis's, listing the equipments the house may describe to
    GuestFlow. The catalogue holds **only** those equipments plus the lights entrusted to guests; nothing else in
    the house is ever named, so it can never be selected, read or sent, whatever GuestFlow asks. As for rule 9bis,
    this is code in the recipe, not a GuestFlow setting: it is the reading boundary, as 9bis is the acting one. An
    empty list describes no sensor at all.

> **Sans test** — the boundary is code in the Sowel recipe, tested in `sowel-recipe-guest-home` (`src/index.test.ts`):
> GuestFlow only ever receives the catalogue the recipe builds.

25. **Every figure is a value Sowel holds** (Adrien, 2026-11-17, amends rules 5 and 18). The house sends, and the
    guest sees, only values Sowel already has: an equipment's current value, the day's minimum and maximum of a
    temperature as Sowel tracks them since local midnight (`temperature_min_today` / `temperature_max_today`,
    Sowel spec 134 — today for weather stations only, extended to every thermometer by `sowel-core` spec 211 R1),
    Sowel's day cumul `energy_day`, and the last 24 hourly buckets of Sowel's history for rain and energy, read
    through the recipe history access of spec 211 R2. Until spec 211 ships, the min/max of a plain thermometer and
    the buckets are absent and their place on the page stays empty rather than estimated. **Spec 211 is not a
    prerequisite** (Adrien, 2026-11-17): the recipe detects what its Sowel offers (`ctx.history`, a thermometer's
    `temperature_min_today`) and, without it, simply sends no min/max and no series; everything else — current
    values, `energy_day`, the rain gauge's `rain_today` and `sum_rain_1`, lights, « Réseau » — works in full, and
    the guest page omits the min/max line and the bars. Neither the recipe nor GuestFlow derives a number: **the trend arrow is removed**
    (rule 18's `trends`), the recipe's own hourly sampling is removed, and `home_readings.samplesJson` is no longer
    written. Presenting a value — rounding it to rule 19's precision, its unit, its phrase, the bars drawn
    proportionally to the tallest — is rendering, not computing, and stays on the server as before.
26. **The house sends less** (Adrien, 2026-11-17, amends rules 3 and 5). The catalogue is sent on start and when its
    content changes — never again unchanged by the recipe (the plugin's own hourly re-PUT of its stored catalogue,
    which refreshes the selection, is no Sowel order and writes nothing to the feed). A reading is sent when its
    value changed since the last send, or once an hour while it stays the same, so a stable value keeps a recent
    `measuredAt` and is never hidden by rule 27's 6 h limit; series are sent once per closed hour. Each order carries only the
    changed entries. The bridge still appears in Sowel's activity feed, but once per real change instead of once a
    minute.
27. **The house's liveness is its poll, not its readings** (amends rules 15, 17 and 20). Since a quiet house no
    longer resends unchanged values, an unchanged value is not an old one: a thermometer reporting every 30 min is
    as current as Sowel itself. The house is « en direct » while it long-polled `/commands` within the last 2 min
    (`home_connector_state.lastPollAt`). Rule 20 becomes: house live → every value shown plainly, the header reads
    « En direct »; house silent for more than 5 min → values muted, header « Dernière nouvelle · à 20 h 50 » and
    the banner « La maison ne donne plus de nouvelles depuis 20 h 50. »; a value Sowel itself last updated more than
    6 h ago → hidden, « Mesure indisponible ». Rule 17's « reported in the last 6 h » and rule 15's channel badge
    read `lastPollAt` too.
28. **Outdoor and rooms show the day's min/max** (Adrien, 2026-11-17, amends rule 12). The **Extérieur** block
    accepts any equipment with a temperature reading — a weather station or a plain thermometer (the gîte's outdoor
    probe is a `sensor`) — and shows temperature, the day's min and max, humidity, and wind only when the
    equipment has it. Each **Pièces** card shows temperature, humidity, and the day's min and max under them.
29. **New block « Réseau »** (Adrien, 2026-11-17, amends rule 12). One main energy meter (`main_energy_meter`), its
    `power` exactly as Sowel's energy page shows it under « Réseau ». Sowel signs it: positive when the house draws
    from EDF, negative when it sends solar surplus back. The block shows the value without its sign, in green with
    « Renvoyé au réseau » when Sowel's value is negative, in red with « Consommé du réseau » when positive, and
    neutral « Équilibre » under 5 W either way (Sowel's own threshold on that page). The colour carries the
    direction, the phrase says it too, so the block reads without colour vision. Studio offers it like any block,
    off by default.

> Rule 26's sending policy is code in the Sowel recipe too, tested in `sowel-recipe-guest-home`; GuestFlow's side of
> it (a batch of changed pairs leaves the others untouched) is `sowel-home-ingest.unit.test.js`.

**Edge cases of the amendment:**
- An equipment removed from « Capteurs partagés » → the next catalogue omits it, rule 13 flags it « Introuvable dans
  Sowel » in Studio and its block is hidden from guests.
- Sowel without InfluxDB, or a temperature Sowel does not historise → no min/max, the line under the value is
  omitted; the value itself still shows.
- Midnight → the day's min/max restart with Sowel's own day (local midnight, spec 134). Sowel's daily history
  buckets are UTC days and are not used for min/max.
- Sowel's « Réseau » exactly 0 W → « Équilibre ».

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
| POST | `/readings` | `{ readings: [{ equipmentId, alias, value, unit, measuredAt }] }` — only the changed pairs (rule 26); the day's min/max are readings of `temperature_min_today` / `_max_today` | `{ stored, dropped }` |
| POST | `/series` | `{ series: [{ equipmentId, alias, buckets: [{ time, value }] }] }` | `{ stored, dropped }` |
| GET | `/commands?wait=25` | — | `{ commands: [{ id, propertyId, equipmentId, value: 'on'\|'off', issuedAt }] }` (empty after `wait` s) |
| POST | `/commands/results` | `{ results: [{ id, ok, reason? }] }` | `{ stored }` |

**Guest** (`/public/v1/guest`, `gf_guest` cookie, `requireModule('home')`, `requireStay` on writes):

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

### 4.4 Amendment of 2026-11-17 (rules 24-29) — code map

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| models | `plugins/gate-access/homeModel.js` | T | `samplesJson` no longer written; a reading batch may hold only the changed pairs (nothing else is cleared). |
| plugin | `plugins/gate-access/manifest.json` | T | Version bump, changelog line. |
| utils | `plugins/guest-app/homeView.js` | T | No trend; the day's min/max under rooms and outdoor; freshness from `lastPollAt` (rule 27); the `grid` block (rule 29). |
| utils | `plugins/guest-app/homeRoles.js` | T | Rooms gain the `min` / `max` roles (aliases `temperature_min_today` / `_max_today`, as outdoor already has): the day's extremes travel as ordinary readings of their own Sowel aliases, so no payload changes; outdoor = any equipment with a temperature reading; `grid` = a `main_energy_meter`'s `power`. |
| utils | `plugins/guest-app/homeBlocksValidation.js` | T | Kind `grid`, one equipment, a `main_energy_meter`. |
| database | `plugins/guest-app/migrations.js` | T | `guest_home_blocks.kind` accepts `grid` (new migration appended; existing rows untouched). |
| plugin | `plugins/guest-app/manifest.json` | T | Version bump, changelog line. |
| guest `pages/` | `HomeAutomationPage.jsx` (`SmartHomeBody`) | T | Trend arrow removed; « min · max » line under rooms and outdoor; the « Réseau » section. |
| guest `styles/` | `app.css` | T | The grid block's two colours, from the guest app tokens, AA on both registers. |
| studio `pages/` | `HomeAutomationPage.jsx`; `constants/studio.js` | T | The « Réseau » block card and its picker; `HOME_BLOCKS` label. |

Sowel side, outside this repository: `sowel-recipe-guest-home` v0.2.0 (slot « Capteurs partagés », history reads,
send-on-change, no sampling) and `sowel-core` spec 211. `sowel-plugin-guestflow` relays the payloads unchanged: no
change.

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

- **Amendment of 2026-11-17:** `home_readings` unchanged in shape — `samplesJson` stays in the schema but is no
  longer written. `guest_home_blocks.kind` gains `grid` (the CHECK constraint is widened by a table rebuild, rows
  kept).

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

**Amendment of 2026-11-17** (interactive summary
[`guest-home-shared-sensors-maquette.html`](guest-home-shared-sensors-maquette.html)):
- Rooms and hero: no trend arrow; under each temperature, « min 16,5° · max 17,3° » in small text.
- « Réseau »: the power large in `tabular-nums`, an arrow and the phrase beside it — green « Renvoyé au réseau »,
  red « Consommé du réseau », neutral « Équilibre » — never colour alone. Same placement rules as « Électricité »
  (side by side from 900 px, stacked below).

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

### Amendment of 2026-11-17

Counts after the amendment: server home suites 66 (`sdk-home-extension-points` 5 unchanged; `sowel-home-connector` 7,
`sowel-home-ingest` 11, `sowel-home-commands` 10, `guest-home-view` 13, `guest-home-blocks-validation` 12,
`guest-home-routes` 12, `guest-home-grid-migration` 1); guest app Vitest 102 (`HomeAutomationPage.render` 8); studio
Vitest 43 (`HomeAutomationPage` 6); recipe `sowel-recipe-guest-home` 26.
- [x] `guest-home-view.unit.test.js` — rule 25: no `trend` in the payload; rule 28: min/max formatted under rooms
      and outdoor, omitted when absent; rule 27: live / silent / older-than-6 h from `lastPollAt` and Sowel's own
      timestamp; rule 29: negative → `export`, positive → `import`, |value| < 5 W → `balanced`, the value unsigned.
- [x] `guest-home-blocks-validation.unit.test.js` — rule 29: `grid` needs one `main_energy_meter`; rule 28: an
      outdoor `sensor` with a temperature accepted.
- [x] `sowel-home-ingest.unit.test.js` — rule 26: a partial batch leaves the other pairs untouched.
- [x] Recipe (`sowel-recipe-guest-home`): the catalogue holds only « Capteurs partagés » plus the entrusted lights;
      a selection naming anything else sends nothing; unchanged catalogue and readings are not resent; min/max are
      Sowel's `temperature_min_today` / `_max_today`, buckets come from `ctx.history`, both absent without them.
- [x] Manual: the gîte's Studio page with its 7 rooms, the outdoor probe, the rain gauge (« Pluviomètre »),
      « ConsommationGite » and « Réseau »;
      Sowel's activity feed shows the bridge only on real changes. Verified locally on 2026-11-17 against a fake
      house carrying the gîte's real equipments: 390 / 900 / 1280 px, day and night, « Réseau » export and import, a
      silent house, the tree switched on and off; Sowel's activity feed is checked once recipe 0.2.0 is installed.

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
- Any figure Sowel does not already hold: trends, averages, forecasts derived on our side (rule 25).
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
- 2026-11-17 — the catalogue is limited by a second recipe slot, « Capteurs partagés » (Adrien, questionnaire, rule
  24).
- 2026-11-17 — the day's min/max come from Sowel's history through a `sowel-core` evolution proposed to Marc, never
  computed by us (Adrien, questionnaire, rule 25).
- 2026-11-17 — the bridge's verbosity is cut by sending less, not by changing Sowel's activity feed (Adrien,
  questionnaire, rule 26).
- 2026-11-17 — the rain gauge is shared too; and the amendment ships without waiting for `sowel-core` spec 211:
  min/max and bars appear when it lands (Adrien).
- 2026-11-17 — the trend arrow is removed (Adrien, questionnaire).
- 2026-11-17 — « Réseau » is the value of Sowel's energy page, green when sent back to EDF, red when drawn (Adrien,
  rule 29).
