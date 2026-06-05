# Platform-commission accounting + no-deposit-on-platform

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/accounting-platform-commission-and-no-deposit` _(user-managed)_ |
| **Created** | 2026-06-04 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Adrien's accountant reviewed the current Comptabilité CSV
(`accountant-accounting-export.md`, Implemented PR 1+2+3, 2026-05-29 → 2026-06-01)
and pushed back on two structural points by email on 2026-06-04:

### 1.1 Commission must be a real journal line, not a trailing info column

Today the export reconnaît le CA sur le **net** that the owner receives
(`finalPrice`), with the platform's commission shown only as an information column
(`Commission`) in the CSV — not as a debited charge account. Result: the
turnover declared on the 70xxx accounts is the **net** the owner banks, not the
**brut** the customer paid. The CA is under-stated and the platform commission
(an actual operating expense) is unrecorded as such.

Verbatim example the accountant gave for a Gîtes de France booking:

> Vous avez reçu de Gîtes de France 626 € : le client a payé 687 € (soit 624,55 € HT)
> et en face on a une commission de 61 € (soit 50,83 € HT).
>
> Du coup l'écriture aurait donné :
> ```
> CCLIENT     626
> 706000           624,55
> 445711            62,45
> 622605       50,83
> 445660       10,17
> ```

So the balanced entry must:
- Recognise the **gross** (687 €) as turnover at 706000 + 445711.
- Debit the commission expense (50.83 € HT) on a platform-specific charge account
  (`6226xx`).
- Debit the deductible VAT on commission (10.17 €) on `44566000` — when the
  platform charges VAT.
- Keep the CCLIENT debit at the **net** amount the owner actually banks (626 €).

Per-platform commission account map provided by the accountant:

```
62260300  FRAIS AIRBNB
62260400  FRAIS ABRITEL
62260500  FRAIS GITE DE FRANCE   (avec TVA déductible 20 % sur 44566000)
62260600  FRAIS STRIPE           (avec TVA déductible 20 % si GREENGO, sinon non)
44566000  TVA déductible sur commission
```

The map is **not exhaustive** — Adrien wants it **configurable per iCal source**
(plus a Settings "generic platform" fallback) rather than hard-coded.

### 1.2 No deposit on platform reservations

Per Adrien's clarification on 2026-06-04: every platform booking is paid as a
**single bank transfer** (= the platform forwards the full amount after the stay,
minus its commission). There is no deposit/balance split on the platform side.
Operators today still enter both `depositAmount` + `balanceAmount` on the
reservation form for platform bookings — that produces phantom acompte entries
in the CSV that don't match the bank's single line, and a confusing
"pro-rata-commission-across-two-entries" footprint.

The complement (`complementAmount` — extras the host adds after the stay starts)
**stays available** on platform reservations: it represents money the host
collects **directly** from the guest at check-in, **outside the platform**, so
it carries **no commission**.

### 1.3 What this spec does NOT touch

- The dual-VAT model (10 % accommodation + 20 % standard) and the 70/44571
  account mapping — unchanged.
- The per-platform tourist-tax-collection flag (`ical_sources.collectsTouristTax`)
  and the 46710000 pass-through — unchanged.
- The accountant role gating, the existing Comptabilité page UX + the open
  Pièce-numbering question from the original spec — unchanged. The new
  "Plan comptable" page widens the accountant's allow-list by
  one route pair only.
- The 3-bucket accounting model (deposit / balance / complement) — kept; the
  platform constraint just forces `depositAmount = 0` on platform reservations,
  it does not remove the bucket from the schema.

## 2. Goal

Make every monthly CSV match the écriture model the accountant validated:

1. **Turnover reconnu sur le brut** (`clientGrossAmount`) for every reservation,
   not on the net. For directs `clientGrossAmount === finalPrice` so the entry
   stays mathematically equivalent to today's; for platforms the CA HT grows
   and the difference flows out as commission debit lines.
2. **Commission as real journal lines** (debit on a per-platform `6226xx` charge
   account + deductible VAT on `44566000` when applicable) inside the same
   balanced double-entry as the encaissement.
3. **Configurable per iCal source** — each platform's commission account
   number + has-VAT-on-commission flag is set in the iCal source settings,
   with a generic Settings-wide fallback `622600` / no-VAT.
4. **Platform reservations: deposit hidden, single balance encaissement** —
   the reservation form stops asking for a deposit when `platform !== 'direct'`;
   the engine enforces `depositAmount = 0`; the complement bucket stays for the
   on-site extras case.
5. **Commission attached entirely to the balance entry** on platform
   reservations (no pro-rata across the missing deposit). On the complement
   entry (= on-site extras): no commission line.

## 3. Functional rules

### 3.1 Data model — per **platform** commission config (deduped across iCal sources)

1. **New `platforms` table** — the single source of truth for "per-platform
   accounting config", deduplicated across every iCal source and including
   `direct` for visual consistency:
   ```sql
   CREATE TABLE platforms (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT UNIQUE NOT NULL,            -- 'direct', 'Airbnb', 'Gîtes de France', 'Stripe', …
     commissionAccountNumber TEXT,         -- 8-digit French chart code, NULL = falls back to default
     hasVatOnCommission INTEGER NOT NULL DEFAULT 0
   );
   ```
2. **Auto-seeding at boot** (idempotent — `INSERT OR IGNORE`):
   - Always ensures a `'direct'` row exists (id reserved as the lowest, never
     editable through the UI — see rule 19).
   - Union of TWO sources:
     - `SELECT DISTINCT platformLabel FROM ical_sources WHERE platformLabel IS NOT NULL`
       — every platform configured as an iCal source.
     - `SELECT DISTINCT platform FROM reservations WHERE platform IS NOT NULL
       AND LOWER(platform) != 'direct'` — covers manually-entered platform
       reservations (e.g. operator typed "Booking" on a one-off reservation
       without an iCal sync). Without this branch, a platform that only ever
       appeared in a manual reservation would stay invisible on the config
       page until the operator added an iCal source matching the same name.
   - Re-runs on every successful iCal source create/update (so a freshly
     added Booking source surfaces immediately on the page without a server
     restart).
   - **Operator-triggered rescan**: a "Rafraîchir la liste" button on
     `/comptabilite/plateformes` reposts to `POST /api/accounting/platform-
     accounts/refresh` which re-runs the union (idempotent). Returns
     `newCount = <number of fresh rows added>` so the UI flashes a friendly
     toast: *"+N nouvelle(s) plateforme(s) ramassée(s)"* or *"Aucune nouvelle
     plateforme à ramasser — la liste est à jour."*.
   - Never deletes — a platform that no longer has any iCal source or
     reservation stays visible (operator can manually delete from the new
     page if they want).
3. **Add two columns** to `app_settings`:
   - `defaultCommissionAccountNumber TEXT NOT NULL DEFAULT '622600'` — fallback
     when a platform has `commissionAccountNumber = NULL`.
   - `vatRateCommission REAL NOT NULL DEFAULT 20` — **the** global VAT rate
     applied to platform commissions (single rate across all platforms; lives
     in Settings → Général → Taux de TVA alongside `vatRateAccommodation` 10
     and `vatRateStandard` 20). When fiscal rates change, the operator updates
     this one value.
4. **Resolution at export time** for a reservation entry:
   - Look up the reservation's `platform` string → find `platforms.name` match.
   - `commissionAccount = platforms.commissionAccountNumber ??
      settings.defaultCommissionAccountNumber`.
   - `hasVat = platforms.hasVatOnCommission` (per-platform binary — no global
     default; the row is auto-created with `hasVatOnCommission = 0`, the
     operator opts in for the platforms whose commission IS VAT-subject
     — typically Gîtes de France, Stripe-via-Greengo).
   - When `hasVat = true`: `commissionHt = commissionTtc / (1 +
     settings.vatRateCommission / 100)`; `commissionVat = commissionTtc -
     commissionHt`. **One VAT line on 44566000.**
   - When `hasVat = false` (Airbnb / Abritel / other non-VAT operators):
     `commissionHt = commissionTtc`; no VAT line. The full commission TTC
     hits the 6226xx charge account as HT (consistent with the comptable's
     instruction for non-EU operators).
   - The actual commission TTC is derived from `clientGrossAmount - finalPrice`
     (the operator-typed truth) — there is no per-platform commission rate
     stored on the table (the column was added in an early draft, judged
     useless on 2026-06-04 and removed).
   - `'direct'` matches `platforms.name = 'direct'` whose fields are never
     written — commission = 0 always.

### 3.2 Data model — `clientGrossAmount` on direct bookings

4. `reservations.clientGrossAmount` is now **populated for every reservation**
   (not only platform). For a direct booking, `clientGrossAmount = finalPrice`
   at save time. Migrated for existing data on boot: `UPDATE reservations SET
   clientGrossAmount = finalPrice WHERE clientGrossAmount IS NULL AND (platform
   IS NULL OR platform = 'direct')`. The "gross < net = error" rule of the
   original spec (rule 8) stays — for directs it can never fire because
   gross = net.

### 3.3 Data model — no deposit on platform reservations

5. Adding a new platform reservation (form save where `platform !== 'direct'`):
   server enforces `depositAmount = 0`, `depositPaid = 0`, `depositPaidDate =
   NULL`, `depositDueDate = NULL`. Whatever the client sent is overridden
   silently with a one-time warning log. The whole `clientGrossAmount` lands on
   the **balance** by default at quote time.
6. Editing an existing platform reservation: same enforcement on save.
7. Switching a direct reservation to a platform: server zero-collapses the
   deposit into the balance (`balanceAmount += depositAmount; depositAmount =
   0; deposit* flags cleared`). The per-line `acompteContribTtc` snapshots, if
   any, are zero'd out — the contrib-driven path falls back to legacy
   pro-rata for that reservation (rare edge case).
8. Switching a platform reservation to a direct: no automatic split — the
   operator sees the full amount on the balance and can move part of it to a
   new deposit manually if they want.

### 3.4 Legacy migration on boot

9. **One-time migration** at server start (idempotent — protected by a
   schema-version flag `migrations.platform_no_deposit_done = 1`):
   - For every `kind='reservation'` row with `platform != 'direct'` AND
     `depositAmount > 0`:
     ```
     UPDATE reservations
       SET balanceAmount = balanceAmount + depositAmount,
           depositAmount = 0,
           depositPaid = 0,
           depositPaidDate = NULL,
           depositDueDate = NULL
     ```
     The per-line `acompteContribTtc` snapshots on the matching `reservation_*`
     children are also nulled out (the legacy pro-rata path catches up for any
     reservation already fully paid).
   - The migration is logged: `[migration:platform-no-deposit] migrated N
     reservation(s)`.
   - **Past CSV exports change retroactively** on these migrated reservations
     (deposit lines disappear, balance lines now carry the full amount +
     commission). This is acceptable per Adrien's call on 2026-06-04 (the past
     CSV was already imprecise per the accountant's feedback; a one-shot wave of
     corrected lines is the cleanest break).
10. **Backward compatibility** — `accountingModel.encaissementsByMonth` no
    longer emits a deposit entry when `depositAmount = 0` (already true today;
    explicitly verified after the migration).

### 3.5 Accounting engine — write the new balanced entry

11. **Commission resolution** for an encaissement:
    - `gross` = the entry's portion of `clientGrossAmount` (= entry portion of
      `finalPrice` for directs, since `clientGrossAmount = finalPrice`).
    - `commissionTtc` = the entry's portion of `clientGrossAmount - finalPrice`,
      where the entry's portion = full commission on the **balance** entry, 0
      on the deposit (= no deposit on platforms anyway), 0 on the **complement**
      entry (on-site extras have no commission).
    - For directs: `commissionTtc = 0` for every entry → no commission line.
12. **Balanced double-entry per encaissement**:
    - **Debit `C<NAME>`** for the **NET** the owner actually banked:
      `encaissementNetTtc = encaissementGrossTtc - commissionTtc`. This matches
      the bank movement (626 € in the GdF example).
    - **Debit commission HT** on `commissionAccount` (per §3.1) for
      `commissionHt = hasVat ? commissionTtc / (1 + settings.vatRateCommission /
      100) : commissionTtc` — when the platform isn't VAT-subject the full
      TTC is booked as HT.
    - **Debit commission VAT** on `44566000` for `commissionVat = commissionTtc
      - commissionHt`, **only when `hasVat = true`**.
    - **Credit 70xxxx** revenue lines per bucket (accommodation / options /
      resources / custom options) for `bucketHt × (encaissementGrossTtc /
      totalStayGrossTtc)` — note: pro-rata denominator switches from
      `totalStayPrice` (= finalPrice + tourist tax, today's rule 29) to
      `totalStayGrossTtc` (= `clientGrossAmount` + tourist tax). For directs,
      gross = net so the denominator is unchanged; only platforms see the new
      denominator.
    - **Credit 44571x** VAT lines per rate (10 % / 20 %) following the same
      pro-rata.
    - **Credit 46710000** tourist-tax pass-through unchanged.
    - Sum check: `Σ debits == Σ credits == encaissementGrossTtc` (the brut).
    - Rounding: residue absorbed in the **last credit line**, same as today, so
      the entry balances to the cent.
13. **Tourist tax interaction unchanged**: when `quote.touristTaxCollectedOnArrival
    = true` (owner-collect non-direct), the deposit + balance entries still
    pro-rate against `finalPrice` (not gross) and the complement carve-out
    rule from the original spec §3.4 rule 30 still applies. The new commission
    lines are computed on the **finalPrice-aligned** gross in this case
    (= clientGrossAmount without the tax portion).

### 3.6 CSV columns

14. The 9 SOLIO columns stay byte-for-byte identical: `Jour ; Mois  ; Année ;
    Journal ; Pièce ; Libellé de l'écriture ; Compte ; Débit ; Crédit`. The
    new commission debit lines slot in alongside the existing credits, sorted
    after the CCLIENT debit and before the 70xxx credits — same line ordering
    convention as the accountant's example.
15. The 3 GuestFlow extension columns (`Plateforme ; Prix payé client ;
    Commission`) stay on the CCLIENT debit row only. The `Commission` value
    becomes the **TTC** commission (= sum of the new commission debit + VAT
    debit lines) — was already the case in spirit but now matches the actual
    journal line totals.

### 3.7 Dedicated "Plan comptable" page (admin + accountant)

16. **New page** at **`/comptabilite/plateformes`** — a dedicated read-write
    table where both **admin** and **accountant** roles can configure the
    commission accounting for every **platform** (deduplicated across all
    iCal sources, regardless of property). NOT placed inside Paramètres → iCal
    (the accountant can't reach Paramètres). NOT placed inside the existing
    `/comptabilite` page either, to keep that one focused on the month export.
17. **Page layout** — `PageActionBar title="Plan comptable"`,
    Save / Cancel canonical actions:
    - **Top card "Compte par défaut"**: a single number input "Compte
      commission par défaut" (8 chiffres, default `622600`). Persists to
      `app_settings.defaultCommissionAccountNumber`. Helper text: *"Utilisé
      pour les plateformes qui n'ont pas leur propre compte commission
      renseigné."* The TVA rate is not on this page — it lives in Settings →
      Général → Taux de TVA (rule 17b).
    - **Bottom card "Par plateforme"**: a `TableCard` listing every row of the
      `platforms` table (auto-deduped — see §3.1 rule 2). Columns:
      - *Plateforme* (read-only label, e.g. "Airbnb", "Gîtes de France",
        "Direct").
      - *Compte commission* (text input, 6–8 digits, placeholder shows the
        resolved fallback `"622600 (défaut)"` when empty).
      - *TVA déductible* (Switch — ON for platforms whose commission carries
        French VAT, OFF for Airbnb/Abritel and other non-EU/non-VAT operators).
        The rate itself (currently 20 %) is read from
        `settings.vatRateCommission` at export time — not editable here.
    - The page does NOT store a per-platform commission rate (column was
      dropped on 2026-06-04 as useless — the actual commission TTC is derived
      from `clientGrossAmount - finalPrice` on each reservation).
17b. **Settings → Général → Taux de TVA** — the existing card grows by **one
    field**: "TVA déductible commissions" (number input, %, default 20). It
    sits alongside the existing "TVA hébergement" (10 %) and "TVA standard"
    (20 %) fields. Same `HelpedTextField` shape; helper text: *"Taux appliqué
    aux commissions plateforme qui sont marquées 'TVA déductible' dans le Plan
    comptable plateformes."* No new endpoint — the existing `PUT /api/settings`
    accepts the new field.
18. **`Direct` row is always present + always disabled**:
    - Auto-inserted into `platforms` at boot if absent (rule 2).
    - Every input on the Direct row is rendered disabled with a muted
      caption *"Pas de commission sur les réservations directes"*.
    - Server PUT silently ignores any field write on the `direct` row (it's
      kept in the response shape just to keep the row visible).
19. **Role access** (server-side, fail-closed):
    - `GET /api/accounting/platform-accounts` — admin **or** accountant.
      Returns `{ defaultAccount, vatRateCommission, platforms: [{ id, name,
      commissionAccountNumber, hasVatOnCommission, isDirect }, …] }`. The
      `vatRateCommission` is included for read-only display in the page's
      caption; the canonical write surface stays `PUT /api/settings` which
      is admin-only.
    - `PUT /api/accounting/platform-accounts` — admin **or** accountant. Body
      = `{ defaultAccount, platforms: [{ id, account, hasVat }, …] }`.
    - `POST /api/accounting/platform-accounts/refresh` — admin **or**
      accountant. No body. Returns `{ defaultAccount, vatRateCommission,
      platforms, newCount }`. Triggers the union rescan (rule 2).
    - Other `/api/ical-sources/*` routes and the `vatRateCommission` write
      (`PUT /api/settings`) stay **admin-only**.
20. **Sidebar wiring**:
    - **Admin**: new sub-item *"Plan comptable"* under the
      existing **Suivi financier** group (next to *Comptabilité*).
    - **Accountant**: minimal sidebar — *Comptabilité*, **NEW** *Plan comptable
      plateformes*, *Mot de passe*, *Se déconnecter*. The accountant's
      client-side redirect rule is widened by one path
      (`/comptabilite/plateformes`).
21. **Validation**:
    - `defaultCommissionAccountNumber`: required, 6–8 digits, digits-only.
    - Per-platform `commissionAccountNumber`: optional. If provided, 6–8
      digits, digits-only. Empty = uses the default.
    - Per-platform `hasVatOnCommission`: boolean (Switch).
    - **Global** `vatRateCommission` (managed in Settings, not on this page):
      required ≥ 0, ≤ 100, default 20. Validated by the existing
      `settingsController` alongside the other VAT rates.
    - The Direct row's fields are server-side ignored (rule 18).

### 3.8 Reservation form UI

21. **FinanceSection** — when `platform !== 'direct'`:
    - The whole **Acompte block** is hidden (title, amount input, "Marquer
      payé" toggle, "Payé le" date). A subtle caption replaces the block:
      *"Pas d'acompte (réservation plateforme — virement unique)"*.
    - The Solde block becomes the only encaissement (plus the optional
      Complément). Its title can stay "Solde" or shift to "Encaissement" — see
      Q1.
    - The "Prix payé par le client" gross field stays visible (already
      platform-only per the original spec rule 7).
    - A small computed caption beneath the gross field shows the **commission
      that will be journalised**: "Commission plateforme: 61,00 € TTC (50,83 €
      HT + 10,17 € TVA) sur le compte 62260500" — reading from the resolved
      `(commissionAccount, hasVat)` of the matched `platforms` row.
22. **ReservationPage save logic** — if the operator types into the Acompte
    fields and later changes the platform from direct to non-direct (or
    selects a non-direct iCal source on a new reservation), the form
    auto-collapses deposit into balance client-side so the UI matches the
    server-side enforcement (rule 5). The opposite direction (platform →
    direct) shows a snackbar: *"Tu peux maintenant ajouter un acompte si
    besoin"*.

**Edge cases:**
- **Platform reservation with `clientGrossAmount` not yet entered** (legacy or
  fresh import): `commissionTtc = 0`, the entry behaves like a direct (CA HT
  on the net). A warning chip on the journal card surfaces the missing gross:
  *"Brut client non renseigné — commission non comptabilisée"*. Operator fills
  it → next export run picks it up.
- **`clientGrossAmount` < `finalPrice`** on a platform: already a 400
  validation error (original rule 8). Unchanged.
- **`hasVatOnCommission = 1` but `commissionTtc = 0`** (zero-commission
  platform, e.g. a partner gift): no commission lines emitted; the entry
  shape collapses to a direct's. Verified by a test case.
- **Tourist tax in complement** on a platform reservation: the complement
  entry has 0 commission (host-billed), 0 tax-collected-on-arrival routing
  only applies to deposit/balance pro-rata, complement's tax stays on
  46710000. No change to the existing rule.
- **Legacy reservation with no `clientGrossAmount`** and `platform !=
  'direct'`: after the migration the deposit collapses into the balance but
  the `clientGrossAmount` migration only fires for directs (§3.2). The
  operator has to fill the field to unlock commission accounting. Surfaced
  via the existing "Prix payé par le client" required field.
- **A platform reservation imported via iCal** (current PR #106 flow): the
  iCal sync sets `platform` from the source's name; the sync now also sets
  `depositAmount = 0` (already de facto since iCal sync doesn't set deposit
  fields). No code change in the iCal worker.

---

## 4. Architecture

> **Fat backend, thin frontend.** All journal-line generation, commission
> resolution per platform, pro-rata splitting, rounding, account mapping +
> CSV serialization live on the server. The client only renders fields and
> calls endpoints.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` | T | Migrations: NEW `platforms` table (idempotent CREATE) + auto-seed `'direct'` row + auto-seed from `DISTINCT ical_sources.platform`; +2 columns on `app_settings` (`defaultCommissionAccountNumber`, `vatRateCommission` default 20); idempotent `migrations.platform_no_deposit_done` flag table. Backfill `clientGrossAmount = finalPrice` for direct rows. |
| `models/platformsModel.js` | C | NEW: `listAll()`, `upsertByName(name)` (used by the iCal sync hook to auto-add fresh platforms), `update({id, account, hasVat, ratePercent})`, `findByName(name)` (used by `accountingModel.buildEntry` to resolve the commission config). |
| `models/icalSourcesModel.js` | T | After successful create/update of a source whose `platform` is new, call `platformsModel.upsertByName(platform)` so the new platform appears immediately on the dedicated page (rule 2). |
| `models/settingsModel.js` | T | Read/write `defaultCommissionAccountNumber` + `vatRateCommission`. The latter sits alongside the existing two VAT rates in the Settings → Général card. |
| `controllers/settingsController.js` | T | Accept/validate the new `vatRateCommission` (0–100) alongside the existing VAT fields. |
| `components/SettingsVatSection.js` | T | Add a third number field "TVA déductible commissions" (% default 20) — same shape as the existing two. |
| `models/platformAccountsModel.js` | C | Aggregator model for the dedicated page: `getAll()` returns `{ defaultAccount, defaultHasVat, platforms: [{id, name, account, hasVat, ratePercent, isDirect}] }`; `saveAll(payload)` writes the settings row + the per-platform rows in a single SQLite transaction; ignores writes targeting the `'direct'` row (rule 18); rolls back atomically on validation failure. |
| `controllers/platformAccountsController.js` | C | Thin GET / PUT pair. Validates 8-digit account format. Surfaces the model output. |
| `routes/accounting.js` | T | Mount two new routes `/api/accounting/platform-accounts` (GET + PUT). Both gated by the accountant allow-list (see `middleware/enforceRoleAccess.js`). |
| `middleware/enforceRoleAccess.js` | T | Allow-list extension: add `GET /api/accounting/platform-accounts` and `PUT /api/accounting/platform-accounts` for the accountant role. |
| `models/reservationsModel.js` | T | Enforce `depositAmount = 0` server-side when `platform !== 'direct'` on insert/update. Populate `clientGrossAmount = finalPrice` for directs at save time. |
| `controllers/reservationsController.js` | T | Plumb the platform → no-deposit enforcement through the create/update paths. |
| `controllers/icalSourcesController.js` | T | Accept/validate the two new fields on PATCH. |
| `controllers/settingsController.js` | T | Accept/validate the two new fields on PATCH. |
| `models/accountingModel.js` | T | `buildEntry` now: (a) reads `clientGrossAmount` (defaulted to `finalPrice` if NULL) instead of `finalPrice` for the gross; (b) for the balance entry of a non-direct reservation, computes `commissionTtc = grossEntryPortion - netEntryPortion`; (c) resolves `(commissionAccount, hasVat)` from `platformsModel.findByName(reservation.platform)` with the settings fallback; (d) emits the new commission debit line(s); (e) keeps the CCLIENT debit at the net (= owner-banked) amount. |
| `utils/accountingExport.js` | T | `buildRows` + `buildStructuredEntries`: emit the new commission debit lines between CCLIENT and the 70xxx credits. Update `accountLabel` map: `622600 → 'Frais plateforme générique'`, `62260300 → 'Frais Airbnb'`, etc.; `44566000 → 'TVA déductible commission'`. The `accountLabel` for the dynamic 622600x codes is resolved from a function (not a hard-coded map) since the operator can plug any account. |
| `constants/accounting.js` | T | New constants: `DEFAULT_COMMISSION_ACCOUNT = '622600'`, `VAT_DEDUCTIBLE_COMMISSION_ACCOUNT = '44566000'`. Helper `commissionAccountLabel(num)` returning the human label per the well-known map + a `'Frais commission (' + num + ')'` fallback. |
| `tests/` | C | New test files (see §7). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/PlatformAccountsPage.js` | C | NEW dedicated `/comptabilite/plateformes` page. Top "Valeurs par défaut" card + bottom `TableCard` row-per-iCal-source. PageActionBar with Save/Cancel canonical actions. Accessible to admin + accountant. |
| `App.js` (routing + sidebar) | T | New route `/comptabilite/plateformes`. Sidebar wiring: admin sub-item under Suivi financier; accountant gets the link in the minimal sidebar; redirect-rule allow-list extended. |
| `components/reservation/FinanceSection.js` | T | Hide Acompte block when platform !== direct; surface the resolved commission account + computed TTC/HT/VAT under the gross field. |
| `pages/ReservationPage.js` | T | Client-side auto-collapse deposit → balance on platform change + snackbar for the opposite direction (rule 22). |
| `pages/AccountingPage.js` | T | Journal preview now renders the new commission debit lines (color per Q3). |
| `api.js` | T | New `getPlatformAccounts()` / `savePlatformAccounts({…})` clients. |

**Component reuse declaration:**
- **Consumed (existing generic)**: `PageActionBar`, `HelpedTextField`,
  `TableCard`, `DataPageScaffold`, the existing Switch pattern. Mirror the
  shape of `SettingsAccountantAccessSection.js` for the page card layout
  rationale.
- **Created (new generic)**: none.
- **Specific (kept feature-local)**: `PlatformAccountsPage` itself (the
  whole page) + the "Commission preview caption" under the gross input in
  FinanceSection.

### 4.3 API contract changes

| Method | Endpoint | Role | Request changes | Response changes |
|---|---|---|---|---|
| GET | `/api/accounting/platform-accounts` | admin **or** accountant | — | `{ defaultAccount, defaultHasVat, platforms: [{ id, name, account, hasVat, ratePercent, isDirect }, …] }` |
| PUT | `/api/accounting/platform-accounts` | admin **or** accountant | `{ defaultAccount, defaultHasVat, platforms: [{ id, account, hasVat, ratePercent }, …] }` (writes targeting `isDirect=true` row are silently ignored) | updated `{ … }` |
| GET | `/api/settings` | admin | — | unchanged externally (defaults are read via the dedicated endpoint above) |
| GET | `/api/accounting/sales.csv` | admin **or** accountant | — | CSV now includes commission debit lines on non-direct entries |
| GET | `/api/accounting/sales` | admin **or** accountant | — | JSON mirror — `entries[i].lines[]` includes lines with `type='commission_charge' / 'commission_vat'`; existing `client/revenue/vat/tax_pass_through` types unchanged |

The `/api/accounting/platform-accounts` endpoints are gated by the existing
`enforceRoleAccess` middleware extension: the accountant allow-list grows by
two routes (one GET + one PUT). The PUT writes the same `app_settings` +
`ical_sources` rows the admin can also reach via the legacy Settings / iCal
admin endpoints — there's a single source of truth, two HTTP surfaces.

---

## 5. Data model

```sql
-- Idempotent boot migrations
CREATE TABLE IF NOT EXISTS platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  commissionAccountNumber TEXT,
  hasVatOnCommission INTEGER NOT NULL DEFAULT 0
);
-- The legacy `commissionRatePercent` column (early-draft, judged useless on 2026-06-04)
-- is dropped on subsequent boots if found via PRAGMA table_info.

-- Always-present 'direct' row (UI-disabled, never used at export time)
INSERT OR IGNORE INTO platforms (name) VALUES ('direct');

-- Auto-seed from existing iCal sources
INSERT OR IGNORE INTO platforms (name)
  SELECT DISTINCT platform FROM ical_sources WHERE platform IS NOT NULL;

ALTER TABLE app_settings ADD COLUMN defaultCommissionAccountNumber TEXT NOT NULL DEFAULT '622600';
ALTER TABLE app_settings ADD COLUMN vatRateCommission REAL NOT NULL DEFAULT 20;

-- One-shot migration table (idempotency guard for the platform→no-deposit sweep)
CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY,
  ran_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Migration: collapse legacy platform deposits into balance
-- (only fires if migrations row absent)
INSERT INTO migrations (name) VALUES ('platform_no_deposit_v1');
UPDATE reservations
   SET balanceAmount = balanceAmount + depositAmount,
       depositAmount = 0,
       depositPaid = 0,
       depositPaidDate = NULL,
       depositDueDate = NULL
 WHERE kind = 'reservation'
   AND platform IS NOT NULL
   AND platform != 'direct'
   AND depositAmount > 0;

-- Migration: populate clientGrossAmount for direct bookings
UPDATE reservations
   SET clientGrossAmount = finalPrice
 WHERE kind = 'reservation'
   AND clientGrossAmount IS NULL
   AND (platform IS NULL OR platform = 'direct');
```

**Data impact summary:**
- New `platforms` table — auto-seeded from `'direct'` + existing iCal sources.
  Idempotent CREATE + INSERT OR IGNORE → safe to re-run on every boot.
- app_settings (singleton): 2 new defaulted columns.
- `ical_sources` is **read-only** for this spec — no schema change there. The
  iCal source create/update path gains a one-line side-effect call to
  `platformsModel.upsertByName(platform)` after a successful write.
- Reservations:
  - Direct rows: `clientGrossAmount` becomes non-NULL (= `finalPrice`).
  - Legacy platform rows with deposits: `depositAmount` collapsed into
    `balanceAmount`, deposit flags cleared. **Past CSV exports change
    retroactively** — acceptable per Adrien's 2026-06-04 call.
  - Per-line `acompteContribTtc` snapshots on the migrated platform
    reservations are nulled out → those reservations fall back to the
    legacy pro-rata path in `buildEntry`. Marginal accuracy loss
    (the snapshot precision was already irrelevant since the deposit
    vanished).

## 6. UI / UX

- **Nouveau page `/comptabilite/plateformes`** ("Plan comptable")
  — accessible aux deux rôles (admin + comptable). `PageActionBar` avec Save /
  Cancel. Deux cartes:
  - **Compte par défaut** (carte du haut): un seul `HelpedTextField` "Compte
    commission par défaut" (8 chiffres, default `622600`). Helper text:
    *"Utilisé pour les plateformes qui n'ont pas leur propre compte
    commission renseigné."* Le taux TVA n'est PAS sur cette page — il vit
    dans Réglages → Général → Taux de TVA, en cohérence avec les deux autres
    taux (hébergement 10 %, standard 20 %).
  - **Par plateforme** (carte du bas): un `TableCard` listant chaque ligne de
    la table `platforms`. Colonnes:
    - *Plateforme* (libellé read-only)
    - *Compte commission* (input 6–8 digits, placeholder = valeur par défaut)
    - *TVA déductible* (Switch — quand ON, l'engine applique le taux global
      `settings.vatRateCommission`)

    La ligne *Direct* est toujours présente, tous les champs grisés avec un
    caption *"Pas de commission sur les réservations directes"*.
    Tri par nom (avec Direct en première position pour rappel visuel).
    Validation visuelle inline (rouge si le compte n'est pas 6–8 chiffres).

    Un caption read-only au-dessus de la table montre le taux TVA actif:
    *"TVA déductible commissions appliquée: 20 %  (modifiable dans Réglages
    → Général)"*. Pour les admins, le `20 %` est un lien vers `/settings`;
    pour le comptable c'est du texte simple (il ne peut pas y aller).
  - **Sidebar admin**: nouveau sous-item *"Plan comptable"* sous
    *Suivi financier* (à côté de *Comptabilité*). **Sidebar comptable**:
    *Comptabilité* → *Plan comptable* → *Mot de passe* → *Se
    déconnecter*.
- **Paramètres (admin) → Général → Taux de TVA** — la carte existante
  `SettingsVatSection` gagne **un 3ème champ** *"TVA déductible commissions"*
  (% number input, default 20). Même shape `HelpedTextField` que les deux
  champs existants. Helper text: *"Taux appliqué aux commissions plateforme
  marquées 'TVA déductible' dans le Plan comptable."*
- **Reservation FinanceSection** —
  - Direct booking: unchanged.
  - Platform booking: Acompte block replaced by a single-line caption ("Pas
    d'acompte (réservation plateforme — virement unique)"). The Solde block
    becomes the primary encaissement. Below the "Prix payé par le client"
    input, a green "Commission journalisée: 61,00 € TTC = 50,83 € HT + 10,17 €
    TVA · compte 62260500" caption surfaces the live preview.
- **AccountingPage journal cards** — new line types render with a charge
  color (proposed: a muted brick `#a36b3b` for commission HT, a darker brick
  for commission VAT). The total line count grows by 1 (no-VAT) or 2 (VAT
  case) per platform encaissement. The pro-rata percentage caption still
  reflects the **gross** denominator.
- **Mobile (xs)**: FinanceSection Acompte-hidden state needs the caption to
  wrap cleanly; AccountingPage journal cards already reflow per the original
  spec.

## 7. Test plan

### 7.1 Server unit tests (new)

| Test file | Cases | Pins |
|---|---|---|
| `accounting-commission-lines.unit.test.js` (C) | (1) Direct booking: no commission line. (2) Platform without VAT (Airbnb): one commission charge debit, no VAT debit, CCLIENT at net. (3) Platform with VAT (GdF): two commission debits, balanced. (4) Configured-per-source account override beats the settings default. (5) Settings fallback when source has no override. (6) Complement entry: 0 commission regardless of platform. (7) Tourist-tax-on-arrival pro-rata interplay: commission computed against the finalPrice-aligned gross, not the full clientGrossAmount + tax. | Rules 11–13. |
| `accounting-no-deposit-on-platform.unit.test.js` (C) | (1) Insert platform reservation with deposit → server overrides to 0. (2) Update direct → platform: deposit collapsed into balance, contribs nulled. (3) Update platform → direct: balance kept as-is, no auto-split. (4) Legacy migration: platform deposits collapsed at boot, idempotent. | Rules 5–9. |
| `accounting-export-gross-denominator.unit.test.js` (C) | (1) Direct: pro-rata uses `finalPrice + touristTaxTotal` (unchanged). (2) Platform: pro-rata uses `clientGrossAmount + touristTaxTotal`. (3) Σ credits == Σ debits to the cent in every case. | Rule 12. |
| `platforms-model.unit.test.js` (C) | (1) Boot creates the table + `'direct'` row. (2) Boot auto-seeds from `DISTINCT ical_sources.platform`. (3) `upsertByName` is idempotent (no duplicate). (4) `findByName('Airbnb')` returns the row. (5) `update` on the Direct row is a no-op (rule 18). | Rules 1–4 + 18. |
| `accounting-platform-accounts-endpoint.unit.test.js` (C) | (1) GET as admin returns default account + platforms list. (2) GET as accountant returns the same shape. (3) GET as unknown role → 403. (4) PUT as accountant updates default account + per-platform rows. (5) PUT with invalid 8-digit account → 400. (6) PUT with empty per-platform account → falls back to default at export time. (7) Default account cannot be cleared (rule 21). (8) PUT silently ignores writes to the Direct row. (9) PUT with rate > 100 → 400. (10) `vatRateCommission` is NOT in the response or write payload (it's in /api/settings). | Rules 16–21. |
| `settings-vat-rate-commission.unit.test.js` (C) | (1) Default 20. (2) Range 0–100 validated. (3) PUT round-trips. (4) Used by the engine in `commissionHt` extraction. | Rules 3, 17b. |

### 7.2 Existing server suite

Stays green. The original `accounting-export.unit.test.js` may have 2-3 cases
that need their expected output updated (now includes commission lines for
platform fixtures); they get updated atomically with this spec, not
relaxed away.

### 7.3 Client Vitest tests (new)

| Test file | Cases | Pins |
|---|---|---|
| `FinanceSection.platform-no-deposit.test.js` (C) | (1) Direct: Acompte block visible. (2) Platform: Acompte block hidden + caption present. (3) Direct → platform: deposit collapsed into balance client-side. (4) Commission preview caption shows resolved account + HT/TTC/VAT. | Rules 18–19. |

### 7.4 E2E suite (PR #110)

Unchanged. Stays at **18 passed / 1 skipped / 0 failed**.

### 7.5 Manual smoke after deploy

- Trigger a boot → migration log shows `[migration:platform-no-deposit]
  migrated N reservation(s)`.
- Past month CSV: previously-platform-deposit reservations now have a single
  balance line with commission instead of split deposit+balance.
- Open a fresh platform reservation: Acompte block hidden, the "Brut payé"
  preview surfaces the commission account + HT/TTC.
- Paramètres → iCal: edit a source, set commission account + has-VAT, save,
  reopen → values persist.
- Paramètres → Compta: edit default fallback values, save, reload → values
  persist.
- AccountingPage: download CSV, open in Excel, verify the GdF-shaped écriture
  matches the accountant's example numerically.

### 7.6 Rollback path

The migration is destructive (deposit collapsed into balance). Rollback
requires either:
- a DB snapshot before the deploy (recommended), or
- a manual SQL to re-split the lines using `reservation_history` audit
  entries (slow, partial).

Document in the CHANGELOG: "Before deploying this PR to prod, snapshot the
SQLite DB."

## 8. Out of scope

- Other commission accounts (e.g. host fees beyond platform commission) —
  outside the scope; if the accountant adds a new charge category, it gets
  its own follow-up spec.
- Auto-detection of which iCal source a manual non-iCal platform reservation
  belongs to (today an iCal source is linked via `reservations.icalSourceId`;
  if a platform booking was entered manually without an iCal source, the
  fallback settings values are used — no UI to pick a source on the
  reservation form for now).
- Per-platform commission **rate** auto-fill (e.g. "Airbnb commission =
  3 %"). Today the operator types the gross; the commission is derived. A
  follow-up spec could auto-fill from a rate table.
- Pièce numbering scheme (still open from the original spec §10) — separate
  follow-up when the accountant decides.

## 9. Open questions

(Resolved before Status → Approved.)

- **Q1** (resolved 2026-06-04): **Keep "Solde"** label on platform
  reservations. The caption "Pas d'acompte — virement unique" gives enough
  context; the DB field is still `balanceAmount`, no cognitive shift.
- **Q2** (resolved by the platforms-table revision): the per-platform config
  lives in the new `platforms` table keyed by name, so the iCal source link
  is not needed to resolve the account — every reservation whose `platform`
  string matches a row in `platforms` picks up that row's config. Manually
  entered platforms (no iCal link) inherit the same row as their iCal-imported
  cousins of the same name. **No alias resolution needed.**
- **Q6** (added 2026-06-04 after the spec update): Where do we surface the
  global default values (`defaultCommissionAccountNumber` /
  `defaultHasVatOnCommission`) — only on the new `/comptabilite/plateformes`
  page (single source of truth) or also mirrored read-only inside Paramètres
  → Compta so the admin sees them at a glance?
  - Proposed: **only on the new page**. Mirroring elsewhere creates two
    places to look (= drift risk). The admin sidebar link is one click away
    anyway.
- **Q7** (resolved 2026-06-04 during implementation): The
  `commissionRatePercent` column was dropped from `platforms`. The
  informational column on the dedicated page was judged useless by Adrien
  on 2026-06-04 (commission TTC is operator-typed via `clientGrossAmount -
  finalPrice`, no real need to also store a typical rate). A follow-up
  spec can re-add it if auto-fill of the gross from a per-platform rate
  becomes desired.
- **Q8** (added 2026-06-04): A platform name in `ical_sources` that's later
  renamed in the iCal source admin — do we rename the corresponding
  `platforms` row, or leave the old name visible as a "ghost" until manually
  deleted?
  - Proposed: **leave as ghost** for v1. Auto-rename is fragile (multi-source
    rename, mid-month reservations). The dedicated page can grow a
    "Supprimer" button per-row in a follow-up if ghosts accumulate.
- **Q3** (resolved 2026-06-04): Journal preview color for commission lines —
  **brick tones** `#a36b3b` (HT) / `#7d4c1f` (VAT). Easy to revisit visually
  after the first real CSV.
- **Q4** (resolved 2026-06-04): **3 commits** on the branch — (1) backend
  (schema + models + controllers + tests), (2) client UI (settings + new
  page + finance section), (3) smoke tests + spec status flip + CHANGELOG.
  Squashed on merge per CLAUDE.md §5.3.
- **Q5** (resolved 2026-06-04): Bundle budget **≤ +10 kB gzip** vs the
  post-React-19 baseline (462.15 kB). New page + 2-3 fields + caption; should
  easily fit.
