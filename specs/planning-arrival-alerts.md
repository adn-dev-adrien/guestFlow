# Planning — arrival-card cleaning alerts + caution-to-collect + platform badge

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/planning-caution-to-collect` _(user-managed)_ |
| **Created** | 2026-06-11 |
| **Author** | Adrien |
| **Related PR** | #168 (turnover datetime fix) + #169 (caution badge) + platform badge (2026-06-11) |

---

## 1. Context

The Planning (`pages/PlanningPage.js`) shows one **arrival card** (`components/ReservationCard.js`)
per upcoming arrival, with overlap/turnover **alerts** computed in `detectAlerts`. Two problems were
reported:

1. **False ménage collisions across different days.** The turnover-conflict detection compared only
   the time-of-day (`HH:MM`), ignoring the date — so a 10:00 checkout on 8 July was flagged in red as
   colliding with a 10:00 arrival on 17 July (same time, 9 days apart). The blue "arrival during
   another logement's cleaning" alert had the same latent bug.
2. **No visibility on an unpaid caution.** When a guest's security deposit (caution) had not been
   received, nothing on the arrival card told the host to collect it at check-in.

## 2. Goal

Arrival cards flag **only genuine** same-window cleaning conflicts (computed on full date+time), and
surface an **unpaid caution to collect** as a red badge on the arrival card — so the host knows, at a
glance, what to handle at check-in.

## 3. Functional rules

1. **Turnover conflict (red, same logement).** An arrival is flagged when the most recent **previous
   checkout on the same property**, plus that property's **cleaning duration** (`cleaningHours`,
   configured per-property in Paramètres, default 3h), ends **strictly after** the arrival —
   compared as **full date+time**, never time-of-day alone.
   - Example: A departs 01/01 10:00, B arrives 01/01 12:00 (same logement).
     - Cleaning **2h** → ends 12:00 = arrival → **no alert** (exact fit is OK).
     - Cleaning **3h** → ends 13:00 > 12:00 → **alert**.
   - A 10:00 checkout on 08/07 and a 10:00 arrival on 17/07 → **no alert** (9 days apart).
2. **Cross-logement cleaning (blue).** An arrival is flagged when **another property's** checkout +
   its cleaning window actually overlaps the arrival, compared on full date+time (not a same-time
   checkout on an earlier day). The detection scans for a genuinely-overlapping reservation.
3. **Simultaneous departures (orange).** Unchanged: multiple logements with the same checkout date +
   time.
4. **Caution to collect (orange badge — 2026-06-12).** When a reservation has `cautionAmount > 0`
   **and** the caution has **not** been received (`cautionReceived` falsy), the arrival card shows an
   **orange** (`warning`) **« Caution à percevoir : X € »** badge with a shield icon. The badge is
   hidden once the caution is received, and when `cautionAmount` is 0.
   - **Colour rationale (2026-06-12):** the **complément à percevoir** uses **red** (`error`, filled) —
     money the host must definitely collect on arrival — so it stands out the most; the **caution**
     uses **orange** (`warning`) — a refundable hold, one notch softer. (Previously caution was red and
     complément orange; swapped per Adrien.)
5. **Platform badge (2026-06-11, enlarged 2026-06-12).** To the **right of the property name**, the
   arrival card shows a **rounded-border, transparent-background** badge with the **platform name**;
   both the border and the text use the **platform's brand colour** (`getPlatformColor`, the same map
   the calendar uses). Sized for legibility (**14px, bold, 1.5px border**). The label is the stored
   platform value (`formatPlatformLabel`: lowercase `direct` → `Direct`, others as-is). Hidden when the
   reservation has no `platform`.
6. **Bed-linen alert (orange badge — 2026-06-12).** The arrival card warns about bed linen, via a
   **server-computed** flag `reservation.bedLinenAlert` (exposed by `getByIdWithDetails`):
   - `{ type: 'no_linen' }` → the guest did **not** take the bed-linen option → badge
     **« Linge de lit non pris »**.
   - `{ type: 'capacity', capacity, required }` → linen taken, but the bed configuration sleeps fewer
     people than the booking → badge **« Linge de lit insuffisant : {capacity} couchage(s) pour
     {required} pers. »**. Capacity = `singleBeds + doubleBeds × 2`; required = `adults + teens +
     children NOT in a baby bed` (children in baby beds = `max(0, babyBeds − babies)`) — the SAME
     formula the reservation form shows live (`bedsCapacityMismatch`), now computed server-side so the
     planning reuses it on saved reservations.
   - **No alert at all for properties where bed linen is a default-offered option**
     (`property_option_defaults` with the `autoOptionType='bed_linen'` option, `offered=1`) — the
     operator doesn't manage linen per stay there. `bedLinenAlert` is then `null`.

**Edge cases:**
- `bedLinenAlert`: a reservation whose beds were coerced to 0 (no linen option) surfaces `no_linen`,
  not `capacity` — the "didn't take linen" message is the actionable one.
- Cleaning that spills past midnight (e.g. 23:00 checkout + 3h) is compared correctly against a
  next-day early arrival (real datetime).
- Invalid/missing dates → `cleaningTurnoverConflict` returns false (never throws, no false alert).

---

## 4. Architecture

> **Fat backend, thin frontend.** The conflict comparison is pure date arithmetic and the caution is
> a straight display of existing reservation fields — both are presentational. No new server logic or
> endpoint is introduced; the Planning already loads full reservation details
> (`api.getReservation`) carrying `cautionAmount` / `cautionReceived`, and `properties.cleaningHours`.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | — | — | Caution / platform badges: **no server change** (`reservationsModel` already returns `cautionAmount`/`cautionReceived`; `properties.cleaningHours` exists). |
| `utils/` | `utils/bedLinenAdequacy.js` | C | Pure `computeBedLinenAlert({ reservation, options, bedLinenProvidedByDefault })` → `null` / `{type:'no_linen'}` / `{type:'capacity',capacity,required}` (rule 6). |
| `models/` | `models/reservationsModel.js` | T | `getByIdWithDetails` computes `bedLinenProvidedByDefault` (query `property_option_defaults`) + sets `reservation.bedLinenAlert` via the util. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `reservationConflicts.js` | T | New pure `cleaningTurnoverConflict({checkoutDate, checkoutTime, cleaningMinutes, arrivalDate, arrivalTime})` — datetime comparison `(checkout + cleaning) > arrival`. |
| `pages/` | `PlanningPage.js` | T | `detectAlerts` Type 2 (red) + Type 3 (blue) use `cleaningTurnoverConflict`; Type 3 scans for a genuinely-overlapping reservation. |
| `components/` | `ReservationCard.js` | T | « Caution à percevoir » badge; **platform badge** (rule 5); **bed-linen alert** badge (rule 6) rendering `reservation.bedLinenAlert` (warning chip + `WarningAmber` icon). |
| `constants/` | `platforms.js` | T | New `formatPlatformLabel(platform)` display helper (capitalises `direct`); reuses existing `getPlatformColor`. |
| `App.js` | `App.js` | T | Planning sidebar icon broom → `CalendarMonth` (a broom reads as pejorative for the cleaning role). |

**Component reuse declaration:** consumes existing primitives (MUI `Chip`/`Box`/icons) inside the
already-extracted `ReservationCard`. No new generic component; the caution badge mirrors the
in-card complement badge, and the platform badge reuses the shared `getPlatformColor` /
`formatPlatformLabel` from `constants/platforms.js`.

### 4.3 API contract

No API change.

---

## 5. Data model

No schema change. Uses existing `reservations.cautionAmount`, `reservations.cautionReceived`, and
`properties.cleaningHours`.

## 6. UI / UX

- **Complément badge:** **red** filled `Chip` (`color="error"`) + Euro icon (`error.main`) when unpaid;
  switches to green (`success`, outlined) once `complementPaid`. The most prominent money cue.
- **Caution badge:** **orange** filled `Chip` (`color="warning"`) + `ShieldOutlined` icon
  (`warning.main`), label `Caution à percevoir : {amount}€`, just below the complement block. Hidden
  when received or amount is 0.
- **Platform badge:** bordered `Box` (1.5px border, `borderRadius: 1`, transparent background, **14px
  bold**), border + text in the platform colour, to the right of the property name in the same flexWrap
  row (wraps under the name on `xs`). `whiteSpace: nowrap`, `flexShrink: 0`.
- **Alerts:** unchanged colours (red turnover, orange simultaneous, blue cross-logement) — only the
  red/blue detection is now datetime-correct.
- **Planning sidebar icon:** calendar instead of a broom.
- **Responsive:** badges sit in a `flexWrap` row; fine on `xs`/`md`/`lg`. No `PageActionBar` change
  (this is a card/list view, not a new page).

## 7. Test plan

### Server unit tests (node:test)
- [x] `tests/bed-linen-adequacy.unit.test.js` (rule 6) — linen-by-default → null; no option → `no_linen`;
      linen + beds cover guests → null; linen + insufficient beds → `capacity` with numbers; children in
      baby beds deducted; teens counted.

### Client unit tests (vitest)
- [x] `components/__tests__/ReservationCard.test.js` — bed-linen alert renders « Linge de lit non pris »
      / « Linge de lit insuffisant : … », nothing when `bedLinenAlert` is absent.
- [x] `utils/reservationConflicts.test.js` — `cleaningTurnoverConflict`: different-day same-time →
      false (8/07 vs 17/07); real same-day turnover → true; enough gap → false; past-midnight spill →
      true; invalid date → false; operator example 2h (OK) / 3h (alert).
- [x] `components/__tests__/ReservationCard.test.js` — caution badge shows when unpaid, hidden when
      received, hidden when amount is 0; **platform badge** shows the label in the platform colour,
      `direct` → `Direct`, hidden when no platform.
- [x] `constants/__tests__/platforms.test.js` — `formatPlatformLabel`: `direct` → `Direct`,
      canonical names unchanged, empty/nullish → ''.

### Manual UI verification
- [ ] Planning: a real same-day tight turnover shows red; a same-time checkout/arrival on different
      days no longer shows red.
- [ ] Planning: a reservation with an unpaid caution shows the red « Caution à percevoir » badge; it
      disappears once the caution is marked received.
- [ ] Planning: each arrival card shows the platform badge (bordered, transparent, platform-coloured)
      to the right of the property name; an Airbnb card is red-bordered, a direct one gold, etc.
- [ ] Planning: an arrival with no bed-linen option shows « Linge de lit non pris »; one whose beds
      don't cover the guests shows « Linge de lit insuffisant : … » ; a linen-by-default property shows
      neither.

## 8. Out of scope

- Computing the Planning alerts server-side (kept client-side for now).
- Marking the caution as received directly from the Planning card (done on the reservation page).
- Any change to how `cleaningHours` or `cautionAmount` are configured.

## 9. Open questions — resolved 2026-06-11

- Cleaning duration source → per-property `cleaningHours` (Paramètres), default 3h.
- Caution badge visibility → only when unpaid (amount > 0 and not received); red, with a shield icon.
