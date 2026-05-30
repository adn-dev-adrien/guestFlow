# Accountant access + monthly accounting export

| Field | Value |
|---|---|
| **Status** | Implemented (PR 1 ✅, PR 2 ✅, PR 3 ✅ — example CSV expected from accountant; format tweaks tracked as a follow-up) |
| **Branch** | `feature/vat-two-rate-global` (PR 1), `feature/payment-dates-platform-gross` (PR 2), `feature/accountant-accounting-export` (PR 3) _(user-managed)_ |
| **Created** | 2026-05-29 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Adrien's accountant needs a recurring, month-by-month accounting feed of GuestFlow's sales, plus a
self-service login. Today:

- There is **no second user account** and **no role system in use**: the `users` table has a `role`
  column but `requireAuth` only checks "is authenticated" (no role gating), and there is **no UI/endpoint
  to create a user** (only the seeded admin + login/change-password/me/logout).
- There is **no accounting export** (the only `attachment` responses are the devis PDF and the public
  `.ics`). The accountant currently gets nothing machine-readable.
- VAT is modelled **per property, with three rates** (`properties.vatPercentageAccommodation /
  Options / Resources`, all default 20). The pricing engine (`utils/pricing.js`) extracts VAT from TTC
  prices per bucket. This is more granular than the business actually needs and is awkward to map onto
  the accountant's two VAT accounts.
- Reservations store payment **due dates + a paid boolean** (`depositDueDate/depositPaid`,
  `balanceDueDate/balancePaid`) but **no real payment date**, and **no platform gross/commission data**
  (`finalPrice` is the net the owner receives; there is no record of what the guest paid on the platform).

The accountant's requirements (verbatim from their email, condensed):

- **Sales invoices** as a CSV/Excel with at least: day, month, year; the **revenue account**
  (`70600000` LOCATION GITE / `70600010` PRESTATIONS COMPLÉMENTAIRES GITE / `70601000` ACTIVITÉS
  DIVERSES); the **VAT account** (`44571200` for 20%, `44571100` for 10%); the **client auxiliary
  account** (`C` + start of client name) for the TTC; a **libellé** (client name); the **debit** (client
  account) and the **credit** (account 7 + VAT).
- For **platform** bookings: the **gross revenue** (before commission), the **commission amount**, the
  **client name**, and the **platform**.
- New reservation-form fields that only apply to platform bookings must **not** be shown/asked for direct
  bookings.

## 2. Goal

Give the accountant their own login (password they can change) that opens a **read-only "Comptabilité"
page**, where they download **one monthly CSV containing all sales** (direct + platform) as balanced
double-entry journal lines, plus the platform gross/commission detail — all driven by **real payment
dates**. Along the way, simplify VAT to the **two rates the business actually uses** (accommodation +
standard).

## 3. Functional rules

### 3.1 VAT model (foundational refactor)

1. VAT is configured by **two global rates** in app settings, common to every property:
   **`vatRateAccommodation`** (default **10%**) and **`vatRateStandard`** (default **20%**).
2. **Accommodation** (the nightly stay, incl. extra-guest surcharge) uses `vatRateAccommodation`.
   **Everything else billable** — options, custom options, resources — uses `vatRateStandard`.
3. The pricing engine, the reservation/devis quote, the **devis PDF** and the reservation **TVA summary**
   must read these two global rates. The three per-property VAT columns are **dropped** (migrated
   first, see §5).
4. **No price total may change** for an existing reservation purely because of this refactor *unless* its
   stored property rates already differed from 10/20 — and any such change must be surfaced, never silent.
   Tourist tax stays out of VAT entirely (unchanged).

### 3.2 Payment dates (real encaissement date)

5. Marking the **deposit** or **balance** as paid records a real **payment date** (`depositPaidDate` /
   `balancePaidDate`), defaulting to **today**, editable. Un-marking clears it.
6. The accounting export is driven by these payment dates — **one journal entry set per encaissement**,
   dated at the encaissement's payment date.

### 3.3 Platform gross/commission

7. Reservations gain a **"prix payé par le client"** field (gross). It is **only shown/asked for
   platform-sourced** reservations (a platform is selected / `sourceType='ical'` / `platform != 'direct'`).
   For direct bookings the field is hidden and irrelevant.
8. `finalPrice` remains **the net the owner receives** (unchanged semantics). The **commission is computed
   automatically** = gross − net (never below 0; gross must be ≥ net or it's a validation error).
9. Platform gross/commission/platform-label/client-name appear in the export (see §3.4 rule 14).

### 3.4 Monthly accounting CSV

10. The accountant selects a **month + year**; the server returns **one CSV** with **all sales** of that
    month (direct **and** platform), as **balanced double-entry journal lines**.
11. A "sale" is recognised **per encaissement** (rule 6): the month's CSV lists every deposit/balance whose
    **payment date** falls in that month. A reservation paid across two months appears in both.
12. Each encaissement produces a balanced set of lines:
    - **1 debit line** on the **client account** `C<NAME>` for the encaissement **TTC** amount.
    - **N credit lines** on the **revenue accounts** for the encaissement's **HT**, split by bucket:
      accommodation → `70600000`; options + custom options → `70600010`; resources → `70601000`.
    - **M credit lines** on the **VAT accounts** for the encaissement's VAT, by rate:
      10% → `44571100`; 20% → `44571200`.
    - Bucket/VAT amounts are **pro-rated** by the encaissement fraction (`payment / total TTC`); rounding
      residue is absorbed so **Σ credits == debit** to the cent.
13. **Columns** (final layout pending the accountant's example, see §9): `Jour`, `Mois`, `Année`,
    `Compte`, `Libellé`, `Débit`, `Crédit`, then platform-info columns `Plateforme`, `Prix payé client`,
    `Commission` (populated only on the client-debit line of platform sales; blank for direct).
14. **Client account** = `C` + start of the client's name, formatted per the accountant's convention
    (char count / casing **pending the example**, see §9). `Libellé` = client name.
15. **Excluded from the export:** the **caution/garantie** (never revenue) and the **taxe de séjour**
    (collected for the commune, outside the gîte's VAT/turnover). Devis (`kind='devis'`) are never exported.
16. The CSV is French-Excel friendly: `;` separator, UTF-8 BOM, decimal comma — **pending example
    confirmation** (§9).

### 3.5 Accountant access (role + page)

17. A new **`accountant`** role exists. An accountant logs in like anyone, can **change their own
    password**, and is redirected to a **read-only `/comptabilite`** page — their main page.
18. The accountant **cannot reach or mutate** anything else: every non-accounting `/api` route is
    **admin-only**; the accountant may only `GET` the accounting endpoints + the self endpoints
    (`me`, `logout`, `change-password`). Enforced **server-side** (fail-closed), not just hidden in the UI.
19. The **admin** can **create / reset** the accountant account (email + temporary password with forced
    first-login change) from **Paramètres → Accès comptable** (chosen in §9).
20. **Password change is on its own page** — `/settings/password` — and is **accessible to every
    authenticated user** (admin and accountant). It is the only page besides `/comptabilite` that the
    accountant can reach (both server-side via the role guard and client-side via the redirect rule).
21. **Sidebar — admin view:** the Comptabilité link lives under **Suivi financier** (next to Vue
    générale and Taxe de séjour). "Mot de passe" is the last sub-item under **Paramètres**.
22. **Sidebar — accountant view:** minimal — Comptabilité, Mot de passe, Se déconnecter (no Suivi
    financier wrapper, no Paramètres sub-menu, nothing else).
23. **Visual journal preview on `/comptabilite`** — above the platforms-commissions table, render
    **one card per encaissement** mirroring exactly what will end up in the CSV: header bar with the
    date / kind chip (Acompte / Solde) / client / platform chip (non-direct only) / encaissement TTC /
    balanced badge; optional platform sub-bar showing gross + commission; inline journal table
    coloured by line type (client = amber, revenue = green, VAT = blue) with monospace account
    numbers and a Σ row. The card border turns red when not balanced. Strict mirror: the JSON behind
    the preview comes from `entryToStructured(entry)`, which calls the same `entryToRows` walk as the
    CSV — any future export change appears in both at once.
24. **Account labels in the preview** — each account number is paired with its human label
    (`70600000 / Location gîte`, `70600010 / Prestation complémentaire`, `70601000 / Activité
    diverse`, `44571100 / TVA 10 %`, `44571200 / TVA 20 %`, `C… / Compte client`) shown as a small
    caption under the number. The CSV itself is unchanged — labels are a UI-only enrichment.
25. **Client name → reservation file link (admin only)** — in each journal card, clicking the client
    name navigates to `/reservations/{reservationId}`. The link is **only rendered for the admin
    role**; the accountant sees the name as plain text (they cannot reach reservations anyway —
    `/api/reservations/*` returns `403 FORBIDDEN_ROLE` for them).
26. **Month / year persisted in the URL** — `/comptabilite?month=MM&year=YYYY`. Picker changes
    `replace:true` the current history entry (no spurious back-stack noise); navigating to a
    reservation file pushes a normal entry, so the browser back-button restores the previously
    selected month + year. URLs are bookmarkable and shareable; bounds are validated client-side
    (month 1–12, year 2000–9999, otherwise fall back to the previous-month default).
27. **Per-card pro-rata context** — under the encaissement amount in each card header, a small
    caption `XX % du séjour (YYY,YY €)` makes the pro-rata and the total stay TTC visible at a glance
    (e.g. `30 % du séjour (360,00 €)` for an acompte on a 360 € stay). Together with the per-line
    account labels (rule 24) this is enough on-screen context — no separate explanatory panel.
28. **Complément à percevoir (3rd encaissement slot)** — when both the deposit and the balance are
    marked paid and the total stay TTC has *since* grown (typical case: options/extras added after the
    payments were recorded), the pricing engine surfaces the leftover as a **third encaissement** named
    *Complément à percevoir*. It is **auto-derived** as `max(0, totalStayPrice − depositAmount − balanceAmount)`
    while unpaid, and **frozen** in the DB once `complementPaid = 1` (same model as deposit/balance —
    once the money has actually been received, the engine never erodes it). Typically paid at end of
    stay for on-site extras. The accounting export treats it as a 3rd encaissement type alongside
    deposit and balance — same balanced double-entry shape, pro-rated by
    `complementAmount / totalStayPrice`, dated at `complementPaidDate`. Deposit + Balance + Complement
    always sum back to `totalStayPrice` (modulo rounding).
    **UI placement** — only when `complementAmount > 0`:
    - **In the FinanceSection** (under Solde): mirrors the Acompte / Solde visual exactly (title +
      amount caption + "Marquer complément payé" button with the standard outlined-inherit /
      contained-success states + "Payé le" date input on flip-to-paid). Wrapped in a **red 1 px
      border** while unpaid to signal "à percevoir"; the border vanishes once paid, so the block
      drops back to the standard look of a paid Acompte/Solde — no orange-tinted background, no
      extra explanation paragraph.
    - **In the right-side `PricingSummary` panel**: a dedicated line between **Solde** and
      **Caution**, label in red while unpaid, with a "Complément payé" chip below it once paid
      (same visual as Solde payé).
29. **Pro-rata base = totalStayPrice (= finalPrice + tourist tax)** — the accounting export now
    pro-rates every encaissement against the **total stay TTC** including the tourist tax, not just
    `finalPrice`. This was a quiet inaccuracy on prior runs (the deposit/balance percentages drifted
    by the tourist-tax ratio); with this change Deposit + Balance + Complement = 100 % of
    `totalStayPrice` exactly, and the per-bucket lines balance to the cent.

**Edge cases:**
- Encaissement marked paid but no real date yet (legacy rows) → backfilled to the **due date** on
  migration; surfaced as the encaissement date until edited.
- Gross < net on a platform reservation → **400** validation error (commission can't be negative).
- A reservation with `finalPrice = 0` or fully offered → produces no revenue lines (skipped), but a paid
  caution still never appears.
- Month with no encaissements → CSV with header only (or an explicit "no rows" — §9).
- Property whose stored VAT rates were not 10/20 → the migration logs/surfaces the affected reservations
  (rule 4); never silently re-prices.

---

## 4. Architecture

> **Fat backend, thin frontend.** All journal-line generation, pro-rata splitting, rounding, VAT
> extraction, account mapping and CSV serialization live on the server. The Comptabilité page only picks a
> month and downloads the file. The reservation form only renders the new fields and submits them.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Migrations: add `app_settings.vatRateAccommodation/vatRateStandard`; backfill from old per-property rates; add `reservations.depositPaidDate/balancePaidDate/clientGrossAmount`; backfill paid-dates from due-dates; ensure a `users.role` value set; (retire the 3 per-property VAT columns — keep but stop reading, or drop after backfill — §9). |
| `utils/pricing.js` | `pricing.js` | T | Read the **two global VAT rates** instead of three per-property ones; accommodation→accommodation rate, options/custom/resources→standard rate. Behaviour-preserving except the intended 3→2 change. |
| `utils/accountingExport.js` | — | C | **Pure** engine: given a month's encaissements (already shaped by the model) → balanced journal lines (`buildRows` for the CSV, `buildStructuredEntries` for the JSON preview — same data, same line order, same rounding). Adds `accountLabel` per line for the visual preview. Unit-tested. |
| `utils/csv.js` | — | C | Pure CSV serializer (`;`, BOM, comma decimals, escaping). Reusable. |
| `models/accountingModel.js` | — | C | Reads encaissements for a month: joins reservations (`kind='reservation'`) + clients + per-bucket HT/VAT from the quote, filtered by `depositPaidDate`/`balancePaidDate` in [month]. Returns rows for the export engine. No HTTP. |
| `models/settingsModel.js` | `settingsModel.js` | T | Add the two VAT columns to `COLUMNS`/`DEFAULTS`. |
| `models/reservationsModel.js` | `reservationsModel.js` | T | Persist/read `depositPaidDate`, `balancePaidDate`, `clientGrossAmount`; compute `commissionAmount` (gross−net) in the shaped payload; set paid-date when `markPayment` flips a paid flag. |
| `models/usersModel.js` | `usersModel.js` | T | `createUser({email,password,role})`, `listUsers()`, `resetUserPassword()`; role-aware. |
| `controllers/accountingController.js` | — | C | Thin: validate `?month=&year=`, call model+engine+csv, set `Content-Disposition` CSV. |
| `controllers/settingsController.js` | `settingsController.js` | T | Accept/return the two VAT rates; validate 0–100. |
| `controllers/usersController.js` | — | C | Admin-only create/reset/list accountant; validation. |
| `routes/accounting.js` | — | C | `GET /api/accounting/sales.csv`, `GET /api/accounting/platforms` (preview/JSON). Thin. |
| `routes/users.js` | — | C | Admin-only user management. Thin. |
| `middleware/requireRole.js` | — | C | `requireRole('admin')`; plus an accountant allow-list guard. |
| `middleware/requireAuth.js` | `requireAuth.js` | T | Keep auth gate; expose `req.user.role` for the role guards mounted per-router in `index.js`. |
| `index.js` | `index.js` | T | Mount accounting/self routes for any authenticated user; wrap all other business routers in `requireRole('admin')` (fail-closed for `accountant`). |
| `constants/accounting.js` | — | C | Account numbers (`70600000`…, `44571100/200`), bucket→account map, client-account format params. Single source of truth. |
| `scripts/create-accountant.js` | — | C | _(if CLI chosen in §9)_ seed/reset the accountant account. |
| `tests/` | `accounting-export.unit.test.js`, `csv.unit.test.js`, `pricing-vat-two-rates.unit.test.js`, `accounting-model.unit.test.js`, `require-role.unit.test.js`, `users-model.unit.test.js` (extend) | C/T | Cover §7. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/AccountingPage.js` | — | C | Read-only Comptabilité page: month/year picker + "Télécharger le CSV" + **visual journal cards** (one per encaissement, mirror of the CSV) + platform-commission preview table. Uses `PageActionBar`. |
| `pages/ChangePasswordPage.js` | — | C | Dedicated change-password page at `/settings/password`. Common to every authenticated role (admin + accountant). Wraps `ChangePasswordForm` in a `PageActionBar` card. |
| `pages/SettingsPage.js` | `SettingsPage.js` | T | New "TVA" fields (2 global rates); admin **"Accès comptable"** section to create/reset the accountant. The legacy in-page Sécurité card was **removed** — change-password now lives only on `/settings/password`. |
| `components/SettingsAccountantAccessSection.js` | — | C | Admin-only Settings card: detects the existing accountant, lets you create one (first run) or reset its password. Includes a "Générer un mot de passe" helper. |
| `components/reservation/FinanceSection.js` | `FinanceSection.js` | T | Add **payment-date** inputs next to each "payé" toggle; add the **"Prix payé par le client"** field shown **only for platform** reservations, with read-only computed commission. |
| `components/PricingSummary.js` (+ TVA display) | `PricingSummary.js` | T | **Audit & fix** the TVA lines to reflect the 2-rate model (user explicitly asked to check this). |
| `App.js` / routing + `hooks/useAuth.js` | `App.js`, `useAuth.js` | T | Role-aware routing: accountant sees a minimal sidebar (Comptabilité, Mot de passe, Se déconnecter) and is redirected to `/comptabilite` from any path outside `[/comptabilite, /settings/password]`. Admin sidebar nests the Comptabilité link under **Suivi financier** and adds **Mot de passe** under **Paramètres**. |
| `api.js` | `api.js` | T | `downloadAccountingSalesCsv(month,year)`, `getAccountingSales(...)` (structured JSON for the visual preview), `getAccountingPlatforms(...)`, settings VAT fields, `listUsers` / `createUser` / `resetUserPassword`, payment-date in `markPayment`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `FormDialog`, `HelpedTextField`, `EmptyState`, `LoadingState`, `ErrorAlert`, `TableCard`/`DataPageScaffold`, `PasswordField` | The Comptabilité page and Settings additions render with existing generics. |
| **Created (new generic)** | `MonthYearPicker` | Shared month + year selector card. Created during the Suivi taxe de séjour visual-alignment pass (2026-05-30) — now used by both `/comptabilite` and `/finance/tourist-tax` for visual coherence. Both selectors share the same `180 px` width on `sm+`; the row is `alignItems: flex-start` so any `helperText` hangs below "Mois" without pushing "Année" down. Exposes `toYearMonth`/`fromYearMonth` helpers so callers hitting endpoints expecting `YYYY-MM` (tourist tax) can convert without owning the format logic. Supports `maxMonth` to disable forward months (tourist tax = past months only). |
| **Specific (kept feature-local)** | `PlatformCommissionPreview` (table inside AccountingPage) | Tied to the accounting payload; a `TableCard` composition. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/accounting/sales.csv?month=MM&year=YYYY` | — | `text/csv` attachment | Auth: admin **or** accountant. Balanced journal lines for the month. |
| GET | `/api/accounting/sales?month=MM&year=YYYY` | — | `{ entries:[…], totals:{ entriesCount, totalDebits, totalCredits, allBalanced } }` | Auth: admin **or** accountant. Structured JSON mirror of the CSV (one entry per encaissement, lines classified `client`/`revenue`/`vat`, each carrying its `accountLabel`). Drives the visual journal preview. |
| GET | `/api/accounting/platforms?month=MM&year=YYYY` | — | `{ rows:[{client,platform,gross,commission,net,date}], totals }` | Preview/JSON for the page table. |
| GET/PUT | `/api/settings` | `{ vatRateAccommodation, vatRateStandard, … }` | settings | Admin-only; validate 0–100. |
| GET/POST/PUT | `/api/users` | `{ email, role, password? }` | safe user(s) | **Admin-only**; create/reset accountant. |
| PATCH | `/api/reservations/:id/payment` | `{ depositPaid?, depositPaidDate?, balancePaid?, balancePaidDate? }` | shaped reservation | Records real payment date. |

All accounting/users endpoints are auth-gated; non-accounting business routes reject `accountant` with
**403 FORBIDDEN_ROLE** (fail-closed, server-side).

---

## 5. Data model

**`app_settings`** (singleton): add `vatRateAccommodation REAL DEFAULT 10`, `vatRateStandard REAL DEFAULT 20`.
- Backfill: from the most common / a chosen property's old `vatPercentageAccommodation` (→ accommodation)
  and `vatPercentageOptions` (→ standard); default 10/20 if absent.

**`reservations`**: add `depositPaidDate TEXT`, `balancePaidDate TEXT`, `clientGrossAmount REAL` (platform
gross; NULL/0 for direct), and **`complementAmount REAL NOT NULL DEFAULT 0`**, **`complementPaid INTEGER NOT NULL DEFAULT 0`**,
**`complementPaidDate TEXT`** (the 3rd encaissement slot — see rule 28).
`commissionAmount` is **derived** (gross − `finalPrice`), not stored.
- Backfill: `depositPaidDate = depositDueDate WHERE depositPaid=1`; same for balance.
  `clientGrossAmount` left NULL (legacy platform reservations have no gross until edited).
  `complementAmount` backfilled on existing fully-paid reservations as `max(0, finalPrice + touristTaxTotal − depositAmount − balanceAmount)`
  so the silent gap (e.g. reservation #12087 in production) is immediately visible after the migration.

**`properties`**: the three `vatPercentage*` columns are **dropped** (`ALTER TABLE … DROP COLUMN`)
*after* the backfill copies their values into the two new globals. Migration is defensive: skips the
backfill if the old columns are already absent; skips the drop on subsequent runs.

**`users`**: no schema change (uses existing `role`); seed/create an `accountant` row.

**Data impact:** VAT refactor can change derived HT/VAT splits if a property's stored rates ≠ 10/20 — rule 4
requires surfacing, never silent re-pricing. Stored `finalPrice` (TTC) is untouched. Migrations idempotent.

## 6. UI / UX

- **Comptabilité page (`/comptabilite`)** — `PageActionBar title="Comptabilité"`, no Save/Cancel. A
  month/year picker + a primary "Télécharger le CSV" action (in the bar, icon `DescriptionIcon`).
  Below: the **"Détail des écritures du mois"** section — one card per encaissement showing exactly
  the lines that will be in the CSV, coloured by account type (client/amber, revenue/green,
  VAT/blue), each account paired with its human label (`Location gîte`, `TVA 10 %`, etc.). For
  **admin only**, the client name in each card is a link to `/reservations/{reservationId}`. Header
  chips: count, total débits, "Tout équilibré". Below that, the platform-commissions table. Empty
  month → friendly empty-state captions. Loading → spinner.
  **Responsive:** picker + button stack on `xs`; cards reflow on `xs` (header chips wrap).
- **`/settings/password` (`ChangePasswordPage`)** — `PageActionBar title="Changer le mot de passe"`,
  subtitle chip with the current user's email. A single card with `ChangePasswordForm` + success
  alert. Reachable by every authenticated user (admin and accountant); for accountants this is the
  only Paramètres-side page they can open.
- **Reservation FinanceSection** — under each "payé" toggle, a date input ("Payé le", default today,
  editable) enabled only when paid. A **"Prix payé par le client"** number field appears **only** when the
  reservation is platform-sourced, with a read-only "Commission plateforme : X €" caption beneath. Hidden
  entirely for direct bookings. **Responsive:** fields full-width and stacked on `xs`.
- **Settings** — a "TVA" block with two percentage fields (Hébergement / Standard, helper text giving the
  defaults 10 / 20). An admin-only "Accès comptable" block to create/reset the accountant login.
- **TVA summary in the reservation page** — audited to display the two-rate breakdown correctly.
- Copy in French throughout (e.g. "Payé le", "Prix payé par le client", "Commission plateforme",
  "Télécharger le CSV", "Mois", "Année").

## 7. Test plan

### Server unit tests
- [x] `pricing-complement.unit.test.js` (7) — complement = 0 by default and when only deposit paid;
      complement = `max(0, totalStayPrice − deposit − balance)` when both are paid; complement
      is frozen once `complementPaid = true`; never negative on a total-price drop; deposit +
      balance + complement always sums back to the total stay price.
- [x] `accounting-export.unit.test.js` (19) — per-encaissement balanced lines (Σ credits == debit),
      pro-rata split, rounding residue, account mapping per bucket, VAT-account by rate,
      client-account formatting (incl. accents/hyphens/padding), platform info on debit row only,
      multi-entry order; **structured-entries mirror buildRows entry-for-entry**; classify by account
      prefix; **accountLabel mapping** (Location gîte / Prestation complémentaire / Activité diverse
      / TVA 10 % / TVA 20 % / Compte client).
- [x] `csv.unit.test.js` (6) — `;` separator, BOM, comma decimals, quoting/escaping, empty input.
- [x] `pricing-vat-two-rates.unit.test.js` (5) — accommodation uses the accommodation rate,
      options/custom/resources use the standard rate; TTC totals unchanged.
- [x] `enforce-role-access.unit.test.js` (8) — admin unrestricted, accountant allowed on
      `GET /accounting/*` and self routes, blocked on POST/PUT/PATCH/DELETE there and on every
      non-accounting/non-self path, unknown role + no user 403 (fail-closed).
- [x] `users-model-admin.unit.test.js` (7) — `createUser` hashes the password, normalises the email
      (trim + lowercase), enforces `mustChangePassword=1` and `isActive=1`, UNIQUE on duplicate;
      `list()` returns safe shape (no hash leaked); `resetUserPassword` re-hashes and re-forces.
- [x] `client-gross-amount.unit.test.js` (7) — gross >= net, negative/NaN rejection.
- [x] `reservations-commission.unit.test.js` (7) — commission = gross − net, clamped at 0,
      platform-only.

### Manual UI verification
- [ ] Happy path: create accountant → log in → forced password change → see only `/comptabilite` → download
      a month CSV → open in Excel, lines balanced.
- [ ] Reservation: platform booking shows gross field + computed commission; direct booking hides it.
- [ ] Mark deposit paid → date defaults to today, editable; appears in that month's CSV.
- [ ] TVA summary on the reservation page reflects 10/20.
- [ ] Regression: existing reservation totals unchanged (rates already 10/20); pricing engine, devis PDF.
- [ ] Mobile checks on Comptabilité + FinanceSection.

## 8. Out of scope

- A full general-ledger / bank-reconciliation module. We export sales journal lines only.
- Purchases/expenses accounting (beyond the platform commission shown for context).
- Multiple accountants / granular permissions beyond the single read-only `accountant` role.
- PDF invoices per reservation (devis PDF already exists; not a fiscal sales invoice).
- Editing accounting entries in-app.

## 9. Open questions

(Resolved before Status → Approved.)
- Q: **Accountant's example CSV** — exact columns/order, separator, encoding, and **client-account format**
  (`C` + how many chars of which name, casing).  → A: **shipped with sensible defaults** (Adrien, 2026-05-30) —
  columns `Jour;Mois;Année;Compte;Libellé;Débit;Crédit;Plateforme;Prix payé client;Commission`, `;`
  separator, UTF-8 BOM, comma decimals; client account = `C` + 6 chars of last name (uppercased,
  accent-stripped, `X`-padded). Trivially tunable in `constants/accounting.js` once the example arrives.
- Q: **Platform turnover basis** — for a platform sale, are the revenue accounts (70xxx) + VAT recognised on
  the **gross** (guest-paid) with commission booked as a **charge** line, or on the **net** the owner
  receives, with gross/commission shown only as info columns?  → A: **net** by default (Adrien, 2026-05-30) —
  simple, every sale has the same shape. To switch to gross + commission-as-charge, change
  `RECOGNISE_REVENUE_ON` in `constants/accounting.js` and add an extra credit line in `accountingExport.js`.
- Q: **Create-accountant mechanism** — admin "Accès comptable" section in Settings (nicer for a solo owner)
  vs a `npm run create-accountant` CLI?  → A: **Settings section** (shipped).
- Q: **Retire per-property VAT columns** — keep them dormant (read nothing) or drop after backfill?
  → A: **drop** (Adrien, 2026-05-29). Migration backfills first, then `DROP COLUMN`. Done.
- Q: **Empty month** — header-only CSV vs a friendly "aucune écriture" response? → A: _proposed: header-only._

---

## 10. Implementation progress

- **PR 1 — VAT 2-rate global refactor ✅ (`feature/vat-two-rate-global`).** Two global rates in
  `app_settings` (`vatRateAccommodation` 10, `vatRateStandard` 20), read by the pricing engine
  (`utils/pricing.js` `getGlobalVatRates`) for the quote, by `financeModel`, and by the devis PDF
  (`utils/devisPdf.js`). Accommodation → its own rate; options/custom options/resources → standard.
  New **Paramètres → Taux de TVA** section (`SettingsVatSection`); the per-property VAT fields are
  removed from the property form, and the per-property `vatPercentage*` columns are **dropped** from
  the schema (`ALTER TABLE … DROP COLUMN`) after a defensive backfill. Reservation TVA summary verified
  (reads the quote, reflects the 2 rates). Tests: `pricing-vat-two-rates` (5).
- **PR 2 — Payment dates + platform gross/commission ✅ (`feature/payment-dates-platform-gross`).**
  New `reservations.depositPaidDate`, `balancePaidDate` (real encaissement dates, defaulted to today
  on flip-to-paid, editable, cleared on un-pay), and `clientGrossAmount` (TTC amount the guest paid the
  platform; only meaningful for non-direct bookings). `commissionAmount` derived in the shaped payload
  as `gross − finalPrice` (clamped at 0). Write boundary rejects `gross < net` with
  `400 GROSS_BELOW_NET`. FinanceSection shows a "Payé le" date input next to each paid toggle, and a
  platform-only "Prix payé par le client" + computed "Commission plateforme" caption (hidden on direct).
  Tests: `client-gross-amount` (7), `reservations-commission` (7). Verified live in the browser
  (visibility toggling on platform change, commission auto-computed, paid-date defaults to today).
- **PR 3 — Accountant role + read-only Comptabilité page + monthly CSV export ✅
  (`feature/accountant-accounting-export`).** New `accountant` role; fail-closed
  `middleware/enforceRoleAccess.js` confines it to `GET /api/accounting/*` + self routes
  (everything else → `403 FORBIDDEN_ROLE`). Admin can create/reset the accountant from
  **Paramètres → Accès comptable** (new `SettingsAccountantAccessSection`). New `/comptabilite`
  page (nested in the admin sidebar under "Suivi financier") with month/year picker, "Télécharger
  le CSV" action, and the platform-commissions preview table. Sales CSV is balanced double-entry
  (`C<NAME>` debit + 70xxx + 44571x00 credits, pro-rated per encaissement). Turnover basis = **net**
  (see §9). One CSV regardless of source; platform info on the debit row only. New files:
  `constants/accounting.js`, `middleware/enforceRoleAccess.js`, `models/accountingModel.js`,
  `controllers/{accountingController, usersController}.js`, `routes/{accounting, users}.js`,
  `utils/{csv, accountingExport}.js`, `pages/AccountingPage.js`,
  `components/SettingsAccountantAccessSection.js`.

  **Follow-ups merged into the same PR after Adrien's review:**
  - **Dedicated change-password page** at `/settings/password` (`ChangePasswordPage`), common to
    every authenticated role. The legacy Sécurité card was removed from both `SettingsPage` and
    `AccountingPage` to deduplicate. Admin sees a new "Mot de passe" sub-item at the bottom of the
    Paramètres group; accountant gets a minimal sidebar (Comptabilité, Mot de passe, Se déconnecter)
    and is client-side-redirected to `/comptabilite` from any path outside
    `[/comptabilite, /settings/password]`.
  - **Visual journal preview** above the platforms table on `/comptabilite`: one card per
    encaissement mirroring exactly what is in the CSV — header bar (date / kind / client / platform
    chip / encaissement TTC / balanced badge), optional platform sub-bar (gross + commission),
    inline journal table coloured per line type. Card border turns red on imbalance. Backed by a
    new `GET /api/accounting/sales` JSON endpoint (`buildStructuredEntries(entries)`), a strict
    mirror of `buildRows(entries)` so the CSV and the UI cannot drift.
  - **Account labels** under each account number: `Location gîte`, `Prestation complémentaire`,
    `Activité diverse`, `TVA 10 %`, `TVA 20 %`, `Compte client`. Centralised in
    `constants/accounting.js` (`ACCOUNT_LABELS`, `accountLabel`); the CSV itself is unchanged.
  - **Client name → reservation link (admin only)**: in each journal card, the client name is a
    `<Link to="/reservations/{id}">` for admins, plain text for accountants (who can't reach
    reservations anyway).
  - **URL-backed picker state** (`useSearchParams`): the page reads `?month=&year=` and stays
    synced; picker changes `replace:true` the entry so the back-button from a reservation file
    returns to the exact same month + year (verified round-trip: select Mai → click client →
    browser back → still on Mai).
  - **Per-card pro-rata context**: each card header shows `XX % du séjour (YYY,YY €)` directly
    under the encaissement amount so the relationship to the full stay total is immediate
    (e.g. `30 % du séjour (360,00 €)`, `71 % du séjour (360,00 €)`). The earlier "Comment lire ces
    écritures" info Alert was dropped on Adrien's request — the per-card caption + the account labels
    (rule 24) carry enough context on their own.
  - **Complément à percevoir** (rule 28): brought to the surface a long-standing silent gap on
    fully-paid reservations whose total had grown after the fact (Adrien spotted it on res #12087:
    finalPrice 600 + tax 4,80 vs deposit 109,44 + balance 255,36 → 240 € unbilled). The engine now
    derives the leftover, the FinanceSection shows a 3rd block when > 0, and the accounting export
    treats it as a 3rd encaissement type (kind = 'complement'). Pro-rata base shifted from
    `finalPrice` to `totalStayPrice` (= finalPrice + tourist tax) so D + B + C = 100 % to the cent.
    New tests: `pricing-complement` (7). Full suite green (440).

  Tests: `csv` (6), `accounting-export` (19), `enforce-role-access` (8), `users-model-admin` (7).
  Full server suite green (433).
