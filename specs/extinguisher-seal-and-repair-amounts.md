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

### 3.1 « Tarifs facturables »

> **Déplacé 2026-06-16** — désormais une page dédiée `/parametres/tarifs` avec sa propre entrée de menu,
> au lieu d'une section de Paramètres → Générale (voir `settings-submenu-reorg.md`). Contenu inchangé.

1. **New « Tarifs facturables » section** groups everything the operator can bill a guest during the SAS,
   in **two sub-lists**: **« Prix du linge »** (the existing priced-linen items, **moved here** from the
   Blanchisserie section) and **« Montants de réparation »** (new — `{ label, price }` rows, add / edit /
   delete / save, extensible). The Blanchisserie section keeps only the laundry weekday + the linen-stock
   counts (its priced-items block moves out; the `linen_priced_items` data + its `linen-items` API are
   unchanged — only the UI relocates).
2. **Seeded extinguisher tariffs with stable keys.** Two rows are seeded for the extinguisher-condition
   check: `extinguisher_seal` / « Plomb manquant » and `extinguisher_use` / « Utilisation », both price
   `0` (operator sets them). Rows that carry a `repairKey` are **protected**: the operator can edit the
   **price** but not the label, and **cannot delete** them (so the SAS link can't break). Custom rows (no
   key) are fully editable/deletable. On save, the server **re-seeds** any missing keyed row, so both
   extinguisher tariffs always exist.
   > **Changed 2026-06-17** — the legacy `extinguisher_seal` row was relabelled « Plomb extincteur » →
   > « Plomb manquant » (in-place migration, label is operator-protected) and the « Utilisation » tariff
   > was added, to drive the new extinguisher-condition page (§3.2).
3. **Price 0 = no charge.** A `0` repair price means the SAS proposes no charge (with a hint to set the
   price), exactly like an unpriced linen item.

### 3.2 Extinguisher condition — departure SAS check

> **Reworked 2026-06-17 (Adrien's decision):** the binary « plomb présent ? » seal check at **both**
> arrival and departure is replaced by a single **« L'extincteur est-il en bon état ? »** question, at
> **departure only**, that opens a **tariff-quantity page** when the answer is « Non ». The « complément
> de fin de séjour » is a departure concept, so the question + the billing both live there; the arrival
> SAS no longer has an extinguisher page.

4. **Departure SAS — « L'extincteur est-il en bon état ? » (Oui par défaut).** A « Extincteur » page asks
   the condition with two answers, **Oui** (default, good condition → no charge) / **Non**.
5. **« Non » → tariff-quantity page.** Answering « Non » opens a page listing every extinguisher tariff
   (`repair_amounts` rows whose `repairKey` starts with `extinguisher`: « Plomb manquant », « Utilisation »)
   each with a **quantity stepper** (− value +, ≥ 0) and its unit price. For each tariff with `qty > 0`,
   the charge `price × qty` is **added to the end-of-stay complement** as one line (`{ repairKey, label,
   qty, amount }`). A `0 €` tariff or a `0` quantity produces no line.
6. **Server-authoritative billing.** The client sends only `extinguisherSealOkAtDeparture` (1 = bon état /
   0 = pas bon état) + `extinguisherCharges` = `[{ repairKey, qty }]`. The **server** looks up each price
   in `repair_amounts`, builds the lines, appends them to the end-of-stay detail, and the stored
   `endOfStayComplementAmount` is the authoritative **sum of every detail line** — no client total is
   trusted (fat backend). « Oui » (bon état) sends no charges → no extinguisher line.
7. **One page, departure only.** The extinguisher condition page appears on **every departure** SAS (a
   safety check), placed just before the recap; the conditional tariff page follows it only on « Non ».
   The single commit at the recap is unchanged. The **arrival** SAS no longer has an extinguisher page.
7. **« Précédent » navigation (new — all SAS pages).** The SAS gains a back affordance (a « ‹ » arrow in
   the header band, shown from the 2nd page on) that returns to the previous page; in-memory decisions
   are **preserved** (revisiting a page shows the prior answer). Going back writes nothing — only
   « Valider et terminer » commits. This relaxes the former forward-only rule (amended in
   `specs/arrival-departure-sas.md` §3.0).
8. **Recap reflects it.** The end-of-stay recap lists each billed extinguisher tariff line (« Plomb
   manquant », « Utilisation ») within the existing end-of-stay total; the arrival recap is unchanged.

**Edge cases:**
- No extinguisher tariff priced (0) + « Non » → no line is created (no silent charge); the page shows
  the tariffs at 0 €.
- No extinguisher tariff configured at all → the « Non » page shows a hint to configure them in Réglages.
- Re-opening a committed departure SAS pre-fills the condition + the per-tariff quantities from the
  persisted detail (lines matched by `repairKey`).
- A finished SAS stays re-openable (existing `departureSasDoneAt` behaviour).

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
| `controllers/` | `sasController.js` | T | `getSas` payload gains `repairAmounts` (the list); `commitDeparture` passes `extinguisherSealOkAtDeparture` + `extinguisherCharges` through. |
| `models/` | `reservationsModel.js` | T | `commitDepartureSas` **prices** `extinguisherCharges` from `repair_amounts`, appends the lines to the end-of-stay detail, and recomputes `endOfStayComplementAmount` as the authoritative sum (2026-06-17). `getByIdWithDetails` returns the seal fields via `r.*`. |
| `models/` | `repairAmountsModel.js` | C | `PROTECTED_REPAIRS` (extinguisher_seal + extinguisher_use) re-seeded on `replaceAll`. |
| `database.js` | `database.js` | T | Seed both extinguisher tariffs; relabel the legacy `extinguisher_seal` row in place. The `repair_amounts` table + the `extinguisherSealOk*` columns live in `schema.sql` (baseline #225). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/sas/` | `ReservationSasDialog.js` | T | Departure-only `extinguisher` step (« bon état ? ») + a conditional `extinguisherItems` tariff-quantity page (shown on « Non »); sends `extinguisherSealOkAtDeparture` + `extinguisherCharges`. The arrival extinguisher step is **removed** (2026-06-17). |
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
| POST | `/api/reservations/:id/sas/departure` | `{ …, endOfStayComplementDetail, extinguisherSealOkAtDeparture, extinguisherCharges: [{ repairKey, qty }] }` | `{ ok }` | The server prices `extinguisherCharges`, appends the lines, and recomputes the authoritative total (no client `endOfStayComplementAmount` is trusted, 2026-06-17). |

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
**Seed** (once, if absent): `('extinguisher_seal', 'Plomb manquant', 0, 0)` + `('extinguisher_use',
'Utilisation', 0, 1)`. The legacy `extinguisher_seal` label « Plomb extincteur » is relabelled in place
(2026-06-17).

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
- [x] `sas-commit.unit.test.js` — `commitDepartureSas` stores `extinguisherSealOkAtDeparture`; and
      (2026-06-17, +3) prices `extinguisherCharges` × qty from `repair_amounts` into the end-of-stay
      detail + authoritative total; « bon état » bills nothing even if charges are sent; a 0-qty / 0-price
      tariff yields no line.
- [x] `repair-amounts-model.unit.test.js` (2026-06-17) — `replaceAll` re-seeds **both** protected
      extinguisher tariffs when the payload drops them.
- [x] Full server suite green (1607).

### Client unit tests (vitest)
- [x] `ReservationSasDialog.test.js` (2026-06-17) — arrival flows no longer step through an extinguisher
      page; the departure « bon état ? » → « Oui » sends `extinguisherSealOkAtDeparture: 1` + empty
      charges; « Non » opens the tariff-quantity page and the per-tariff quantities reach
      `commitDepartureSas` as `extinguisherCharges` (priced server-side, not in the detail).
- [x] `SettingsBillableAmountsSection.test.js` — renders both sub-lists; the keyed repair row's label is
      disabled (non-editable); saving sends the list to `updateRepairAmounts`. Full client suite green (472).

### Manual UI verification
- [x] Configure the « Plomb manquant » / « Utilisation » prices; run a departure SAS → « bon état ? » →
      « Non » → set a quantity → the end-of-stay complement gains the priced line (verified 2026-06-17:
      qty 1 × 30 € → `endOfStayComplementAmount = 30`, detail line carries `repairKey` + `qty`).
- [x] « Oui » (bon état) → no extinguisher line.
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
