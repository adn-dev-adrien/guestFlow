# Site booking — full options/resources on devis + dashboard alert + email notifications

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/site-booking-notifications` _(user-managed)_ |
| **Created** | 2026-06-11 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

When a visitor submits a booking request from the public website (WordPress widget → public API
`/public/v1/booking-requests`), GuestFlow creates a **draft devis** flagged `requestOrigin='public'`
([publicBookingRequestController.js:97](../server/src/controllers/public/publicBookingRequestController.js#L97)).
Three problems / gaps:

1. **Options (and possibly resources) are dropped on the devis.** Root cause confirmed:
   `devisModel.computeQuote` pre-filters out **every** selected option that carries an
   `autoOptionType`, regardless of whether it is actually engine-managed
   ([devisModel.js:238-241](../server/src/models/devisModel.js#L238)):
   ```js
   .filter((line) => !optionMetaById.get(Number(line.optionId))?.autoOptionType);
   ```
   Options such as **Petit-déjeuner** (`autoOptionType='breakfast'`), **Linge de lits**
   (`bed_linen`), **Linge de toilette** (`bathroom_linen`) have an `autoOptionType` **but**
   `autoEnabled=0`. The pricing engine only auto-adds options with `autoEnabled=1`
   ([pricing.js:1104](../server/src/utils/pricing.js#L1104)), so these manually-selected options are
   **neither kept nor re-added → they vanish from the devis**. The engine's normal option path
   ([pricing.js:1002-1070](../server/src/utils/pricing.js#L1002)) prices them correctly if they reach
   it; only the `devisModel` pre-filter is at fault. Resources are **not** filtered
   ([devisModel.js:247-250](../server/src/models/devisModel.js#L247)) and persist correctly; a
   non-applicable resource is rejected up-front (422) rather than silently dropped.

2. **No signal that a site request arrived.** A public-origin devis lands in the list with no
   dashboard alert; Adrien has to notice it manually.

3. **No email on new bookings.** Neither a new site devis nor a new **iCal** reservation
   (Airbnb/Booking import) triggers any notification.

## 2. Goal

When a visitor books from the site, the devis carries **all** the options and resources they chose;
Adrien sees a **dashboard alert** for every pending site request and receives an **email** for it;
and he also receives an **email** whenever a new external **iCal** reservation is imported. Emails go
to the address configured in the SMTP settings.

## 3. Functional rules

1. A devis created from a public booking request must persist **every option the visitor selected**,
   including options that carry an `autoOptionType` but are **not** auto-enabled
   (`autoEnabled=0`) — e.g. breakfast, bed/bathroom linen.
2. Options that **are** engine-managed (`autoOptionType` **and** `autoEnabled=1`, i.e. early
   check-in / late check-out driven by the chosen times) must keep being added by the engine, **not**
   duplicated from the selected list. (No double-counting.)
3. All visitor-selected **resources** must persist on the devis (verify; no regression).
4. The fix lives in the shared `devisModel.computeQuote` filter, so it benefits **both** the public
   flow and the in-app admin flow consistently.
5. A new **dashboard alert** lists pending **site-origin** devis: rows with `requestOrigin='public'`,
   `kind='devis'`, `devisStatus='draft'`, and `convertedReservationId IS NULL`. It disappears once
   the devis is handled (status changed / converted / deleted). Clicking it navigates to the devis.
6. When a **new site devis** is created, send an **email** summarising the request (client, property,
   dates, guests, options, resources, total, reference) **plus a clickable link to the devis**.
7. When the iCal sync imports a **genuinely new** reservation (not an update/unchanged/locked one),
   send **one email per new reservation** summarising it (platform, property, dates, guest name)
   **plus a clickable link to the reservation**.
8. **Recipient & sender:** notifications are sent **from** the SMTP sender (`smtpFromEmail`) **to** a
   new configurable Settings field `notificationRecipientEmail`. If that field is empty, fall back to
   `smtpFromEmail` (send to self).
9. **Toggle:** notifications are gated by a new Settings switch `notificationsEnabled`, **ON by
   default**. When OFF, no notification email is sent (devis/reservation still created normally).
10. **Link:** the email link is built from a new Settings field `appPublicUrl` (the app's public base
    URL) + the in-app devis/reservation route. If `appPublicUrl` is empty, the email is sent
    **without** a link (details + reference only).
11. Notification emails must be **best-effort**: a failure (SMTP not configured, send error, toggle
    off) must **never** break the booking-request HTTP response nor the iCal sync. Failures are
    logged server-side only.
12. If SMTP is **not configured** (`smtpConfigured()` false) or the toggle is OFF, notifications are
    silently skipped.
13. **Property option defaults are enforced server-side** on every site devis (via
    `mergePropertyDefaultsIntoPayload`): each option configured as a default for the property is
    auto-added to the devis **even if the website did not send it**.
14. A **paid** default (`property_option_defaults.offered=0`) appears on the devis as a selected line
    **with its price**; an **offered** default (`offered=1`) appears selected **with total = 0** and
    the `offered` flag set on the line.
15. Rules 13–14 must hold **even when a default option carries an `autoOptionType` with
    `autoEnabled=0`** (e.g. linen/breakfast set as a default) — the Part 1 filter fix must not let the
    pre-filter drop a defaulted option. This is the cross-check between the bug fix and the existing
    defaults mechanism.
16. **Baby beds are couchage, not a supplement.** GuestFlow filters the "Lit bébé" resource out of
    the supplements list (it is modelled by the `reservations.babyBeds` couchage field). The public
    booking flow must therefore route the visitor's baby-bed count to the devis **`babyBeds` field**
    (so it shows in the operator's Couchage section), **not** as a `selectedResources` line (which
    would be persisted but hidden). The public API accepts `babyBeds` (non-negative integer, capped
    at the number of babies); the WordPress widget sends it as a count, not a resource.

**Edge cases:**
- Honeypot-tripped booking request → no devis, no email (unchanged behaviour).
- Visitor selects an early-check-in option *and* an early time → engine adds it once (rule 2); no
  duplicate.
- iCal sync that only updates/relocates existing reservations → **no** email (only `createdCount`
  rows trigger it).
- Same iCal reservation seen again on the next sync → **no** repeat email (we notify exactly the
  reservation ids created in *this* sync run, not a "created today" query).
- SMTP send throws mid-sync → the reservation is still imported; only the email is lost (logged).
- `notificationRecipientEmail` empty → send to `smtpFromEmail`. Both empty / SMTP unconfigured →
  skip silently.
- `appPublicUrl` empty → email sent without a link.
- `notificationsEnabled` OFF → devis/reservation created, no email.

---

## 4. Architecture

> **Fat backend, thin frontend.** All notification logic, recipient resolution, content building, and
> the devis filter fix live on the server. The client only renders the new alert payload.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `devisModel.js` | T | Part 1 fix: filter out only **engine-managed** auto-options (`autoOptionType && autoEnabled=1`); keep manually-selected non-auto options. Add `autoEnabled` to `optionMetaById`. This also un-breaks **property option defaults** that carry an `autoOptionType` (merged in by `mergePropertyDefaultsIntoPayload` then previously dropped). Defaults mechanism itself (paid → priced, offered → 0 via `offeredOptionIds`) is unchanged. |
| `models/` | `reservationsModel.js` | T | Add `listPendingPublicDevis()` → public-origin draft devis for the dashboard alert. |
| `models/` | `propertyIcalModel.js` | T | `syncSource` returns the list of `createdReservationIds`; `syncSourceAndRecord` fires the new-iCal notification for exactly those rows (best-effort, post-transaction). |
| `controllers/` | `public/publicBookingRequestController.js` | T | After the devis is created + marked `requestOrigin='public'`, fire the new-site-devis notification (best-effort). |
| `controllers/` | `dashboardController.js` | T | Add `publicDevisPending` handler returning `listPendingPublicDevis()`. |
| `routes/` | `dashboard.js` | T | Add `GET /api/dashboard/public-devis-pending`. |
| `utils/` | `notificationService.js` | C | New pure-ish service: `notifyNewSiteDevis(devisId)`, `notifyNewIcalReservation(reservationId)`. Reads settings (toggle, recipient, sender, app URL), builds the FR text + link, calls `createEmailService(...).send(...)`. Transport/settings injectable for tests. Honours the toggle; swallows + logs errors. |
| `utils/` | `emailService.js` | — | Reused as-is (`createEmailService`, `send`). |
| `models/` | `settingsModel.js` | T | Add read/write for `notificationsEnabled`, `notificationRecipientEmail`, `appPublicUrl` (non-secret → exposed in `read()`); expose a `notificationSettings()` helper. |
| `controllers/` | `settingsController.js` | T | Accept + validate the 3 new fields on update. |
| `routes/` | `settings.js` | T | Pass the 3 new fields through (thin). |
| `database.js` | `database.js` | T | Idempotent migration: add the 3 settings columns with defaults. |

**Notes:**
- The Part 1 fix is a ~3-line change in one shared function; covered by a unit test driving the real
  engine.
- `notificationService` must not import Express; it takes ids and reads its own data, so both the
  controller and the iCal model can call it.
- iCal emails are sent from `syncSourceAndRecord` (already async), **after** the better-sqlite3
  transaction commits — never `await` inside the transaction.
- The 3 new settings are **not secret** (no encryption) — plain columns, returned by `read()`.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `DevisPublicRequestAlert.js` | C | Dashboard alert card for pending site devis. Mirrors `EmailPendingAlert` (fetch on mount, render nothing while loading/empty, clickable → devis list). |
| `pages/` | `Dashboard.js` | T | Mount `<DevisPublicRequestAlert />` alongside the existing alert stack. |
| `pages/` | `SettingsPage.js` | T | New "Notifications" block: toggle (default on), recipient email field, app public URL field. |
| `api.js` | `api.js` | T | Add `getPendingPublicDevis()`; pass the 3 new settings fields through the settings update payload. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | the existing dashboard-alert pattern (`EmailPendingAlert`, `IcalNewReservationsAlert`) as the template; MUI `Alert`/card primitives already used there | Same visual language as the other dashboard alerts. |
| **Created (new generic)** | — | `DevisPublicRequestAlert` is feature-specific (queries public devis), consistent with the existing one-file-per-alert convention on the dashboard. |
| **Specific (kept feature-local)** | `DevisPublicRequestAlert` | Mirrors siblings; not generic by design (each alert owns its fetch + copy). |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/dashboard/public-devis-pending` | — | `[{ id, devisNumber, clientFullName, propertyName, startDate, endDate, finalPrice, createdAt }]` | Auth: same as other dashboard endpoints. Empty array → alert renders nothing. |
| GET | `/api/settings` | — | `{ ..., notificationsEnabled, notificationRecipientEmail, appPublicUrl }` | 3 new non-secret fields added to the existing settings payload. |
| PUT | `/api/settings` | `{ ..., notificationsEnabled, notificationRecipientEmail, appPublicUrl }` | updated settings | Validates email format (if provided) and URL format (if provided). |

No change to the public API contract. The booking-request response is unchanged (rule 11 — email is a
side effect).

---

## 5. Data model

**Reservations:** no change — all needed columns already exist (`requestOrigin`, `kind`,
`devisStatus`, `convertedReservationId`, `devisNumber`, `sourceType`, `sourcePlatformKey`,
`sourceIcalEventUid`, `createdAt`).

**Settings:** 3 new non-secret columns (idempotent migration in `database.js`):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `notificationsEnabled` | INTEGER (0\|1) | `1` (ON) | Master switch for the new booking notifications. |
| `notificationRecipientEmail` | TEXT | `''` | TO address for notifications; empty → falls back to `smtpFromEmail`. |
| `appPublicUrl` | TEXT | `''` | App public base URL for the email link; empty → no link. |

**Data impact:** the Part 1 filter change affects **how future devis/reservations are computed**, not
existing rows. The 3 settings columns are additive with safe defaults (notifications ON, recipient
falls back to the SMTP sender). No backfill, no loss.

## 6. UI / UX

**Dashboard — new alert (`DevisPublicRequestAlert`):**
- Placement: in the existing alert stack in `Dashboard.js` (near `EmailPendingAlert`).
- Visible only when ≥1 pending site devis exists; otherwise renders `null` (like its siblings).
- Copy (FR): title e.g. **« Demande(s) de devis depuis le site »**, line per item:
  `{clientFullName} — {propertyName}, du {startDate} au {endDate} · {finalPrice} €`.
  Whole card clickable → navigates to the devis (list filtered on site origin, or the devis detail).
- Severity: `info` (same as `EmailPendingAlert`).
- **Responsive:** inherits the dashboard alert styling (full-width stacked card); no table. Fine on
  `xs`/`md`/`lg` by construction (text wraps; ≥44px touch target on the clickable card).
- **PageActionBar:** not applicable — this is a dashboard widget, not a new page. The Dashboard page
  keeps its current header.

**Settings — new "Notifications" block (`SettingsPage.js`):**
- A switch **« Notifications de réservation par email »** (default ON) — `notificationsEnabled`.
- A text field **« Adresse de réception des notifications »** (email) — `notificationRecipientEmail`;
  helper: *« Si vide, l'expéditeur SMTP est utilisé. »*
- A text field **« URL publique de l'application »** (e.g. `https://guestflow.mondomaine.fr`) —
  `appPublicUrl`; helper: *« Utilisée pour le lien direct dans les emails. »*
- Fits the existing Paramètres layout (masonry desktop / stacked mobile) and the page's
  `PageActionBar` Save/Cancel flow — no new page-level actions.
- **Responsive:** standard MUI fields, full-width on `xs`, within the existing settings card grid.

**Emails (plain text, FR):**
- *New site devis* — subject e.g. `Nouvelle demande de devis #{devisNumber} — {propertyName}`; body
  lists client + contact, property, dates, guests, selected options, selected resources, total, the
  reference, and a **link to the devis** (`{appPublicUrl}{devisRoute}`) when `appPublicUrl` is set.
- *New iCal reservation* — subject e.g. `Nouvelle réservation {platform} — {propertyName}`; body
  lists platform, property, dates, guest name, and a **link to the reservation** when `appPublicUrl`
  is set.
- Sent **from** `smtpFromEmail`, **to** `notificationRecipientEmail` (or `smtpFromEmail` if empty).
- No HTML required (matches the existing `emailService.send({ to, subject, text })` contract).

## 7. Test plan

### Server unit tests
- [ ] `tests/public-devis-options-persist.unit.test.js` — booking-request/devis with breakfast +
      linen selected → both persist in `reservation_options`; an engine-managed early-check-in option
      is **not** duplicated (rules 1, 2). Resources persist (rule 3).
- [ ] `tests/public-booking-request-default-options.unit.test.js` — **drives the public
      booking-request flow** (real controller + real engine, in-memory DB; mirrors the existing
      `public-quote-progressive-participants` test style). Property is configured with default
      options: one **paid** default and one **offered** default (at least one carrying
      `autoOptionType` + `autoEnabled=0`). The visitor sends one extra paid option. Asserts the
      persisted `reservation_options` contains: the paid default **with price > 0**, the offered
      default **with totalPrice = 0 and offered = 1**, and the visitor's extra option — none dropped
      (rules 13–15, regression on the existing defaults mechanism).
- [ ] `tests/notification-service.unit.test.js` — `notifyNewSiteDevis` / `notifyNewIcalReservation`
      send **from** `smtpFromEmail` **to** `notificationRecipientEmail` (fallback to `smtpFromEmail`
      when empty) with the expected subject/body and a link built from `appPublicUrl` (omitted when
      empty), via an injected transport; **skip** when the toggle is OFF or SMTP unconfigured; never
      throw on send error (rules 6–12).
- [ ] `tests/dashboard-public-devis-pending.unit.test.js` — `listPendingPublicDevis()` returns only
      `requestOrigin='public'` draft, unconverted devis; excludes handled/converted/non-public
      (rule 5).
- [ ] `tests/property-ical-sync-*.unit.test.js` (extend) — `syncSource` returns
      `createdReservationIds` for new rows only; not for updated/unchanged/locked (rule 7, edge
      cases).
- [ ] `tests/settings-notifications.unit.test.js` — read/write of `notificationsEnabled`,
      `notificationRecipientEmail`, `appPublicUrl`; defaults (ON, '', '') on a fresh DB; email/URL
      validation on update.

### Manual UI verification
- [ ] Settings: the Notifications block shows the toggle (ON by default), recipient field, and app
      URL field; saving persists them.
- [ ] Happy path: submit a site booking with breakfast + linen + a resource → devis shows them all;
      dashboard shows the alert; an email arrives at the configured recipient with a working link.
- [ ] Defaults: on a property with a paid default option and an offered default option, submit a site
      booking → the devis auto-includes the paid default (with price) and the offered default (at
      0 €), in addition to what the visitor picked.
- [ ] iCal: import a new external reservation → email (with link) arrives; re-sync → no second email.
- [ ] Edge: recipient empty → email goes to the SMTP sender; app URL empty → email has no link;
      toggle OFF → no email but devis/alert still created.
- [ ] Edge: SMTP not configured → booking still creates the devis, no error, alert still shows.
- [ ] Regression: in-app devis/reservation creation still prices options correctly (no double-count
      of early/late check-in).

## 8. Out of scope

- Pre-filling the booking widget dates/guests on the lodging page (separate, earlier item).
- HTML/branded email templates (plain text only here).
- Push/SMS or any non-email channel.
- A separate "test notification" button in Settings (the existing SMTP test already covers SMTP).

## 9. Open questions — resolved 2026-06-11

- **Q1 — recipient.** → New Settings field `notificationRecipientEmail`; emails sent **from**
  `smtpFromEmail`. Empty recipient → fall back to `smtpFromEmail`.
- **Q2 — toggle.** → New Settings switch `notificationsEnabled`, **ON by default**.
- **Q3 — email link.** → **Include a link**; add a new Settings field `appPublicUrl` (app public base
  URL). Empty → email without link.
- **Q4 — dashboard alert scope.** → **Site devis only** (iCal keeps its existing alert + now an
  email).
- **Q5 — iCal email batching.** → **One email per new iCal reservation.**

---

## 10. Implementation progress (2026-06-11)

Implemented as specified, with one refinement: the email link **reuses the existing `publicUrl`
setting** (already present + shown in the SMTP section), so only **2** new settings columns were
added (`notificationsEnabled`, `notificationRecipientEmail`) instead of 3.

- **Server:** `devisModel` filter fix; `notificationService.js` (new); `publicBookingRequestController`
  fires the site-devis notification; `propertyIcalModel.syncSource` returns `createdReservationIds`
  and `syncSourceAndRecord` notifies per new iCal reservation (post-commit, fire-and-forget);
  `reservationsModel.listPendingPublicDevis`; `dashboardController.publicDevisPending` +
  `GET /api/dashboard/public-devis-pending`; settings model/response/controller + 2-column migration.
- **Client:** `DevisPublicRequestAlert` (mounted on the dashboard); `SettingsNotificationsSection`
  (mounted on the Paramètres page); `api.getPendingPublicDevis` + settings passthrough.
- **Tests:** server suite **1344 pass / 0 fail** (+~19 new): `public-devis-options-persist`,
  `public-booking-request-default-options`, `notification-service`, `dashboard-public-devis-pending`,
  `settings-notifications`, + `createdReservationIds` assertions in `property-ical-sync`. Client
  build green (Vite).
- **Manual UI verification:** pending — GuestFlow runs on the user's environment; the automated
  suite + client build cover the logic and compilation. To exercise end-to-end: submit a site
  booking with breakfast + linen, confirm the devis + dashboard alert + email, and import a new iCal
  reservation to confirm its email.

### Follow-up fixes (2026-06-11, from the user's first test)

- **Baby bed missing from the devis (rule 16).** The WordPress widget sent the baby bed as a
  hidden 0 € "Lit bébé" resource line, which GuestFlow filters out of the supplements list, while the
  `babyBeds` couchage field stayed 0 → the operator saw no baby bed. Fixed: `publicInputValidation`
  accepts `babyBeds` (capped at babies), `publicBookingRequestController` forwards it to the devis
  `babyBeds` field, and the widget now sends it as a count (no resource push). +2 server tests
  (+ public-input-validation shape test updated).
- **Unlabeled "Complément" toggle (adjacent UI fix, spec `force-item-to-complement.md`).** The
  per-line force-to-complement Switch in the reservation Suppléments section had only a tooltip +
  aria-label → it read as a bare switch. Added a visible **"Compl."** caption label to all four
  toggles (option / auto-option / custom option / resource) in `ExtrasSection.js`.
