# Platform payout — solde due 10 days after departure

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-payout-due-date` _(Claude-managed)_ |
| **Created** | 2026-08-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

[payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) §3.4 shipped the
« **Échéances de paiement** » dashboard card: every reservation whose acompte or solde is past due
surfaces there with its amount, its days late and its available actions. The card works — but it only
ever shows **direct** bookings: [paymentDeadlines.js:44](../server/src/utils/paymentDeadlines.js#L44)
opens with

```js
if (!isDirectChannel(row.platform)) return null;
```

The rationale at the time (rule 1 of that spec) was correct in its own terms: a platform booking is
settled by the platform *after* the stay, so an unpaid solde before arrival is the normal state of
affairs, not something to chase. But it left a real hole open on the other side of the stay:

1. **A platform payout that never arrives is never surfaced.** Airbnb pays a day after check-in,
   Booking invoices monthly, Gîtes de France transfers after the stay — and every one of them
   occasionally misses one. Today nothing in GuestFlow says so. The operator would have to notice, on
   their own, that a séjour finished six weeks ago was never settled.
2. **The stored due date is meaningless for a platform.** The engine derives
   `balanceDueDate = startDate − property.balanceDaysBefore` (30) for every reservation
   ([paymentSchedule.js:68-84](../server/src/utils/paymentSchedule.js#L68-L84)), platform included. So
   a platform solde is « due » a month *before* the guest even arrives — a date on which the platform
   could not possibly have paid, and which describes nothing real.

The two are one problem: the card cannot alert on a deadline that does not exist, and the deadline
that does exist is wrong. Fixing the date is what makes the alert operational.

**Discovered while writing this spec — a pre-existing dunning leak.** The daily solde-request pass
([balanceRequestRunner.js:41](../server/src/utils/balanceRequestRunner.js#L41)) correctly restricts
itself to direct channels. The auto-send cron does **not**:
[emailAutoSendRunner.js:56-64](../server/src/utils/emailAutoSendRunner.js#L56-L64) builds its
`depositDueDate` / `balanceDueDate` anchor queries with no channel filter at all. The
`balance_reminder` template is `auto` + `enabled` by default with `dayOffset: +3`
([defaultEmailTemplatesRegistry.js:528-539](../server/src/utils/defaultEmailTemplatesRegistry.js#L528-L539)),
so an OTA guest whose fiche carries an email address can **already** receive « Solde en attente pour
votre séjour » 27 days before arrival — asking them to pay us money they already paid Airbnb. Moving
the platform due date to after the stay would only relocate that email, not remove it. This spec
closes it (§3.3).

**Arbitrages taken with Adrien on 2026-08-20** (questionnaire):

| Subject | Decision |
|---|---|
| Alert scope | A **dedicated state** for platforms — its own copy, no dunning email, no cancellation. |
| Where the delay lives | **Per platform** (`platforms.payoutDueDays`), default **10**. |
| Existing reservations | **No boot migration** — new reservations only; existing rows re-derive on their next save. |

## 2. Goal

Every OTA reservation carries a solde deadline that means something — **the platform's payout, due
`payoutDueDays` (10 by default) after the guest leaves** — set from the moment the booking lands,
iCal import included; and the dashboard raises a « Virement plateforme en retard » row as soon as
that deadline passes with the money still not in.

## 3. Functional rules

### 3.0 Scope

1. Everything here applies to reservations whose channel is **not an own channel**:
   `!isDirectChannel(platform)` ([platformNameFormat.js:62](../server/src/utils/platformNameFormat.js#L62)).
2. **`Lodgify` is an own channel, not an OTA** — `DIRECT_CHANNELS = { 'direct', 'lodgify' }`. A
   Lodgify booking is a direct booking that happens to carry a commission: the guest pays *us*, so it
   keeps the acompte-at-booking / solde-at-J-30 schedule and the existing direct alert states. The
   rule is written against `isDirectChannel()`, **never** against `platform === 'direct'` — the two
   differ, and `pricing.js` deliberately uses the other notion (`platformIsNonDirect`, ≠ `'direct'`)
   for commission routing. Do not conflate them.
3. `kind = 'reservation'` only. A devis is never on a platform.

### 3.1 The solde due date

4. **`balanceDueDate = endDate + payoutDueDays`** for every non-direct reservation, where
   `payoutDueDays` is the platform's own setting (rule 6). It replaces the
   `startDate − balanceDaysBefore` derivation, which only ever made sense for a guest paying us.
5. The **acompte** due date is unchanged. A platform that pays an acompte up front
   (`platformTakesDeposit = 1`, [platform-deposit-toggle.md](platform-deposit-toggle.md)) keeps
   `depositDueDate = bookingDate + property.depositDueDays`, frozen at creation like everywhere else.
   It is not part of this change, and it never drives an alert row (rule 15).
6. **`payoutDueDays` is a per-platform global setting**, `platforms.payoutDueDays`, **default 10**.
   Global per platform exactly like the tourist-tax mode and the acompte flag
   ([per-platform-tourist-tax-three-way.md](per-platform-tourist-tax-three-way.md),
   [platform-deposit-toggle.md](platform-deposit-toggle.md)): Airbnb pays within days, Booking
   invoices at the month's end — the delay is a property of the channel, not of the logement.
7. **Fallback 10.** A platform with no `platforms` row (a reservation whose channel was never synced
   or configured), a NULL column, or a non-finite value → 10 days. The setting accepts integers
   `0 … 365`; anything else is rejected by the API and the stored value is left alone.
7bis. **The platform is matched by SLUG, not by name.** An iCal-imported reservation stores the
   source's `platformKey` (`gites-de-france`) while the catalogue row is named `GitesDeFrance`; a
   `name COLLATE NOCASE` lookup — the shape the neighbouring `getDepositMode` uses — misses it and
   silently returns the default, i.e. the per-platform setting would never reach the very reservations
   it exists for. `platformSlug()` reduces both to `gitesdefrance`.
8. **The date follows the stay.** Unlike the acompte (frozen at booking), the platform deadline is
   *derived* from the departure date: the pricing engine recomputes it on every save, and an iCal
   re-sync that moves the dates of a non-locked reservation moves it too. This mirrors rule 8 of
   [payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) for the direct solde.
9. **Set at creation, iCal import included.** The iCal sync writes `balanceDueDate = endDate +
   payoutDueDays` in its INSERT
   ([propertyIcalModel.js:340-350](../server/src/models/propertyIcalModel.js#L340-L350)), which today
   hardcodes `NULL`. It is written **even though the imported row carries `balanceAmount = 0`** — the
   deadline is a fact about the booking, known the moment it lands; the amount arrives later, when
   the operator enters the platform's figures ([platform-payment-entry.md](platform-payment-entry.md)).
10. **No boot migration.** Existing platform reservations keep their `startDate − 30` date until they
    are next saved, at which point the engine re-derives it (rule 8). Nothing in `database.js`
    rewrites reservation rows.
11. `balanceDueDate` stays `NULL` when `balanceAmount = 0` on an engine recompute — unchanged
    behaviour, and the reason rule 9 writes the import date directly rather than through the engine.

### 3.2 Dashboard alert — the platform row

12. A fifth state joins the four of
    [payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) §3.4:

    | State | Condition | Severity | Copy |
    |---|---|---|---|
    | `platform_payout_overdue` | non-direct, `balanceAmount > 0`, `balancePaid = 0`, `balanceDueDate < today` | `warning` | « Virement plateforme en retard de N jours » |

12bis. **The alert DERIVES the deadline; it does not trust the stored column.** A payout deadline is a
    pure function of the departure and the platform's delay, so the card computes `endDate +
    payoutDueDays` itself rather than reading `balanceDueDate`. This is what makes shipping without a
    migration (rule 10) actually safe: found in the browser during implementation — a reservation
    created before this change still carries the old guest-facing date, and for a stay that had just
    ended the card announced « Virement plateforme en retard de 26 jours » when the payout was not due
    for another five days. Two such rows were visible on the dashboard on the first run. The stored
    column is a cache for the fiche and the emails; the truth is departure + delay.
12ter. **A payout is never late before the guest has left.** `endDate < today` is required on top of
    the deadline test — a stay still ahead can carry no late payout, whatever any stored date says.

13. **Render order.** `platform_payout_overdue` ranks **last**, after `deposit_overdue`: money owed by
    a platform arrives eventually, money owed by a guest who is about to walk in does not. The
    existing four keep their order and their conditions untouched.
14. A platform row is driven by the **solde only**. `depositDue` is always 0 on it (rule 5) and the
    acompte can never put a platform reservation on the card.
15. `unpaid_at_arrival` and `cancel_due` **never apply to a platform row**: by construction the
    deadline falls after the departure, and neither « the guest is at the door unpaid » nor
    « cancel the stay and keep the acompte » describes a late bank transfer.
16. **No dunning action.** The row carries `canRemind: false` and `remindType: null` — GuestFlow must
    never email an OTA guest about money they already paid the platform. The « Relancer » button is
    **not rendered** for such a row (not merely disabled: there is nothing to send, ever).
17. **No cancellation action.** `canCancel: false`, `retainedDepositAmount: 0`. The séjour has already
    happened.
18. Available actions: « **Reporter** » (the existing snooze, rule 18 of the parent spec — hides the
    row for 7 days, moves no deadline) and the row's link to the reservation.
19. The row payload carries **`platformLabel`** (the formatted platform name) so the card can say
    *which* platform owes the money. Direct rows carry `null`.
20. **The remind endpoint refuses a non-direct reservation.** `POST /api/dashboard/payment-deadlines/
    :id/remind` returns **400 `PLATFORM_RESERVATION`** rather than sending. Defence in depth: the
    button is gone from the UI, and the endpoint could not be used to send that email by hand either.

21. **Visibility window.** Rule 20bis of the parent spec drops a stay that ended more than 30 days ago,
    enforced in SQL on `endDate` ([reservationsModel.js:1265](../server/src/models/reservationsModel.js#L1265)).
    Applied as-is to a platform row that only *becomes* late at `endDate + 10`, it would leave 19 days
    of visibility. The window therefore moves out of SQL and into the pure layer, with one rule per
    channel:
    - **direct** — the row leaves when `endDate < today − 30 days` (unchanged behaviour, same dates);
    - **platform** — the row leaves when it has been late for more than **30 days**
      (`daysLate > 30`, i.e. `endDate + payoutDueDays + 30`).

    The candidates read widens to `endDate >= date(@today, '-60 days')` so both rules have their rows
    to work on; the drop itself is decided in `paymentDeadlines.js` and unit-tested there.

### 3.3 No dunning email ever leaves for a platform reservation

22. The auto-send cron's payment anchors (`depositDueDate`, `balanceDueDate`) gain the **same
    direct-channel filter** as [balanceRequestRunner.js:41](../server/src/utils/balanceRequestRunner.js#L41),
    bound from `DIRECT_CHANNELS` so the list stays single-sourced. The `start` anchor is untouched:
    arrival-related emails (welcome, check-in instructions, J-1 …) are legitimate on a platform
    booking — it is the *money* templates that must not go out.
23. This closes the pre-existing leak described in §1 (`balance_reminder` reaching OTA guests at
    `startDate − 27`) and prevents the new deadline from re-creating it at `endDate + 13`.

### 3.4 Settings — where the delay is edited

24. The per-platform card of the logement page ([PropertyDetail.jsx](../client/src/pages/PropertyDetail.jsx),
    the iCal/platform rows) gains a numeric field « **Virement reçu sous (jours)** » next to the
    existing « Taxe de séjour » and « Acompte » selects, editable in the same inline edit mode and
    saved by the same « Enregistrer » of that row.
25. Like its two neighbours the value is **global to the platform**, not per logement — the row's
    helper text says so, exactly as the existing ones do.
26. The field is **hidden for own channels** (`direct`, `Lodgify`): they have no payout to wait for.
    The per-property payload gains an `isDirectChannel` boolean for that test — the existing `isDirect`
    flag means `slug === 'direct'` only and would wrongly show the field on Lodgify.

**Edge cases:**

- **Imported booking whose platform amount was never entered** (`balanceAmount = 0`) → the deadline is
  stored but no row appears: there is no amount to claim. See §9 — this is the one remaining hole in
  « totalement opérationnelle », and it is a different alert (« résa plateforme sans montant »).
- **Solde marked paid before the deadline** (the usual case: the payout lands on time) → the row never
  appears; nothing to do.
- **Platform reservation with `platformTakesDeposit = 1` and an unpaid acompte** → no row (rule 14).
  The acompte is the platform's business too.
- **iCal date drift on a locked reservation** → the dates do not move
  ([ical-sync-override-locked-dates.md](ical-sync-override-locked-dates.md)), so the deadline does not
  move either. Correct: the operator's dates are the truth.
- **A stay shortened by a re-sync** → the deadline moves *earlier* with the new departure. A row may
  therefore appear the same day the drift is applied. Intended: the payout is due relative to the real
  departure.
- **`payoutDueDays = 0`** → the payout is due on the departure day itself; the row can appear the day
  after. Legitimate configuration, not an error.
- **Platform renamed / deduped** ([platformSlugDedupMigration.js](../server/src/utils/platformSlugDedupMigration.js))
  → `payoutDueDays` is carried over with the other per-platform columns, or the setting would silently
  reset to 10 on a dedup.
- **Snoozed platform row whose payout arrives** → the row disappears on its own (the condition no
  longer holds); the snooze column is harmless residue, as for direct rows.

---

## 4. Architecture

> **Fat backend, thin frontend.** The deadline, the alert state, the days late, which actions a row
> offers, whether a row is still worth showing — all decided on the server. The client maps a state to
> French words and a colour, and renders.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `platforms.js` | T | `PUT /:key/payout-due-days` |
| `routes/` | `dashboard.js` | — | (none — existing endpoints keep their shape) |
| `controllers/` | `platformsController.js` | T | Validates `days` (integer 0-365), delegates to the model |
| `controllers/` | `dashboardController.js` | T | Resolves each candidate's `payoutDueDays` (one lookup per distinct channel) for rule 12bis; `remind` refuses a non-direct reservation (400 `PLATFORM_RESERVATION`) |
| `controllers/` | `reservationsController.js` | T | `resolvePlatformPayoutDueDays(platform)` fed to the 3 quote calls, twin of `resolvePlatformTakesDeposit` |
| `controllers/` | `paymentsController.js` | — | (none — its only engine call is devis-scoped, and rule 3 keeps a devis off the payout schedule) |
| `controllers/` | `public/publicQuoteController.js` | — | (none — the public funnel pins `platform: 'direct'`) |
| `models/` | `platformsModel.js` | T | `getPayoutDueDays(name)` / `setPayoutDueDays(name, days)`; `payoutDueDays` + `isDirectChannel` in the `listForProperty` payload |
| `models/` | `propertyIcalModel.js` | T | INSERT writes `balanceDueDate = endDate + payoutDueDays`; the date-drift UPDATE re-derives it. The platforms model is rebound to the **injected** database (lazily, so a minimal test schema degrades to the default) like the drift/cancellation/closure models |
| `models/` | `reservationsModel.js` | T | Candidates read widened to `endDate >= date(@today, '-60 days')`; new `getPlatform(id)` for the dunning guard |
| `models/` | `devisModel.js` | — | (none — rule 3 neutralises the platform on a devis inside the engine) |
| `middleware/` | — | — | (none) |
| `utils/` | `paymentSchedule.js` | T | `resolveBalanceDueDate` gains `platform` / `endDate` / `platformPayoutDueDays`: non-direct → `endDate + N`, direct → unchanged |
| `utils/` | `paymentDeadlines.js` | T | The `platform_payout_overdue` branch, its actions, the per-channel visibility window |
| `utils/` | `pricing.js` | T | New `platformPayoutDueDays` input, forwarded with `endDate` + `platform` to `resolveBalanceDueDate` |
| `utils/` | `emailAutoSendRunner.js` | T | Direct-channel filter on the two payment anchors (rule 22) |
| `utils/` | `platformSlugDedupMigration.js` | T | Carries `payoutDueDays` through a dedup (its default is 10, not 0, so `isCustomScalar` needs its own branch) |
| `utils/` | `platformPayout.js` | C | **Pure**: the default (10), the max (365), `normalizePayoutDueDays` (storage-side, falls back) and `parsePayoutDueDaysInput` (API-side, rejects) |
| `utils/` | `forceItemContribsCapture.js` | — | (none — it recomputes for the contrib buckets and never persists a due date) |
| `scheduledTasks.js` | — | — | (none — no new job) |
| `database.js` | `database.js` | T | Idempotent `ALTER TABLE platforms ADD COLUMN payoutDueDays INTEGER NOT NULL DEFAULT 10`. **No reservation backfill** (rule 10). |

**Notes:**
- `paymentSchedule.js` and `paymentDeadlines.js` stay **pure** (no DB, no clock): every input injected,
  everything unit-tested. The platform delay is resolved by the caller, never looked up inside them.
- `resolveBalanceDueDate` keeps its current signature working: absent `platform` → direct behaviour, so
  no call site breaks silently.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `PropertyDetail.jsx` | T | « Virement reçu sous (jours) » field in the per-platform row (edit mode + save) |
| `components/` | `PaymentDeadlinesAlert.jsx` | T | Renders the new state; hides « Relancer » when `remindType` is null; shows the platform name |
| `hooks/` | — | — | (none) |
| `services/` | — | — | (none) |
| `utils/` | — | — | (none) |
| `constants/` | `paymentDeadlines.js` | T | Label, badge colour and headline for `platform_payout_overdue` |
| `styles/` | — | — | (none) |
| `api.js` | `api.js` | T | `setPlatformPayoutDueDays(platformKey, days)` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusBadge` | Already carries the row's severity badge. |
| **Created (new generic)** | — | Nothing new: the change is one state inside an existing card and one field inside an existing row editor. |
| **Specific (kept feature-local)** | `PaymentDeadlinesAlert` | Pre-existing dashboard card; extended, not forked. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| PUT | `/api/platforms/:key/payout-due-days` | `{ days: 10 }` | `{ name, payoutDueDays }` | Auth required. `:key` = platform label/name, url-encoded. Integer 0-365; anything else → **400 `INVALID_DAYS`**. An own channel (`direct`, `Lodgify`) → **400 `DIRECT_CHANNEL`**. Upserts the platform row by canonical name, like `setDepositMode`. |
| GET | `/api/properties/:id/platforms` | — | rows `+ payoutDueDays, isDirectChannel` | Existing endpoint, two fields added. |
| GET | `/api/dashboard/payment-deadlines` | — | `{ rows: [...] }` | Existing endpoint. Rows may now carry `state: 'platform_payout_overdue'`, `platformLabel`, `remindType: null`. |
| POST | `/api/dashboard/payment-deadlines/:id/remind` | `{ type }` | `{ ok }` | **400 `PLATFORM_RESERVATION`** on a non-direct reservation (rule 20). |

---

## 5. Data model

**New column:**

```sql
ALTER TABLE platforms ADD COLUMN payoutDueDays INTEGER NOT NULL DEFAULT 10;
```

Added in the existing `platforms` migration block of
[database.js:1012-1021](../server/src/database.js#L1012-L1021), guarded by the same
`PRAGMA table_info(platforms)` check — idempotent, safe on every boot.

**Existing rows:** every platform gets 10 by the column default, which is exactly the intended value.
Nothing else to backfill.

**Reservations:** **untouched**. No UPDATE runs over `reservations.balanceDueDate` (rule 10). Existing
platform reservations keep their `startDate − 30` date, which means they may alert earlier than the
new rule would — they re-derive on their next save. This is the deliberate arbitrage of 2026-08-20.

**Data impact:** none destructive. One additive column with a sensible default; no rewrite of existing
records; nothing lost if the feature is reverted (the column simply stops being read).

## 6. UI / UX

### 6.1 Dashboard — the platform row in « Échéances de paiement »

Same card, same layout as the four existing states
([PaymentDeadlinesAlert.jsx](../client/src/components/PaymentDeadlinesAlert.jsx)):

```
┌────────────────────────────────────────────────────────────────┐
│ Échéances de paiement — 2 en retard                            │
│ ─────────────────────────────────────────────────────────────  │
│ ● Solde impayé   Martin Dupont · Le Lodge                      │
│   Du 12/09 au 19/09 · n° 2026-0142                             │
│   Solde impayé — 9 jours de retard, annulation possible        │
│   Solde 480,00 €                                               │
│   [Relancer] [Reporter] [Annuler le séjour]                    │
│ ─────────────────────────────────────────────────────────────  │
│ ● Virement plateforme   Sophie Bernard · Le Lodge · Airbnb     │
│   Du 02/07 au 09/07 · n° 2026-0098                             │
│   Virement plateforme en retard de 12 jours · échéance 19/07   │
│   Solde 612,00 €                                               │
│   [Reporter]                                                   │
└────────────────────────────────────────────────────────────────┘
```

**Copy (French):**

| Element | String |
|---|---|
| Badge | « Virement plateforme » (`warning`) |
| Headline | « Virement plateforme en retard de N jours » / « … aujourd'hui » when `daysLate = 0` |
| Platform name | appended to the client/logement line: « Sophie Bernard · Le Lodge · Airbnb » |
| Actions | « Reporter » only |

The card's overall severity keeps its current rule (`error` if any row is `error`, else `warning`), so
a card holding only platform rows renders in the warning tone.

### 6.2 Logement page — the per-platform field

In the platform row's inline edit mode, after « Acompte » :

```
Virement reçu sous  [ 10 ] jours
Réglage global à la plateforme (s'applique à tous les logements).
```

Numeric `TextField`, `size="small"`, `type="number"`, `inputProps={{ min: 0, max: 365 }}`, same
`onFocus={handleZeroFocus}` treatment as the other numeric settings on the page. Hidden entirely on
own-channel rows (rule 26). Saved with the row's existing « Enregistrer », through the new endpoint,
alongside the tourist-tax and acompte writes already performed there.

### 6.3 Responsive behaviour

- **Dashboard card** — unchanged: the row's action buttons already stack vertically on `xs`
  (`flexDirection: { xs: 'column', sm: 'row' }`). A platform row shows a single button, so `xs` gains
  vertical space rather than losing it. The platform name lands on the wrapping client line
  (`flexWrap: 'wrap'` already set) — no horizontal scroll at 375px.
- **Logement page** — the new field joins the existing responsive stack of the platform row editor
  (full width on `xs`, inline from `sm`). Touch target ≥ 44px via the MUI `small` TextField default
  height (40px) plus the row's padding; verified at the three breakpoints.
- **`PageActionBar`** — both pages already use it; no page-level action is added or removed by this
  change.

## 7. Test plan

### Server unit tests — **3 222 pass, 0 fail** (`cd server && npm test`)

- [x] `tests/payment-schedule.unit.test.js` (T, +4) — non-direct → `endDate + payoutDueDays`; `Lodgify`
      and `direct` → unchanged `startDate − balanceDaysBefore` clamped at the booking day; missing /
      NULL / non-finite / out-of-range `payoutDueDays` → 10; `payoutDueDays = 0` → the departure day
      itself; no departure or `hasBalance = false` → `null` (rules 2, 4, 7).
- [x] `tests/payment-deadlines.unit.test.js` (T, +7) — a non-direct row past its deadline yields
      `platform_payout_overdue` with `canRemind: false`, `remindType: null`, `canCancel: false`,
      `depositDue: 0`, `platformLabel` set; it ranks after `deposit_overdue`; the deadline is derived,
      not read from the stored column (rule 12bis, with the exact legacy case found in the browser);
      the platform's own delay drives the row; nothing before the deadline or before the departure;
      no amount → no row; an unpaid platform acompte alone → no row; snooze applies; visibility —
      a direct row drops 31 days after the departure, a platform row 31 days after its deadline.
- [x] `tests/payment-dunning-emails.unit.test.js` (T, +2) — a `balanceDueDate` / `depositDueDate`
      anchor never selects a platform booking; `direct` and `Lodgify` still are; a blank platform reads
      as direct (rules 22-23).
- [x] `tests/property-ical-sync.unit.test.js` (T, +4) — an imported event writes
      `balanceDueDate = endDate + 10`, and `endDate + 3` when the catalogue configures it; a date drift
      on a pristine reservation re-derives it; a locked reservation moves neither dates nor deadline
      (rules 8-9).
- [x] `tests/platforms-model.unit.test.js` (T, +4) — `get/setPayoutDueDays` round-trip, 0 accepted,
      slug matching (`gites-de-france` finds `GitesDeFrance`), own channels and unknown platforms fall
      back to 10 and can never be configured, a never-synced platform is upserted (rules 6-7bis, 26).
- [x] `tests/pricing-platform-payout-due-date.unit.test.js` (C, 6) — end-to-end through the engine:
      platform → departure + delay, own channels unchanged, the deadline follows a moved departure, a
      devis stays on the guest-facing schedule, nothing to collect → no deadline.

### Client tests — **1 015 pass, 0 fail** (`cd client && npx vitest run`)

- [x] `PaymentDeadlinesAlert.test.jsx` (T, +2) — a `platform_payout_overdue` row renders its badge, the
      headline and the platform name, with **no** « Relancer » and no « Annuler le séjour »; a direct
      row alongside it keeps its own « Relancer ».
- [x] `PropertyDetail.test.jsx` (T, +3) — the delay shows per platform and is absent on own channels;
      editing it calls `setPlatformPayoutDueDays` with the platform label; an unchanged value is not
      re-sent on save.

### E2E — **65 pass, 1 skipped** (`npm run test:e2e`)

- [x] No regression on the existing Playwright suite after the client changes.

### Manual UI verification (dev server, 2026-08-20)

- [x] Dashboard: the card lists three « Virement plateforme » rows (Booking ×2, GitesDeFrance) with the
      right deadlines (departure + 10) and days late, each with « Reporter » alone.
- [x] The two legacy rows that the stored column would have shown as « 26 jours de retard » correctly
      do **not** appear — their payouts are not due yet (rule 12bis).
- [x] Logement page: the « Virement sous » column shows « 10 j » per OTA and « — » on `direct` **and**
      `Lodgify`; editing Airbnb to 3 persists globally and moves that platform's alert to
      departure + 3 (a reservation ending 13/08 became late on 16/08).
- [x] API guards: `days` = 400 / `"abc"` / 2.5 → 400 `INVALID_DAYS`; an own channel → 400
      `DIRECT_CHANNEL`; « Relancer » on a platform reservation → 400 `PLATFORM_RESERVATION`.
- [x] A real iCal sync (GitesDeFrance, 15 events) runs clean — both rewritten statements prepare
      against the production schema.
- [x] Mobile (375 px): platform rows read with the badge, the platform name and a full-width
      « Reporter »; the logement row shows « Virement reçu sous : 10 j »; `document.body.scrollWidth`
      360 ≤ 375, no horizontal scroll.

## 8. Out of scope

- **Retroactive migration** of existing platform reservations' `balanceDueDate` (explicitly declined
  on 2026-08-20; they re-derive on their next save).
- **Alerting on an imported reservation whose platform amount was never entered** (`balanceAmount = 0`)
  — see §9.
- **Automatic reconciliation of the payout** (matching a Qonto bank movement to a reservation and
  marking the solde paid on its own). The operator still marks it.
- **Per-platform acompte deadline.** Rule 5 keeps the existing derivation.
- **Any dunning email towards a platform** (a « votre virement est en retard » to Airbnb). Chasing a
  platform happens in the platform's own back-office; the card only says *that* it is late.
- **The Finances page.** It already lists « Reste à payer » with correct arithmetic; this spec does not
  touch it.

## 9. Open questions

- **Q: An iCal booking whose platform amount is never entered has `balanceAmount = 0` and will
  therefore never alert — even a year after the stay. Is that the last hole to close?**
  A: (open) It is a *different* alert — « réservation plateforme sans montant saisi », which is about
  data entry, not about a late payout, and would belong either to this card as a sixth state or to the
  existing iCal-import card. Deliberately left out of this spec so the payout rule ships clean. To be
  decided with Adrien.
- **Q: should the payout delay be per property rather than per platform?**
  A: **Resolved 2026-08-20 — per platform.** Airbnb transfers within days, Booking invoices at the
  month's end: the delay belongs to the channel, not to the logement.
- **Q: `warning` or `error` severity for a late payout?**
  A: **Resolved 2026-08-20 — `warning`.** An OTA payout that is a few days late is routine; the card's overall
  tone should not go red for it, or the red signal loses its meaning again — the exact failure mode
  [dashboard-collection-alert.md](dashboard-collection-alert.md) was written to fix. Revisit if a real
  case shows a payout going properly missing.
