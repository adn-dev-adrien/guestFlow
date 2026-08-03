# SAS arrival upsells activate the catalogue option (not a custom line)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/sas-upsells-activate-catalogue-option` _(user-managed)_ |
| **Created** | 2026-08-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The arrival SAS sells two things the catalogue already knows about:

- **Ménage** — « Ajouter le ménage » ([arrival-departure-sas.md](arrival-departure-sas.md) §3.1 rule 10);
- **Linge de toilette** — « Ajouter le linge de toilette » ([sas-bath-linen-upsell.md](sas-bath-linen-upsell.md) §3.2).

Both are written by `commitArrivalSas` as **custom lines** — `reservation_custom_options` rows with
`inComplement = 1`, `sasArrivalOrigin = 1` and a French label — instead of activating the matching
catalogue option (`options.autoOptionType = 'cleaning'` / `'bathroom_linen'`).

**This silently breaks the linen chain.** The laundry preparation and the linen stock projection count
bath linen by joining the catalogue option:

```sql
FROM reservation_options ro JOIN options o ON o.id = ro.optionId
WHERE o.countsAsBathroomLinen = 1
```
([laundryModel.js:132](../server/src/models/laundryModel.js#L132), same shape in
[linenInventory.js:158](../server/src/utils/linenInventory.js#L158)). A custom line is invisible there,
so **the towels sold at check-in are never counted in the linen to prepare, nor in the stock outflow.**
Verified on a live reservation: a « Linge de toilette » custom line at 32 €, and **no**
`countsAsBathroomLinen` row on the reservation.

The cleaning has no laundry impact, but the same shape makes it detectable only **by its label**
(`isCleaningOption` matches the name « ménage »), which is what
[defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md) §3.1 had to rely on.

**Second finding (2026-08-03), load-bearing here:** `insertCustomOptions` — run on **every fiche save** —
does not write `sasArrivalOrigin` ([reservationsModel.js](../server/src/models/reservationsModel.js)),
so the marker is silently reset to 0. A SAS re-opened after a fiche save no longer recognises its own
lines (they degrade to « preserved » lines). Any marker this spec introduces must survive the same path.

## 2. Goal

When the operator adds the ménage or the linge de toilette during the check-in SAS, the reservation
**carries the real catalogue option** — priced by the engine, counted by the laundry and the stock,
visible as the standard option on the fiche — while still being collected in the arrival complement and
still being removable by re-opening the SAS.

## 3. Functional rules

### 3.1 What the SAS writes

1. **Catalogue options, not custom lines.** « Ajouter le ménage » and « Ajouter le linge de toilette »
   create a `reservation_options` row on the option resolved by `autoOptionType`
   (`'cleaning'` / `'bathroom_linen'`), with `inComplement = 1` (the charge stays in the arrival
   complement, never in the acompte/solde) and `sasArrivalOrigin = 1` (rule 4).
2. **Price is the engine's, resolved server-side.** `quantity = 1`; `unitPrice` = per-property override
   (`property_option_prices`) else `options.price`; `billedUnits = quantity × getTypeMultiplier(priceType,
   persons, nights)`; `totalPrice = unitPrice × billedUnits`, rounded to 2 decimals. This is exactly what
   `getBathLinenOfferForReservation` / `getCleaningPriceForProperty` already quote on the SAS page, so
   **the amount the operator announced is the amount billed**, and a later fiche save recomputes the same
   figure instead of drifting.
3. **Linen items stay custom.** The missing bed-linen elements (taie d'oreiller, serviette…) come from
   `linen_priced_items`, not from the catalogue: they keep being written as `reservation_custom_options`
   with `sasArrivalOrigin = 1`. Unchanged.
4. **The client sends intent, not money.** The arrival commit payload carries booleans
   `cleaningAdded` / `bathLinenAdded` (+ the unchanged `complementItems` for the linen elements). The
   server resolves availability, option id and price (CLAUDE.md §6.0 — no client-side pricing).

### 3.2 Idempotence & reversibility

5. **New marker `reservation_options.sasArrivalOrigin`** (0/1), mirroring the custom table. Set to 1 on
   the rows the arrival SAS creates; never set on an option the operator activated from the fiche.
6. **Re-commit is a faithful replace** ([reopen-completed-sas.md](reopen-completed-sas.md) §4 rule 4):
   for each of the two options, a re-run of the arrival SAS
   - **adds** the row when the step says « ajouté » and no row exists;
   - **removes** it when the step says « non merci » **and the existing row is `sasArrivalOrigin = 1`**;
   - **leaves it strictly alone** when the row exists with `sasArrivalOrigin = 0` (the operator sold it
     from the fiche — the SAS never deletes operator data).
7. **The step stays visible while it is the SAS's own line.** The arrival ménage page is hidden when the
   cleaning is included ([sas-hide-settled-steps.md](sas-hide-settled-steps.md) §3 rule 3) and the
   bath-linen page when the option is already taken ([sas-bath-linen-upsell.md](sas-bath-linen-upsell.md)
   §3.1 rule 1). **Revised:** both pages remain visible, **pre-selected on « ajouté »**, when the only
   reason they'd be hidden is a `sasArrivalOrigin = 1` row — otherwise adding an option would make its
   own undo button disappear. An option taken at booking or added from the fiche still hides the page.
8. **The departure guard is unaffected.** « Is the cleaning sold? »
   ([defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md) §3.1) stays true
   for a SAS-added cleaning — the host was paid to do it, whoever recorded it. The arrival page asks
   « can I still sell/unsell this? »; the departure guard asks « is it sold? ». Two different questions.
9. **The marker survives a fiche save.** `insertOptions` / `replaceOptions` (delete + re-insert on every
   save) must **carry `sasArrivalOrigin` over per `optionId`**: read the flagged ids before the delete,
   re-apply them on insert. Without this the marker is wiped exactly like the custom-line one is today.

### 3.3 Complement bookkeeping

10. **`complementAmount` accounting is extended, not changed.** `commitArrivalSas` currently adjusts the
    stored complement by `− prior SAS custom sum + new SAS custom sum`. It now adjusts by
    `− (prior SAS custom + prior SAS option) + (new SAS custom + new SAS option)`, so a re-run never
    double-counts and the total is identical to today for the same choices. A complement already marked
    paid stays frozen (unchanged guard).
11. **The pricing engine agrees.** The SAS-added option carries `inComplement = 1`, so the next fiche
    save recomputes `complementAmount = forced items + tax + gap` with the same amount in it. No drift
    between the SAS-written value and the engine-recomputed one.

### 3.4 Migration of existing reservations

12. **One-shot boot migration.** Every `reservation_custom_options` row with `sasArrivalOrigin = 1` whose
    description matches the cleaning option (name « ménage ») or the bath-linen option title becomes a
    `reservation_options` row on that catalogue option, `inComplement = 1`, `sasArrivalOrigin = 1`,
    **`totalPrice` = the custom row's amount verbatim** (`billedUnits` / `unitPrice` derived from the
    stored amount, not re-quoted — a past stay must never be re-priced), then the custom row is deleted.
13. **Skip, never merge.** A reservation that already carries the catalogue option is **left untouched**
    (both rows kept) — deleting the custom line there would silently lower the amount owed. The migration
    logs those reservation ids so they can be reviewed by hand.
14. **Money is invariant.** `complementAmount`, `endOfStayComplementAmount`, deposit and balance are not
    touched by the migration: it moves a line between two tables at identical value. A verification query
    (Σ custom + Σ options before/after per reservation) runs in the migration test.

**Edge cases:**
- No `cleaning` / `bathroom_linen` option in the catalogue, or price ≤ 0 → the step is not offered
  (unchanged) and nothing is written.
- Option already on the reservation from the booking → page hidden, nothing written (unchanged).
- Complement already paid → the existing « encaisser le supplément manuellement » warning still applies;
  the option row is still written (the guest did take it) — same behaviour as the custom line today.
- Offered option (`offered = 1`) activated at booking → not a SAS row, untouched.
- A migrated reservation whose fiche is re-saved: the engine re-prices the option at the **current**
  catalogue price. This is the normal behaviour of every option line on the fiche, not a migration effect.

---

## 4. Architecture

> **Fat backend, thin frontend.** The client sends two booleans; the server resolves the option, its
> price, the complement delta and the reversibility. No amount is computed in React.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/reservationsModel.js` | T | `commitArrivalSas`: accept `cleaningAdded` / `bathLinenAdded`; resolve + insert/remove the catalogue rows (rules 1-2, 6); extend the complement delta (rule 10). `insertOptions` / `replaceOptions`: carry `sasArrivalOrigin` per optionId (rule 9). New `getSasUpsellOptions(reservationId)` → `{ cleaning: { optionId, unitPrice, billedUnits, totalPrice, present, sasOrigin }, bathLinen: {…} }`, shared by the commit and the payload. |
| `controllers/` | `controllers/sasController.js` | T | `getSas`: `cleaning.included` / `bathLinen.available` gain the « …unless it is our own SAS row » nuance (rule 7) + expose `sasOrigin` so the client pre-selects the step. `commitArrival`: forward the two booleans. |
| `utils/` | `utils/cleaningOption.js` | REUSE | Still the single « is this the cleaning? » matcher, now used for the migration's name match only. |
| `utils/` | `utils/pricing.js` | REUSE | `getTypeMultiplier` for the billed units — same call the SAS quote already makes. |
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE reservation_options ADD COLUMN sasArrivalOrigin INTEGER NOT NULL DEFAULT 0` + the one-shot migration of §3.4 (guarded by the column creation, logged). |
| `tests/` | `tests/sas-commit.unit.test.js`, `tests/sas-upsell-migration.unit.test.js` (C) | T/C | Rules 1-14 (see §7). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/sas/ReservationSasDialog.js` | T | Send `cleaningAdded` / `bathLinenAdded`; stop pushing those two lines into `complementItems`; keep them in `arrivalAddedLines` for the recap display (amounts come from the payload, unchanged). Re-open pre-fill reads `cleaning.sasOrigin` / `bathLinen.sasOrigin` instead of scanning custom lines. Step visibility follows rule 7. |
| `components/` | `components/reservation/ExtrasSection.js` | — | No change: the option now appears in the standard options list, which is the point. |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | The SAS shell, MUI `Button`/`Chip`/`Stack` | Unchanged. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | The `cleaning` / `bathLinen` step blocks | Unchanged, only their state source moves. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/sas?mode=arrival` | — | `cleaning: { included, price, sasOrigin }`, `bathLinen: { …, sasOrigin }` | `sasOrigin = true` → the step stays visible, pre-selected « ajouté ». |
| POST | `/api/reservations/:id/sas/arrival` | adds `cleaningAdded`, `bathLinenAdded` (booleans, `undefined` when the step isn't shown → leave untouched) | `{ ok, complementAmount }` | The two lines leave `complementItems`, which keeps only the linen elements. |

---

## 5. Data model

**One new column**, idempotent in `server/src/database.js`:

```sql
ALTER TABLE reservation_options ADD COLUMN sasArrivalOrigin INTEGER NOT NULL DEFAULT 0;
```

**One-shot migration** (§3.4), inside the column-creation branch: move each SAS-origin custom
« Ménage » / « Linge de toilette » line onto its catalogue option at the same amount, skipping (and
logging) any reservation that already carries the option.

**Data impact:** one row moves from `reservation_custom_options` to `reservation_options` per affected
reservation, at an identical value. No amount, no paid flag and no accounting entry changes. The gain is
that past and future stays finally appear in the laundry/stock counts.

## 6. UI / UX

- **SAS arrival, ménage & linge de toilette pages:** unchanged copy and buttons. The only visible change
  is that a re-opened SAS now shows the step **pre-selected on « ajouté »** instead of hiding it.
- **Fiche réservation:** the charge appears as the standard **Ménage** / **Linge de toilette** option
  (toggle ON, « Compl. » chip ON) instead of a line in « Options personnalisées ». Same amount, same
  place in the complement.
- **Planning / Blanchisserie:** the towels now show up in the linen to prepare — the actual point of the
  fix.
- **Responsive:** no layout change; the SAS dialog and the fiche keep their current behaviour at `xs` /
  `md` / `lg`. Manual check on the fiche options list at `xs`.
- **Sticky action bar:** untouched.

## 7. Test plan

### Server unit tests (`sas-commit.unit.test.js`, `sas-upsell-option-migration.unit.test.js`)
- [x] « Ajouter le ménage » / « Ajouter le linge de toilette » create a `reservation_options` row on the
      right catalogue option with `inComplement = 1`, `sasArrivalOrigin = 1`, and the engine price —
      including the per-property override and the per-person billing (rules 1-2).
- [x] No custom line is created for those two any more; the missing linen elements still are (rule 3).
- [x] Re-commit with « non merci » removes a `sasArrivalOrigin = 1` row and **never** an operator row;
      re-running with the same answer never double-counts (rule 6).
- [x] `replaceOptions` carries `sasArrivalOrigin` across a delete+re-insert cycle (rule 9).
- [x] `complementAmount` after add / re-run / remove equals the expected total, and is frozen when the
      complement is paid (rule 10).
- [x] `getSasUpsellOptions` reports `present` / `sasOrigin` correctly (rule 7).
- [x] Migration: the custom line becomes an option row at the same amount, the custom row is gone,
      Σ per reservation is invariant; the cleaning matches by name; linen elements and operator lines are
      left alone; a reservation already carrying the option is skipped and reported; re-running is a
      no-op (rules 12-14).
- [x] Full server suite green (2184), incl. the departure cleaning guard (rule 8).

### Client tests (vitest)
- [x] The arrival commit payload carries `cleaningAdded` / `bathLinenAdded` and no longer carries those
      labels in `complementItems`.
- [x] A re-opened SAS shows both steps pre-selected when `sasOrigin` is true (chip « Ménage ajouté » /
      « Linge ajouté »), and hides them when the option came from the booking.
- [x] Full client suite green (718) + Playwright E2E (32).

### Manual UI verification (dev, 2026-08-03)
- [x] Check-in SAS on a 5-person / 2-night stay → « Ajouter le ménage » (30 €) + « Ajouter le linge de
      toilette » (5 × 8 = 40 €) → recap 70 € → the fiche shows **both as standard options** with the
      « Compl. » chip and **« Aucune option personnalisée »**; `complementAmount = 70`.
- [x] Laundry: the migrated live reservation now yields **4 grandes + 4 petites serviettes** on the
      drop-off window — it yielded 0 before (the bug being fixed).
- [x] Re-open the SAS → both steps pre-selected with their chips → « Non merci » on the bath linen →
      the option row is gone and `complementAmount` drops back to 30.
- [x] Saving the fiche afterwards keeps `sasArrivalOrigin = 1` (rule 9 verified end-to-end, not just in
      unit tests).
- [x] Migration on the live dev DB: the 32 € custom line became a `bathroom_linen` option row
      (`unitPrice 8 × billedUnits 4 = 32`, `inComplement = 1`), `complementAmount` unchanged at 64.
- [x] Mobile (`xs` 390px): SAS steps readable, no horizontal scroll, every button within the viewport.

### SAS history (specs/arrival-departure-sas.md §3.7)
- [x] `sasAudit.unit.test.js`: no change → no entry; arrival diff (caution, upsells, complement, report);
      breakfast summarised with only its non-zero items; departure diff (billed lines, extinguisher,
      caution return); linen elements listed; a removed upsell reads « pris → non pris ».
- [x] Manual: the fiche's history shows a **« SAS arrivée »** entry — « Caution reçue : non → oui »,
      « Ménage : non pris → pris », « Linge de toilette : non pris → pris »,
      « Complément à percevoir : 0 € → 70 € », « Complément reporté en fin de séjour : non → oui » — and a
      second one recording the removal on re-run.

## 8. Out of scope

- Restoring `sasArrivalOrigin` on **custom** lines across a fiche save (pre-existing, noted in §1 — the
  linen elements degrade to « preserved » lines; they stay billed, only their SAS re-editability is lost).
- Any change to how the complement is collected, displayed or accounted.
- Turning the missing-linen elements into catalogue options.

## 9. Open questions

- **Resolved (2026-08-03):** scope = ménage **and** linge de toilette; existing reservations **are**
  migrated; the SAS keeps the ability to remove what it added (hence the new marker column).
- **Added mid-implementation (2026-08-03), at the operator's request:** both SAS now feed the
  reservation's « Historique des modifications ». Specified in
  [arrival-departure-sas.md](arrival-departure-sas.md) §3.7 (its natural home — it applies to the whole
  SAS, not just to the upsells) and shipped in the same PR: `utils/sasAudit.js`, the two `sas_arrival` /
  `sas_departure` event types, and the client's event-title map.
