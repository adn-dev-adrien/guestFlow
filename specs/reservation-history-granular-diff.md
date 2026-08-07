# Reservation history — granular, readable diff

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservation-history-granular-diff` |
| **Created** | 2026-08-07 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Every reservation edit writes a labeled diff into `reservation_history` (`utils/reservationAudit.js` →
`computeAuditChanges`), rendered in the « Historique des modifications » card of
[ReservationPage.jsx:2922-2990](client/src/pages/ReservationPage.jsx#L2922-L2990).

The stored diff *is* already limited to the fields that changed, but three things make an entry hard
to read:

1. **Options / Ressources are compared as one opaque blob.** The snapshot flattens all option lines
   into a single `optionsSignature` string, so adding one option renders the **whole list before** →
   **the whole list after**, and the reader has to diff two long lines by eye. Real row from the DB:

   ```
   Options : Ménage : 7 € • Petit-déj ×3 : 19,50 € (compl.) • Draps ×3 : 22,50 € (compl.)
           → Ménage : 7 € • Petit-déj ×3 : 19,50 € (compl.) • Draps ×3 : 22,50 € (compl.) • Lit ×2 : 50 € (compl.)
   ```

2. **Values are printed raw.** `Logement : 3 → 5`, `Caution reçue : 0 → 1`, `Date acompte : 2026-07-09`,
   `Prix final : 497 → 547` — ids, SQLite booleans, ISO dates and unit-less numbers.

3. **Engine recalculations drown the actual edit.** Adding one option also moves `totalPrice`,
   `touristTaxTotal`, `finalPrice`, `depositAmount`, `balanceAmount` — five automatic lines above the
   one thing the user actually did.

The same payload feeds the (currently unused) devis history endpoint via `devisModel.getHistory`.

## 2. Goal

When reading a reservation's history, the user sees **only what actually changed**, one line per
changed thing, each with its **old value then its new value**, written in French with names, € and
JJ/MM/AAAA — and several changes in the same edit are listed one under the other.

---

## 3. Functional rules

1. A history entry lists **one row per changed thing**, in the order the fields are declared in
   `HISTORY_FIELD_LABELS`, each rendered as `Libellé : ancienne valeur → nouvelle valeur`.
2. **Options and Ressources are diffed line by line.** The `optionsSignature` / `resourcesSignature`
   change is expanded into one row per option/resource id whose quantity, price, `offert` or
   `complément` flag differs. Lines present and identical on both sides produce **no row**.
3. Each expanded line row carries a **kind**:
   - `added` — absent before, present after → no old value, new value only, prefixed `+`.
   - `removed` — present before, absent after → old value only, prefixed `−`.
   - `changed` — present on both sides with a different quantity/price/flag → `old → new`.
4. Expanded rows are labeled with the **resolved name** of the option/resource (`Petit-déjeuner`,
   not `19`), and grouped under a `Options` / `Ressources` heading rendered once per group.
5. A line's value text is `[×qty ]montant[ (offert, compl.)]` — quantity shown only when > 1, tags
   only when the corresponding flag is set. Same formatting as today, minus the name.
6. **Values are formatted per field type**, server-side:
   - `propertyId` → property name, `clientId` → `Prénom Nom`. Unknown/deleted id → `#<id>`.
   - booleans (`cautionReceived`, `cautionReturned`, `extraGuestSurchargeOffered`, `depositDisabled`,
     `touristTaxInComplement`) → `Oui` / `Non`.
   - money (`totalPrice`, `customPrice`, `touristTaxRate`, `touristTaxTotal`, `finalPrice`,
     `depositAmount`, `balanceAmount`, `cautionAmount`) → `547 €` / `19,50 €` (FR decimal comma,
     no trailing `,00`).
   - dates (`startDate`, `endDate`, `depositDueDate`, `balanceDueDate`, `cautionReceivedDate`,
     `cautionReturnedDate`) → `09/07/2026`.
   - `discountPercent` → `10 %`.
   - everything else → the raw string; `null` / `''` → `vide`, **except on a boolean field** where
     the absence of a flag means `Non`.
7. **Engine-recalculated fields are grouped apart.** `totalPrice`, `touristTaxRate`,
   `touristTaxTotal`, `finalPrice`, `depositAmount`, `balanceAmount` are moved out of the main list
   into a secondary « Recalculs » block rendered below it, in a dimmed style.
8. If an entry contains **only** recalculated fields, they are rendered as the main list (no
   « Recalculs » heading) — the entry must never look empty.
9. Rows written by other producers that already carry `fromText` / `toText` (the two SAS commits via
   `utils/sasAudit.js`, the iCal lock line of `reservationsController`) are **passed through
   untouched** — never re-formatted.
10. An entry with no change at all keeps today's wording: `Réservation créée` for `create`,
    `Mise à jour sans changement détecté` otherwise.
11. All of the above is computed **on the server**: the client receives ready-to-print
    `label` / `fromText` / `toText` / `kind` / `group` and only renders them.

**Edge cases:**
- Option removed *and* another added in the same edit → two rows (`−` then `+`), not one `changed`.
- Custom options carry synthetic, position-based ids (`2_000_000 + index`): removing one shifts the
  followers, so a single removal can surface as several rows on custom lines. Accepted (they have no
  stable identity in the signature); they are labeled `Option personnalisée`.
- A quantity change that leaves the total price identical (offered line) still produces a `changed`
  row — the signature carries the quantity.
- Signature empty on both sides → no row at all (`computeAuditChanges` wouldn't have emitted one).
- Unknown option/resource id (deleted from the catalogue) → `Option #<id>` / `Ressource #<id>`, as today.

---

## 4. Architecture

> Fat backend: the whole diff expansion + French formatting happens in `utils/reservationAudit.js`.
> The client component prints strings and applies colors — no parsing, no formatting, no business rule.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `reservationAudit.js` | T | Replaces `enrichHistoryChanges` with `buildHistoryRows(changes, ctx)`: per-field value formatting, signature line-by-line expansion, derived/main split. Adds `HISTORY_FIELD_FORMATS`, `DERIVED_HISTORY_FIELDS`, `parseSignature`, `diffSignatureLines`, `formatHistoryFieldValue`. |
| `models/` | `reservationsModel.js` | T | `getHistory` builds the naming context (options, resources, **properties, clients**) and returns `{ id, eventType, createdAt, changes, derived }`. |
| `models/` | `devisModel.js` | T | Same call-site update in `getHistory` (shares the table + util). |
| `models/` | `historyNamesModel.js` | C | `buildHistoryNameContext(db)` — the four id → name maps (options, resources, properties, clients) both `getHistory` need. |
| `controllers/` | `reservationsController.js` | — | Unchanged (the iCal lock row already ships `from`/`to` as text). |
| `routes/` | `reservations.js` | — | Unchanged. |
| `database.js` | — | — | No schema change. |

`buildHistoryRows` stays a pure function (no DB access): the model injects the name maps.

Row shape returned to the client:

```js
{
  field: 'optionsSignature',      // source field (React key + debugging)
  group: 'Options' | 'Ressources' | null,
  label: 'Petit-déjeuner',        // option name, or the field label for plain fields
  kind: 'changed' | 'added' | 'removed',
  fromText: '×2 : 13 €' | null,
  toText: '×3 : 19,50 €' | null,
}
```

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.jsx` | T | Drops the inline history markup + `formatHistoryValue`; renders `<ReservationHistoryPanel>` with the loaded entries. |
| `components/reservation/` | `ReservationHistoryPanel.jsx` | C | The whole « Historique des modifications » card: toggle button, loading/empty states, entry cards, group headings, `+`/`−`/`→` rows, « Recalculs » block. |
| `hooks/` | — | — | (none) |
| `api.js` | — | — | Unchanged endpoint. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `LoadingState`, `EmptyState` | Already used by the inline block. |
| **Created (new generic)** | — | |
| **Specific (kept feature-local)** | `ReservationHistoryPanel` | Bound to the reservation history payload shape; lives in `components/reservation/` next to `FinanceSection.jsx`. Reusable as-is by a future devis history view (same payload). |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/history` | — | `[{ id, eventType, createdAt, changes: Row[], derived: Row[] }]` | **Breaking:** replaces `changedFields: Change[]`. Sole consumer is `ReservationPage`, updated in the same commit. |
| GET | `/api/devis/:id/history` | — | `[{ id, eventType, createdAt, changes: Row[], derived: Row[] }]` | Replaces `changes: Change[]`. No client consumer today. |

Auth: unchanged (session-authenticated, reception role restrictions untouched).

---

## 5. Data model

No schema change. `reservation_history.changedFields` keeps storing the raw
`[{ field, label, from, to }]` diff — the expansion and formatting are read-time only, so **existing
history rows benefit from the new rendering retroactively**.

**Data impact:** none. No migration, no backfill, no risk of loss.

## 6. UI / UX

The card keeps its position (bottom-left column of the reservation page) and its « Voir historique »
toggle. Only the body of an entry changes.

**Before**

```
Modification                                   07/08/2026 09:52
Prix final : 497 → 547
Options : Ménage : 7 € • Petit-déj ×3 : 19,50 € (compl.) • Draps ×3 : 22,50 € (compl.)
        → Ménage : 7 € • Petit-déj ×3 : 19,50 € (compl.) • Draps ×3 : 22,50 € (compl.) • Lit ×2 : 50 € (compl.)
```

**After**

```
Modification                                   07/08/2026 09:52
Options
  + Lit parapluie   ×2 : 50 € (compl.)
    Petit-déjeuner  ×2 : 13 € → ×3 : 19,50 €
  − Ménage          7 €
Recalculs
    Prix final      497 € → 547 €
    Acompte         149,10 € → 164,10 €
```

- Group heading (`Options`, `Ressources`) : `caption`, `text.disabled`, uppercase-free, above its rows.
- `+` prefix in `success.main`, `−` prefix in `error.main`, `→` separator in `text.disabled` (unchanged).
- Row label in `text.primary` / 600, values in `text.secondary`.
- « Recalculs » block: `caption` heading in `text.disabled` + a 1px top divider, rows at 0.85 opacity.
- Copy: `Recalculs`, `Options`, `Ressources`, `vide`, `Oui`, `Non`, `Réservation créée`,
  `Mise à jour sans changement détecté`, `Aucun historique disponible.`, `Voir/Masquer historique`.

**Responsive:**
- `xs` — rows wrap: label on its own line, `ancienne → nouvelle` below it (`flexWrap: 'wrap'`); card
  padding `px: 1`. No horizontal scroll.
- `md` / `lg` — label and values on one line, as sketched above.
- The card is inside the existing responsive grid; no change to its column spans.

**PageActionBar:** untouched — this spec changes a card inside `ReservationPage`, whose action bar
already exists.

## 7. Test plan

### Server unit tests
- [x] `tests/reservation-history-rows.unit.test.js` (new, 9 tests) — rules 2/3/4/5: added / removed /
      changed option lines, resources with `offert`, unchanged lines produce no row, empty → non-empty
      signature; rule 6: property/client id → name (and `#id` fallback), booleans → Oui/Non, money,
      dates, percent, `null` → `vide`; rules 7/8: derived split + derived-only entry rendered as main
      list; rule 9: a row carrying `fromText`/`toText` (SAS shape) passes through untouched.
- [x] `tests/reservation-audit.unit.test.js` — trimmed of the removed exports.
- [x] Full server suite: 2369 pass.

### Client tests
- [x] `components/reservation/__tests__/ReservationHistoryPanel.test.jsx` (new, 4 tests) — group
      headings printed once, `+`/`−` rows, « Recalculs » block, empty / loading / collapsed states.
- [x] Full client suite: 801 pass. Playwright E2E: 45 pass, 1 skipped.

### Manual UI verification
_Done 2026-08-07 against the dev DB (real history rows, headless Chromium)._
- [x] Happy path: reservation 22246 — each entry shows a single `+ Champagne … 40 € (compl.)` row
      under `Options` and `Prix final 457 € → 497 €` under « Recalculs ».
- [x] Values: `Client #88 → Nicolas Vigier`, `Caution reçue Non → Oui`,
      `Date réception caution vide → 23/06/2026`, `Acompte désactivé Non → Oui`.
- [x] Old entries (written before this change) render with the new formatting — read-time only.
- [x] Mobile (`xs`, 390px): rows wrap under their label, no horizontal scroll.
- [x] Regression: the iCal lock line (`Active → Verrouillée après modification manuelle`) is untouched.

## 8. Out of scope

- Storing *who* made the change (no user id in `reservation_history` today).
- A devis-side history UI (the endpoint is updated but has no consumer).
- Filtering / paginating the history list, or purging old entries.
- Giving custom options a stable identity in the signature (see edge case).
- Changing what `computeAuditChanges` tracks (no new audited field).

## 9. Open questions

- Q: Options/Ressources — one row per changed line, or a single condensed line?
  - A: (2026-08-07) One row per changed option/resource, unchanged lines hidden.
- Q: Should raw values (ids, booleans, dates, amounts) be resolved?
  - A: (2026-08-07) Yes — the three: ids → names, booleans → Oui/Non, money in € and dates in JJ/MM/AAAA.
- Q: What to do with engine-recalculated fields?
  - A: (2026-08-07) Kept, but grouped in a secondary « Recalculs » block (not hidden, not inline).
