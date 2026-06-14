# Reservation option immutability (frozen reservations vs. option config changes)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservation-option-immutability` _(user-managed)_ |
| **Created** | 2026-06-14 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

We recently shipped the per-property "Options incluses" (default options) feature
(`property-default-option-applicability.md`, `weekly-bed-linen-tracking.md` §3.7,
`per-property-option-prices.md`). It auto-adds property-default options to reservations and renders a
configuration card on the property page ([PropertyDetail.js:759](../client/src/pages/PropertyDetail.js#L759),
titled *"Options incluses"*).

Adrien's hard requirement (2026-06-14): **any change to an option's configuration — moving it
in/out of "Inclus", changing its price, archiving it, renaming it, or anything else — must NEVER
modify a reservation that already exists.** A reservation, once created, must stay exactly as it was.

An audit confirmed the **money is already frozen**: `reservation_options` snapshots
`unitPrice / billedUnits / priceType / totalPrice / offered / acompteContribTtc / soldeContribTtc`
at insert time, and `reservations` stores `finalPrice / depositAmount / balanceAmount /
complementAmount`. Finance, accounting and the suivi financier read these snapshots, never the live
`options` price. So price/archive/applicability/per-property-price changes do **not** touch existing
reservations.

The audit found two behaviors that still let option/property-default config bleed into an existing
reservation:

- **Update re-merge** ([reservationsController.js:422-447](../server/src/controllers/reservationsController.js#L422-L447),
  `bed-config-in-linen-card.md` rule 4.bis): editing an existing reservation re-injects
  `countsAsBedLinen = 1` property-default options it didn't carry — so a pre-default-era reservation
  *gains* an option on save.
- **Client forced display** ([ExtrasSection.js:131](../client/src/components/reservation/ExtrasSection.js#L131),
  `enabled = explicitlyEnabled || isForcedByPropertyDefault`): a property-default option is shown
  *checked + disabled ("Inclus")* on every reservation of the property, including old ones that don't
  carry it.

Separately, Adrien wants the **"Options incluses" card removed from the property page**
(Settings → Logements), keeping per-property defaults editable only from the Options page.

## 2. Goal

A reservation that already exists is frozen: no option-catalog or property-default configuration
change alters its billed content or its displayed option set. New reservations keep getting property
defaults as before. The per-property "Options incluses" card disappears from the property page;
defaults are still configured from the Options page.

## 3. Functional rules

1. **Invariant.** Once a reservation is created, its option set and all billed amounts (quantities,
   unit/total prices, `offered` flags, deposit/balance/complement, acompte/solde contributions) are
   frozen against any later change to the `options` catalog or to `property_option_defaults`.
2. **Already guaranteed (snapshot — no code change, protected by regression tests).** Reads for
   display, finance, accounting and suivi use the `reservation_options` snapshot columns +
   `reservations` stored totals — never the live option price. Changing an option's price, archiving
   it, changing its per-property price, or changing its property applicability does not modify any
   existing reservation.
3. **Change — update re-merge removed.** Editing an existing reservation must NOT add a
   property-default option the reservation does not already carry. The `countsAsBedLinen` re-merge in
   the update controller is removed. Options the reservation *does* carry are preserved (they are in
   the submitted payload).
4. **Change — client forcing limited to creation.** The "forced ON / *Inclus*" property-default
   display applies **only when creating a new reservation**. In edit mode, options render exactly as
   the reservation carries them — an option the reservation lacks renders as a normal *off* switch,
   never as a disabled "Inclus".
5. **Kept — new reservations still receive property defaults.** The create-time merge
   ([reservationsController.js create path](../server/src/controllers/reservationsController.js#L281-L294))
   and the devis merge ([devisModel.js](../server/src/models/devisModel.js#L30-L49)) are unchanged.
6. **Kept — per-property defaults stay configurable from the Options page** (Settings → Options, the
   per-property grid on an option). Only the property-page card is removed.
7. **Libellé live (explicit decision).** Option `title` / `description` remain read live via the
   `options` join. Renaming an option updates the displayed label on existing reservations/devis
   (cosmetic only — no amount changes). Snapshotting the label is **out of scope** (see §8).
8. **Card removal + dead-code cleanup.** The `PropertyDefaultOptionsCard` is removed from the
   property page; the now-dead component, its test, and the unused client API functions
   `setPropertyOptionDefault` / `unsetPropertyOptionDefault` are deleted. `getPropertyOptionDefaults`
   stays (read, used by `ReservationPage`). The server `option-defaults` write routes are left in
   place (no UI consumer; still tested + reachable via API) — removing them is out of scope.

**Edge cases:**
- Existing reservation that **already carries** a bed-linen property-default option → kept on edit
  (it is in the submitted payload); bed counts preserved.
- Existing reservation that **lacks** it (pre-default era) → stays without it on edit; bed inputs are
  not shown; the rule-7 bed-count invariant runs on the submitted options (no linen ⇒ single/double
  beds zeroed, baby beds exempt) — unchanged behavior minus the auto-add.
- **New** reservation on a property with a bed-linen default → option forced ON via the create-time
  merge — unchanged.
- Archived option present on an existing reservation → still displayed (the join resolves the
  archived row) — unchanged.

---

## 4. Architecture

> **Fat backend, thin frontend.** No business logic moves to the client. The client change is purely
> a UI-state gate (forced display only in create mode); the authoritative "no re-merge on update"
> rule lives on the server.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `reservationsController.js` | T | Remove the update re-merge block; `reservationOptions = rawUpdateOptions`; keep the rule-7 bed-count invariant operating on the submitted options. Update the comments. |
| `models/` | — | — | No change (`reservationsModel`, `financeModel`, `accountingModel` already read snapshots). |
| `database.js` | — | — | No schema change. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.js` | T | Gate `bedLinenForcedOptionIds` to creation only — empty `Set` when `editingReservationId` is set. |
| `pages/` | `PropertyDetail.js` | T | Remove the `<PropertyDefaultOptionsCard>` section (incl. the wrapping `<Box>`) + its import. |
| `components/` | `PropertyDefaultOptionsCard.js` | **Removed** | Dead once the property-page card is gone. |
| `components/__tests__/` | `PropertyDefaultOptionsCard.test.js` | **Removed** | Tests the removed component. |
| `components/reservation/` | `ExtrasSection.js` | — | No change — it receives an empty forced set in edit mode and renders accordingly. |
| `api.js` | `api.js` | T | Remove `setPropertyOptionDefault` + `unsetPropertyOptionDefault` (dead). Keep `getPropertyOptionDefaults`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | — | No new UI; this change removes one card and gates one flag. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `OptionDefaultsSection` (OptionsPage), `OptionPropertyDefaultsMirror` | Kept — they remain the per-property defaults editor/mirror on the Options page. |

### 4.3 API contract

No new or changed endpoints. The per-property `option-defaults` write routes
(`PUT/DELETE /api/properties/:propId/option-defaults/:optionId`) remain but lose their UI consumer;
`GET /api/properties/:propId/option-defaults` stays in use by `ReservationPage` (read).

---

## 5. Data model

No schema change. The snapshot columns that make rule 1–2 hold already exist
(`reservation_options.unitPrice / billedUnits / priceType / totalPrice / offered /
acompteContribTtc / soldeContribTtc`, added via the migrations at
[database.js:677-700](../server/src/database.js#L677-L700)).

**Title/description are intentionally NOT snapshotted** (rule 7). `reservation_options` has no
`title` column; the label is joined live from `options`. This is an accepted cosmetic exception.

**Data impact:** none. No migration, no backfill, no row rewrite. The one-time startup backfill
`backfill_property_default_options_v1` ([database.js:1785](../server/src/database.js#L1785)) already
ran in prod (rows at 0 €); it is neither re-run nor reverted by this change.

## 6. UI / UX

**PropertyDetail (Settings → Logements → a property):** the *"Options incluses"* card disappears from
the right column. Nothing replaces it; per-property defaults are edited from Settings → Options. No
`PageActionBar` change. Responsive: the right column simply has one fewer card on `xs`/`md`/`lg`.

**ReservationPage — options section:**
- **Create mode (unchanged):** a `countsAsBedLinen` property-default option renders *checked +
  disabled* with the muted *"Inclus"* caption; bed inputs mount under it.
- **Edit mode (changed):** options render exactly as the reservation carries them. A property-default
  option the reservation does **not** carry renders as a normal *off* switch (toggleable), with no
  "Inclus" caption. One the reservation **does** carry renders enabled as usual.
- Responsive: unchanged layout (option cards already stack on `xs`).

## 7. Test plan

### Server unit tests
- [x] `tests/reservation-option-immutability.unit.test.js` (C) — 4 tests: changing an option's price
  / archiving it / a later catalog change does not move an existing reservation's snapshot
  (`unitPrice / totalPrice / priceType / offered`); renaming follows on display only (libellé live).
- [x] `tests/reservations-controller-bed-linen-invariant.unit.test.js` (T) — the former "re-merge on
  update" test now asserts the frozen behaviour (no re-merge; submitted options persisted as-is) and
  also pins `req.body.options`; the rule-7 bed-count invariant assertions are kept.
- [x] `tests/laundry-end-to-end.regression.test.js` — verified it did **not** assert
  re-merge-on-update → no change needed. Full server suite green (1535).

### Client unit tests (vitest)
- [x] `ExtrasSection.bed-linen-inputs.test.js` — added an **edit-mode** test (empty forced set → a
  property-default-but-absent option renders as a normal *off*, toggleable switch, no "Inclus", no bed
  inputs) alongside the existing **create-mode** forced test. Full client suite green (462).
- [x] `PropertyDefaultOptionsCard.test.js` removed with the component.

### Manual UI verification
> The create-vs-edit option display is verified deterministically by the `ExtrasSection` component
> test above, and the property-page card removal by the green client build (2005 modules, no dead
> refs). A full browser session was not run to avoid colliding with the user's local dev server —
> recommended manual pass before merge:
- [ ] Edit an existing Le Gîte reservation that predates the linen default → the linen option is NOT
  auto-added on save; amounts unchanged.
- [ ] Edit an existing reservation that already has the linen option → it stays, bed counts preserved.
- [ ] Create a new Le Gîte reservation → linen option forced "Inclus".
- [ ] Rename an option → an existing reservation shows the new label, amount unchanged (libellé live).
- [ ] Property page no longer shows the "Options incluses" card.
- [ ] Settings → Options still edits per-property defaults (grid on an option).
- [ ] Mobile (`xs`) check on the property page + reservation options section.

## 8. Out of scope

- **Snapshotting option title/description** — kept live by Adrien's decision (rule 7).
- **Removing the create-time property-default merge** — new reservations keep getting defaults (rule 5).
- **Removing the Options-page per-property defaults editor / mirror** — kept (rule 6).
- **Removing the server `option-defaults` write routes** — left in place (rule 8).
- **Reverting the one-time startup backfill** — already ran, 0 €, harmless.

## 9. Open questions

Resolved via the 2026-06-14 questionnaire:
- Q: How far to remove the "Options incluses" mechanism? → **A: Card on the property page only.** Keep
  the Options-page editor and the auto-apply to new reservations.
- Q: How complete should the freeze of existing reservations be? → **A: "Gel données, libellé live".**
  Remove the re-merge on edit so an existing reservation never gains an option; keep the option label
  read live (renames follow the display; no amount ever changes).

---

## 10. Cross-spec updates (same PR — spec-in-sync)

- **`bed-config-in-linen-card.md`** — rule 4.bis amended: the `countsAsBedLinen` property-default
  re-merge applies on **create only**, not on update. Existing reservations are frozen.
- **`weekly-bed-linen-tracking.md` §3.7 rule 31** — the PropertyDetail canonical-edit card is removed;
  per-property defaults are edited from the Options page; the read-only mirror stays.
- **`property-default-option-applicability.md`** — clarified: "always applies" governs **new**
  reservations (and ones already carrying the option). Existing reservations are frozen per this
  spec's invariant. This intentionally reverses the 2026-06-11 retroactive application for already-
  created reservations.
