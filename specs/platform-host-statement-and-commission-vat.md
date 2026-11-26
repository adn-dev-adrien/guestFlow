# Platform stays booked from the host statement, commissions by VAT regime

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/accountant-october-review` |
| **Created** | 2026-11-26 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary for review** | [docs/specs/2026-11-26-platform-host-statement.html](../docs/specs/2026-11-26-platform-host-statement.html) |

---

## 1. Context

On 2026-11-26 the accountant (ANC2) listed what she rewrites by hand when she imports GuestFlow's
October export. Every rewrite is a figure GuestFlow got wrong, and the same wrong figure is shown on
the reservation fiche, in *Suivi financier* and in *Comptabilité*. Every claim below was checked
against the production database (read-only, 2026-11-26) and the statements she attached.

**A. Commission accounts follow the platform's VAT regime.**

| Account | Regime | Platforms |
|---|---|---|
| `62260300` | EU platform — intra-community VAT, self-assessed | Abritel, Airbnb, Booking |
| `62260500` | French platform — 20 % VAT, deductible | Gîtes de France, Abracadaroom, Greengo |
| `62260600` | No VAT | Stripe (Lodgify), Lodgify |

In production: Airbnb on `62260300`, Greengo on `62260600` with deductible VAT, Campspace on
`62260700`, every other platform on the generic `622600`; Gîtes de France without deductible VAT. The
« TVA déductible » box cannot say « EU, self-assessed ».

**B. The « brut » of a platform fiche contains money that is not the host's turnover.** The block
asks for « Montant total payé par le client »:

| Stay | Host statement | Typed on the fiche | Effect |
|---|---|---|---|
| #13 Dausque, GdF, paid 01/10 | location 784 + options 80 = **864**, commission 65 HT + 13 VAT, tax 0, paid **786** | brut 943,20 (GdF's 5 % guest fee + 36 tax), commission 121,20 | turnover +43,20, commission +43,20, options booked as rent |
| #22291 Fraisse, Airbnb, paid 12/10 | room 725 + cleaning 80 = **805**, host fee **124,78**, taxes **24** paid to us, paid **704,22** | brut 868,87 (guest total), tax « withheld » 24, commission 140,65 | turnover +39,87, commission +15,87, tax missing from `46710000` |
| #22326 Toussaint, Airbnb, 26/12 (intake) | rooms 1 598 − 443,40 = **1 154,60**, host fee 178,96, taxes **52,80** paid to us (28,86 kept by Airbnb), paid 1 028,44 | brut 1 236,26, tax withheld 28,86 | turnover includes the 52,80 of tax |

**C. Airbnb pays (part of) the tourist tax to us.** Fraisse and Toussaint payouts include « Taxes ».
Adrien, 2026-11-26: Airbnb moves to « collecte et nous reverse », from the current month, no
retroactivity.

**D. The platforms do not compute the tax like GuestFlow** (Gilibert/Booking: 20,02 paid vs 26,40
computed; Toussaint/Airbnb: 52,80 vs 24,00). Adrien, 2026-11-26: **GuestFlow's engine is the right
tax**: `46710000` and the office declaration use our figure; **the gap goes into the accommodation
price**.

**E. A platform's options belong in `70600010`.** Dausque's cleaning and linen were « offerts » at 0 €
while GdF billed 80 € of options, so all 864 € went to the rent. The fiche lets this happen, and the
GdF intake has never run in production (`gdf_intakes` is empty).

**F. Payment-provider fees.** The cabinet files Stripe's fees (inside the Lodgify commission) in
`62260600`; Mollie's fees go to `62780000` in the Mollie journal. Adrien wants both as commissions.

**G. The cabinet keys a VAT code per line** (`TI` on sales, `INTRACOM` on an EU commission) and
self-assesses EU commissions. Adrien wants the code in the CSV and the self-assessment in the export.

## 2. Goal

Typing — or importing — a platform's statement on a fiche produces, with no correction, the entry the
accountant writes herself: rent and options on their accounts, the commission on the account of its
VAT regime with its deductible or self-assessed VAT, our tourist tax on `46710000`, a VAT code on each
line. The fiche, *Suivi financier*, *Taxes de séjour* and *Comptabilité* show those same figures.

## 3. Functional rules

### 3.1 The statement is typed as the host's figures

1. **The block takes the host side of the statement, in two figures:** « Location (relevé) » and
   « Options (relevé) ». Their sum is the **host amount**, stored in `platformGrossAmount` (its meaning
   changes, its column does not); the options figure in `platformOptionsAmount`. Neither ever contains
   the tourist tax or a fee the platform bills the guest. Where to read them:
   - Gîtes de France « Relevé des réservations »: « Montant location », « Options ».
   - Airbnb « Vous gagnez »: « Frais de chambre » (adjustments included), « Frais de ménage ».
   - Booking: « Sous-total » (commissionable), options 0 unless the extranet lists extras.
   This replaces the conventions of `platform-brut-excludes-offered-tourist-tax.md` rules 1 and 4 and
   `platform-tourist-tax-out-of-the-commission.md` rule 3. Those specs are annotated in the same commit.
2. **The fiche's options follow the statement's options, by themselves** (Adrien, 2026-11-26, Q5 B).
   When « Options (relevé) » is filled, the server compares it with the sum of the fiche's option and
   resource lines billed by the platform (not offered, not in the complement) and, on save, adjusts
   the lines so they sum to it to the cent:
   - **gap > 0** — a property catalogue option, offered or absent on the fiche, priced exactly at the
     gap (ménage 80 €) becomes a paid, platform-billed line; with none, one custom line « Options
     <plateforme> » (`customKey = platform_options`, platform-billed) is created or updated to carry
     the gap.
   - **gap < 0** — that custom line is lowered first (removed at 0); then a paid platform-billed line
     priced exactly at the remaining gap becomes offered. When nothing matches, the save is refused on
     the field (« Le relevé compte 0,00 € d'options, la fiche 80,00 € : retirer une option. ») — the only
     case the server cannot settle alone.
   The adjustment is the same in the preview, so the fiche shows the lines it will save, and the block
   states it: « Ménage passé en payant (80,00 €) pour suivre le relevé. » Empty « Options (relevé) » →
   no adjustment (statement not received yet).
3. **Rent comes from the statement, not from a back-solve guess:** `accommodation = location (relevé)
   − extraGuestSurcharge + tax gap` (rule 7), clamped at 0. Options keep their line prices, which rule
   2 has made equal to the statement. `finalPrice = host amount + tax gap + complement`.
4. **Migration keeps every stored price to the cent** (`database.js`, idempotent, one pass marked in
   `app_settings`, count logged): on a non-direct reservation with a stored brut,
   - mode `platform` with a filled tax box → `brut := brut − box`;
   - mode `platform_reversed` → `brut := brut − T` and `box := T`, `T` = the reversed tax the engine
     subtracted on that row (so the tax gap is 0);
   - `platformOptionsAmount` stays NULL (no check on history).
   A test re-prices one prod-shaped fixture per case before/after and asserts `finalPrice`, schedule,
   `touristTaxTotal` and every accounting entry unchanged. Fees inside a historical brut stay: no
   retroactivity; the cabinet already corrected filed months.

### 3.2 The tourist tax

5. **The « Taxe de séjour » box reads the statement, its meaning follows the platform's mode:**
   - `platform` → « Taxe de séjour retenue par la plateforme »: informational, enters nothing
     (`platform-tourist-tax-out-of-the-commission.md` rule 8 stands).
   - `platform_reversed` → « Taxe de séjour versée avec le virement ».
   - `owner`, direct → no box.
6. **`46710000` and *Taxes de séjour* use GuestFlow's own tax** (Adrien, 2026-11-26), unchanged
   engine: platform-paid occupants in the balance, guests added beyond them at arrival
   (`platform-added-guests-tourist-tax.md`). In mode `platform_reversed` those stays appear on the
   *Taxes de séjour* page for the office declaration, as Booking's do since 2026-10-16.
7. **Tax gap → accommodation.** In mode `platform_reversed`, `tax gap = box − engine's platform-paid
   tax` (positive or negative), added to the accommodation, so Σ credits equals the money received.
   The fiche states it under the block: « Écart de taxe de séjour : +28,80 € (Airbnb 52,80 €, GuestFlow
   24,00 €) ajouté au logement. » Empty box → gap 0.
8. **« Calculer la commission »** for every mode:
   `commission solde = max(0, host amount + box if platform_reversed − virement − commission acompte)`.
   Fraisse 805 + 24 − 704,22 = **124,78**; Dausque 864 − 786 = **78,00**; Toussaint 1 154,60 + 52,80 −
   1 028,44 = **178,96**. Only in `platformPayment.commissionOf` (server); intakes call it.
9. **Airbnb moves to `platform_reversed`** on both properties after the release (Claude, rule 30).
   Stays already priced keep their frozen tax (`tourist-tax-freeze-past-with-refresh.md`): Fraisse and
   every Airbnb stay before November do not move. A test pins it.

### 3.3 What the block shows

10. Under the figures, server-computed lines (existing preview endpoint): the closing
    `host amount + tax paid − commission = virement` ✓ or the gap; the tax gap (rule 7); the
    commission's booking « 78,00 € TTC = 65,00 € HT + 13,00 € de TVA déductible · compte 62260500 » /
    « 124,78 € · UE, TVA autoliquidée 24,96 € · compte 62260300 » / « … · sans TVA · compte 62260600 ».
11. **Commission-rate check:** with `platforms.commissionPercent > 0`, `commission ÷ host amount` more
    than 1 point away from it → warning on the field (« Commission à 17,5 % du montant hôte, Airbnb est
    à 15,5 % : le montant hôte contient-il les frais payés par le voyageur ? »). Never blocks.
12. **Refusals on the field** (server on save, mirrored on blur): negative or non-numeric amount; a
    commission above host amount + tax paid; rule 2's one unsettled case.

### 3.4 Commissions, VAT regime, VAT code, self-assessment

13. **Each platform carries `commissionVatRegime`**, set in *Comptabilité › Plateformes*:
    `fr_vat` « France — TVA 20 % déductible » (HT + `44566000`) · `eu_reverse_charge` « UE —
    autoliquidation » (full amount + rule 15) · `no_vat` « Sans TVA » (full amount). It replaces the
    « TVA déductible » box. Migration: `hasVatOnCommission = 1` → `fr_vat`, else `no_vat` (exports
    byte-identical until the operator sets the regimes). Under « Sans TVA » sales regime
    (`vat-optional-mode.md` rule 12g) every regime books TTC, no self-assessment.
14. **Choosing a regime proposes its account** when the platform has none or still has the previous
    regime's proposal: `fr_vat` → `62260500`, `eu_reverse_charge` → `62260300`, `no_vat` →
    `62260600`, from three plan roles (`commissionFrAccount`, `commissionEuAccount`,
    `commissionNoVatAccount`). A typed account is never overwritten.
15. **Self-assessment in the export.** An entry whose commission is `eu_reverse_charge` gains two
    lines: debit `44566200` « TVA déductible autoliquidée » and credit `44520000` « TVA due
    intracommunautaire », each `round2(commission HT × vatRateCommission)`. Both accounts are plan
    roles (`reverseChargeDeductibleAccount`, `reverseChargeDueAccount`); the setting
    `reverseChargeLines = '0'` leaves the two lines out (Q9). Debits and credits stay equal.
    *Synthèse › TVA* shows the due and the deductible self-assessed VAT of the period.
16. **« Code TVA » column in the CSV**, appended after the last existing column so no column moves.
    Per line: a sales line → the code of its rate (plan settings `vatCodeRate10 = 'TI'`,
    `vatCodeRate20 = 'TN'`, `vatCodeRate55 = 'TR'`); an EU commission line → `vatCodeReverseCharge =
    'INTRACOM'`; a French commission line → `vatCodeDeductible20` (default empty); every other line
    empty. Codes are editable in the account plan. The cabinet confirms the codes she uses (§9).
17. **Payment-provider fees are commissions without VAT.** Mollie's fee lines (Mollie journal) book on
    `commissionNoVatAccount` (`62260600`): `mollieFeeAccount` defaults to it. Stripe has no own flow
    any more: its fees sit in the Lodgify commission, `no_vat` → `62260600`.
18. **Account labels follow the cabinet's plan**: `62260300` « Commissions plateformes UE »,
    `62260500` « Commissions plateformes France », `62260600` « Commissions et frais sans TVA ».

### 3.5 Intakes write the statement from the source

19. **`gites-de-france-intake`** writes « Location » = rent, « Options » = `optionsTotal`, the tax in
    the box, and sets the supplements as paid platform lines (existing matching: cleaning by label and
    price, other supplements as custom lines). It refuses the apply when the lines it set do not sum to
    `optionsTotal` (« Options GdF 80,00 € non retrouvées sur la fiche »).
20. **`airbnb-intake`** writes « Location » = `roomFees + adjustments`, « Options » = `cleaningFee`
    with the cleaning line paid at that price, the box = `hostTaxes` in `platform_reversed` (= `guestTaxes
    − hostTaxes` withheld in `platform`), and keeps its check « commission = hostFee » through rule 8.
21. **`booking-intake`** writes « Location » = `subtotal`, « Options » = 0, the box = `touristTax`.
22. The skill references (`.claude/skills/platform-booking-intake/references/*.md`) say the same.

### 3.6 Everywhere the figures are read

23. The fiche, *Suivi financier* (CA, « Canaux » commissions, trésorerie), *Taxes de séjour* and
    *Comptabilité* read the same stored figures; no new formula in any of them. *Comptabilité*
    renames « Revenu brut » to « Montant hôte » on platform rows; the CSV info column « Prix payé
    client » keeps its header and carries the host amount.

### 3.7 Verification and production settings (Claude)

24. **Shadow replay of October** before the PR: a purged copy of production, the branch's server, the
    October platform stays re-entered from the cabinet's statements (Dausque, Fraisse) and Gruat; the
    October export must equal the cabinet's entries line for line, accounts, amounts and codes. The
    *Taxes de séjour* page is checked for an Airbnb stay in `platform_reversed`.
25. **After the release** (Claude, with the prod Claude account, each change reported to Adrien):
    regimes and accounts of every platform (A), commission rates from the latest statements (GdF
    changed its rate in October and November), Airbnb → `platform_reversed`, `mollieFeeAccount`, then
    November and future platform stays re-checked against their statements with Adrien (Gilibert,
    Roux, Toussaint, the four Booking stays of 2027).

**Edge cases**
- Host amount < platform-billed options → the location is what the statement says; rule 2 holds.
- Platform with no commission rate → no rate check.
- A platform switched between `platform` and `platform_reversed` after a fiche was typed → the box
  changes meaning; frozen tax is not re-read; the operator re-checks a stay not yet paid. As today.
- Campspace is not on the cabinet's list → left on its account until she answers (§9).

---

## 4. Architecture

> Fat backend: every formula, check, refusal and label is server-side; the client renders the lines
> the preview returns and sends the operator's figures.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/pricing/` | `platformPayment.js` | T | Commission formula (rule 8), tax gap (rule 7), rate check (rule 11) |
| `utils/pricing/steps/` | `platformGross.js`, `touristTax.js` | T | Rent from the statement + tax gap (rules 3, 7) |
| `utils/` | `platformStatementCorrection.js`, `financeValidation.js` | T | Option-line adjustment and refusals (rules 2, 12) |
| `models/` | `platformStatementModel.js` | T | Preview lines and warnings (rules 10–11) |
| `models/` | `platformsModel.js` | T | `commissionVatRegime`, account proposal (rules 13–14) |
| `models/` | `reservationsModel.js` | T | `platformOptionsAmount` persisted |
| `plugins/accounting-export/` | `accountingModel.js` | T | Regime, self-assessment lines (rules 13, 15) |
| `plugins/accounting-export/` | `accountingExport.js` | T | « Code TVA » column, self-assessment rows (rules 15–16) |
| `plugins/accounting-export/` | `accountPlan.js`, `settings.js` | T | Plan roles, VAT codes, labels, Mollie fee default (rules 14–18) |
| `plugins/accounting-export/` | `platformAccountsModel.js`, `controller.js` | T | Regime in GET/PUT; journal preview |
| `utils/accounting/exporters/` | `synthesis.js` | T | Self-assessed VAT in *Synthèse* (rule 15) |
| `plugins/*-intake/` | GdF `intakeService.js`, Airbnb `paymentBlock.js`, Booking `intakeService.js` | T | Statement from the source (rules 19–21) |
| `database.js` / `schema.sql` | — | T | Two columns, brut migration (rule 4) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/reservation/` | `PlatformStatementEditor.jsx` | T | Location / Options / tax by mode, server lines, adjusted option lines |
| `components/reservation/` | `FinanceSection.jsx` | T | Same labels where the statement is summarised |
| `plugins/accounting-export/` | `PlatformAccountsPage.jsx` | T | Regime select, proposed account, VAT codes and self-assessment accounts in the plan |
| `plugins/accounting-export/` | `AccountingPage.jsx`, `AccountingSynthesisTab.jsx` | T | « Montant hôte », code column in the journal preview, self-assessed VAT |

No new generic component (`HelpedTextField`, `Alert`, MUI `Select`).

### 4.3 API contract

- `PUT /api/reservations/:id` and the statement preview accept `platformOptionsAmount`; the preview
  returns the option lines rule 2 will save and the sentence stating the adjustment; its one refusal
  answers `{ field: 'platformOptionsAmount', message }`.
- Preview answer: `{ netLabel, lines: [{ tone, label }], warnings: { … } }`.
- `GET/PUT /api/accounting/platform-accounts`: `commissionVatRegime` per platform; `hasVat` accepted on
  PUT for one release (`true` → `fr_vat`).
- CSV: one more trailing column, « Code TVA ».

## 5. Data model

- `platforms.commissionVatRegime TEXT NOT NULL DEFAULT 'no_vat'` (backfilled, rule 13).
- `reservations.platformOptionsAmount REAL NULL`.
- Brut migration (rule 4).
- Plugin settings: `commissionFrAccount 62260500`, `commissionEuAccount 62260300`,
  `commissionNoVatAccount 62260600`, `reverseChargeDeductibleAccount 44566200`,
  `reverseChargeDueAccount 44520000`, `vatCodeRate10 TI`, `vatCodeRate20 TN`, `vatCodeRate55 TR`,
  `vatCodeReverseCharge INTRACOM`, `vatCodeDeductible20 ''`, `reverseChargeLines '1'`; `mollieFeeAccount` default → `62260600`.

## 6. UI / UX

See the interactive summary. « Paiement plateforme »: virement, location, options, tax (per mode),
commissions + « Calculer »; under them the server's lines; a rule-2 refusal shows on « Options
(relevé) » and the sentence stating the adjustment of the option lines (rule 2). Phone: one column, lines wrap. *Comptabilité ›
Plateformes*: « Régime de TVA » select replaces the box; cards on phone.

## 7. Test plan

### Server unit tests (`server/src/tests/platform-host-statement.unit.test.js`, intakes in their own suites)
- Fraisse, Dausque, Toussaint end to end → buckets, commission, tax gap, entry lines and codes equal
  to the cabinet's entries (rules 1–8, 13–16).
- Migration, one fixture per mode: prices, schedule, tax, entries unchanged (rule 4).
- Options adjustment both ways, custom line, the one refusal (rule 2); refusals (rule 12); rate warning both ways (rule 11).
- Frozen past Airbnb stay unchanged after the mode switch; reversed stay on *Taxes de séjour* (6, 9).
- Regime proposal, typed account kept, « Sans TVA » sales regime (13–14); Mollie fee account (17).
- GdF / Airbnb / Booking intakes from their recorded fixtures (19–21).

### Manual UI verification
- Fiche Airbnb and GdF at ≤600, ~900, ≥1200: typing, refusal + fix, « Calculer », save.
- *Comptabilité › Plateformes*, journal preview, CSV opened; *Taxes de séjour*.
- Shadow replay of October (rule 24).

### Implementation notes (2026-11-26)
- Rule 4's one-pass marker is the `migrations` table (`platform_host_statement_brut_v1`), run at boot from `index.js` (it replays each reversed stay through the engine's tax slice, which cannot load while `database.js` is still loading), not `app_settings`. In mode `platform_reversed` the percentage tax base keeps reading the tax the platform paid (`brut + box`), so a percentage-mode property re-prices to the cent; a per-person tax ignores it.
- Rule 9: the tax gap is not applied to a stay whose tax is frozen at 0 (priced under another mode): the switch never moves it.
- The sale-figures record (`storedTouristTax`) carries `touristTaxGap`; the quote's key set is unchanged (the price gate's key list), the readout reads the gap from that record.
- Rule 10's commission-booking sentence (« 78,00 € TTC = 65,00 € HT + 13,00 € de TVA… · compte … ») is not served yet: the journal preview already shows the booked lines; the regime is on the platform row.
- SDK 2.36.0: `ctx.core.reservations.touristTaxMode(propertyId, platformKey)`; `platformCommission(figures)` takes the platform's key with the figures.
- Airbnb intake: in a mode other than `platform_reversed` the commission check folds the taxes handed to the host into the gross (Airbnb's own arithmetic), the fiche then shows the gap that asks for the switch.
- Price gate: 232 allowlist entries (`class: host-statement`, echo of the brut and of the box, no price moved), 19 quote hashes and the intake replays re-captured; golden fixtures of the VAT regimes and of the accounting output re-captured (new CSV column, regime fields, `selfAssessed`).

## 8. Out of scope
- Rewriting October or any filed month.
- Splitting the sales VAT line per revenue line (GuestFlow totals per rate; the cabinet accepts it).

## 9. Open questions (for the cabinet, asked by Adrien)
- Q-A Campspace's regime.
- Q-B The codes she uses for 20 % sales, 5,5 % sales and a French deductible commission (defaults
  `TN`, `TR`, empty), and whether the « Code TVA » column at the end of the file suits her import.
- Q-C The self-assessment accounts (`44566200` / `44520000` by default), and whether her `INTRACOM`
  code already generates those lines in her software — if so, the export's lines would double them
  and rule 15 is switched off by a setting.

### Resolved (2026-11-26, Adrien)
- Q1 one definition: host amount without tax. Q2 one regime per platform. Q3 « Code TVA » column.
- Q4 our tax in `46710000`, the gap into the accommodation. Q5 fixed at the root (fiche + GdF intake):
  the fiche adjusts its option lines by itself (rule 2), no confirmation. Q8 « Code TVA » as the last
  column. Q9 self-assessment lines written, with a plan setting `reverseChargeLines` (`'1'` default,
  `'0'` = left out) in case the cabinet's `INTRACOM` code already generates them. Q6 rate warning at 1 point (GdF changed its rate in October and November: Claude
  updates the rate after the release). Q7 Claude re-checks November and future stays after the release.
- Stripe and Mollie fees are commissions without VAT. Self-assessment written in the export.
