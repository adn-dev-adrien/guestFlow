# Force Extras to Complement on Platform Reservations

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/force-extras-complement-on-platform` _(user-managed)_ |
| **Created** | 2026-06-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Two prior specs set the stage for this one:

- [accounting-platform-commission-and-no-deposit.md](accounting-platform-commission-and-no-deposit.md)
  (PR #116) — established the rule that a non-`direct` reservation has
  `depositAmount = 0`: the platform pays the operator in **one** bank
  transfer, so the deposit/balance split is collapsed to "balance only"
  server-side + the Acompte block is hidden in the UI.
- [force-item-to-complement.md](force-item-to-complement.md) (merged
  pre-#116) — introduced the per-line `inComplement` flag on
  `reservation_options`, `reservation_resources`,
  `reservation_custom_options`. When `inComplement = 1`, the line is
  routed entirely to the **Complément** payment and skipped from the
  acompte/solde proration. The flag is exposed to the operator as a
  per-line checkbox in `ExtrasSection` (lines ~113, ~148, ~218, ~323).

The current state is inconsistent for platform reservations:

- The base stay (nights × pricePerNight) is paid by the platform's
  single transfer → fine, it lands in the balance.
- But options / resources / custom options added on the reservation
  default to `inComplement = 0`, so the engine prorates them across
  deposit (0) + balance — they end up bundled in the platform transfer's
  expected amount, which is wrong: a baby bed or a late check-out
  surcharge is **paid directly by the guest on-site**, not by the
  platform.

The operator currently has to remember to flick the "Compl." toggle on
every extra they add to a platform reservation — easy to forget, hard
to audit retroactively.

## 2. Goal

For every reservation where `platform != 'direct'`, every extra line
(option, custom option, resource, auto-option) is **automatically and
authoritatively** treated as paid in the Complément — without a UI
toggle, and without the operator having to think about it.

## 3. Functional rules

1. **Server is authoritative.** On `insertReservation` /
   `updateReservation` / `replaceOptions` / `replaceCustomOptions` /
   `replaceResources` / `replaceAutoOptions`, when
   `reservations.platform != 'direct'` (after normalization by
   `formatPlatformName`), every inserted/updated row in
   `reservation_options`, `reservation_custom_options`,
   `reservation_resources` is written with `inComplement = 1`, regardless
   of the payload value. The flag in the request body is ignored on
   non-direct reservations — never trusted.
2. **Forced lines carry NULL contributions.** As already enforced by
   `replaceOptions` / `replaceResources` for forced lines (see
   `reservationsModel.js` line ~552–554): when `inComplement = 1` we
   write `acompteContribTtc = NULL` and `soldeContribTtc = NULL`. The
   payment-flip path (`captureContribsOnFlip`) is already careful to
   only capture contribs for non-forced lines — no change there.
3. **Direct reservations: unchanged.** When `platform = 'direct'` (or
   absent), the per-line `inComplement` toggle keeps its current
   behaviour: operator opt-in, default `0`, user-controllable in the UI.
4. **UI hides the complement toggle on platform reservations — but
   keeps "Offrir" available.** When
   `form.platform && form.platform != 'direct'`:
   - `ExtrasSection` hides the "Compl." Checkbox on every line type
     (property options, custom options, resources, auto-options) and
     shows a single muted caption at the top of the section:
     *"Réservation plateforme — les extras sont automatiquement
     facturés en paiement complémentaire."*
   - `PricingSummary` also hides the per-line `<ComplementChip>` (the
     small "compl." chip mirrored from the ExtrasSection toggle). The
     "Offert/Offrir" button (`<Button>` next to each line, lines
     ~341-359) **stays visible and fully interactive** — an operator
     can always make a geste commercial on an extra, regardless of
     whether the reservation came via a platform.
   - Offering an extra on a platform reservation continues to work
     exactly as on direct: `offered = 1` zeroes the line's `totalPrice`
     in the engine, which then routes a 0 € line into Complément
     (rule 1's forced `inComplement = 1` still applies; the engine
     already handles "offered AND forced" as a no-op € for the
     Complément entry, see `accountingModel.js` line ~457–462).
5. **Auto-options included.** The "forced to complement" rule applies
   to auto-options too: a property's default linen / late-checkout
   surcharge added via the auto-options channel
   (`autoOptionsInComplement` in `ReservationPage`) on a platform
   reservation is treated as if its `inComplement` bit was on, both at
   write time and in the accounting engine. The "Offert" button on
   the summary remains available on auto-options as well — same
   geste-commercial rationale.
6. **Boot migration.** A one-shot, idempotent migration runs at server
   boot (gated by `migrations.force_extras_complement_on_platform_v1`):
   for every reservation with `platform != 'direct'` (case-insensitive),
   `UPDATE reservation_options / reservation_custom_options /
   reservation_resources SET inComplement = 1,
   acompteContribTtc = NULL, soldeContribTtc = NULL WHERE
   reservationId IN (…)`. The migration only touches rows where
   `inComplement = 0` (or NULL) — rows already flipped are left alone
   (their captured contribs were nulled by the previous force).
7. **Already-paid contribs are preserved when possible.** If a
   reservation's `depositPaid = 1` *and* its options had non-null
   `acompteContribTtc` (rare on platforms post-PR #116, but possible on
   legacy rows), the migration logs a one-line warning per affected
   reservation (`[migration:force-extras-complement-on-platform]
   reservation #N: had captured acompte contribs on extras; nulled —
   review the export if needed`) but still nulls them. Accounting
   re-derives totals from `inComplement` at export time, so the impact
   is contained to the next export only.
8. **No new DB columns.** This change reuses the existing `inComplement`
   / contribs columns on the three extras tables. No schema additions.
9. **Backward compatibility on the accounting export.** The engine's
   existing routing (`computeBucketTtcsFromContribs`,
   `accountingModel.js` line ~457–462) already handles forced lines
   correctly. No change required there. The only knock-on effect is
   that platform reservations exported *after* this migration will show
   any pre-existing extras in the Complément entry instead of in the
   Solde — which is the whole point.

**Edge cases:**
- Direct → Platform transition mid-edit: when the operator changes
  `form.platform` from `direct` to a platform value, the client
  pre-fills `inComplement = true` on every extra line (mirrors the
  existing auto-collapse-deposit logic introduced by PR #116). The
  server then enforces it on save anyway, but the client preview
  reflects the new total immediately.
- Platform → Direct transition mid-edit: the client *keeps*
  `inComplement = true` on the existing lines (the operator can untick
  manually). No surprise unticking.
- Reservation with `platform = ''` (empty string): treated as direct
  (`formatPlatformName('') || 'direct'` returns `'direct'`). No
  forcing.
- Re-running the boot migration: idempotent, returns 0 affected on the
  second run (the `WHERE inComplement = 0` clause acts as the guard).

---

## 4. Architecture

> **Reminder — Fat backend, thin frontend.** The forcing rule is
> implemented and enforced on the server. The client merely hides the
> toggle and pre-fills the state for visual feedback.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | New one-shot migration block gated by `migrations.force_extras_complement_on_platform_v1`. Calls a small util that does the bulk UPDATE on the 3 extras tables. |
| `utils/` | `utils/forceExtrasComplementOnPlatformMigration.js` | C | Extracted migration logic (so it's unit-testable in isolation). Returns `{ affectedReservations, affectedLines }`. |
| `models/` | `models/reservationsModel.js` | T | In `replaceOptions` / `replaceCustomOptions` / `replaceResources` (+ the `insert*` variants that wrap them): when the reservation's `platform != 'direct'`, override `inComplement = 1` + NULL contribs on every inserted row, regardless of payload. |
| `models/` | `models/reservationsModel.js` (auto-options path) | T | The auto-options write path (currently in `replaceOptions` via the `autoOptionsInComplement` set passed by the controller) must include every auto-option for the reservation in the "forced" set when the platform is non-direct. |
| `controllers/` | — | — | (none — controllers already pass the platform through; only the model needs the logic) |
| `utils/pricing.js` | `utils/pricing.js` | — | (no change — the engine already drops forced lines from acompte/solde and pushes them into the Complément entry) |
| `routes/` | — | — | (none) |
| `middleware/` | — | — | (none) |
| `scheduledTasks.js` | — | — | (none) |

**Notes:**
- No new dependency.
- The migration helper is extracted from `database.js` to keep boot
  code thin and to allow a `:memory:` fixture in a unit test (same
  pattern as `normalizePlatformNamesMigration.js`).
- The model-level forcing is the load-bearing change. The migration
  is a one-shot data backfill; from that boot onwards, the model
  enforces the invariant on every write.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/reservation/` | `ExtrasSection.js` | T | New `isPlatformReservation` prop derived from `form.platform`. When true: hide all four "Compl." Checkbox blocks (property options, auto-options, custom options, resources). Show the muted caption *"Réservation plateforme — les extras sont automatiquement facturés en paiement complémentaire."* above the section. |
| `components/` | `PricingSummary.js` | T | New `isPlatformReservation` prop. When true: the per-line `<ComplementChip>` (rendered around line ~331-333 for options + ~rows for resources) is **not rendered**, since the routing is forced on the server. The `<Button>` "Offert/Offrir" (~line 341-359 for options + mirror in resources) **stays visible and interactive** — an operator can always offer an extra. |
| `pages/` | `ReservationPage.js` | T | (a) Pass `isPlatformReservation` to `ExtrasSection` and `PricingSummary`. (b) In the direct→platform transition handler (already exists for the deposit auto-collapse from PR #116): flip `inComplement = true` on every line in `form.selectedOptions`, `form.customOptions`, `form.selectedResources`, plus mark every auto-option enabled on this reservation as in-complement (`autoOptionsInComplementSet`). This is purely client-side preview; the server enforces it again on save. |
| `services/` | — | — | (none — `api.js` already threads `inComplement` through) |
| `utils/` | — | — | (none) |
| `constants/` | — | — | (none) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `Typography`, `Stack`, `Checkbox`, `FormControlLabel` (MUI), `ExtrasSection` (page-specific) | All pre-existing. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `ExtrasSection` (already feature-local) | This change reuses the existing component, no new specifics. |

### 4.3 API contract

No new endpoint. The existing payload shape on
`POST/PUT /api/reservations` is unchanged. The server **ignores** the
client-supplied `inComplement` value for platform reservations and
forces it to `1`; this is a silent override (no error, no warning to
the client), in the same spirit as PR #116's silent deposit override.

---

## 5. Data model

**No schema changes.** Reuses existing columns:

- `reservation_options.inComplement INTEGER NOT NULL DEFAULT 0`
- `reservation_options.acompteContribTtc REAL DEFAULT NULL`
- `reservation_options.soldeContribTtc REAL DEFAULT NULL`
- (same three columns on `reservation_custom_options` and
  `reservation_resources`)
- `migrations` table (already exists, used by
  `platform_no_deposit_v1` and `platform_names_normalized_v1`).

**Migration block in `database.js`:**

```js
// specs/force-extras-complement-on-platform.md §3 rule 6 + §5.
if (!hasRun(db, 'force_extras_complement_on_platform_v1')) {
  const result = require('./utils/forceExtrasComplementOnPlatformMigration')
    .runForceExtrasComplementOnPlatform(db);
  console.log(
    `[migration:force-extras-complement-on-platform] migrated ${result.affectedLines} ` +
    `extra line(s) across ${result.affectedReservations} reservation(s)`
  );
  markRun(db, 'force_extras_complement_on_platform_v1');
}
```

**Data impact:** affects existing platform reservations' extras. The
total amount due is unchanged on each reservation (extras keep their
`totalPrice`); only the **routing** changes — from "split across
deposit/balance" to "paid in Complément". The migration is one-way:
operators can re-tick the lines on a per-reservation basis after the
fact via the UI (on direct reservations only; platform reservations
will refuse the unticking on save).

**Risk of loss/corruption:** none. No row is deleted, no `totalPrice`
is mutated. Contributions (`acompteContribTtc` /
`soldeContribTtc`) are nulled on the migrated rows; this is the
already-documented behaviour for forced lines (see PR
`force-item-to-complement` §5).

---

## 6. UI / UX

### `/reservations/:id` — `ExtrasSection`

**When `form.platform = 'direct'` (or empty):** unchanged — per-line
"Compl." Checkbox visible on each of the four blocks (property
options, auto-options, custom options, resources).

**Direct reservation extras — visual contract (post 2026-06-05 polish):**

Each per-line "Compl." toggle is a **small MUI Switch** (`size="small"`)
inside a `<Tooltip>`, with no inline label — same visual family as the
per-line activation Switch above the bottom row, just smaller. The
`<FormControlLabel>` wrapper carries no `label` prop; the Tooltip
provides the affordance text (*"Cette ligne sera comptabilisée
intégralement dans le Complément à percevoir, jamais dans l'acompte
ou le solde."*) and an `aria-label="Forcer en complément"` makes the
control queryable by screen readers + tests. The Compl. Switch sits
immediately to the **left** of the Total chip in the right-aligned
bottom cluster (`justifyContent="flex-end"`); the Total chip is
sized to its content (no `flexGrow: 1`) so the cluster stays tight
against the right edge.

**When `form.platform != 'direct'`:**

1. At the top of the Extras section (immediately under the "Extras"
   heading), insert a muted caption:
   > Réservation plateforme — les extras sont automatiquement facturés
   > en paiement complémentaire.
2. The four "Forcer en complément" small Switches (`ExtrasSection.js`
   on each of the 4 line types) are **not rendered**. The surrounding
   `<Stack>` /`<Tooltip>` wrapper falls back to just the totals chip +
   the delete button (custom options) / qty input. The right-aligned
   bottom cluster (Total chip alone) keeps the same alignment as the
   direct case.
3. In `PricingSummary`, the per-line `<ComplementChip>` is **not
   rendered** (same rationale — the routing is forced, no toggle to
   expose). The "Offert/Offrir" `<Button>` next to each line **stays
   visible and clickable** with its normal behaviour: clicking "Offrir"
   sets `offered = 1`, the engine zeroes the line's `totalPrice`, the
   row shows the strike-through display + "✓ Offert" label.
4. The Complément row in the Finance summary at the bottom of the page
   surfaces the total of all (non-offered) extras, exactly like a
   direct reservation with the toggle ticked on every line — no
   separate visual treatment required.

### Direct → Platform transition

When the operator changes the `Platform` dropdown from `direct` to a
platform value (`Airbnb`, `GitesDeFrance`, etc.):

1. The existing auto-collapse-deposit handler (added in PR #116) runs
   and clears `depositAmount`.
2. **New (this PR):** the same handler also iterates
   `form.selectedOptions`, `form.customOptions`,
   `form.selectedResources` and sets `inComplement = true` on every
   line. The `autoOptionsInComplementSet` is populated with every
   currently-enabled auto-option's id.
3. The Extras section re-renders with the caption + hidden toggles.
4. The Finance summary recomputes the Complément total (the engine
   gets the new `inComplement` flags on the next quote).

No snackbar needed — the caption itself is feedback. The transition
is undo-able by switching back to `direct`.

### Platform → Direct transition

No automatic unflipping. The lines that were already in complement
stay in complement; the operator can untick them manually if needed.
This is the safer default (avoid surprise revenue routing).

### Responsive behaviour

- `xs` (mobile, ≤600px): the caption wraps naturally. Hidden
  checkboxes free up horizontal space; the totals chip + delete button
  fit comfortably on a single line.
- `md` (~900px) + `lg` (≥1200px): same layout as direct reservations
  minus the checkboxes.

### Sticky action bar

No change — the existing `PageActionBar` on `ReservationPage` is
untouched.

---

## 7. Test plan

### 7.1 Server unit tests

| File | Cases |
|---|---|
| **NEW** `tests/force-extras-complement-on-platform-migration.unit.test.js` | (1) Migrates only non-direct reservations' extras. (2) Sets `inComplement = 1` + NULLs both contribs on all 3 tables. (3) Idempotent — second run affects 0 rows. (4) Preserves `inComplement = 1` rows untouched. (5) Logs the captured-contrib warning when a non-null `acompteContribTtc` is found on a non-direct reservation. |
| **NEW** `tests/reservations-extras-platform-force-complement.unit.test.js` | (1) `insertReservation` + `replaceOptions` on a non-direct platform forces `inComplement = 1` on every option even when payload says `0`. (2) Same for `replaceCustomOptions`. (3) Same for `replaceResources`. (4) Direct reservation: payload `inComplement = 0` is honoured. (5) Direct reservation: payload `inComplement = 1` is honoured. (6) Empty-string platform = direct (no forcing). |
| **TOUCHED** `tests/accounting-export.unit.test.js` | Update the existing platform-reservation fixture: assert that any extra (option / custom option / resource) included in the fixture now lands in the **Complément** entry's bucket totals, not in the **Balance** entry's. ~2 cases adjusted. |

Expected: existing **903** + **6** (existing PR #116/#118) ≈ **909** → ≈ **920** with **+11 new** + ~2 touched.

### 7.2 Client unit tests (Vitest)

| File | Cases |
|---|---|
| **NEW** `client/src/components/reservation/__tests__/ExtrasSection.platform-force-complement.test.js` | (1) Direct reservation: the four "Compl." Checkbox blocks render. (2) Platform reservation: the caption renders + zero "Compl." Checkboxes are present. (3) Property option total is unchanged (just routing). (4) Switching `platform` prop from `direct` to `Airbnb` re-renders without the checkboxes. |
| **NEW** `client/src/components/__tests__/PricingSummary.platform-force-complement.test.js` | (1) Direct reservation: per-line `<ComplementChip>` rendered + "Offrir" button rendered. (2) Platform reservation: per-line `<ComplementChip>` NOT rendered + "Offrir" button still rendered. (3) Clicking "Offrir" on a platform reservation calls `onToggleOptionOffered` as on direct. |

Expected: existing **184** + **4** + **3** = **191**.

### 7.3 E2E

No new E2E case. The existing suite (18 passed / 1 skipped) still
passes — none of its flows exercise the extras toggles directly.

### 7.4 Manual UI verification

1. Boot the app on a DB that already contains a platform reservation
   with at least one option + one custom option not in complement.
   Server log shows `[migration:force-extras-complement-on-platform]
   migrated N extra line(s) across M reservation(s)`.
2. Open that reservation in the UI. Extras section shows the caption;
   no "Compl." checkboxes. Finance summary shows the extras' total in
   the Complément row.
3. Create a new direct reservation. Add an option. Toggle "Compl." on
   and off — works normally.
4. Change its platform from `direct` to `Airbnb`. The "Compl."
   checkboxes disappear, the caption appears, the extras line(s) are
   automatically routed to Complément. Save → reload → still in
   Complément.
5. Download the monthly CSV export. The platform reservation's extras
   appear in the **Complément** entry, not in the **Balance** entry.

---

## 8. Out of scope

- No "bulk re-tick across direct reservations" tool. Operators tick
  per-line on direct reservations as today.
- No new accounting account for extras-on-complement. The existing
  Complément routing logic in `accountingModel.js` already produces
  the right journal lines.
- No commission impact: extras on platform reservations are paid
  directly by the guest, not by the platform, so they do not affect
  the commission amount captured by the operator (commission is
  computed on `clientGrossAmount - finalPrice`, both of which are
  unchanged by this PR).
- No quote PDF impact — devis PDFs are generated only for direct
  reservations (no platform devis).

---

## 9. Open questions

(All resolved with Adrien before moving Status to Approved.)

1. ✅ **UI treatment of the toggle on platform reservations?** →
   Hide entirely + muted caption above the section (aligned with the
   PR #116 deposit-block pattern).
2. ✅ **Migration for existing platform extras with `inComplement = 0`?** →
   One-shot boot migration, idempotent, gated by
   `force_extras_complement_on_platform_v1`.
3. ✅ **Auto-options included?** → Yes — same forcing rule on
   auto-options (linen defaults, late-checkout surcharge, etc.).

---

## 10. Implementation progress

_(Filled in as commits land. Update this section in the same commit
that ships each step, per CLAUDE.md §4.1.)_

- [x] Backend: `forceExtrasComplementOnPlatformMigration` util +
      `database.js` boot wiring.
- [x] Backend: `reservationsModel` write-time forcing on the 3
      extras tables + auto-options (the OR-with-platform-state path
      covers auto-options through the same `optionLines` channel).
- [x] Backend: server unit tests (6 migration + 6 model = 12 new). The
      existing `accounting-export.unit.test.js` did NOT need updating —
      its fixture builder bypasses the per-line `inComplement` field.
- [x] Frontend: `ExtrasSection` derives `isPlatformReservation`
      internally (no new prop — cleaner) + 4 conditional Checkbox
      blocks + muted caption.
- [x] Frontend: `PricingSummary` derives `isPlatformReservation`
      internally from `form` + hides `<ComplementChip>` everywhere; the
      "Offrir" button stays.
- [x] Frontend: `ReservationPage` `quoteInput` derivation (no
      transition handler needed — the engine sees `inComplement: 1`
      directly from the memoized input on platform reservations).
- [x] Frontend: Vitest tests (4 ExtrasSection + 3 PricingSummary).
- [ ] Docs: CHANGELOG entry, spec Status → Implemented.
