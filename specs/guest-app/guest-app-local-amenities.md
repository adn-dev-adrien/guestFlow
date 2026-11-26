# Guest app — « Pratique »: the shops and waste points around the estate on a map

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/guest-app-local-amenities-map` |
| **Created** | 2026-11-26 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary / mock-up** | `docs/specs/2026-11-26-guest-app-local-amenities.html` |

---

## 1. Context

Guests ask the same questions every stay: where is the bakery, is the pharmacy open, where do the bins go. The
estate has no waste collection: household waste, packaging and glass go to the collection points of Satillieu,
Saint-Romain-d'Ay and Saint-Alban-d'Ay, and bulky waste to the Saint-Alban-d'Ay recycling centre.

What the guest app offers today does not answer them:

- **Soliomap** (tile « Activités », `guest-app.md` rule 15) maps *activities*. Its eight categories are a closed,
  colour-validated set that comes with a drive time, a time on site and free / paid (Soliomap
  the interactive-map spec of Soliomap's own repository, rule 4). A bakery or a glass bank has none of these, and fourteen categories would
  break the palette. Soliomap stays as it is.
- The **booklet** has `place` blocks (`guest-app.md` rule 18): one address and « Itinéraire » each, no map, no
  filter, no opening hours.

Decided with Adrien on 2026-11-26: a **native page in the guest app**, its places entered in the **Studio**; reached
from a **home tile** and from a **booklet button**.

## 2. Goal

A guest sees on one map the bakeries, pharmacy, butcher, tobacconist, grocery shops and waste points of
Satillieu, Saint-Romain-d'Ay and Saint-Alban-d'Ay, filters them by kind, and opens any of them in their phone's GPS.

## 3. Functional rules

### 3.A The page

1. **Module `places`, tile « Pratique ».** A new module of `guest-app.md` rule 11bis, key `places`, label
   « Pratique » (EN « Essentials »), **on** by default, placed right after `soliomap`.
   Prerequisite: at least one published place. Open to every mode (stay, pre-arrival, visitor): nothing in it is
   private. An off module answers 404 `MODULE_OFF` like the others.
2. **Map first.** The page opens on a map (OpenStreetMap tiles) centred to show the estate and every published
   place, the estate drawn with its own non-clickable marker. A « Carte · Liste » switch sits under the filters
   (decided 2026-11-26: map first; offline, rule 9 shows the list whatever the choice). The tile layer is requested with
   `referrerPolicy: 'strict-origin-when-cross-origin'`: the app answers with `Referrer-Policy: no-referrer` (helmet) and
   OpenStreetMap's tile servers refuse a request without a Referer.
3. **Markers.** One round marker per place: fill colour = category, white glyph = category (identity never by
   colour alone, same rule as Soliomap rule 5). Markers closer than 28 px group into a counted bubble ringed with
   the colours it holds; a tap zooms to them; markers are redrawn on a zoom only (never on a pan, which would drop the keyboard focus). At maximum zoom, markers on the same spot fan out instead of grouping.
4. **Filters.** A chip row « Tout » + one chip per category that holds at least one published place, with its
   count. Chips are additive (several at once); « Tout » clears them. A category with no published place shows no
   chip. A filter that hides the open place closes its sheet.
5. **List.** The same filtered places, grouped by category, sorted by drive time from the estate then name
   (server order), each row: glyph, name, commune · drive time, open / closed state.
6. **Place sheet.** A tap on a marker or a row opens a bottom sheet (centred dialog from 900 px): category,
   name, commune · drive time, open state and the week's hours with today in bold (rule 13), what can be dropped
   (waste places, rule 10), what is sold (fuel places, rule 10), the note, « Vérifié le <date> », then « Itinéraire » and « Appeler » when a phone is
   known. Absent fields are absent, never « N/A ».
7. **Itinéraire.** The first tap offers **Plans** (Apple devices only), **Google Maps** and
   **Waze**; the choice is remembered on the device (`localStorage`) and later taps open it directly, with
   « Changer d'appli » under the button. Links: `https://maps.apple.com/?daddr=<lat>,<lng>&dirflg=d`,
   `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>`, `https://waze.com/ul?ll=<lat>,<lng>&navigate=yes`.
   Built by the server from the stored coordinates, never by the client.
8. **« Me localiser ».** A map button shows the device's position as a blue dot, after the browser's own
   permission prompt on the first tap. The position never leaves the phone: no request carries it. The core sends
   `Permissions-Policy` with `geolocation=()` on every response; the guest app's own answers (and only those) re-send the
   same value with `geolocation=(self)`, derived from the core's header so its list is never forked. The Studio and the
   admin keep the denial.
9. **Offline.** The places payload is cached by the service worker like the booklet (`guest-app.md` rule 21), so
   the list, the sheets and the GPS links work without network. Without network the page shows the list, with
   « Pas de connexion : la carte ne peut pas se charger » above it; tiles are never cached by the app.

### 3.B The places

10. **Categories — closed set, in this order.** `dechets` (Déchets), `boulangerie` (Boulangeries), `pharmacie`
    (Pharmacie), `boucherie` (Boucheries), `epicerie` (Épiceries, supérette included), `tabac` (Tabac-presse),
    `poste` (La Poste), `distributeur` (Distributeur de billets), `carburant` (Carburant et recharge). A new
    category is a spec change. Each category has its glyph and a colour validated with the dataviz palette
    validator on all pairs, against the day and night map grounds.
    - A `dechets` place has a `wasteKind` — `point` (collection point) or `decheterie` — and a non-empty
      `accepts` list among `om` (ordures ménagères), `emballages`, `verre`, `papier`, `textile`, `vegetaux`,
      `encombrants`. One « Déchets » chip only (decided 2026-11-26); the sheet lists what can be dropped.
    - A `carburant` place has a non-empty `energies` list among `essence`, `gazole`, `recharge` (recharge
      électrique), shown as tags in the sheet.
11. **One list for the estate.** Places are not per lodging: every lodging with the module on shows the same
    list.
12. **Drive time.** Each place carries `driveMinutes`, entered in the Studio (integer 1–60, required): the
    time by car from the estate, as Soliomap does (decided 2026-11-26 — the mountain roads double the
    great-circle distance, so a computed distance misleads). The server labels it « 6 min en voiture »
    (EN « 6 min drive »). The estate's position is a Studio setting (prefilled 45.16369, 4.63184), used for its
    marker and the 15 km check of rule 16.
13. **Hours.** Optional weekly ranges per day (0–2 ranges a day). The server derives, at Paris
    time, `Ouvert · ferme à 13 h` / `Fermé · ouvre à 15 h` / `Fermé · ouvre demain à 7 h` / `Horaires non
    renseignés`. A place with no hours never claims to be open.
14. **Freshness.** Each place carries `verifiedOn` (set to today on every save in the Studio); the sheet shows it.
    The Studio lists places not verified for 12 months first, flagged « À revérifier ».

### 3.C The Studio

15. **Page « Pratique ».** List grouped by category with counts (a category at 0 says « masquée aux clients »),
    publish switch, order by category then name; add / edit / delete in a dialog.
16. **Fields and refusals** (server-validated, the Studio only shows them):
    - name FR required (≤ 80), EN optional (falls back to FR);
    - category required, from rule 10;
    - commune from Satillieu, Saint-Romain-d'Ay, Saint-Alban-d'Ay, « Autre » + free text;
    - position required, pasted as `45.1502, 4.6151` or as a Google Maps link carrying coordinates (`@lat,lng`,
      `?q=`, `!3d…!4d…`). Unparseable → « Position non reconnue : collez « 45.1502, 4.6151 » ou un lien Google
      Maps qui contient les coordonnées. » More than **15 km** from the estate → « Ce lieu est à N km du domaine :
      la carte couvre 15 km autour. » No address geocoding;
    - drive time required, integer 1–60 → « Indiquez le temps en voiture depuis le domaine, en minutes (1 à 60). »;
    - `dechets` without anything in `accepts` → « Cochez au moins ce qu'on peut y déposer. »;
    - `carburant` without anything in `energies` → « Cochez au moins une énergie : essence, gazole ou recharge. »;
    - phone optional, French format, 10 digits;
    - note FR / EN optional (≤ 280);
    - hours: each range `open < close`, ranges of a day not overlapping.
17. **Seed.** No automatic import. The OpenStreetMap extraction of 2026-11-26 (summary page, « Données de
    départ ») is entered once by Adrien after checking it on the ground; it is not shipped in a migration.

### 3.D Entry points

18. **Booklet button target.** The `button` block gains the target `{ kind: 'places', category? }`: it opens the
    page with that category's chip already on. Not rendered when the `places` module is off for the session
    (same rule as the other targets, `guest-app.md` rule 18). The page *Le domaine* gets « Voir les points de
    collecte » → `{ kind: 'places', category: 'dechets' }` (content, entered in the Studio).

**Edge cases:**
- No published place → no tile, no booklet button, `GET …/places` answers 404 `MODULE_OFF`.
- A filter leaves nothing → « Rien dans ce filtre » + « Tout afficher » (only reachable through a stale deep link,
  since empty categories have no chip).
- A place on the exact same spot as another (OSM shows shops a few metres apart) → fan-out at maximum zoom (rule 3).
- Geolocation refused or unavailable → toast « Position indisponible », the map stays as it is.
- Night register → same tokens as the rest of the app; marker colours keep ≥ 3:1 against both map grounds.

## 4. Architecture

### 4.1 Server side (`server/src/plugins/guest-app/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| plugin | `migrations.js` | T | Table `guest_app_places` (§5) |
| plugin | `modules.js` | T | Module `places`, default on after `soliomap`, prerequisite `publishedPlaces > 0`, every mode |
| plugin | `places.js` | C | Pure: validation (rule 16), Google Maps link parsing, 15 km check, drive-time label, open state from weekly hours at Paris time, the three GPS links, server order, the guest payload and the Studio's grouped list |
| plugin | `placeCategories.js` | C | The closed set of rule 10 with its FR / EN labels, no dependency (the booklet's button target and `places.js` both read it) |
| models | `placesModel.js` | C | Prepared statements: list (published / all), get, insert, update, delete, count published |
| controllers | `placesController.js` | C | Guest payload (rules 4-7, 12-13) and Studio CRUD |
| routes | `public.js` | T | `GET /public/v1/guest/places` (session or visitor, module guard) |
| routes | `admin.js` | T | `GET/POST /api/guest-app/places`, `PUT/DELETE /api/guest-app/places/:id` |
| plugin | `bookletBlocks.js`, `booklet.js` | T | Button target `places` validated and resolved, hidden when the module is off |
| plugin | `settings.js` | T | Setting `estatePosition` (`lat, lng`, default `45.16369, 4.63184`), judged by `places.js` |
| controllers | `studioSettingsController.js` | T | `estatePosition` read and written with the Studio's other settings |
| controllers | `bookletController.js` | T | The `places` button target follows the `places` module (every mode) |
| plugin | `appHosting.js` | T | CSP: `img-src` adds `https://tile.openstreetmap.org` (tiles only; no script, no connect); the guest build's answers open `geolocation` to `self` in the core's `Permissions-Policy` (rule 8) |
| plugin | `manifest.json` | T | Version 1.6.0 and its journal lines |
| tests | `plugins/guest-app/tests/guest-app-local-amenities.unit.test.js` | C | §7 — the plugin's suites live in its own `tests/` folder, not `server/src/tests/` |

### 4.2 Client side

| App | File | T/C | Responsibility |
|---|---|---|---|
| guest | `pages/PlacesPage.jsx` | C | Chips, map / list switch, offline banner, deep-link category |
| guest | `components/PlacesMap.jsx` | C | Leaflet map: tiles, estate marker, category markers, grouping and fan-out, zoom, « Me localiser » |
| guest | `components/PlaceSheet.jsx` | C | The sheet of rule 6 on the existing `BottomSheet`; the GPS chooser and its remembered choice (`device` store, key `gps`) |
| guest | `constants/placeCategories.js` | C | The one palette of category colours and their Lucide glyphs (component for the page, drawing data for the markers) |
| guest | `utils/clusterPoints.js`, `utils/glyphSvg.js` | C | Pure: pixel-distance grouping and fan-out of rule 3; a Lucide glyph as an SVG string for Leaflet's HTML markers |
| guest | `components/blocks/ButtonBlock.jsx` | T | Target `places` → `/pratique?c=<category>` |
| guest | `App.jsx`, `pages/HomePage.jsx`, `components/Icon.jsx`, `hooks/useActions.js`, `services/api.js`, `i18n/`, `styles.css` | T | Route `/pratique` (module guard), tile icon and action, `api.places()`, the `places` button target, FR / EN strings, the page's styles |
| guest | `public/sw.js` | T | Cache `/public/v1/guest/places` with the booklet reads |
| guest | `package.json` | T | `leaflet` (no `react-leaflet`: one component, imperative API, smaller). The map is loaded lazily with the page (`React.lazy`): the home and the shop do not pay for it |
| studio | `pages/PlacesPage.jsx` | C | Estate position field, list by category, publish switch, delete, « À revérifier » |
| studio | `components/PlaceDialog.jsx` | C | Add / edit dialog; refusals shown under their field; hours with the existing `RangesEditor` |
| studio | `StudioShell.jsx`, `App.jsx`, `services/api.js`, `constants/studio.js`, `components/ModuleIcon.jsx`, `preview/PreviewApp.jsx`, `components/blockEditors/ButtonEditor.jsx` | T | Entry « Pratique » under Réglages (`/reglages/pratique`), the module's label and icon, the `places` button target with its category |

No GuestFlow admin client change.

### 4.3 API contract

`GET /public/v1/guest/places` →
```json
{ "estate": { "lat": 45.16369, "lng": 4.63184 },
  "categories": [ { "key": "boulangerie", "label": "Boulangeries", "count": 4 } ],
  "places": [ { "id": 3, "category": "boulangerie", "name": "Maison Roux", "commune": "Satillieu",
    "lat": 45.15123, "lng": 4.6163, "driveMinutes": 4, "driveLabel": "4 min en voiture",
    "open": { "state": "open", "label": "Ouvert · ferme à 13 h" },
    "hours": [ { "day": "lundi", "ranges": "7 h – 13 h", "today": false } ],
    "accepts": null, "energies": null, "note": null, "phone": null, "telUrl": null, "verifiedOn": "2026-11-26",
    "links": { "apple": "…", "google": "…", "waze": "…" } } ] }
```
Places in server order (category order of rule 10, then drive time, then name). As built, a place also carries
`categoryLabel` (singular, for the sheet), `wasteKind` (`{ key, label }` or null), `accepts` and `energies` as lists of
`{ key, label }` (or null), `phone` written in groups of two (`04 75 12 34 56`), `telUrl` (`tel:0475123456`); `hours` is the
week Monday first and null when no hours are known; the language is `?lang=` / the stay's / the browser's, and a missing
English name or note falls back to French. The route reads for a session or, in visitor mode, `?lodgingCode=` (the booklet's reader).

Studio routes (`/api/guest-app/places`, admin only):
- `GET` → `{ estate: { lat, lng, position, communes, maxKm }, categories, groups: [{ key, label, count, publishedCount, hiddenFromGuests, places }], reviewCount }`;
  each place is `{ id, category, nameFr, nameEn, commune, position, lat, lng, driveMinutes, wasteKind, accepts, energies, phone, noteFr, noteEn, hours, published, verifiedOn, needsReview }`
  (`hours` = 7 arrays, Sunday first, of `[openMin, closeMin]`; 1440 is midnight); in a group, places to re-verify come first, then by name.
- `POST` and `PUT /:id` take that shape with `position` as the pasted text (coordinates or Google Maps link); the server parses it into `lat` / `lng`.
  A `PUT` whose body is `{ published }` alone only flips the switch and leaves `verifiedOn` alone; any other save sets `verifiedOn` to today (rule 14).
- `DELETE /:id`; an unknown id answers 404 `PLACE_NOT_FOUND`.
- Refusals are `400 { error: 'INVALID_PLACE', fields: { position: '…' } }`, one French message per field (`category`, `nameFr`, `nameEn`, `commune`, `position`,
  `driveMinutes`, `wasteKind`, `accepts`, `energies`, `phone`, `noteFr`, `noteEn`, `hours`, `published`; `_` for a malformed request).
- The estate position is read and written with the Studio's settings (`GET / PUT /api/guest-app/studio/settings`, key `estatePosition`, `45.16369, 4.63184`); an unparseable value is refused with rule 16's position message.

## 5. Data model

`guest_app_places`: `id`, `category` TEXT, `name_fr` TEXT, `name_en` TEXT NULL, `commune` TEXT, `lat` REAL,
`lng` REAL, `drive_minutes` INTEGER, `waste_kind` TEXT NULL, `accepts` TEXT NULL (JSON array), `energies` TEXT
NULL (JSON array), `phone` TEXT NULL, `note_fr` / `note_en` TEXT
NULL, `hours` TEXT NULL (JSON: 7 arrays of `[openMin, closeMin]`, Sunday first), `published` INTEGER DEFAULT 1,
`verified_on` TEXT, `created_at`, `updated_at`. New table, no existing data touched.

## 6. UI / UX

The summary page above is the reference mock-up (day and night, offline, Studio refusals). Guest app tokens and
components only (`apps/guest/DESIGN.md`): chips `.chip`, `BottomSheet`, square buttons, Marcellus titles.
Mobile: tab bar under 900 px, sheet from the bottom; from 900 px the sheet is a centred dialog and the map takes
the pane. Touch targets ≥ 44 px (map controls included). `prefers-reduced-motion`: no zoom animation, no fly-to.

## 7. Test plan

- Server unit — `server/src/plugins/guest-app/tests/guest-app-local-amenities.unit.test.js` (32 tests): validation and refusals (rule 16),
  link parsing (3 Google formats + plain coordinates), 15 km check, drive-time labels, `energies` / `accepts`
  required by category, open state across midday break, Sunday,
  next-day opening, no hours (rule 13), GPS links (rule 7), module prerequisite (rule 1), button target hidden
  when off (rule 18), visitor access.
- Guest client — `apps/guest/src/__tests__/PlacesPage.filters.test.jsx` (12): chips, empty category hidden, deep-link category, list, offline list, home tile,
  button target; `PlaceSheet.gps.test.jsx` (9): the sheet's content and the remembered GPS choice; `PlacesMap.leaflet.test.jsx` (7, Leaflet replaced by a stand-in):
  tiles and their referrer policy, redraw on zoom only, estate marker, grouping bubble, fan-out, « Me localiser »; `PlacesMap.grouping.test.js` (4): pure grouping and the palette's contrast;
  `sw.offline.test.js` (+2): `/places` cached like the booklet.
- Studio client — `apps/studio/src/__tests__/PlacesPage.test.jsx` (10): the list, « À revérifier », the switch, delete, refusals shown under their field, the week sent as minutes, the estate position.
- Manual: iPhone (Plans, Google Maps, Waze installed or not), Android, offline after a first load, night.

## 8. Out of scope

- Routing inside the app; live traffic.
- Importing or syncing OpenStreetMap / Annonay Rhône Agglo data.
- Per-lodging lists; opening exceptions (holidays, closures).
- Any change to Soliomap.

## 9. Open questions

None open.

### Resolved (2026-11-26, Adrien, on the summary page)

- Where: a native page in the guest app, places entered in the Studio (not a Soliomap view, not booklet blocks).
- Entry: home tile + booklet button (rules 1, 18).
- Q1 Name: « Pratique » / « Essentials » (rule 1).
- Q2 Itinéraire: chooser Plans / Google Maps / Waze, remembered on the device (rule 7).
- Q3 Waste: one « Déchets » chip (rule 10).
- Q4 Hours: weekly ranges with « Ouvert · ferme à 13 h » (rule 13).
- Q5 Distance: drive minutes entered per place in the Studio, not a computed distance (rule 12).
- Q6 Opening view: the map (rule 2).
- Q7 « Me localiser »: yes, on demand, position kept on the phone (rule 8).
- Built (2026-11-26): the places live in `guest_app_places` with no seed (rule 17); the existing lodgings get the module at the end of their stored list, on.
- Q8 Extra categories: La Poste, Distributeur de billets, Carburant et recharge (rule 10). Doctor: no.

## 10. Implementation progress

Done 2026-11-26 on `feature/guest-app-local-amenities-map`:
- Server: table, module, `places.js`, model, controller, routes, button target, CSP, setting, plugin 1.6.0 — 32 tests.
- Guest app: page, map (Leaflet, lazy chunk), sheet with GPS chooser, offline cache, tile, button target — 30 tests (+2 in `sw.offline.test.js`).
- Studio: Réglages › Pratique, dialog, button editor target — 10 tests.
- Manual checks left to Adrien (§7): iPhone (Plans, Google Maps, Waze installed or not), Android, offline after a first load, night, the map in a real browser.
