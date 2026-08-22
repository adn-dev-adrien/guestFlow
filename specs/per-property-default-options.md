# Per-property « inclus par défaut » for every option (on the Options page, beside the per-property price)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/per-property-default-options` _(user-managed)_ |
| **Created** | 2026-06-14 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Property option **defaults** (« Options incluses ») let an option be auto-added to a property's new
reservations. The data model is already **per property**: `property_option_defaults(propertyId, optionId,
offered)` ([database.js](../server/src/database.js)), written via `propertyOptionDefaultsModel.set/unset`
and the `PUT/DELETE /api/properties/:id/option-defaults/:optionId` endpoints. But today only **linen**
options can be set as a default: the editor card filters to linen
([PropertyDefaultOptionsCard.js:29-37](../client/src/components/PropertyDefaultOptionsCard.js#L29) —
`isLinenOption`).

Separately, an option's **per-property price** is configured **on the Options page**
([OptionsPage.js](../client/src/pages/OptionsPage.js), `OptionPriceSection`): for each applicable property,
a price override (`property_option_prices`). The operator wants the **default-inclusion** to work the same
way — **per applicable property**, configured **beside the per-property price** on the Options page —
because an option used by several properties must be includable on some and not others.

## 2. Goal

Any option (not just linen) can be marked **« inclus par défaut »** — **per property** — from the **Options
page**, right beside the per-property price, for each property the option applies to. The existing
per-property defaults table (`property_option_defaults`) backs it, so the property-side card stays in sync.

## 3. Functional rules

1. **All options eligible.** Any option can be a per-property default — drop the linen-only restriction.
   Auto-timed options (early/late check-in/out, `autoEnabled=1`) are **excluded** (they're engine-driven,
   not operator-included); breakfast / linen options remain eligible (they already were).
2. **Per property.** The default is set **per (option, property)** pair — never globally. For an option
   applicable to several properties, each property is independent.
3. **Configured on the Options page, beside the per-property price.** In the option form's per-property
   section, each **applicable** property row gets, in addition to the price override:
   - an **« Inclus par défaut »** toggle (→ `property_option_defaults` row exists for that property),
   - an **« Offert »** toggle (→ that row's `offered` flag; disabled until « Inclus par défaut » is on).
4. **Applicable properties only.** The per-property rows are the option's applicable properties
   (`form.propertyIds`; when the option is global/all-properties, all properties are listed) — mirroring the
   per-property price UI.
5. **Persisted with the option save.** Saving the option persists the per-property defaults map (set/unset
   + offered) alongside `property_options` (applicability) and `property_option_prices` (price). Setting a
   default implies applicability (the model already upserts the `property_options` row).
6. **Property-side card stays consistent.** The fiche-logement card (`PropertyDefaultOptionsCard`) drops its
   linen-only filter and lists the **options applicable to that property** (so the same per-property
   defaults are visible/editable from the property page too — same `property_option_defaults` table, always
   in sync). [Decision 2026-06-14, Q2: applicable options.]
7. **Future-only (unchanged).** Toggling a default only affects **new** reservations (defaults are
   snapshotted at create time — see specs/property-default-option-applicability.md). Existing reservations
   are never modified.
8. **Offered semantics.** `offered = 1` → the option is included **free** (0 € line); `offered = 0` → it's
   auto-added but **billed** (per-property price or base).
9. **« Comprise » in the reservation summary (2026-06-21).** Because a default-`offered` option is part of
   the night rate (not a one-off geste commercial), the pricing engine tags such an offered line
   `includedInRate` (it reads `property_option_defaults.offered = 1` for the property). `PricingSummary`
   then renders it as **« Comprise »** with the hint *« incluse dans le tarif »* at **0,00 €**, instead of
   the green **« ✓ Offert »** + struck-through original price (which stays for a manually-offered line). If
   the operator un-offers the line (to bill it), it loses `includedInRate` and shows its real price.
10. **« Comprise » is mandatory (2026-08-22).** Because such a line is part of the night rate — and,
   since [tourist-tax-included-services-deduction.md](tourist-tax-included-services-deduction.md),
   because its reference value leaves the declared tourist-tax base — it **cannot be removed from a
   booking**: its Switch renders checked + disabled with the « Inclus » caption, and a save that omits
   it is corrected server-side. Scoped to bookings that already carry it (an older reservation never
   gains one) and to `offered = 1` defaults: a *billed* default stays an ordinary, removable option.

**Edge cases:**
- Removing a property from the option's applicable list (`propertyIds`) → its default row is cleared too
  (an option can't be a default for a property it no longer applies to).
- A global option (applies to all) → the per-property table lists all properties.
- Auto-timed option → no default toggles shown (rule 1).

---

## 4. Architecture

> **Fat backend, thin frontend.** Persistence + the applicability/offered rules live on the server; the
> Options form sends a per-property map.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `optionsModel.js` | T | `get()` / `list()`: include a `propertyDefaults` map `{ [propertyId]: { default: true, offered: bool } }` (read `property_option_defaults` for the option). `create()` / `update()`: persist the `propertyDefaults` payload — upsert/delete `property_option_defaults` rows (offered flag), scoped to the option's applicable properties; clear rows for de-scoped properties (rule edge). Reuse `propertyOptionDefaultsModel` semantics (set implies `property_options`). |
| `models/` | `propertyOptionDefaultsModel.js` | — | Reused (`set`/`unset`). Possibly a small `listForOption` already exists (read mirror). |
| `controllers/` | `optionsController.js` | — | Passes the new payload field through (thin). |
| `database.js` | — | — | No schema change (`property_option_defaults` already exists). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `OptionsPage.js` | T | In `OptionPriceSection` (or a sibling per-property block), add per-applicable-property **« Inclus par défaut »** + **« Offert »** toggles beside the price input. Load from `option.propertyDefaults`; include the map in the save payload (`toPayload`). Hide the toggles for auto-timed options. |
| `components/` | `PropertyDefaultOptionsCard.js` | T | Drop the `isLinenOption` filter → list the **applicable** options for the property (exclude auto-timed). Same Inclure/Offert toggles + same API. |
| `api.js` | `api.js` | — | Option create/update already send the form payload; the new `propertyDefaults` map rides along. |

**Component reuse declaration:** reuses the existing per-property rows pattern in `OptionPriceSection` and
the existing toggles in `PropertyDefaultOptionsCard`; no new generic component.

### 4.3 API contract

| Method | Endpoint | Request (additive) | Notes |
|---|---|---|---|
| GET | `/api/options` + `/api/options/:id` | response gains `propertyDefaults: { [propertyId]: { offered: bool } }` per option | |
| POST/PUT | `/api/options` `/api/options/:id` | body gains `propertyDefaults: { [propertyId]: { default: bool, offered: bool } }` | Server persists to `property_option_defaults`, scoped to applicable properties. |

The existing `PUT/DELETE /api/properties/:id/option-defaults/:optionId` (used by the fiche card) is unchanged.

---

## 5. Data model

No schema change. Tables: `property_option_defaults(propertyId, optionId, offered)` (existing),
`property_options` (applicability, existing), `property_option_prices` (existing). **Data impact:** none
until the operator sets a default; all writes are idempotent upserts/deletes on `property_option_defaults`.

## 6. UI / UX

- **Options page — option form, per-property section:** when the option applies to ≥1 property, a table
  lists those properties; each row: **property name · Inclus par défaut (switch) · Offert (switch, gated) ·
  Prix /logement (existing override input)**. The « Offert » switch is disabled until « Inclus par défaut »
  is on. Auto-timed options show no default toggles.
- **Fiche logement — « Options incluses » card:** now lists every applicable (non-auto-timed) option with
  the Inclure/Offert toggles (was linen-only).
- **Responsive:** the per-property table scrolls horizontally on `xs` (property name + up to 3 controls);
  full-width inputs; ≥44px toggles.
- **PageActionBar:** N/A (content inside existing pages/forms).

## 7. Test plan

### Server unit tests (`options-model.unit.test.js`, +5; suite 1513 green)
- [x] `create`/`update` persist `propertyDefaults` (set + offered; de-scoped property cleared on update);
      `get`/`list` expose the `propertyDefaults` map; setting a default implies the `property_options`
      applicability row; omitting `propertyDefaults` leaves existing untouched.
- [x] Auto-timed options (`autoEnabled`) can't be defaulted — their default rows are cleared (guard).

### Client (vitest → 460 green)
- [x] `PropertyDefaultOptionsCard` — lists a **non-linen** applicable option (linen-only filter dropped);
      excludes auto-timed options + options applicable only to another property; keeps global options.
- [ ] `OptionsPage` per-property defaults section — covered by build + the model tests; a form-level vitest
      is impractical (rendered through the DataPageScaffold). Manual check below.

### Manual UI verification
- [ ] Option used by 2 properties: set « Inclus par défaut » on property A only → a new reservation on A
      auto-includes it, on B does not.
- [ ] « Offert » on → the auto-added line is 0 €. Per-property price still applies when not offered.
- [ ] The same toggle reflects on the property's « Options incluses » card.

## 8. Out of scope

- Changing how defaults apply to reservations (still snapshot-at-create, future-only).
- Auto-timed options as defaults.
- The option soft-delete/archive feature (separate spec, pending).

## 9. Open questions — resolved 2026-06-14

- **Q1 — where to configure?** → **Options page, beside the per-property price** (option-centric, per
  applicable property). The property-side card stays in sync (same table).
- **Q2 — which options on the fiche card?** → the **applicable** options for that property.
