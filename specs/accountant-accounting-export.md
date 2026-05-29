# Accountant access + monthly accounting export

| Field | Value |
|---|---|
| **Status** | Approved — implementing (PR 1 ✅, PR 2 ✅, PR 3 pending §9) |
| **Branch** | `feature/vat-two-rate-global` (PR 1), `feature/payment-dates-platform-gross` (PR 2), then `feature/accountant-accounting-export` (PR 3) _(user-managed)_ |
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
    password**, and is redirected to a **read-only `/comptabilite`** page — their only page.
18. The accountant **cannot reach or mutate** anything else: every non-accounting `/api` route is
    **admin-only**; the accountant may only `GET` the accounting endpoints + the self endpoints
    (`me`, `logout`, `change-password`). Enforced **server-side** (fail-closed), not just hidden in the UI.
19. The **admin** can **create / reset** the accountant account (email + temporary password with forced
    first-login change). Mechanism chosen in §9 (admin Settings section vs CLI).

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
| `utils/accountingExport.js` | — | C | **Pure** engine: given a month's encaissements (already shaped by the model) → balanced journal lines (account mapping, pro-rata split, rounding residue, client-account formatting). Unit-tested. |
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
| `pages/AccountingPage.js` | — | C | Read-only Comptabilité page: month/year picker + "Télécharger le CSV" + platform-commission preview table. Uses `PageActionBar`. |
| `pages/SettingsPage.js` | `SettingsPage.js` | T | New "TVA" fields (2 global rates); admin "Comptes" section to create/reset the accountant (if UI chosen, §9). |
| `components/reservation/FinanceSection.js` | `FinanceSection.js` | T | Add **payment-date** inputs next to each "payé" toggle; add the **"Prix payé par le client"** field shown **only for platform** reservations, with read-only computed commission. |
| `components/PricingSummary.js` (+ TVA display) | `PricingSummary.js` | T | **Audit & fix** the TVA lines to reflect the 2-rate model (user explicitly asked to check this). |
| `App.js` / routing + `hooks/useAuth.js` | `App.js`, `useAuth.js` | T | Role-aware routing: `accountant` → only `/comptabilite`; hide admin nav; redirect attempts elsewhere. |
| `api.js` | `api.js` | T | `downloadAccountingCsv(month,year)`, `getPlatformReport(...)`, settings VAT fields, user-management calls, payment-date in `markPayment`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `FormDialog`, `HelpedTextField`, `EmptyState`, `LoadingState`, `ErrorAlert`, `TableCard`/`DataPageScaffold`, `PasswordField` | The Comptabilité page and Settings additions render with existing generics. |
| **Created (new generic)** | `MonthYearPicker` (if none exists) | Month+year selector reused by accounting and potentially finance/reporting. Justify at build time. |
| **Specific (kept feature-local)** | `PlatformCommissionPreview` (table inside AccountingPage) | Tied to the accounting payload; a `TableCard` composition. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/accounting/sales.csv?month=MM&year=YYYY` | — | `text/csv` attachment | Auth: admin **or** accountant. Balanced journal lines for the month. |
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
gross; NULL/0 for direct). `commissionAmount` is **derived** (gross − `finalPrice`), not stored.
- Backfill: `depositPaidDate = depositDueDate WHERE depositPaid=1`; same for balance. `clientGrossAmount`
  left NULL (legacy platform reservations have no gross until edited).

**`properties`**: the three `vatPercentage*` columns are **dropped** (`ALTER TABLE … DROP COLUMN`)
*after* the backfill copies their values into the two new globals. Migration is defensive: skips the
backfill if the old columns are already absent; skips the drop on subsequent runs.

**`users`**: no schema change (uses existing `role`); seed/create an `accountant` row.

**Data impact:** VAT refactor can change derived HT/VAT splits if a property's stored rates ≠ 10/20 — rule 4
requires surfacing, never silent re-pricing. Stored `finalPrice` (TTC) is untouched. Migrations idempotent.

## 6. UI / UX

- **Comptabilité page (`/comptabilite`)** — `PageActionBar title="Comptabilité"`, no Save/Cancel. A
  `MonthYearPicker` + a primary "Télécharger le CSV" action (in the bar, icon `DescriptionIcon`), and a
  preview table (platform commissions for the month) below. Empty month → `EmptyState`. Loading/error →
  `LoadingState`/`ErrorAlert`. **Responsive:** picker + button stack on `xs`; preview table → stacked cards
  on `xs`, real table on `md+`.
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
- [ ] `accounting-export.unit.test.js` — per-encaissement balanced lines (Σcredits==debit), pro-rata split
      across acompte/solde, rounding residue, account mapping per bucket, VAT-account by rate, client-account
      formatting, caution & taxe de séjour excluded, devis excluded.
- [ ] `csv.unit.test.js` — separator/BOM/comma/escaping.
- [ ] `pricing-vat-two-rates.unit.test.js` — accommodation uses accommodation rate, options/custom/resources
      use standard rate; totals unchanged when rates are 10/20; tourist tax untouched.
- [ ] `accounting-model.unit.test.js` — month filter on payment dates, platform gross/commission, only
      `kind='reservation'`.
- [ ] `require-role.unit.test.js` — accountant blocked on non-accounting routes (403), allowed on accounting
      + self; admin allowed everywhere.
- [ ] `users-model.unit.test.js` (extend) — create accountant, forced change, reset.

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
  (`C` + how many chars of which name, casing).  → A: _pending Adrien's example (offered in the email)._
- Q: **Platform turnover basis** — for a platform sale, are the revenue accounts (70xxx) + VAT recognised on
  the **gross** (guest-paid) with commission booked as a **charge** line, or on the **net** the owner
  receives, with gross/commission shown only as info columns?  → A: _pending (accounting decision; likely
  gross = turnover, commission = charge — confirm with the accountant)._
- Q: **Create-accountant mechanism** — admin "Accès comptable" section in Settings (nicer for a solo owner)
  vs a `npm run create-accountant` CLI?  → A: _proposed: Settings section; confirm._
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
- **PR 3 — Accountant role + read-only Comptabilité page + monthly CSV export ⬜.** Blocked on §9
  (example CSV format + platform turnover basis).
