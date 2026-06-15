# Extinguisher seal check (SAS) + configurable repair amounts

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/extinguisher-seal-repair-amounts` _(user-managed)_ |
| **Created** | 2026-06-15 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The arrival/departure SAS (`specs/arrival-departure-sas.md`, `ReservationSasDialog`) guides the operator
through check-in/check-out. There is currently **no fire-extinguisher seal (« plomb ») check**, and no
place to configure **repair charges** that can be billed to a guest. Adrien wants the operator to
verify the extinguisher seal at both arrival and departure, bill its replacement when the guest broke
it, and to manage the replacement price (plus future repair prices) from the settings.

The SAS already bills extras through complements: the **arrival** SAS adds priced lines to the
**arrival complement** (`reservations.complementAmount`), and the **departure** SAS sets the
**end-of-stay complement** (`reservations.endOfStayComplementAmount` + `…Detail`). The operator-managed
priced-linen list (`linen_priced_items` via `linenItemsModel` + `GET/PUT /api/settings/linen-items` +
`SettingsLaundrySection`) is the **pattern** this spec mirrors for repair amounts.

## 2. Goal

The operator can verify the extinguisher seal at check-in and check-out; if the seal was present on
arrival but is missing on departure, the replacement price is added to the **end-of-stay complement**.
The replacement price — and any future repair prices — are configured in a new **« Tarifs facturables »**
settings section that also hosts the existing **linen prices** (moved there from Blanchisserie), so all
guest-billable amounts live in one place.

## 3. Functional rules

### 3.1 « Tarifs facturables » (Réglages)
1. **New « Tarifs facturables » section** groups everything the operator can bill a guest during the SAS,
   in **two sub-lists**: **« Prix du linge »** (the existing priced-linen items, **moved here** from the
   Blanchisserie section) and **« Montants de réparation »** (new — `{ label, price }` rows, add / edit /
   delete / save, extensible). The Blanchisserie section keeps only the laundry weekday + the linen-stock
   counts (its priced-items block moves out; the `linen_priced_items` data + its `linen-items` API are
   unchanged — only the UI relocates).
2. **Seeded « Plomb extincteur » with a stable key.** One row is seeded with `repairKey =
   'extinguisher_seal'`, label « Plomb extincteur », price `0` (operator sets it). Rows that carry a
   `repairKey` are **protected**: the operator can edit the **price** but not the label, and **cannot
   delete** them (so the SAS link can't break). Custom rows (no key) are fully editable/deletable. On
   save, the server **re-seeds** any missing keyed row, so `extinguisher_seal` always exists.
3. **Price 0 = no charge.** A `0` repair price means the SAS proposes no charge (with a hint to set the
   price), exactly like an unpriced linen item.

### 3.2 Extinguisher seal — SAS check (Adrien's decision 2026-06-15: « arrivée = constat, départ = facture »)
4. **Arrival SAS — baseline, never bills. Default = présent.** A new page « Extincteur » shows the seal
   as **présent by default** (a « Plomb de l'extincteur présent » switch, **ON**) + « Suivant »; the
   operator only flips it to **manquant** if it's actually missing. The answer is recorded
   (`extinguisherSealOkAtArrival` = 1 / 0, **default 1**); **no charge** at arrival. When flipped to
   manquant, the page notes the seal was already missing on arrival (owner to replace; guest not at fault).
5. **Departure SAS — bills only if broken during the stay. Default = présent.** The same « Plomb présent »
   switch defaults **ON**; the operator flips it to **manquant** if missing. On **manquant**:
   - seal **présent at arrival** — the default, **including reservations with no arrival SAS** (présent is
     assumed) → the « Plomb extincteur » repair amount is **added to the end-of-stay complement** (one
     line « Plomb extincteur » = its configured price).
   - seal **explicitly marked manquant at arrival** → **no charge** (pre-existing; flagged in the recap).
   - The departure answer is recorded (`extinguisherSealOkAtDeparture` = 1 / 0, **default 1**).
6. **One page per SAS, always shown.** The extinguisher page appears on **every** arrival and departure
   SAS (it's a safety check), placed just before the recap. The single commit at the recap is unchanged.
7. **« Précédent » navigation (new — all SAS pages).** The SAS gains a back affordance (a « ‹ » arrow in
   the header band, shown from the 2nd page on) that returns to the previous page; in-memory decisions
   are **preserved** (revisiting a page shows the prior answer). Going back writes nothing — only
   « Valider et terminer » commits. This relaxes the former forward-only rule (amended in
   `specs/arrival-departure-sas.md` §3.0).
8. **Recap reflects it.** The end-of-stay recap lists the « Plomb extincteur » line (when billed) within
   the existing end-of-stay total; the arrival recap is unchanged (arrival never bills the seal).

**Edge cases:**
- No `extinguisher_seal` price configured (0) + departure missing + was present → the line is proposed
  at 0 € with a hint to set the price in Réglages (no silent charge).
- Existing reservations (no arrival baseline column value) → baseline = « non vérifié » → no auto-charge.
- A finished SAS stays locked (existing `arrivalSasDoneAt` / `departureSasDoneAt` behaviour).

---

## 4. Architecture

> **Fat backend, thin frontend.** The repair-price list + its persistence, the seal-baseline storage,
> and the « bill only if broken during the stay » rule live on the server. The SAS dialog renders the
> page and builds the end-of-stay line from the server-provided price; the settings section edits the
> list.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | `repairAmountsModel.js` | C | `list()` + `replaceAll(items)` on `repair_amounts`, **preserving keyed rows** + re-seeding `extinguisher_seal`. `buildModel(db)` factory (mirror of `linenItemsModel`). |
| `controllers/` | `settingsController.js` | T | `getRepairAmounts` / `updateRepairAmounts` (mirror of the linen-items handlers). |
| `routes/` | `settings.js` | T | `GET /settings/repair-amounts`, `PUT /settings/repair-amounts`. |
| `controllers/` | `sasController.js` | T | `getSas` payload gains `repairAmounts` (the list); `commitArrival` / `commitDeparture` pass the new seal fields through. |
| `models/` | `reservationsModel.js` | T | `commitArrivalSas` persists `extinguisherSealOkAtArrival`; `commitDepartureSas` persists `extinguisherSealOkAtDeparture` (the bill rides the existing `endOfStayComplementDetail`). `getByIdWithDetails` returns both seal fields via `r.*`. |
| `database.js` | `database.js` | T | Migrations: `CREATE TABLE repair_amounts (id, repairKey TEXT, label, price REAL, sortOrder)`; seed `extinguisher_seal`; `ALTER TABLE reservations ADD COLUMN extinguisherSealOkAtArrival INTEGER` + `…AtDeparture INTEGER` (idempotent). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/sas/` | `ReservationSasDialog.js` | T | New `extinguisher` step in both `activeKeys` (before recap); arrival records the baseline; departure shows the baseline + builds the end-of-stay « Plomb extincteur » line when billable. New step icon. |
| `components/` | `SettingsBillableAmountsSection.js` | C | New **« Tarifs facturables »** card holding **both** sub-lists: « Prix du linge » (priced-linen items, via the existing `linen-items` API) + « Montants de réparation » (new `repair-amounts` API; keyed rows price-only + non-deletable). |
| `components/` | `SettingsLaundrySection.js` | T | **Remove** the priced-linen-items block (it moves to `SettingsBillableAmountsSection`); keep the laundry weekday + linen stock. |
| `pages/` | `SettingsPage.js` | T | Mount `SettingsBillableAmountsSection`. |
| `api.js` | `api.js` | T | `getRepairAmounts` / `updateRepairAmounts`; the SAS commit functions already exist (the new fields ride their bodies). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | the SAS `StepLayout` shell (refonte §6), `ConfirmDialog` | Reused for the new SAS page + any confirm. |
| **Created (new)** | `SettingsRepairAmountsSection` | A settings card specific to repair amounts; mirrors the linen-items management block. Kept feature-local (it's a settings section, like the other `Settings*Section`s). |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/settings/repair-amounts` | — | `[{ id, repairKey, label, price, sortOrder }]` | Ordered by `sortOrder, id`. |
| PUT | `/api/settings/repair-amounts` | `[{ repairKey?, label, price }]` | the saved list | Replace-all; keyed rows preserved + `extinguisher_seal` re-seeded. |
| GET | `/api/reservations/:id/sas` | — | `{ …, repairAmounts: [...] }` | Adds the repair list (existing payload otherwise unchanged). |
| POST | `/api/reservations/:id/sas/arrival` | `{ …, extinguisherSealOkAtArrival }` | `{ ok, complementAmount }` | New field; no charge. |
| POST | `/api/reservations/:id/sas/departure` | `{ …, endOfStayComplement…, extinguisherSealOkAtDeparture }` | `{ ok }` | Bill rides the existing end-of-stay detail. |

---

## 5. Data model

**New table** (idempotent `CREATE TABLE IF NOT EXISTS`):
```sql
CREATE TABLE repair_amounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repairKey TEXT,                 -- stable key for SAS-linked rows ('extinguisher_seal'); NULL for custom
  label TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  sortOrder INTEGER NOT NULL DEFAULT 0
);
```
**Seed** (once, if absent): `('extinguisher_seal', 'Plomb extincteur', 0, 0)`.

**New columns on `reservations`** (idempotent `ALTER TABLE … ADD COLUMN`, both nullable INTEGER):
`extinguisherSealOkAtArrival`, `extinguisherSealOkAtDeparture` — `1` = present, `0` = missing, `NULL`
= not checked.

**Data impact:** additive only; existing reservations get `NULL` seal fields (« non vérifié » → never
auto-billed). No backfill, no loss.

## 6. UI / UX

- **SAS « Extincteur » page** (arrival + departure): the redesigned coloured shell (band + big icon =
  fire-extinguisher) with a **« Plomb de l'extincteur présent » switch defaulting ON** (présent) +
  « Suivant ». On **departure**, when the switch is OFF (manquant): a caption shows « Plomb extincteur
  facturé : {prix} » (or « déjà manquant à l'arrivée → non facturé », or a « configurez le prix » hint
  when the price is 0).
- **« Précédent » back arrow** in the SAS header band (shown from the 2nd page on), at the far left
  before the step icon. The ✕ (Quitter) stays at the far right.
- **Réglages → « Tarifs facturables »**: one card with two sub-sections — **« Prix du linge »** (the
  priced-linen items moved from Blanchisserie: `libellé + montant`, by category lit/serviette) and
  **« Montants de réparation »** (`libellé + montant (€)`, add / delete + save). The seeded « Plomb
  extincteur » row is price-editable but its label is fixed and it can't be deleted. Responsive:
  full-width inputs stacked on `xs`, rows on `sm+`.
- **Mobile:** both screens follow the existing SAS + settings responsive rules (full-width controls on
  `xs`, ≥ 44–48 px touch targets).

## 7. Test plan

### Server unit tests
- [x] `repair-amounts-model.unit.test.js` (4 tests) — `list` ordering; `replaceAll` drops empty labels,
      preserves keyed rows, **re-seeds `extinguisher_seal`** (preserving its price) when the payload omits
      it, ignores a duplicate key; price coerced ≥ 0.
- [x] `sas-commit.unit.test.js` (extended, +3) — `commitArrivalSas` stores `extinguisherSealOkAtArrival`
      and **never** changes the complement for the seal; an omitted field leaves the column NULL;
      `commitDepartureSas` stores `extinguisherSealOkAtDeparture` (the bill rides `endOfStayComplementDetail`).
- [x] Full server suite green (1542).

### Client unit tests (vitest)
- [x] `ReservationSasDialog.test.js` (extended) — the existing flows now step through the extinguisher
      page (default present → no charge, payload carries `extinguisherSealOkAtArrival: 1`); a new test
      flips it to « Manquant » at departure (present at arrival + configured price) → the « Plomb
      extincteur » line + total reach the `commitDepartureSas` payload.
- [x] `SettingsBillableAmountsSection.test.js` — renders both sub-lists; the keyed repair row's label is
      disabled (non-editable); saving sends the list to `updateRepairAmounts`. Full client suite green (472).

### Manual UI verification
- [ ] Configure « Plomb extincteur » price; run an arrival SAS (mark present) then a departure SAS (mark
      missing) → the end-of-stay complement gains the line; verify in the reservation finance.
- [ ] Departure « Manquant » when arrival was « Manquant » → no charge.
- [ ] Mobile check of both the SAS page and the Réglages section.

## 8. Out of scope

- Per-property repair prices (the list is global, like the linen prices).
- SAS checks for other repair types (the list is generic for future use, but only the extinguisher seal
  has a dedicated SAS page in this iteration).
- Photo/evidence capture of the broken seal.
- Reworking the existing complement/finance plumbing (the bill reuses the end-of-stay complement as-is).

## 9. Open questions

Resolved via the 2026-06-15 questionnaire:
- Q: Arrival vs departure billing? → **A: arrival = baseline (no charge); departure bills only if the
  seal was present on arrival but missing on departure (→ end-of-stay complement).**
- Q: Shape of the configurable amount? → **A: a generic, extensible « Montants de réparation » list in
  Réglages, with « Plomb extincteur » as the first (keyed) entry.**
