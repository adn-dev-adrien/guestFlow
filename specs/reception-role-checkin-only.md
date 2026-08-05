# Reception role (check-in / check-out only, no financials)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reception-role-checkin-only` _(user-managed)_ |
| **Created** | 2026-07-22 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

GuestFlow has a fully-built multi-role system (specs/admin-account-management.md): roles live in the
`user_roles` join table, the server source of truth is `server/src/constants/roles.js`
(`admin`, `accountant`), mirrored client-side in `client/src/constants/roles.js`. Enforcement is
centralized:

- **Server:** a global `requireAuth` → `enforceRoleAccess` chain guards every `/api/*` route
  ([server/src/middleware/enforceRoleAccess.js](server/src/middleware/enforceRoleAccess.js)).
  Today it is hard-coded: `admin` = unrestricted, `accountant` = read-only accounting + self
  endpoints, **any other role → fail-closed 403**.
- **Client:** `ROUTE_ROLES` + `canSeeRoute` filter the sidebar
  ([client/src/constants/roles.js](client/src/constants/roles.js#L36)); an
  `AccountantConfinement` redirect in [client/src/App.js](client/src/App.js#L694) confines
  non-admins client-side. Routes themselves are **not** individually guarded — hiding a sidebar
  entry is cosmetic; the real enforcement is the server 403 + the confinement redirect.

Adrien wants a collaborator who can **welcome guests on-site** (run the arrival / departure
check-in) **without ever seeing any financial data** (revenue, deposit, balance, total price,
accounting). Both operational surfaces this person needs — the **home page** (today
[client/src/pages/Dashboard.js](client/src/pages/Dashboard.js), route `/`) and the **Planning**
([client/src/pages/PlanningPage.js](client/src/pages/PlanningPage.js), route `/planning`, host of
the SAS wizard) — currently **leak financial data**:

- The Dashboard arrivals/departures tables show a **Paiements** column (remaining due, deposit,
  balance) and a caution column ([Dashboard.js:54-56](client/src/pages/Dashboard.js#L54)).
- Both pages fetch reservations via `GET /reservations` + `GET /reservations/:id`, whose payloads
  carry the **full finance** (`totalPrice`, `depositAmount/Paid`, `balanceAmount/Paid`,
  `remainingDue`, platform commission, tourist tax, contributions…).

So a genuine restriction needs a new role **plus** a server-side finance-stripped reservation view
(fat backend), not just UI hiding.

## 2. Goal

Adrien can create an **« Accueil »** account (new role `reception`) that logs in to a
**finance-free home page listing only the day's arrivals and departures** and to the **Planning**,
where the person runs the full **arrival / departure SAS** (collecting caution + complement at the
door). That account can **never** reach clients, reservations sheets, finance, accounting, devis,
emails, settings, or any monetary figure beyond *the caution and complement to collect at check-in
/ check-out* — enforced on the server, not just hidden in the UI.

## 3. Functional rules

### 3.1 The role

1. A third role **`reception`** (French label **« Accueil »**) joins `admin` and `accountant` in
   `server/src/constants/roles.js` (source of truth) and its client mirror. It is assignable from
   the existing admin **Gestion des comptes** UI (`AccountFormDialog` role multi-select) exactly
   like the other roles — no new account-management UI. A user MAY hold `reception` alone or
   combined with others; **when combined with `admin`, admin wins** (unrestricted), consistent with
   the existing `userHasRole` precedence.
2. A **reception-only** user (holds `reception`, not `admin`) is confined — server and client — to
   exactly this surface:
   - **`/`** — the finance-free home (arrivals / departures of the day).
   - **`/planning`** — the full Planning + the arrival / departure SAS (incl. the
     `?sas=…&reservationId=…` deep-links).
   - **`/account`** — self-service only (« Mes informations » + « Mon mot de passe »); the admin
     « Gestion des comptes » section stays hidden (it is already `admin`-gated).
   Every other route → **client redirect to `/`** and, for any disallowed API call, **server 403
   `FORBIDDEN_ROLE`**.

### 3.2 What « no financial information » means here (scope of the money guard)

3. **Shown to reception** (operational money to collect at the door — the whole point of the SAS):
   - **Caution à percevoir / à rendre** (`cautionAmount` + received/returned markers).
   - **Complément à percevoir** (arrival `complementAmount` + `complementPaid`, and the departure
     `endOfStayComplementAmount`), with the SAS line-by-line detail and the settlement buttons
     (CB/Chèque, liquide, en fin de séjour) — these already exist on the SAS recap.
4. **Never shown / never sent to reception** (stripped server-side, rule 8):
   - `totalPrice` / `customPrice` / accommodation price / nightly breakdown, `discountPercent`.
   - `depositAmount` / `depositAmountOverride` / `depositPaid` / `balanceAmount` / `balancePaid` /
     `remainingDue` / `paymentComplete`.
   - Tourist tax figures, platform **commission**, revenue, contributions (`contribs`), and any
     accounting field.
   - Client **contact PII** (email, phone, address) — the reception sees the guest **display name
     only** (needed to greet them), never the client fiche.

### 3.3 Home page for reception (`/`)

5. When the logged-in user is **reception-only**, route `/` renders a **reduced Dashboard**:
   - **Only** two sections: **Arrivées — {date}** and **Départs — {date}**, plus the existing date
     navigator (previous / today / next day).
   - Each row shows: guest **display name**, **logement**, **plateforme** badge, **heure**
     d'arrivée/départ, **nombre de personnes**, **options/ressources** réservées, the **caution**
     and **complément à percevoir** indicators (rule 3), and the operational **statut** toggles
     (« Prêt » / « Arrivé » for arrivals, « Parti » for departures — `checkInReady`, `checkInDone`,
     `checkOutDone`).
   - **Removed for reception:** the **Paiements** column and any deposit/balance/remaining-due
     figure (rule 4); the **KPI tiles**; the admin **alert banners** (linen shortage, iCal
     drift / cancellation / new-imports, pending emails, pending public devis — all admin
     workflows); the month **occupancy calendar**. The page is *just* the two lists.
   - **Row action:** tapping an arrival (resp. departure) row navigates to
     `/planning?sas=arrival&reservationId=:id` (resp. `sas=departure`) — i.e. it **opens the SAS
     on the Planning** via the existing deep-link, instead of opening the (forbidden) reservation
     sheet.
6. The admin / accountant home page is **unchanged** (full Dashboard). Only the reception-only
   branch is reduced.

### 3.4 Planning for reception (`/planning`)

7. Reception gets the **full Planning** (arrivals `ReservationCard`, departures `DepartureMiniRow`,
   plus the housekeeping cards: laundry / breakfast / linen inventory / option & resource cards —
   all operational, no money). The **only** page render changes for reception:
   - The **client-name link** on cards (→ `/clients?clientId=…`) and the SAS **« Ouvrir la fiche »**
     link (→ the reservation sheet) are **disabled** (reception has no client/reservation access) —
     the name renders as **plain text**.
   - `ReservationCard` already renders only **« Caution à percevoir »** + **« Complément à
     percevoir »** and no other money ([ReservationCard.js:347,364](client/src/components/ReservationCard.js#L347)),
     so no financial figure needs hiding on the cards themselves.
8. Reception runs the **arrival and departure SAS end-to-end** (all steps, incl. caution, complement
   line items, settlement buttons) and commits, exactly like an admin. The SAS payload
   (`GET /reservations/:id/sas`) is already finance-free (caution / options / cleaning price /
   complement / repair prices) — it is served to reception unchanged.
   **Narrowed 2026-08-04 by [reception-sas-lock-after-commit.md](reception-sas-lock-after-commit.md):**
   only a SAS that has **never been committed**. Once `arrivalSasDoneAt` (resp. `departureSasDoneAt`)
   is set, the planning ✓ is disabled for reception and the commit endpoint answers **403
   `SAS_ALREADY_COMMITTED`** — the re-edit of [reopen-completed-sas.md](reopen-completed-sas.md)
   stays admin-only.
9. Completing a SAS still validates the status flags per specs/arrival-departure-sas.md §3.6
   (arrival → `checkInReady=1` + `checkInDone=1`; departure → `checkOutDone=1`). Reception commits
   set them identically.

### 3.5 Status toggles (check-in / check-out)

10. Reception may flip the **operational status flags** (`checkInReady`, `checkInDone`,
    `checkOutDone`) from the home page and the Planning — these hit
    `PATCH /reservations/:id/payment` (the existing `markPayment`). For a **reception-only**
    requester, the server accepts **only** those three fields and **ignores every financial field**
    in the same payload (`depositPaid`, `balancePaid`, `complementPaid`, `caution*`, amounts…) —
    fail-closed, asserted by a unit test. (No new endpoint; a field allowlist in the controller.)

### 3.6 Server enforcement (authoritative)

11. `enforceRoleAccess` gains a **`reception` branch** with an explicit method+path allowlist. A
    reception-only user may reach **only**:
    - the shared **self endpoints** (`/auth/me`, `/auth/logout`, `/auth/change-password`,
      `/users/me`, `/users/me/email-status`, `/version`) — already the `SELF_ENDPOINTS` set;
    - **reservations, finance-stripped:** `GET /reservations`, `GET /reservations/:id`,
      `GET /reservations/:id/sas`, `GET /reservations/:id/weather-alerts`,
      `POST /reservations/:id/sas/arrival`, `POST /reservations/:id/sas/departure`,
      `PATCH /reservations/:id/payment` (field-guarded, rule 10);
    - **property list, pricing-stripped:** `GET /properties`;
    - **housekeeping (Planning) reads + their done/skip writes:** `GET /planning/*` and
      `POST /planning/option-cards/done`, `POST /planning/resource-cards/done`;
      `GET`/`POST`/`DELETE /laundry/*` (skips + manual additions);
      `GET /resource-bookings` (planning events).
    Anything else (clients, devis, finance, accounting, settings, emails, `POST`/`PUT`/`DELETE`
    reservations, `GET /reservations/:id/history`, `GET /reservations/search`, …) → **403
    `FORBIDDEN_ROLE`**. Fail-closed. A unit test **pins the exact reachable set** (drift guard, like
    the accountant scope test).
12. **Finance stripping (fat backend).** For a **reception-only** requester, `GET /reservations`
    and `GET /reservations/:id` return a **reception view** (whitelist of operational fields,
    rules 3–4) produced by a pure `utils/receptionView.js` serializer; `GET /properties` returns a
    **reception property view** (id, name, photo, non-financial config only). Admin / accountant
    payloads are **untouched**. The stripping is keyed on
    `userHasRole(req.user, RECEPTION) && !userHasRole(req.user, ADMIN)`.

**Edge cases:**
- **reception + admin** on the same account → admin wins: full payloads, full nav, no stripping,
  no confinement (rule 1).
- **reception + accountant** (no admin) → union of the two allowlists is **not** granted; the
  server evaluates each branch, so the user can reach reception's operational surface **and** the
  accountant's read-only accounting. UI: the sidebar shows the union (Tableau de bord + Planning +
  Comptabilité + Gestion utilisateur). (Documented, low-priority combo; the money guard on
  reservations still strips because the user is not admin — but accounting stays visible via the
  accountant branch. Acceptable: the two roles were explicitly assigned.)
- Reception types `/finance` (or any forbidden path) in the URL bar → client confinement redirects
  to `/`; had they crafted an API call, the server 403s.
- Reception opens a SAS, taps a step that fires `GET /reservations/:id/weather-alerts` → allowed;
  the call degrades to an empty list on any failure (existing behaviour).
- Housekeeping summary endpoints 403 would break nothing (the Planning wraps them in `.catch`
  fallbacks) — but they are allowlisted so the cards populate normally.
- A reception-only user reaches `/account` → sees « Mes informations » + « Mon mot de passe »
  only; `listUsers` is not called (already `admin`-gated in `UserManagementPage`).

---

## 4. Architecture

> **Fat backend, thin frontend.** The role taxonomy, the API allowlist, the finance stripping, and
> the status-field guard all live server-side. The client only (a) hides nav it can't reach,
> (b) redirects a confined user, and (c) renders the finance-free home layout. No money logic on
> the client.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `constants/` | `constants/roles.js` | T | Add `RECEPTION = 'reception'` to the `ROLES` frozen list + `userHasRole` unchanged. Source of truth (client mirrors it; the cross-side snapshot test now covers 3 roles). |
| `middleware/` | `middleware/enforceRoleAccess.js` | T | New `reception` branch: an explicit `{method, matcher}` allowlist (rule 11). Reuses `SELF_ENDPOINTS`. Exports the reception matchers on `__test` for the drift-pinning test. |
| `utils/` | `utils/receptionView.js` | C | Pure serializers: `toReceptionReservationView(res)` (whitelist operational fields, drop all finance + client PII per rules 3–4) and `toReceptionPropertyView(prop)` (id, name, photo, non-financial fields). Unit-tested. |
| `controllers/` | `controllers/reservationsController.js` | T | `list` + `getById`: when requester is reception-only, map the payload through `toReceptionReservationView`. `updatePayment`: when reception-only, restrict the writable set to `{checkInReady, checkInDone, checkOutDone}` (ignore/skip every financial field). |
| `controllers/` | `controllers/propertiesController.js` | T | `list`: when reception-only, map through `toReceptionPropertyView`. |
| `models/` | — | — | No schema/model change — `user_roles` already stores arbitrary role strings; the reception view reads existing columns. |
| `database.js` | — | — | **No migration.** `reception` is just a new value in the existing `user_roles.role` column. |
| `tests/` | `tests/reception-role-access.unit.test.js` | C | Pins the reception reachable set (every allowed method+path passes; a representative sample of forbidden ones 403); reception+admin → unrestricted; reception+accountant → union of branches. |
| `tests/` | `tests/reception-view.unit.test.js` | C | `toReceptionReservationView` keeps caution/complement + operational fields and **drops** deposit/balance/total/remainingDue/commission/tourist-tax/contribs/client-PII; `toReceptionPropertyView` drops pricing. |
| `tests/` | `tests/reservations-controller.unit.test.js` (or the payment test file) | T | `updatePayment` as reception writes only the 3 status flags; a payload also carrying `depositPaid`/`balancePaid` leaves those untouched (field guard). `list`/`getById` strip for reception-only, full for admin. |
| `tests/` | `tests/roles.unit.test.js` (cross-side snapshot) | T | Extended to assert the 3-role taxonomy stays in sync between server + client. |

**Notes:**
- No new dependency.
- The allowlist matchers use anchored regexes (`^/reservations/\d+/sas$`, …) so `:id` params match
  but sibling paths (`/history`, `/search`) don't.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `constants/` | `constants/roles.js` | T | Add `RECEPTION` + `ROLE_LABELS[RECEPTION] = 'Accueil'`; extend `ROUTE_ROLES`: `'/'` → `[ADMIN, RECEPTION]`, `'/planning'` → `[ADMIN, RECEPTION]`, `'/account'` → `[ADMIN, ACCOUNTANT, RECEPTION]`. `canSeeRoute` unchanged. |
| `App.js` | `App.js` | T | Generalize `AccountantConfinement` → **`RoleConfinement`**: a non-admin user whose current path isn't in their allowed set is redirected to their **home** (`accountant → /comptabilite`, `reception → /`). Accountant behaviour preserved verbatim. Reception's allowed paths = `/`, `/planning`, `/account`. |
| `pages/` | `pages/Dashboard.js` | T | Reception-only branch (`const isReceptionOnly = userHasRole(user, RECEPTION) && !userHasRole(user, ADMIN)`): render only the Arrivées / Départs lists + date nav; drop the Paiements column, KPI tiles, alert banners, month calendar; row click → `/planning?sas=…&reservationId=…`. Uses `useAuth()`. |
| `components/` | `components/ReservationCard.js` | T | Accept `canOpenClientFiche` / `canOpenReservation` (default `true`); when false, render the client name as plain text and hide the fiche link. Caution/complement unchanged. |
| `components/` | `components/DepartureMiniRow.js` | T | Same `canOpen*` gating for the departure row. |
| `components/sas/` | `components/sas/ReservationSasDialog.js` | T | Accept `canOpenReservation` / `canOpenClientFiche` (default `true`); hide « Ouvrir la fiche » + the client-name link when false. |
| `pages/` | `pages/PlanningPage.js` | T | Compute `receptionMode = userHasRole(user, RECEPTION) && !userHasRole(user, ADMIN)`; pass `canOpenClientFiche={!receptionMode}` / `canOpenReservation={!receptionMode}` to the cards + SAS dialog. Data-loading path unchanged (server strips the payloads). |
| `api.js` | — | — | No new methods — reception reuses `getReservations` / `getReservation` / `getProperties` (server-stripped) + the existing SAS + planning methods. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `ResponsiveTable`, `LoadingState`, `ErrorAlert` | Reused as-is in the reduced Dashboard. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `Dashboard` reception branch, `ReservationSasDialog` prop gating | The reduced home is a conditional branch of the existing Dashboard (same date-nav + list scaffolding), not a new page — avoids duplicating the arrivals/departures rendering. |

### 4.3 API contract

No new endpoints. Behavioural changes, gated on **reception-only** requester:

| Method | Endpoint | Change for reception-only | Notes |
|---|---|---|---|
| GET | `/api/reservations` | Response items → `toReceptionReservationView` (finance + client-PII stripped). | Admin/accountant unchanged. |
| GET | `/api/reservations/:id` | Response → `toReceptionReservationView`. | |
| GET | `/api/reservations/:id/sas` | Unchanged (already finance-free). | Allowlisted. |
| POST | `/api/reservations/:id/sas/arrival`\|`/departure` | Unchanged. | Allowlisted (SAS commit). |
| PATCH | `/api/reservations/:id/payment` | Writable set restricted to `{checkInReady, checkInDone, checkOutDone}`; financial fields ignored. | Field guard, rule 10. |
| GET | `/api/properties` | Response → `toReceptionPropertyView` (pricing stripped). | |
| GET | `/api/planning/*`, `/api/laundry/*`, `/api/resource-bookings` | Allowed (housekeeping, no money). | |
| POST | `/api/planning/option-cards/done`, `/resource-cards/done`; laundry skip/additions | Allowed. | |
| * | everything else under `/api/*` | **403 `FORBIDDEN_ROLE`**. | clients, devis, finance, accounting, settings, emails, reservation create/update/delete, history, search. |

Error shape unchanged: `{ error: 'FORBIDDEN_ROLE' }`.

---

## 5. Data model

**No schema change.** `reception` is a new value stored in the existing
`user_roles(userId, role)` table; assigned/removed through the existing admin account UI. No column
added, no migration, no backfill.

**Data impact:** none. Existing users keep their roles. The role only *widens* what
`enforceRoleAccess` permits for accounts that are explicitly granted `reception`.

## 6. UI / UX

### 6.1 Reception home (`/`, reception-only)

- **PageActionBar:** `title="Tableau de bord"`, no `backTo`, no Save/Cancel, no actions (read-only
  overview). Keep the date navigator (prev / today / next) as the existing inline control.
- **Layout:** two stacked sections — **Arrivées — {date}** then **Départs — {date}** — each a
  `ResponsiveTable`. Columns (md+): Client (name, plain text) · Logement · Plateforme (badge) ·
  Heure · Personnes · Options/Ressources · Caution/Complément à percevoir · Statut (toggle
  chips/checkboxes). **No Paiements column.** On `xs`: `ResponsiveTable` collapses to stacked cards
  (existing behaviour). Empty state per list: *« Aucune arrivée / Aucun départ ce jour. »*
- **Interaction:** row tap → navigates to `/planning?sas=arrival|departure&reservationId=:id`
  (opens the SAS on the Planning). Status toggles flip in place (optimistic), same handlers as
  today but calling the field-guarded endpoint.
- **Copy:** French, reuse existing labels (« Prêt », « Arrivé », « Parti », « Caution à percevoir »,
  « Complément à percevoir »).
- **Responsive:** identical breakpoints to today's Dashboard tables (table → cards on `xs`),
  minus the dropped sections; touch targets ≥ 44 px for the status toggles and rows.

### 6.2 Reception Planning (`/planning`)

- Visually identical to the admin Planning **except**: client names are plain text (no link), and
  the SAS header shows no « Ouvrir la fiche ». Everything else (arrival/departure cards, SAS launch
  buttons, housekeeping cards, caution/complement) renders as usual. `fullScreen` SAS on `xs`
  unchanged.

### 6.3 Sidebar (reception-only)

- Shows: **Tableau de bord**, **Planning**, and (under the **Paramètres** parent, which survives
  because `/account` is visible) **Gestion utilisateur**. The Paramètres parent becomes a
  non-navigating toggle (existing behaviour when the parent's own path is unreachable). No Finance,
  Devis, Emails, Calendrier, or other Paramètres children.

### 6.4 Account creation (admin, unchanged UI)

- The `AccountFormDialog` role multi-select now lists three options: **Admin**, **Comptable**,
  **Accueil**. Assigning **Accueil** alone produces a reception-only account.

## 7. Test plan

### Server unit tests
- [x] `tests/reception-role-access.unit.test.js` — every allowlisted method+path passes; a sample
      of forbidden paths (`GET /clients`, `GET /finance/…`, `GET /reservations/1/history`,
      `POST /reservations`, `PUT /settings`, `GET /accounting/…`) → 403; reception+admin →
      unrestricted; reception+accountant → both branches reachable; unknown role → 403 (fail-closed
      unchanged).
- [x] `tests/reception-view.unit.test.js` — `toReceptionReservationView` keeps
      `{clientDisplayName, propertyName/Id, dates, times, guest counts, options, resources,
      bedLinenAlert, cautionAmount, cautionReceived/Returned, complementAmount, complementPaid,
      endOfStayComplementAmount, checkInReady/Done, checkOutDone, arrival/departureSasDoneAt,
      platform}` and **drops** `{totalPrice, customPrice, depositAmount/Paid, balanceAmount/Paid,
      remainingDue, paymentComplete, discountPercent, touristTax, commission, contribs, client
      email/phone/address}`; `toReceptionPropertyView` drops pricing fields.
- [x] `tests/reception-view.unit.test.js` — the `PATCH /reservations/:id/payment` field guard is a
      pure helper `toReceptionPaymentPatch(body)` (used by `updatePayment`): it keeps only
      `{checkInReady, checkInDone, checkOutDone}` and drops `depositPaid`/`balancePaid`/
      `complementPaid`/`caution*`/amounts. (Chosen over a full DB controller test — the controller
      imports the singleton `db`/`model`, so the guard was extracted to a unit-testable pure fn; the
      `list`/`getById` stripping is the same `toReceptionReservationView` covered above, wired behind
      `isReceptionOnly(req)`.)
- [x] `client/src/constants/__tests__/roles.test.js` (extended) — the client roles taxonomy is the
      cross-side drift guard (server `constants/roles.js` mirrored here): `ROLES` = 3 entries,
      `ROLE_LABELS[reception] === 'Accueil'`, and `canSeeRoute` pins the reception scope to
      `/`, `/planning`, `/account` only.

### Client unit tests (vitest)
- [x] `constants/__tests__/roles.test.js` (extended) — `canSeeRoute` admits reception on
      `/`, `/planning`, `/account` **only**; reception denied `/finance`, `/clients`,
      `/comptabilite`, `/settings`, `/devis`, `/emails`, `/calendar`; admin+reception → admin scope.
- [x] `pages/__tests__/Dashboard.test.js` (extended) — reception-only renders the arrivals list,
      keeps the Caution column, drops the Paiements column / KPI tiles / month calendar; a row click
      routes to `/planning?sas=arrival&reservationId=…`; admin renders the full Dashboard.
- [x] `components/sas/__tests__/ReservationSasDialog.test.js` (extended) — with
      `canOpenReservation={false}` the header « Fiche » link is absent; default keeps it.
- [x] `components/__tests__/ReservationCard.test.js` / `DepartureMiniRow.test.js` — the cards are
      unchanged; PlanningPage passes `undefined` open-handlers for reception, and the existing
      "open handlers omitted → read-only, plain-text client name" cases already pin that behaviour.

### E2E (Playwright)
- [x] `reception/role-confinement.spec.js` — **delivered 2026-08-05** (with
      [reception-sas-today-only.md](reception-sas-today-only.md), which added the reception E2E
      infrastructure: a seeded « Accueil » account in `server/scripts/seed-e2e.js` + a second
      storageState `e2e/.auth/reception.json` written by `global-setup.js` and exposed through
      `e2e/fixtures/authState.js`). Runs as the reception account and asserts:
      `/finance`, `/clients`, `/reservations/upcoming`, `/settings` all redirect to `/`; the reduced
      home offers « Planning » and never names a forbidden surface; `GET /reservations/:id` carries
      the door money but none of `{totalPrice, customPrice, deposit*, balance*, remainingDue,
      paymentComplete, touristTax, commissionAmount, contribs}` nor the client's
      `{email, phone, address}`; `GET /properties` drops the pricing config; and crafted calls
      (`GET /clients`, `POST /reservations`, `GET /finance/overview`) fail closed with 403.
      *(Shipped as its own spec file rather than as an extension of `auth/sidebar-navigation.spec.js`
      — that suite runs under the admin storageState, and mixing sessions in one file is not
      possible with Playwright's per-file `test.use`.)*

### Manual UI verification
- [ ] Create an **Accueil** account (admin → Gestion des comptes → rôle Accueil), receive the temp
      password email, log in, forced password change, re-login.
- [ ] Reception home `/` shows only arrivals/departures, **no** payment/deposit/balance figures.
- [ ] Row tap on an arrival opens the arrival SAS on the Planning; run it end-to-end; caution +
      complement collected; status flags validated; **no** finance shown anywhere.
- [ ] Reception Planning: client names are plain text; « Ouvrir la fiche » absent in the SAS.
- [ ] Reception typing `/finance`, `/clients`, `/settings`, `/comptabilite` in the URL → bounced to
      `/`; DevTools network shows the reservation payloads carry **no** deposit/balance/total.
- [ ] Regression: an **admin** still sees the full Dashboard + full reservation payloads; an
      **accountant** still confined to `/comptabilite`.
- [ ] Mobile (`xs`): reception home lists collapse to cards; SAS `fullScreen`.

## 8. Out of scope

- **Per-permission granularity** (custom permission matrix). Still coarse roles.
- **A reception-specific reservation sheet** (read-only fiche without money). Reception opens the
  SAS, not a reservation page. Could be added later if the person needs a read-only detail view.
- **Client phone for on-site calls.** Deliberately excluded (no client PII). If the reception needs
  to phone an arriving guest, expose *only* the phone on the reception reservation view later — flag
  it if requested.
- **Reception access to Calendrier / Ressources / housekeeping settings.** The person gets the
  operational Planning, not the month Calendar or any Réglages page (decision: home + Planning only).
- **Audit log** of who checked whom in (beyond the SAS's existing reservation writes).
- **i18n** — French only.

## 9. Open questions

(To resolve before Status → Approved.)

- Q1: On the reception home, should a row tap open the SAS (as specified, rule 5) **or** stay
  purely informational (no navigation, SAS launched only from the Planning)?
  — proposed **A:** open the SAS via the deep-link (fewer taps to check a guest in).
- Q2: Keep the SAS **« Ouvrir la fiche »** link hidden for reception (rule 7), confirmed — the
  reservation sheet is finance-heavy and forbidden. Any need for a stripped read-only fiche? →
  default **no** (out of scope §8).
- Q3: reception+accountant combo (edge case) — leave as the natural union of both branches, or
  forbid assigning them together? → default **allow** (both were explicitly granted).
