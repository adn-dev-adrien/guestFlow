# Accounting — encaissement amounts from stored money & effective-percent bucket split

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/accounting-encaissement-effective-percent` |
| **Created** | 2026-07-15 |
| **Author** | Adrien |
| **Related PR** | [#334](https://github.com/adn-dev-adrien/guestFlow/pull/334) |

---

## 1. Context

The Comptabilité page (journal cards + « Encaissements du mois » table + sales CSV — all driven by
`accountingModel.encaissementsByMonth` → `utils/accountingExport`) shows wrong amounts for
per-échéance-commission reservations. Reference case: reservation #22224 (Thomas Vanden wildenberg,
Lodgify, Aventura lodge) — `finalPrice` 131,28 €, tourist tax 2,98 €, `depositAmount` =
`balanceAmount` = 67,13 € (each = 50 % of the 134,26 € gross charged by Lodgify),
`acompteCommissionAmount` = `platformCommissionAmount` = 1,93 €.

Observed vs expected on the **deposit** entry:

| Surface | Today | Expected | Why it's wrong today |
|---|---|---|---|
| CA / « Revenu brut » (`encaissementTtc`) | 65,64 | **67,13** (= `depositAmount`) | `grossRatio = finalPrice / Σ(stored échéances)` = 131,28/134,26 rescales the stored amount because the denominator includes the tourist tax but the numerator doesn't. |
| « Net perçu » (`encaissementNetTtc`) | 63,71 | **65,20** (= `depositAmount − acompteCommissionAmount`, the fiche résa summary « Acompte » line) | Derived from the shrunk CA. |
| Débit CCLIENT | 63,71 | **65,20** | Same. |
| Débit commission | 1,93 | 1,93 ✓ | Correct (per-échéance commission). |
| Crédit « Location gîte » | 48,50 | **40,11** | Legacy path reads `quote.accommodationNetPrice` from a **recomputed** quote; pricing rules drifted since booking, so the bucket no longer reflects the stored price. |
| Crédit « Prestation complémentaire » (options) | 9,55 | **20,92** | Same drift + residue absorption garbage. |
| Crédit TVA 10 % | 7,59 | **6,10** | Same. |

Two root causes:

1. **`grossRatio` mis-normalises the current-model rows.** For reservations whose stored schedule is
   the gross the guest paid (deposit + balance + complement = `finalPrice` + tourist tax — the shape
   the pricing engine writes since `platform-per-echeance-commission.md`), the ratio must be **1**.
   Today it is `finalPrice / storedSum`, which is < 1 whenever the tax is in the schedule.
2. **Legacy-path buckets come from a recomputed quote, not from stored money.** The engine re-derives
   accommodation/options from *current* pricing rules; any tariff drift corrupts the credit lines
   (the stale-quote problem that `accounting-export-legacy-path-stale-quote` already fights). The
   stored row data (`finalPrice`, per-line `totalPrice`) is the truth of what was sold.

## 2. Goal

Every encaissement on the Comptabilité page (cards, table, CSV) shows the money that actually moved:
CA = the amount the guest paid for that échéance, net = CA − that échéance's commission, and the
revenue/VAT credit lines are the stored accommodation/options/resources amounts split by the
reservation's **effective** acompte/solde percentage — for **all** reservations of the month, with a
non-regression test pinning each corrected figure.

## 3. Functional rules

Decisions taken with Adrien on 2026-07-15 (AskUserQuestion):
- The percent applied to the buckets is the **effective percent of the reservation**
  (= what the money says), not the property's raw `depositPercent`. When the deposit was computed
  automatically, the effective percent *equals* the property setting; when it was overridden
  (Thomas: 67,13 → 51,14 %), the entry stays balanced and matches the real payment.
- Tourist tax keeps riding **entirely on the solde** (`specs/tourist-tax-on-solde.md` unchanged):
  no tax line on the deposit entry; the deposit card has exactly 5 lines (client, commission,
  gîte, options, TVA).

### Rules

1. **Gross-up ratio.** Per reservation:
   - entered-commission model (`acompteCommissionAmount + platformCommissionAmount > 0`):
     `ratio = (finalPrice + touristTaxTotal) / Σ(depositAmount + balanceAmount + complementAmount)`.
     For every reservation written by the current engine the schedule sums to exactly
     `finalPrice + touristTaxTotal`, so **ratio = 1** and stored amounts pass through unscaled.
     Rows from the old « solde = net » era (e.g. prod #7: balance 903, finalPrice 994, commission 91)
     get ratio > 1 and gross up to what the guest paid — same intent as before, fixed numerator.
   - legacy `clientGrossAmount` model (no entered commission, stored gross > finalPrice):
     unchanged — `ratio = clientGrossAmount / finalPrice`, commission = gross − finalPrice.
   - direct / no commission data: ratio = 1.
2. **CA per échéance** (`encaissementTtc`, the card header, « Revenu brut », the table column):
   `round2(storedAmount × ratio)` where storedAmount ∈ {`depositAmount`, `balanceAmount`,
   `complementAmount`}. Thomas deposit → **67,13**.
3. **Commission per échéance** (unchanged allocation): deposit → `acompteCommissionAmount`,
   balance → total commission − acompte share, complement → 0. VAT-on-commission split
   (`hasVatOnCommission` → HT + 44566000 line at `vatRateCommission`) unchanged. Thomas → **1,93**.
4. **Net perçu** (`encaissementNetTtc`, CCLIENT debit, « Net perçu » column):
   `CA − commission_échéance`. Thomas deposit → **65,20** — equal to the fiche résa summary
   « Acompte » line (`depositAmount − acompteCommissionAmount`).
5. **Tourist tax per échéance** — unchanged (`computeTaxTtcForKind`): 0 on deposit; full tax
   (clamped to the CA) on balance; complement carries it only when routed there. The balance card
   keeps its 46710000 pass-through line.
6. **Revenue buckets from stored money** (legacy/no-contribs path). Bucket TTCs are derived from
   the row, never from a recomputed quote:
   - `optionsTtc` = Σ `reservation_options.totalPrice` + Σ `reservation_custom_options` amounts
     (offered lines count 0 — same shape as `buildPerLineData`),
   - `resourcesTtc` = Σ `reservation_resources.totalPrice`,
   - `accommodationTtc` = `finalPrice − optionsTtc − resourcesTtc` (clamped ≥ 0).
7. **Effective percent per échéance**: `pct = (CA − tax_échéance) / finalPrice`.
   Thomas: deposit 67,13/131,28 = 51,14 %, balance (67,13 − 2,98)/131,28 = 48,86 %.
8. **Credit lines**: each bucket credits `HT × pct` where `HT = bucketTtc / (1 + vatRate/100)`;
   the VAT credit = Σ over buckets of `bucketTtc × pct × vatRate/(100 + vatRate)`, grouped by rate.
   `vatRate` is the single global rate (`app_settings.vatRate`, `specs/single-vat-rate.md`) — there
   is no per-property VAT. Thomas deposit → gîte **40,11**, options **20,92**, TVA **6,10**;
   balance → 38,33 / 19,99 / 5,83 + taxe 2,98.
9. **Balance guarantee**: Σ credits = CA = Σ debits (CCLIENT net + commission lines); the ≤ 2-cent
   rounding residue is still absorbed by the last credit line (existing `entryToRows` mechanism).
10. **Contrib-driven path** (`force-item-to-complement` snapshots): bucket TTCs stay the captured
    contribs but are **no longer multiplied by `grossRatio`**; CA = stored amount × ratio (= stored,
    contrib rows are all current-model), net = CA − commission. Zero cross-kind contamination
    guarantees unchanged.
11. **« N % du séjour » caption**: the structured payload exposes a dedicated `stayShare`
    field (= `(CA − tax) / finalPrice`, rule 7) consumed by the card caption; `fraction` stays
    the export-side bucket multiplier (1 on the contrib path). Deposit card shows
    « 51 % du séjour ».
12. Scope: applies to every entry of `encaissementsByMonth` — platform and direct, deposit/balance/
    complement/endOfStay (endOfStay entries are already flat TTC and unchanged). CSV, journal
    cards and « Encaissements du mois » table all read the same engine output, so all three
    surfaces correct together.

**Edge cases:**
- Stored schedule sums to 0 with a paid flag set → entry still dropped (existing rule 12bis guard).
- Pure-tax complement (tax-on-arrival platforms, e.g. #22209) → entry still dropped.
- « solde = net » era rows (#7) → ratio > 1 restores the guest-paid gross; net stays the stored
  bank movement (994 CA / 91 commission / 903 net).
- `clientGrossAmount` era rows (#1–#6, #8, #13, #22211…) → behavior unchanged.
- Offered options → count 0 in `optionsTtc`, never resurface (keeps the Chloé-Le-Lann fix; the
  stale-quote failure mode disappears structurally since the quote's bucket amounts are no longer
  used).

---

## 4. Architecture

> Fat backend, thin frontend: the fix is 100 % server-side. The client already renders the payload
> as-is; no client logic changes.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `accountingModel.js` | T | `buildEntry` rework: ratio per rule 1, CA/net per rules 2–4, buckets from stored line totals (rules 6–8), remove quote-bucket reads in the legacy path, remove grossRatio scaling in the contrib path. `computeQuoteForReservation` kept only for the tax-routing flag (`touristTaxCollectedOnArrival`) — or replaced by a direct platform-settings read if simpler. |
| `utils/` | `accountingExport.js` | T | `entryToStructured` exposes `stayShare` (rule 11); row building + residue absorption unchanged. |
| `controllers/` | `accountingController.js` | — | (none — passthrough) |
| `routes/` | `accounting.js` | — | (none) |
| `database.js` | — | — | (none — no schema change) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `AccountingPage.js` | T | Card caption reads `entry.stayShare ?? entry.fraction` (one line). |
| `pages/__tests__/` | `AccountingPage.*.test.js` | — | Unchanged — fixtures without `stayShare` fall back to `fraction`. |

**Component reuse declaration:** none — no UI change.

### 4.3 API contract

`GET /api/accounting/sales?month&year`, `GET /api/accounting/platforms?month&year`,
`GET /api/accounting/sales.csv` keep their fields; the **values** of `encaissementTtc`,
`encaissementNetTtc`, `fraction`, `lines[].debit/credit` change to the corrected figures, and
each structured sales entry gains a backward-compatible `stayShare` field (rule 11).

---

## 5. Data model

No schema change. No migration. Read-only over existing rows.

## 6. UI / UX

No visual change — same cards, table, CSV layout; corrected numbers only. Responsive behavior
untouched. (Deposit card for Thomas now reads: header 67,13 € / « 51 % du séjour (131,28 €) »;
info strip Revenu brut 67,13 · Commission − 1,93 · Net perçu 65,20; lines CVANDEN 65,20 D,
622600 1,93 D, 70600000 40,11 C, 70600010 20,92 C, 44571100 6,10 C.)

## 7. Test plan

### Server unit tests — non-regression, one per reported problem (fixture = Thomas's shape:
platform reservation, deposit+balance both 50 % of gross, tax 2,98, per-échéance commissions 1,93)

New file `tests/accounting-effective-percent.unit.test.js` (12 tests, all passing):
- [x] **P1** — deposit `encaissementTtc` = `depositAmount` (67,13), not the grossRatio-shrunk value.
- [x] **P2** — deposit `encaissementNetTtc` = `depositAmount − acompteCommissionAmount` (65,20);
      structured `platform.net` matches.
- [x] **P3** — CCLIENT debit line = 65,20.
- [x] **P4** — commission debit = `acompteCommissionAmount` (1,93); companion case with
      `hasVatOnCommission = 1` → HT + 44566000 VAT split at `vatRateCommission`.
- [x] **P5** — « Location gîte » credit = stored accommodation HT × effective % (40,11), immune to
      pricing-rule drift (test mutates the pricing rules after booking and asserts stability).
- [x] **P6** — options credit = stored options HT × effective % (20,92).
- [x] **P7** — VAT credit = `vatRate` × (gîte HT + options HT) shares (6,10); rate read from
      `app_settings.vatRate`.
- [x] Balance entry mirror: CA 67,13 / net 65,20 / gîte 38,33 / options 19,99 / TVA 5,83 /
      taxe 2,98; entry balanced.
- [x] `stayShare` caption values: 51 % deposit / 49 % balance.
- [x] Backward-compat: « solde = net » era row (#7 shape, WITH a tax to pin the fixed numerator)
      → CA grossed up to guest-paid, net = stored; `clientGrossAmount` era row → unchanged output.
- [x] Direct reservation with auto deposit (30 %) → effective % = property % exactly; balanced.

Existing suites re-baselined (signature `buildEntry(row, kind, perLineData, commissionContext,
taxContext)` + stored-bucket values at the single global VAT rate):
`accounting-commission-lines` (case 4quater now feeds the options split via `perLineData`),
`accounting-per-line-contribs` (options HT re-baselined from the retired 20 % rate to the global
10 %), `accounting-model-tourist-tax`, `tourist-tax-collection-coverage`, `platform-deposit-toggle`
(mechanical call-site updates). `accounting-export-legacy-path-stale-quote`,
`accounting-encaissements-integration`, `accounting-export`, `accounting-csv-solio-format`,
`accounting-no-deposit-on-platform`: numerically unchanged, kept as-is.
Full server suite: 2005/2005 passing.

### Manual UI verification (done 2026-07-16, headless Playwright on the prod-import DB)
- [x] Juin 2026 (prod data): Thomas's two cards show the §6 figures; « Tout équilibré » chip green.
- [x] Every June entry balanced (10/10); totals row = Σ CA.
- [x] CSV = cards guaranteed structurally (`entryToStructured` wraps the same `entryToRows` walk;
      pinned by `accounting-csv-solio-format` + P-tests on `entryToRows`).
- [x] « Encaissements du mois » table: Revenu brut / Commission / Net perçu columns per rules 2–4
      (Thomas rows: 67,13 / −1,93 / 65,20).
- [x] Mobile (`xs`, 390px): cards + table render as before (no layout change).
- [x] Client suites: `cd client && npx vitest run` (639/639) + `npm run test:e2e` (30 passed,
      1 skipped).

## 8. Out of scope

- Any change to how deposits/commissions are **stored** (pricing engine, fiche résa) — display and
  export only.
- Tourist-tax routing rules (`tourist-tax-on-solde.md`, three-way collection) — consumed as-is.
- Per-property VAT rate (does not exist; single global rate stands).
- The `Pièce` numbering column (still empty pending accountant input).

## 9. Open questions

- Q: Bucket percent = property `depositPercent` or effective percent of the reservation?
  - **A (2026-07-15):** effective percent of the reservation (equals the property % when the
    deposit is automatic; stays balanced when overridden — Thomas 51,14 %).
- Q: Tourist tax share on the deposit entry (Lodgify collects 50/50 physically)?
  - **A (2026-07-15):** keep `tourist-tax-on-solde.md` — tax 100 % on the solde entry; the deposit
    card has exactly the 5 lines Adrien listed (no tax line).
