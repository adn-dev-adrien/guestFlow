# Check-in Weather Alerts (Vigilance Météo-France)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/checkin-weather-alerts` _(user-managed)_ |
| **Created** | 2026-07-01 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The arrival SAS ([ReservationSasDialog.js](../client/src/components/sas/ReservationSasDialog.js)) walks the operator/guest through a sequence of conditional pages (`intro → portal → caution → … → cleaning → recap`), ordered by the `activeKeys` memo. The final page is always `recap`, where every decision is committed in a single call.

When a weather hazard hits the domain during a guest's stay (heatwave, thunderstorm, high wind…), there is today no place in the check-in flow that surfaces it. In France the authoritative source is **Vigilance Météo-France**, which publishes, **per département**, a colour level (green/yellow/orange/red) and a chronology (start/end datetime) for 9 phenomena (wind, rain-flood, thunderstorms, flood, snow-ice, heatwave, extreme-cold, avalanches, coastal-waves).

The domain's address already exists in Settings → « Informations sur votre activité » as `companyAddress` in the `app_settings` singleton ([SettingsCompanySection.js](../client/src/components/SettingsCompanySection.js), [settingsModel.js](../server/src/models/settingsModel.js)).

## 2. Goal

During the **arrival check-in SAS**, if there is an **Orange or Red** Météo-France vigilance whose validity window overlaps the guest's stay dates for the domain's département, show a dedicated **weather-alert page** (last page before the final recap) that reports the alert(s) — phenomenon, colour, timing during the stay, the official message — plus phenomenon-specific safety instructions (e.g. heatwave → fire ban + respect smoking areas). The alert data is refreshed in the background when the check-in opens. If no qualifying alert exists, the page does not appear at all.

## 3. Functional rules

1. The weather-alert source is **Vigilance Météo-France** (`DPVigilance` public API). The domain's département is derived from `companyAddress` via the IGN Géoplateforme geocoder.
2. Only the **arrival** SAS is affected (not departure).
3. The weather-alert page appears **only if** at least one qualifying alert exists; otherwise it is absent from the flow.
4. When present, the weather-alert page is inserted **immediately before `recap`** (the last page before the end of the check-in).
5. A vigilance qualifies only if **both**:
   - its colour level is **Orange (3) or Red (4)** — Yellow and Green are ignored;
   - its validity window **overlaps the stay** `[startDate 00:00 … endDate 23:59]`: `alertStart ≤ stayEnd && alertEnd ≥ stayStart`.
6. Each reported alert shows: phenomenon label (FR), colour (label + level), the alert's start/end **date & time that fall within the stay**, and a **French summary** of the alert for that phenomenon & colour. _(Implementation note 2026-07-01: the summary is synthesized server-side from the phenomenon/colour/timing — e.g. « Vigilance orange « Canicule » en cours pour votre secteur du 2 juillet à 12:00 au 4 juillet à 22:00. ». Pulling the full free-text Météo-France bulletin — `textesvigilance/encours` — is a possible later enhancement; see §8.)_
7. **Phenomenon-specific safety instructions** are appended by the backend on top of the official message:
   - **Canicule (heatwave, id 6):** the official message **+** « Les feux sont strictement interdits (barbecue, cigarette, etc.). » **+** « Merci de respecter impérativement les zones fumeurs. »
   - **Orages (thunderstorms, id 3):** the official message **+** explicit start/end date & time of the alert during the stay, **+** « Évitez les activités extérieures et les zones exposées pendant l'épisode orageux. »
   - Any other phenomenon: the official message + a generic prudence line.
8. Alert data is fetched by the client **in the background when the SAS opens** (a separate call, non-blocking for the rest of the wizard). The wizard renders normally; the weather page appears once the response arrives (if it qualifies).
9. The backend **caches** vigilance per département (short TTL) and refreshes a stale cache on demand, so opening several check-ins in a row does not hammer the API.
10. The Météo-France API key is an **operator-configured secret**, stored **encrypted** in `app_settings` and set from Settings. When no key is configured, the feature is inert: no page, no error shown to the guest.
11. All alert content shown to the guest is in **French**; all display shaping (labels, colour names, formatted dates, appended instructions, filtering) is done **server-side** — the client only renders the ready payload.

**Edge cases:**
- No API key configured → `{ configured: false, alerts: [] }` → no page, no UI error.
- Address empty or not geocodable → `{ resolved: false, alerts: [] }` → no page (logged server-side, not shown to guest).
- Météo-France API unreachable/errors → serve the last cached payload if any; otherwise `{ alerts: [] }` → no page (never blocks the check-in).
- Vigilance only covers **today (J) and tomorrow (J+1)**. A stay starting later than J+1 will legitimately return no alert until the vigilance window reaches those dates — the background refresh on each open picks up new alerts as they are published.
- Corsica (`2A`/`2B`) and overseas départements: département code is derived from the geocoded INSEE `citycode` (first 2 chars, with the Corsica special case), not from a naive substring of the postcode.
- Multiple qualifying phenomena → all are shown, ordered by colour (red first) then by start time.

---

## 4. Architecture

> **Fat backend, thin frontend.** Geocoding, the Météo-France call, caching, date-overlap filtering, colour thresholding, French label/colour mapping, message assembly and the appended safety instructions all live on the server. The client fires one request on open and renders the returned array.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `reservations.js` | T | Add `GET /:id/weather-alerts` → `weatherController.getReservationAlerts`. |
| `controllers/` | `weatherController.js` | C | Orchestrate: load reservation dates + `companyAddress` + API key → resolve département → get (cached) vigilance → filter by stay & colour → shape display payload. |
| `models/` | `weatherCacheModel.js` | C | DB access for the `weather_vigilance_cache` table (read fresh/stale, upsert). |
| `models/` | `settingsModel.js` | T | Add `meteoFranceApiKeyEncrypted` (encrypted column) + masked flag `meteoFranceApiKeySet`; helper `meteoFranceApiKey()` returning the decrypted key for internal use. |
| `utils/` | `meteoVigilance.js` | C | Pure-ish integration helpers: `geocodeDepartment(address)` (Géoplateforme), `fetchVigilance(dept, apiKey)` (Météo-France), `normalizeVigilance(raw)`, `filterAlertsForStay(phenomena, {start,end,threshold})`, `buildAlertDisplay(phenomenon, stay)` (labels, colour, timing, appended instructions). |
| `utils/` | `meteoVigilanceLabels.js` | C | Static maps: phenomenon id → FR label, colour id → {label, level}, phenomenon id → appended safety instructions. Pure, unit-tested. |
| `database.js` | `database.js` | T | Idempotent migrations: `ALTER TABLE app_settings ADD COLUMN meteoFranceApiKeyEncrypted TEXT DEFAULT ''`; `CREATE TABLE IF NOT EXISTS weather_vigilance_cache (...)`. |

**Notes:**
- New outbound HTTP uses the runtime's global `fetch` (Node 18+); no new dependency.
- Geocoding result (address → département) is cached in-memory in `meteoVigilance.js` keyed by the address string (cheap, re-resolved on restart or address change). Vigilance payloads are cached in the DB table (durable across restarts) with a short TTL.
- Cache TTL constant lives in `meteoVigilance.js` (e.g. `VIGILANCE_TTL_MINUTES = 30`).

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/sas/` | `ReservationSasDialog.js` | T | On open (arrival mode) fire `api.getReservationWeatherAlerts(id)` in a `useEffect`; store `weatherAlerts`; add `weather` to `activeKeys` (before `recap`) when `weatherAlerts.length > 0`; render the new page. |
| `components/sas/` | `SasWeatherAlertPage.js` | C | Presentational page rendering the alert list (colour badge, phenomenon, timing, message, instructions). Feature-local (SAS-specific layout). |
| `components/` | `StatusBadge.js` | (T/—) | Reuse for the colour chip if it already fits; otherwise render an MUI `Chip` with the colour from the payload. |
| `components/` | `SettingsIntegrationsSection.js` _or_ `SettingsCompanySection.js` | T | Add a `MaskedTextField` for the Météo-France API key (masked/`Set` pattern like SMTP/Qonto). |
| `pages/` | `SettingsPage.js` | T | Wire the new key field into the settings form group + PUT payload. |
| `services/` `api.js` | `api.js` | T | Add `getReservationWeatherAlerts(id)` → `GET /reservations/:id/weather-alerts`; pass the new key through the settings payload. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `MaskedTextField`, `StatusBadge` (for colour chip if suitable) | Reuse the secret-field + status-chip patterns already used by SMTP/Qonto. |
| **Created (new generic)** | — | None; the colour chip reuses `StatusBadge`/`Chip`. |
| **Specific (kept feature-local)** | `SasWeatherAlertPage` | Layout tightly coupled to the SAS wizard page frame; not reusable elsewhere. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/weather-alerts` | — | `{ configured: boolean, resolved: boolean, department: string\|null, alerts: Alert[] }` | Auth: same as other reservation routes. Never 5xx on upstream failure — degrades to `alerts: []`. |
| PUT | `/api/settings` | `{ integrations: { meteoFranceApiKey } }` (or within existing group) | masked | Key stored encrypted; response exposes only `meteoFranceApiKeySet: boolean`. |

`Alert` shape (all display-ready, FR):
```jsonc
{
  "phenomenonId": 6,
  "phenomenon": "Canicule",
  "colorLevel": 3,                 // 3=orange, 4=rouge
  "color": "Orange",
  "startsAt": "2026-07-02T12:00:00",
  "endsAt": "2026-07-04T22:00:00",
  "timingLabel": "du 2 juillet 12:00 au 4 juillet 22:00",
  "message": "Épisode de forte chaleur… (texte Météo-France)",
  "instructions": [
    "Les feux sont strictement interdits (barbecue, cigarette, etc.).",
    "Merci de respecter impérativement les zones fumeurs."
  ]
}
```

---

## 5. Data model

**`app_settings`** (singleton) — new encrypted column:
```sql
ALTER TABLE app_settings ADD COLUMN meteoFranceApiKeyEncrypted TEXT DEFAULT '';
```
Added to `ENCRYPTED_COLUMNS` + `COLUMNS` in `settingsModel.js`, masked to `meteoFranceApiKeySet` in `HTTP_MASKED_COLUMNS`.

**New table `weather_vigilance_cache`** (durable vigilance cache, one row per département):
```sql
CREATE TABLE IF NOT EXISTS weather_vigilance_cache (
  departmentCode TEXT PRIMARY KEY,
  payload TEXT NOT NULL,       -- JSON: normalized phenomena array
  fetchedAt TEXT NOT NULL      -- ISO timestamp of the fetch
);
```

**Migration strategy:** both blocks are idempotent (`ADD COLUMN` guarded like the existing settings migrations; `CREATE TABLE IF NOT EXISTS`). No backfill. Empty key = feature inert on existing installs. No existing data touched → no risk of loss.

## 6. UI / UX

**Weather-alert page (`SasWeatherAlertPage`), inside the arrival SAS, before recap:**
- Header: warning icon + « Alerte météo pendant le séjour ».
- One card per alert:
  - Colour chip (Orange/Rouge) using the payload colour.
  - Phenomenon name (bold) + `timingLabel`.
  - Official message paragraph.
  - Instructions rendered as a bulleted list (icon per line).
- Standard SAS footer: `Précédent` / `Suivant` (leads to `recap`), consistent with other pages.
- **Loading:** the page only appears once the background call resolves with ≥1 alert; there is no spinner page. While the call is in flight the wizard is fully usable; if the guest reaches `recap` before it resolves and an alert then arrives, the page is inserted before `recap` (they can still step back to see it). No blocking.
- **Empty/none:** page absent entirely.

**Responsive:**
- `xs` (mobile): single-column cards, full-width, reduced padding (`p: { xs: 1.5, sm: 3 }`); colour chip above the phenomenon title; the dialog is already `fullScreen` on mobile per the existing SAS pattern.
- `md`/`lg`: cards stacked with comfortable padding; chip inline with the title.

**Settings — Météo-France API key:**
- A `MaskedTextField` labelled « Clé API Météo-France (Vigilance) » with helper text linking to the Météo-France API portal, following the SMTP/Qonto masked-secret pattern (shows `••••••` + « Modifier » when set). Lives in the Settings page; saved via the existing `PageActionBar` Save. No new page-level actions.

## 7. Test plan

### Server unit tests (23 tests, all passing)
- [x] `tests/meteoVigilanceLabels.unit.test.js` — phenomenon→FR label, colour→{label,level}, canicule/orages instruction maps (+ no-shared-mutation).
- [x] `tests/meteoVigilance.unit.test.js`:
  - `normalizeVigilance(raw)` parses a sample Météo-France payload → phenomena with colour + timing (rule 6); unknown dept / malformed → [].
  - `filterAlertsForStay` keeps only colour ≥ orange (rule 5a) **and** windows overlapping the stay (rule 5b); drops yellow and non-overlapping; red sorts first; per-phenomenon collapse takes the max colour.
  - `buildAlertDisplay` for **Canicule** appends the fire-ban + smoking-area lines (rule 7); for **Orages** leads with explicit start/end timing (rule 7).
  - `frTimingLabel` multi-day + same-day (Europe/Paris); département extraction from INSEE citycode incl. Corsica `2A`/`2B` + overseas.
  - `getVigilanceForDepartment` no-key/no-dept → []; fresh cache short-circuits the fetch.
- [x] `tests/weatherCacheModel.unit.test.js` — upsert + fresh/stale read + upper-case normalization against an in-memory DB (rule 9).

### Client unit tests (Vitest)
- [x] `components/sas/__tests__/SasWeatherAlertPage.test.js` — renders phenomenon, colour chip, timing, message, instructions; multiple alerts; empty list.
- [x] `components/sas/__tests__/ReservationSasDialog.test.js` — mock extended with `getReservationWeatherAlerts` (flow unchanged when no alert).

### Manual UI verification
- [ ] Happy path (needs a real key): department with an active Orange vigilance → weather page appears before recap; canicule shows fire-ban + smoking lines; orage shows date/time. _(Requires the operator to create a Météo-France key.)_
- [x] No-key path: empty key → page absent, no error (default state; covered by the inert-feature path).
- [x] Mobile (`xs`): cards stack, dialog already fullscreen (existing SAS pattern).
- [x] Regression: full server suite (1955) + client Vitest (603) green; arrival/departure SAS flows unchanged.

## 8. Out of scope

- Departure SAS weather page (arrival only).
- Yellow-level vigilance (only Orange/Red trigger).
- Weather forecasts / temperatures (only official vigilance alerts).
- Per-property addresses (uses the single domain `companyAddress`).
- Push/email notification of alerts (only shown inside the SAS).
- Long-range alerts beyond Météo-France's J/J+1 vigilance horizon.
- Pulling the full free-text Météo-France bulletin (`textesvigilance/encours`) — v1 synthesizes a
  French summary from the carte data instead (see rule 6). Possible later enhancement.

## 9. Open questions

- Q: Cache TTL value?
  - A (proposed): 30 minutes — well under the ~twice-daily vigilance update cadence, cheap to refresh on open.
- Q: Where exactly to place the API key field in Settings (new « Intégrations / Alertes météo » card vs. inside an existing section)?
  - A (resolved 2026-07-01): a **dedicated « Alertes météo » card** in the Settings page (title + masked key field + link to the Météo-France API portal), following the masked-secret pattern.
