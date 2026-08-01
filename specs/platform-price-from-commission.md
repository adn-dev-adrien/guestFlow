# Platform list price from commission % (property tarif page)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-price-from-commission` _(user-managed)_ |
| **Created** | 2026-06-14 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

> **See also (2026-08-01):** this tarif page now also hosts **calendar season painting** — select a
> period on the season calendar to (re)assign it to a season (existing or new) with a per-range minimum
> nights, splitting the covering season server-side. See `specs/pricing-min-nights-per-range.md`.

## 1. Context

The property « tarif » page ([PropertyPricingSeasonsPage.js](../client/src/pages/PropertyPricingSeasonsPage.js))
lists a property's **tariff seasons**, each with a **net price per night** (`pricing_rules.pricePerNight`)
— this is the price the owner wants to **net**. When the owner also lists the property on a platform
(Airbnb, Booking…), the platform takes a **commission**, so the price to **display on the platform** must
be **grossed up** so that, after commission, the owner still nets the season price.

Today there's no help for this: the owner computes it by hand. Two facts from the codebase:
- The set of platforms is already **aggregated from the properties' iCal imports**: `platformsModel`
  seeds the `platforms` table at boot from `SELECT DISTINCT platformLabel FROM ical_sources`
  ([platformsModel.js:101](../server/src/models/platformsModel.js#L101)) and tops it up on every iCal
  source change. So the platform name list the operator wants **already exists**.
- No commission **rate** is stored per platform (a `commissionRatePercent` column existed but was dropped
  as "informational only, never used"). The accounting only derives commission **after the fact**
  (`commission = gross − net`, [accountingModel.js:321](../server/src/models/accountingModel.js#L321)).

## 2. Goal

On a property's tarif page, for each **platform** (aggregated from the iCal imports) and each **tariff
season**, show the **price to list on that platform** so that — after the platform's commission % — the
owner nets the season's price/night. The commission % is entered per platform and reused everywhere.

## 3. Functional rules

1. **Platform list = the aggregated iCal platforms.** Use the existing `platforms` table (already fed
   from `DISTINCT ical_sources.platformLabel` + reservations), **excluding** the `direct` row (no
   commission on direct bookings).
2. **Commission % per platform.** Each platform carries a **`commissionPercent`** (REAL, default 0,
   range `0 ≤ c < 100`). It is **global per platform** (a platform's rate is the same for every property)
   and **editable** from the tarif page; the value persists and is reused on every property's tarif page.
3. **Gross-up formula (server-side):** `gross = round2(net / (1 − c/100))`.
   - `c = 0` → `gross = net` (no platform fee).
   - `c` clamped to `[0, 99.99]`; a value `≥ 100` is rejected (would divide by ≤ 0) — treated as invalid,
     no price shown for that platform.
   - Rounding: 2 decimals (cents), like the rest of the pricing engine (`roundMoney`).
4. **Computed for each season's `pricePerNight`** (the net base /nuit), per platform. (Progressive tiers
   are out of scope — decision 2026-06-14, Q2.)
5. The grid is **read-only** (display of computed gross prices); only the per-platform commission % is
   editable. Editing a % re-computes the grid (server) and persists the % for that platform.
6. **Fat backend:** the aggregation, the clamp, and the gross-up math live on the server; the client only
   renders the returned grid and edits the % via the API.

**Edge cases:**
- A property with **no tariff seasons** → empty grid (just the platform list + % inputs, or a hint).
- **No platforms** beyond `direct` (no iCal source anywhere yet) → the section shows an empty-state hint
  (« Aucune plateforme — configurez un import iCal »).
- A platform with `commissionPercent = 0` → gross = net (shown as-is, not hidden).
- Changing a season's net price → the grid reflects it on next load/refresh.

---

## 4. Architecture

> **Fat backend, thin frontend.** Platform aggregation, the clamp, and `gross = net/(1−c)` rounding live
> on the server. The client renders the grid and PUTs a commission %.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent migration: re-add `platforms.commissionPercent REAL NOT NULL DEFAULT 0` (now **used**, not informational). |
| `utils/` | `pricing.js` | T | New pure helper `grossFromNet(net, commissionPercent)` → `round2(net / (1 − clamp(c)/100))`; `c≥100` → null. Exported + unit-tested. |
| `models/` | `platformsModel.js` | T | Include `commissionPercent` in the SELECT/list; `update()` accepts + writes it (clamped). Add `listWithCommission()` (non-direct platforms + their %). |
| `models/` | `propertiesModel.js` | T | `platformPrices(propertyId)` → `{ platforms: [{ id, name, commissionPercent }], seasons: [{ ruleId, label, netPerNight, byPlatform: { [platformId]: grossPerNight|null } }] }`. |
| `controllers/` | `propertiesController.js` | T | `platformPrices` handler (GET). |
| `controllers/` | the platforms controller (behind `PUT /platforms/:id`) | T | Accept `commissionPercent` on update (clamped). |
| `routes/` | `routes/properties.js` | T | `GET /:id/platform-prices`. |
| `routes/` | platforms route | T | Ensure the platform-update route forwards `commissionPercent`. |

**Notes:** routes thin. `grossFromNet` is the single source of the formula (also reusable later if we
ever want to gross-up a full quote). No change to the booking/accounting flow.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `PropertyPricingSeasonsPage.js` | T | New **« Prix plateformes »** Card: a table (rows = seasons, columns = platforms). Each column header shows the platform name + an editable commission % field. Cells show the computed gross /nuit (read-only). Editing a % calls the API (debounced) → persists + refreshes the grid. Rendered **last** on the page (below the yearly season tables). |
| `api.js` | `api.js` | T | `getPlatformPrices(propId)` (GET `/properties/:id/platform-prices`); `setPlatformCommission(platformId, commissionPercent)` (reuses the platform-update endpoint). |

**Component reuse declaration:** reuses existing MUI `Table`/`TextField`/`Card` patterns already on the
page; no new generic component. A small note clarifies the % is **global per platform** (applies to all
properties).

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/properties/:id/platform-prices` | — | `{ platforms: [{ id, name, commissionPercent }], seasons: [{ ruleId, label, netPerNight, byPlatform: { [platformId]: number\|null } }] }` | Excludes `direct`. `null` gross = invalid % (≥100). |
| PUT | `/api/platforms/:id` (existing) | `{ commissionPercent? }` (+ existing fields) | updated platform | `commissionPercent` clamped to `[0, 99.99]`. |

---

## 5. Data model

Idempotent migration in `database.js`:

```sql
ALTER TABLE platforms ADD COLUMN commissionPercent REAL NOT NULL DEFAULT 0;
```

**Data impact:** additive; existing platforms get `0` (gross = net until a rate is entered). No backfill.
The `direct` platform keeps `0` and is never shown in this feature.

## 6. UI / UX

**« Gestion tarifaire » page — « Prix plateformes » card** (placed **last**, below the yearly season tables):
- A **table**: first column = season (label + « net /nuit »), then one column per non-direct platform.
- Each platform column **header**: the platform name + a small **« % commission »** number field
  (editable, 0–99.99), with a caption that the rate is shared across all properties.
- **Cells**: the gross price /nuit to list (`net / (1 − %)`, 2 decimals). When the % is 0 → equals net.
- **Empty states**: no seasons → hint to add a season; no platforms → hint to add an iCal import.
- Editing a % → debounced PUT, then the column's cells refresh. A short helper explains the formula
  (« Prix à afficher sur la plateforme pour net X € après commission »).
- **Responsive:** the table scrolls horizontally inside a contained wrapper on `xs` (many platform
  columns); the % fields stay tappable (≥44px). Card padding reduced on `xs`.
- **PageActionBar:** N/A — content inside the existing tarif page.

## 7. Test plan

### Server unit tests (`platform-price-from-commission.unit.test.js`, +5; suite 1508 green)
- [x] `grossFromNet`: `c=20,net=100 → 125`; `c=15,net=100 → 117.65`; `c=0/undefined/negative → net`;
      `c≥100 → null`.
- [x] `platformsModel` — `setCommissionPercent` clamps to `[0,99.99]`, rejects `direct`;
      `listWithCommission` excludes `direct`. Existing platform fixtures updated for the new column.
- [x] `propertiesModel.platformPrices` — seasons × non-direct-platforms grid with correct gross per cell;
      empty seasons / platforms handled.

### Client (vitest) — `PlatformPriceCard.test.js` (+4)
- [x] Renders the grid (gross per season × platform, net when % = 0); empty-platforms + empty-seasons
      hints; editing a % PUTs (debounced) and re-fetches.

### Manual / live verification (done 2026-06-14)
- [x] Server boot OK on the real DB (idempotent `platforms.commissionPercent` migration); `GET
      /properties/1/platform-prices` → grid; `PUT /platforms/:id/commission` 15 % → season net 252 →
      Airbnb gross **296,47 €** (= 252 / 0,85); dev DB reverted to 0 after the check. Client build green.
- [ ] Browser pass of the tarif-page card (the user's env) — recommended before release.

## 8. Out of scope

- Grossing up progressive tiers / weekend / extra-guest surcharges (only the season base /nuit — Q2).
- Per-property or per-property×platform commission rates (the rate is global per platform).
- Pushing prices to the platforms automatically (display/calculator only).
- Any change to the booking, quote, or accounting commission flow.

## 9. Open questions — resolved 2026-06-14

- **Q1 — where to edit the commission %?** → **Inline on the tarif page** (platform-column header),
  persisting the global per-platform rate.
- **Q2 — rounding granularity?** → **2 decimals** (cents), consistent with the engine.
