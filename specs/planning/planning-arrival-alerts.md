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
7. **The cleaning alerts are computed by the server** (2026-10-27 spec review, F1–F4 — supersedes the
   client-side `detectAlerts`). `GET /api/planning/alerts?from&to` returns them ready to render (route removed 2026-10-28: the alerts now ride in `GET /api/planning/days`, dashboard-planning-scroll.md rules 8–10); the
   page only paints them. The client computation missed and invented alerts: it only saw the stays
   ARRIVING inside the loaded window, substituted `11:00` for real checkout times, and read a
   non-existent `cleaning` field (always 120 min) instead of `cleaningHours`.
8. **Real times, real cleaning hours, stays started before the window.** Every comparison uses the
   stay's own `checkInTime` / `checkOutTime` (defaults 15:00 / 10:00 only when empty) and each
   logement's `cleaningHours` (default 3 h). The server looks at the stays around the window (7 days on
   each side), so a guest already in the house who leaves the day the next guest arrives raises rule 1's
   red alert. Real reservations only — devis and cancelled stays never raise an alert.
9. **Simultaneous departures are departures** (amends rule 3). Two logements or more whose stays end on
   the same date at the same real checkout time raise the orange « Départs simultanés de plusieurs
   logements » on their **departure rows**. It is never raised on an arrival card.
10. **One alert per card, keyed by card kind.** The payload is `{ arrivals: { [reservationId]: alert },
    departures: { [reservationId]: alert } }`: an arrival card reads `arrivals`, a departure row reads
    `departures`. A stay's arrival card and departure row used to share the same alert (the departing
    guest's arrival card painted with the next arrival's turnover). Priority on a card: red (turnover)
    over blue (rule 2) on an arrival, red over orange (rule 9) on a departure. Rule 2's blue alert needs
    the other logement's checkout at or before the arrival and its cleaning still running at the arrival
    time.
11. **Durations in hours and minutes, the property's own times** (adversarial review of the 2026-10-27
    fixes). The cleaning duration of an explanation reads « 1h30 », « 2h15 », « 3h » (a 1.5 h cleaning
    read « 1h5 »). A stay without its own `checkInTime` / `checkOutTime` takes its logement's
    `defaultCheckIn` / `defaultCheckOut`, and only then 15:00 / 10:00 (amends rule 8: it fell back to
    15:00 / 10:00 straight away, hiding a turnover on a logement whose default checkout is 12:00).

**Edge cases:**
- `bedLinenAlert`: a reservation whose beds were coerced to 0 (no linen option) surfaces `no_linen`,
  not `capacity` — the "didn't take linen" message is the actionable one.
- Cleaning that spills past midnight (e.g. 23:00 checkout + 3h) is compared correctly against a
  next-day early arrival (real datetime).
- Invalid/missing dates or times → the stay is left out of the comparison (never throws, no false alert).

---

## 4. Architecture

> **Fat backend, thin frontend.** The caution and platform badges are a straight display of existing
> reservation fields. The cleaning alerts are business rules and live on the server since the
> 2026-10-27 spec review (rules 7–10): the page asks `GET /api/planning/alerts` and paints the answer (superseded 2026-10-28 by `GET /api/planning/days`, dashboard-planning-scroll.md rule 10).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | — | — | Caution / platform badges: **no server change** (`reservationsModel` already returns `cautionAmount`/`cautionReceived`; `properties.cleaningHours` exists). |
| `utils/` | `utils/bedLinenAdequacy.js` | C | Pure `computeBedLinenAlert({ reservation, options, bedLinenProvidedByDefault })` → `null` / `{type:'no_linen'}` / `{type:'capacity',capacity,required}` (rule 6). |
| `models/` | `models/reservationsModel.js` | T | `getByIdWithDetails` computes `bedLinenProvidedByDefault` (query `property_option_defaults`) + sets `reservation.bedLinenAlert` via the util. |
| `utils/` | `utils/planningArrivalAlerts.js` | C | Pure `computePlanningAlerts({ stays, cleaningHoursByProperty, propertyTimes, from, to })` → `{ arrivals, departures }` (rules 1–3, 7–11), `cleaningLabel` (rule 11). (2026-10-27) |
| `models/` | `models/planningAlertsModel.js` | C | `alertsInRange({ from, to })`: loads the real stays of `[from − 7 d, to + 7 d]` with their client names and every logement's `cleaningHours` and default check-in / check-out (rule 11), hands them to the util. (2026-10-27) |
| `controllers/` | `controllers/planningController.js` | T | `alerts` handler: validates `from`/`to` (400 `INVALID_DATE_RANGE`). (2026-10-27) |
| `routes/` | `routes/planning.js` | T | `GET /alerts`. Reception reads it through the existing `GET /planning/*` allowlist entry. (2026-10-27) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `reservationConflicts.js` | T | `cleaningTurnoverConflict` removed on 2026-10-27 — the comparison moved to the server (rule 7). |
| `services` | `api.js` | T | `getPlanningAlerts({ from, to })`. (2026-10-27) |
| `pages/` | `PlanningPage.jsx` | T | `detectAlerts` and the properties load removed (2026-10-27): the page loads `getPlanningAlerts` with each window (merged on the infinite scroll) and passes `alerts.arrivals[id]` to `ReservationCard`, `alerts.departures[id]` to `DepartureMiniRow` (rule 10). |
| `components/` | `ReservationCard.js` | T | « Caution à percevoir » badge; **platform badge** (rule 5); **bed-linen alert** badge (rule 6) rendering `reservation.bedLinenAlert` (warning chip + `WarningAmber` icon). |
| `constants/` | `platforms.js` | T | New `formatPlatformLabel(platform)` display helper (capitalises `direct`); reuses existing `getPlatformColor`. |
| `App.js` | `App.js` | T | Planning sidebar icon broom → `CalendarMonth` (a broom reads as pejorative for the cleaning role). |

**Component reuse declaration:** consumes existing primitives (MUI `Chip`/`Box`/icons) inside the
already-extracted `ReservationCard`. No new generic component; the caution badge mirrors the
in-card complement badge, and the platform badge reuses the shared `getPlatformColor` /
`formatPlatformLabel` from `constants/platforms.js`.

### 4.3 API contract

`GET /api/planning/alerts?from=YYYY-MM-DD&to=YYYY-MM-DD` (2026-10-27, admin + reception; **removed 2026-10-28**, same payload under `alerts` in `GET /api/planning/days`, dashboard-planning-scroll.md rule 10) →

```json
{ "arrivals":   { "2": { "type": "red", "explanation": "Marie Durand part le 29/10/2026 à 10:00, ménage: 4h" },
                  "5": { "type": "blue", "explanation": "Arrivée pendant nettoyage d'un autre logement" } },
  "departures": { "1": { "type": "red", "explanation": "Arrivée de Jean Fontaine 29/10/2026 à 13:00, ménage: 4h", "cleaningDisplay": "4h" },
                  "3": { "type": "orange", "explanation": "Départs simultanés de plusieurs logements" } } }
```

Only cards whose date (arrival `startDate`, departure `endDate`) falls in `[from, to]` are keyed. A
missing or malformed range, or `from > to` → 400 `INVALID_DATE_RANGE`.

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
- [x] `tests/planning-arrival-alerts.unit.test.js` (7, rules 1–3 and 7–10, 2026-10-27) — guest already in
      the house before the window still raises the red turnover (F1); two 10:00 departures of two
      logements raise « Départs simultanés » on both departure rows, an 11:00 one does not (F2); no
      blue alert when the other logements are clean at the arrival, blue when one is still being
      cleaned (F3); each alert on its own card kind (F4); exact fit / overrun / days apart; half hours
      « 1h30 » (rule 11; it pinned « 1h5 » before), cancelled stays ignored, iCal summary as the name.
- [x] `tests/planning-alerts-times-and-cleaning-label.unit.test.js` (5, rule 11, adversarial review of the
      2026-10-27 fixes) — « 1h30 » / « 2h15 » / « 3h »; a timeless stay takes its property's 12:00 / 14:00
      and raises the turnover the 10:00 / 15:00 fallback hid; the model passes the defaults. Failed before.

### Client unit tests (vitest)
- [x] `components/__tests__/ReservationCard.test.js` — bed-linen alert renders « Linge de lit non pris »
      / « Linge de lit insuffisant : … », nothing when `bedLinenAlert` is absent.
- [x] `pages/__tests__/PlanningPage.arrival-alerts.test.jsx` (1, rule 10, 2026-10-27) — the arrival card
      shows the `arrivals` alert of its stay and the departure row the `departures` one, each once.
      (The `cleaningTurnoverConflict` cases of `utils/reservationConflicts.test.js` moved to the server
      suite with the comparison.)
- [x] `components/__tests__/ReservationCard.test.js` — caution badge shows when unpaid, hidden when
      received, hidden when amount is 0; **platform badge** shows the label in the platform colour,
      `direct` → `Direct`, hidden when no platform.
- [x] `constants/__tests__/platforms.test.js` — `formatPlatformLabel`: `direct` → `Direct`,
      canonical names unchanged, empty/nullish → ''.

### Manual UI verification
- [x] Planning (2026-10-27, 390 / 900 / 1280 px, admin and reception): a guest in the house since
      25/10 leaving 29/10 10:00 and a 13:00 arrival on a 4 h logement → red on the arrival card
      (« … part le 29/10/2026 à 10:00, ménage: 4h ») and on the departure row only; two 10:00
      departures → orange on both departure rows; a 11:00 arrival while the tent (2 h) is cleaned → blue.
- [ ] Planning: a reservation with an unpaid caution shows the red « Caution à percevoir » badge; it
      disappears once the caution is marked received.
- [ ] Planning: each arrival card shows the platform badge (bordered, transparent, platform-coloured)
      to the right of the property name; an Airbnb card is red-bordered, a direct one gold, etc.
- [ ] Planning: an arrival with no bed-linen option shows « Linge de lit non pris »; one whose beds
      don't cover the guests shows « Linge de lit insuffisant : … » ; a linen-by-default property shows
      neither.

## 8. Out of scope

- Marking the caution as received directly from the Planning card (done on the reservation page).
- Any change to how `cleaningHours` or `cautionAmount` are configured.

## 9. Open questions — resolved 2026-06-11

- Cleaning duration source → per-property `cleaningHours` (Paramètres), default 3h.
- Caution badge visibility → only when unpaid (amount > 0 and not received); red, with a shield icon.
