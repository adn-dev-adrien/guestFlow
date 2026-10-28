# VAT optional mode — a dated VAT regime (« Assujetti » ↔ « Sans TVA »)

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/vat-optional-mode` _(user-managed)_ |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Related** | [single-vat-rate.md](single-vat-rate.md) (the one rate — amended by its rule 14), [payment-links-vat.md](payment-links-vat.md) (link baskets — amended by its rule 11), [accountant-accounting-export.md](accountant-accounting-export.md) (journal — amended by its rule 36), [fiscal-year-and-nights-sold.md](fiscal-year-and-nights-sold.md) (the exercise, unchanged), [tourist-tax-matches-the-office-calculation.md](tourist-tax-matches-the-office-calculation.md) (the HT base of the proportional tax), [plugins-phase-p-productisation.md](plugins-phase-p-productisation.md) (GuestFlow sold to other operators) |
| **HTML summary** | [docs/specs/2026-10-28-vat-optional-mode.html](../docs/specs/2026-10-28-vat-optional-mode.html) |

---

## 1. Context

GuestFlow is going to be sold to other accommodations (phase P). Some of them are individuals, not
companies: no accountant, no VAT. Today every install is VAT-registered by construction. Feedback of
2026-10-28 (Adrien, on the `inte/plugins` shadow):

> Pour la page TVA & exercice, il faut pouvoir le désactiver pour les clients de guestflow qui ne
> serait pas en société et donc sans comptable ni TVA […] C'est peut être désactivable si on retire le
> plugin comptable ? […] il faut aussi qu'on puisse à un moment décider de passer avec TVA et comptable
> ou l'inverse. Dans ce cas il faut que ce soit appliqué uniquement sur les réservations à venir en
> gardant bien la date du changement, mais il faut aussi faire en sorte de pouvoir appliquer aux
> réservations existantes en cas de mauvais paramétrage. Ce changement doit se faire avec une popup
> d'alerte et d'explication succincte de l'implication.

### 1.1 Where VAT lives today (code at `origin/inte/plugins` 714ed5e4)

There is **one global rate**, `app_settings.vatRate` (REAL, default 10), edited on Paramètres › TVA &
exercice ([SettingsVatSection.jsx](../client/src/components/SettingsVatSection.jsx),
[VatFiscalSettingsPage.jsx](../client/src/pages/settings/VatFiscalSettingsPage.jsx)). It is **read live,
by every consumer, at every read** — there is no per-reservation snapshot. That is a deliberate earlier
choice ([single-vat-rate.md](single-vat-rate.md) rule 12: « retroactive »). The rate is read directly from
`app_settings` in **eleven places**:

| # | Reader | What it does with the rate |
|---|---|---|
| 1 | [utils/pricing.js:1334](../server/src/utils/pricing.js#L1334) `getGlobalVatRate` → `:1519`, `:2348`, `:2427-2444` | Quote: extracts VAT from each TTC bucket; feeds the tourist-tax base (`accommodationVatRate`). |
| 2 | [utils/pricing.js:472-487](../server/src/utils/pricing.js#L472) `computeTouristTaxBreakdown` | **Proportional tourist tax**: base HT = TTC ÷ (1 + rate). The only place where the rate changes a TTC figure. |
| 3 | [controllers/reservationsController.js:781](../server/src/controllers/reservationsController.js#L781) | `storedSummary` « Total HT / TVA x % ». |
| 4 | [models/financeModel.js:103](../server/src/models/financeModel.js#L103), `:377`, `:825`, `:993` | Finance dashboard HT figures (`htAmount`). |
| 5 | [utils/devisPdf.js:274](../server/src/utils/devisPdf.js#L274) | Devis PDF « Prix HT / TVA % / Total TTC » columns, « Sous-total HT ». |
| 6 | [utils/devisQuote.js:83](../server/src/utils/devisQuote.js#L83) | Devis payment-link basket rate. |
| 7 | [utils/publicPaymentMode.js:17](../server/src/utils/publicPaymentMode.js#L17) | Public payment basket rate. |
| 8 | [controllers/paymentsController.js:111](../server/src/controllers/paymentsController.js#L111), `:140`, `:163` | Admin link baskets (quote key, then `financeModel.helpers.getVatRate`). |
| 9 | [controllers/refundsController.js:48](../server/src/controllers/refundsController.js#L48), `:57` | Refund lines — **frozen** at refund time in `reservation_refund_lines.vatRate`. |
| 10 | [controllers/reservationCancellationController.js:51](../server/src/controllers/reservationCancellationController.js#L51) | Requalified acompte lines on cancellation. |
| 11 | [plugins/accounting-export/accountingModel.js:392](../server/src/plugins/accounting-export/accountingModel.js#L392) `buildCommissionContext` (via `sdk.coreModule('settingsModel')`) | Every journal entry: 4457x VAT credits, end-of-stay / mid-stay / arrival adjustments. |

Plus the wording: [settingsSummaryController.js:68](../server/src/controllers/settingsSummaryController.js#L68)
(« TVA 10 % · exercice clos fin … »), [PricingSummary.jsx:815-825](../client/src/components/PricingSummary.jsx#L815),
[StoredPricingSummary.jsx:50-51](../client/src/components/reservation/StoredPricingSummary.jsx#L50),
[FinanceHero.jsx:71](../client/src/components/FinanceHero.jsx#L71) (« HT · net de commissions »),
[FinanceDetailPanel.jsx:229](../client/src/components/FinanceDetailPanel.jsx#L229) (TTC / HT columns),
[PropertyTariffTab.jsx:166](../client/src/components/property/PropertyTariffTab.jsx#L166) (« prix TTC »).

Key properties of the engine, verified in the code:

- **All prices are TTC; VAT is extracted, never added** (`VAT = TTC × r ÷ (100 + r)`). So a rate of 0
  leaves every price, deposit, solde and platform gross **unchanged**. The only TTC figure the rate moves
  is the **proportional tourist tax** (reader 2): its legal base is the night « hors taxes » (CGCT
  art. L2333-30), so without VAT the base is the price paid and the tax goes up by the rate (≈ +10 %).
- Rate 0 is already accepted (`validateVatRate` 0–100) but it is not « sans TVA »: documents still
  print « TVA 0 % », « Total HT », and no legal mention. The current product cannot produce a lawful
  document for an operator outside VAT.
- Rows are inserted by **seven code paths** (`reservationsModel.js:1589`, `devisModel.js:787/1113/1187`,
  `propertyIcalModel.js:428`, `devisFusionMigration.js:67`, `emailDraftPreview.js:101`) — a snapshot
  written by application code would have to be repeated in each; a DB trigger covers all of them.

### 1.2 Is it « the accounting plugin »? No.

Deactivating `accounting-export` removes the journal, the Plan comptable and the « Comptable » role.
VAT stays in the **core**: the quote, the devis PDF, the résumé tarifaire, the payment-link baskets, the
finance dashboard's HT. And the two axes are independent in real life: an individual renting a furnished
gîte under the micro-BIC regime has no VAT and usually no accountant, but an LMNP « au réel » has an
accountant and no VAT, and a small company under the VAT franchise has both a company and no VAT.
Finally a plugin toggle is not dated, so it cannot honour « only the reservations to come ».
**The VAT regime is a core, dated setting; the accounting plugin stays a separate on/off.**

### 1.3 What « sans TVA » means in France (to be confirmed by the operator's adviser)

GuestFlow does not decide the regime: the operator declares it. The two legal grounds an accommodation
operator meets, and the mention each one requires on invoices and quotes:

| Ground | Who | Mention on documents |
|---|---|---|
| **Franchise en base** — CGI art. 293 B (commentary BOI-TVA-DECLA-40-10-20; thresholds in BOI-BAREME-000036) | A business under the turnover threshold, including chambres d'hôtes and para-hotel lettings that would otherwise be taxable at 10 % (CGI art. 279 a). | « TVA non applicable, art. 293 B du CGI » |
| **Exonération** — CGI art. 261 D 4° (amended by art. 84 of the 2024 finance law; commentary BOI-TVA-CHAMP-10-10-50-20, updated 2025-03-26) | Furnished lettings **without** para-hotel services — taxable only when at least 3 of 4 are offered: breakfast, regular cleaning, household linen, reception. | « Exonération de TVA, art. 261 D 4° du CGI » |

Consequences retained by this spec:
- **Prices**: the guest pays the same figure; HT = TTC; no VAT line anywhere.
- **Documents**: the chosen mention replaces the VAT breakdown on the devis PDF and the résumé tarifaire.
- **Tourist tax**: never VAT, in both regimes. Its proportional base « hors taxes » equals the price paid.
- **Platform commissions**: the platform's VAT on its commission is not deductible — it is a cost.
- **Thresholds**: GuestFlow does not monitor the franchise thresholds (out of scope, §8).

### 1.4 Impact measured on the shadow (prod copy, 2026-10-28)

58 reservations (49 past, 9 upcoming), 5 devis (2 drafts), 40 tourist taxes frozen, 12 declared,
1 refund (2 lines), 3 installments, 1 cancellation compensation, 5 open payment links, encaissements
spread over 11 months (2025-12 → 2026-10). La Granja: tourist tax per person per night (the VAT does
not change it); L'Estiva: **proportional** 5 % + 10 % departmental (the VAT changes it).

| A switch to « Sans TVA » on 2026-10-28, scope… | Reservations moved | of which money collected | Stays whose tourist tax moves | Frozen taxes kept |
|---|---|---|---|---|
| booked from that date | 1 | 0 | 0 | 0 |
| arriving from that date | 9 | 1 | 2 (1 taxed directly: 9,65 € → ≈ 10,6 €) | 0 |
| every reservation (correction) | 58 | 48 | 5 | 40 |

Solio itself never switches: it is VAT-registered at 10 %. For Solio the whole change must be
invisible — that is what the golden tests of rule 23 prove.

## 2. Goal

An operator who is not liable to VAT runs GuestFlow without any VAT on screens, documents, links and
accounting, with the right legal mention; and an operator who changes status can switch, from a date,
for the reservations to come — or correct every reservation after a misconfiguration — through one
explained confirmation, with a dated, permanent history. A VAT-registered install sees no difference.

## 3. Functional rules

### 3.1 The regime and its history

1. **Two regimes.** `subject` — « Assujetti à la TVA », one rate 0–100 applied to every revenue stream
   (today's behaviour, unchanged); `not_subject` — « Sans TVA »: every revenue VAT rate is 0 and every
   guest document carries a legal mention instead of a VAT breakdown.
2. **The legal mention is chosen, not typed.** A `not_subject` period carries one of two keys:
   `art_293_b` (default) → FR « TVA non applicable, art. 293 B du CGI », EN « VAT not applicable,
   art. 293 B of the French General Tax Code »; `art_261_d_4` → FR « Exonération de TVA, art. 261 D 4°
   du CGI », EN « VAT exempt, art. 261 D 4° of the French General Tax Code ». The texts are server
   constants; the client receives the label.
3. **The regime is a history of periods**, append-only: `{ regime, rate, legalMention, basis,
   effectiveFrom, createdAt, createdBy, note }`. A period is never edited, except the rate (rule 9) and
   the mention of the period in force, and never deleted, except under rule 18.
4. **Every reservation carries the period it was sold under** (`reservations.vatPeriodId`), assigned at
   insert by rule 5, whatever the insert path (form, iCal import, intake plugins, website, devis
   conversion). A DB trigger performs it, so no insert path can forget it.
5. **Assignment rule.** The period of a row is the latest period (highest id) whose predicate holds:
   basis `all` → always; basis `booking` → the row's booking date (`createdAt`, Europe/Paris) ≥
   `effectiveFrom`; basis `arrival` → the row's `startDate` ≥ `effectiveFrom`.
6. **The assignment is final.** Editing dates, party, prices, options, cancelling or reinstating never
   changes `vatPeriodId`. Only a switch (rule 15) reassigns.
7. **A devis not converted is a live offer**: it is always resolved as if booked today (rule 5 with
   today's date and the devis's `startDate`), so a draft re-sent after a switch prints the regime in
   force. The reservation born from its conversion gets its own period through rule 4.
8. **One resolver.** `vatRegime.forRow(db, row)` → `{ periodId, regime, rate, legalMention,
   legalMentionText }` is the only source of a VAT rate for a sale. Each of the eleven readers of §1.1
   goes through it; outside `models/vatRegimeModel.js`, no code reads `app_settings.vatRate`.
9. **The rate field keeps today's meaning.** « Taux de TVA (%) » edits the rate of the period in force
   today, retroactively for the reservations of that period only — the rule-12 behaviour of
   single-vat-rate, narrowed to a period. Refused with 422 when the period in force is `not_subject`.

### 3.2 What changes without VAT

10. **No price moves.** In `not_subject`, the accommodation, options, resources, custom lines, discounts,
    deposits, soldes, installments, complements and platform gross are the same TTC figures as with VAT;
    VAT is extracted at 0, so HT = TTC.
11. **Tourist tax.** Never VAT, in either regime (bucket at 0 %). In the proportional mode its base « HT »
    is the price paid ÷ (1 + rate of the row's period) — the price itself without VAT. A tourist tax that
    is **frozen** (`touristTaxFrozenAt`) or **declared** (`touristTaxDeclaredAt`) never changes because of
    a regime, whatever the scope of a switch.
12. **Screens and documents of a `not_subject` sale** — each reads the row's period, not the current one:
    - a. **Résumé tarifaire** (live and stored): no « Total HT » / « TVA x % » lines; one caption line with
      the mention.
    - b. **Devis PDF**: no « TVA % » column, no « HT » column, no « Sous-total HT / TTC »; « TOTAL » instead
      of « TOTAL TTC »; the mention printed under the totals, in the PDF's language. The footer VAT
      number still prints when it is set (it is the operator's data).
    - c. **Payment links**: the same items (stay, « Taxe de séjour », « Ajustement »), every one at
      `vat_rate "0"`; the charged total is unchanged to the cent (payment-links-vat rule 1).
    - d. **Finance dashboard**: each reservation's HT uses its own period's rate. The payload carries
      `showHt`: false when the period in force is `not_subject` and no reservation of the view is
      `subject`; the client then drops the « HT » figures and columns.
    - e. **Settings summary**: « Sans TVA · exercice clos fin <mois> ».
    - f. **Logement › Tarifs** caption: « Prix payés par le client. » instead of the TTC / VAT-rate link.
    - g. **Accounting export** (when the plugin is active): no 4457x line — the revenue lines take the
      whole TTC share; a platform commission is booked TTC on its account, with no 44566 deductible-VAT
      line, whatever `hasVatOnCommission`; a cancellation compensation and a refund carry 0 %.
13. **A mixed history stays exact.** A view or an export that spans periods treats each row with its own
    period: a month can hold entries with VAT and entries without.

### 3.3 Switching

14. **A switch creates a period.** Inputs: the target regime (the other one); its rate (`subject`,
    default 10, 0–100) or its mention (`not_subject`); a scope — `booking` « Réservations prises à partir
    du … » (default), `arrival` « Séjours qui commencent à partir du … », `all` « Toutes les réservations
    (correction) »; and `effectiveFrom` for `booking` / `arrival`. Admin only.
15. **Bounds.** `effectiveFrom` is a valid date, ≥ the `effectiveFrom` of the latest dated period (the
    history is never rewritten in the middle), ≥ today − 366 days (further back is a correction) and
    ≤ today + 366 days. A target identical to the period in force (same regime, and same rate for `subject`) is refused. Errors are 422 with the field and a
    short message (§4.3).
16. **Reassignment.** In one transaction: the period is inserted; every existing reservation (kinds
    `reservation` and `cancelled`) matching its predicate (rule 5) takes the new `vatPeriodId`; each one
    whose regime or rate actually changes gets a `reservation_history` entry « Régime de TVA : Assujetti 10 % → Sans TVA (changement du
    28/10/2026) » (« correction » for scope `all`); the non-tax lines of its refunds are re-rated to the
    new rate, their TTC unchanged. A future-dated `booking` switch reassigns nothing now.
17. **Preview before confirmation.** The dialog shows, from the server, for the exact inputs: reservations
    whose regime or rate changes; of which with money collected; stays whose tourist tax changes, with the total delta;
    frozen or declared taxes kept; open payment links (their amount stands, their VAT display is not
    rewritten — Qonto links are immutable); months whose accounting entries change; devis drafts that
    now print differently. The preview returns a fingerprint; the switch re-sends it and is refused
    with 409 when the reassigned set changed in between.
18. **Undo of an unused change.** The latest period, when no reservation references it (a future-dated
    switch, or a mistake caught at once), can be deleted (« Annuler ce changement »). Otherwise the
    history is immutable; a wrong switch is fixed by another switch or a correction.
19. **Scope `all` asks for an explicit acknowledgement** (a checkbox « Les écritures déjà transmises
    au comptable changent. », shown only when months are affected; « Les documents déjà envoyés ne
    changent pas. » otherwise) before the button enables; the server refuses scope `all` without
    `acknowledged: true`.
20. **Independent of the accounting plugin.** Activating or deactivating `accounting-export` changes no
    VAT. When the plugin is active, the dialog says its entries follow the regime of each reservation.
21. **Fresh install**: one period `subject`, rate 10, basis `all` — today's default.

### 3.4 Migration and proof

22. **Migration**, idempotent: create `vat_periods`; seed period 1 = `{ subject, rate:
    app_settings.vatRate, basis: all, note: 'initial' }`; set `vatPeriodId = 1` on every row; create the
    assignment trigger. `app_settings.vatRate` stays, written as a mirror of the rate in force (0 when
    `not_subject`), for plugin SDK compatibility only.
23. **Golden: a VAT-registered install sees no difference.** For a database whose only period is
    period 1, the quote of every stay and devis, the stored summary, the devis PDF, the payment-link
    baskets of every type, the accounting CSV of every month, the finance payloads and the Suivi taxe de
    séjour are byte-identical to their capture on the code before Lot 1.

**Edge cases:**
- Booking at 00:30 on the switch day (Paris) → the booking date is that day (rule 5 uses Europe/Paris,
  never UTC).
- An iCal reservation's booking date is its import date — the platform's own booking date is not known.
- A stay moved across the switch date after its assignment keeps its period (rule 6); the operator uses
  a correction if it matters.
- A paid solde on a stay whose proportional tax rises after a correction → the existing « reste à
  payer » complement path shows the difference; the preview counted it (rule 17).
- Two admins previewing at once → the second switch gets 409 (rule 17) and re-previews.
- A refund recorded under period A on a reservation later corrected to B → its lines follow B (rule 16),
  so the avoir mirrors the encaissement.
- `subject` at rate 0 stays a legitimate, distinct state: « TVA 0 % » documents, no mention.
- A converted devis whose period differs from the draft's: the TTC promised is the same (rule 10); only
  the proportional tax may move, as on any recompute today.

---

## 4. Architecture

> Fat backend: the period resolution, the preview, every derived « showHt », mention text and VAT split
> live on the server. The client renders the payloads and holds the dialog's draft inputs.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Rule 22: `vat_periods` table, `reservations.vatPeriodId`, seed + backfill, `trg_reservations_vat_period` AFTER INSERT trigger, all idempotent. |
| `models/` | `vatRegimeModel.js` | C | Read periods, period in force, `forRow`, insert period, reassign rows, delete unused latest, mirror `app_settings.vatRate`. The only reader of that column. |
| `models/` | `settingsModel.js` | T | `vatRate` writes route to the period in force (rule 9). |
| `models/` | `financeModel.js` | T | `htAmount` per row via `forRow`; `showHt` in the dashboard payloads (rule 12d). |
| `models/` | `refundsModel.js` | T | Re-rate lines of reassigned reservations (rule 16). |
| `models/` | `reservationsModel.js` | T | `addHistoryEntry` (existing, `:1541`) — one entry per reassigned reservation (rule 16). |
| `utils/` | `vatRegime.js` | C | Pure: predicate of rule 5, mention texts (rule 2), bounds validation (rule 15), preview fingerprint. |
| `utils/` | `pricing.js` | T | `getGlobalVatRate` → the period of the SAVED booking (or today's for a fresh quote / live devis); quote gains `vatRegime { periodId, regime, rate, legalMention, legalMentionText }`; the three `vatPercentage*` keys carry the period's rate. |
| `utils/` | `devisPdf.js` | T | Rate from the row's period; `not_subject` layout and mention (rule 12b, FR/EN labels). |
| `utils/` | `devisQuote.js`, `publicPaymentMode.js`, `storedLinkComponents.js` | T | Basket rate from the row's period (rule 12c). |
| `utils/` | `cancellationRequalification.js` | — | Unchanged; its caller passes the row's rate. |
| `controllers/` | `vatRegimeController.js` | C | GET state, POST preview, POST switch, DELETE period; admin check; 409 / 422 shapes. |
| `controllers/` | `reservationsController.js` | T | `storedSummary` from the row's period (rule 12a). |
| `controllers/` | `paymentsController.js`, `refundsController.js`, `reservationCancellationController.js` | T | Rate from the row's period. |
| `controllers/` | `settingsController.js`, `settingsSummaryController.js` | T | Rate edit → period in force (422 when `not_subject`); summary wording (rule 12e). |
| `routes/` | `settings.js` | T | Mount `/api/settings/vat-regime*` (thin). |
| `plugins/accounting-export/` | `accountingModel.js`, `accountingExport.js` | T | Rate per row via `sdk.coreModule('vatRegimeModel')`; `not_subject` entries without VAT, commission TTC without 44566, compensation 0 % (rule 12g). Plugin version bump + changelog line. |
| `plugins/sdk/` | core module list | T | Expose `vatRegimeModel` read-only to plugins. |
| `middleware/` | — | — | Existing admin role guard reused. |
| `scheduledTasks.js` | — | — | None (a future-dated period needs no job: rule 5 is evaluated at insert). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/settings/` | `VatFiscalSettingsPage.jsx` | T | Hosts the regime card; the switch never goes through the page's Save. |
| `components/` | `SettingsVatSection.jsx` | T | Current regime badge, rate field (`subject`) or mention select (`not_subject`), history, « Changer de régime… ». |
| `components/` | `VatRegimeSwitchDialog.jsx` | C | Specific: inputs of rule 14 on `FormDialog`, server preview, acknowledgement, 409/422 display. |
| `components/` | `VatPeriodHistory.jsx` | C | Specific: dated list of periods, « Annuler ce changement » on an unused latest one. |
| `components/` | `PricingSummary.jsx`, `reservation/StoredPricingSummary.jsx` | T | Render `vatRegime` from the payload (rule 12a). |
| `components/` | `FinanceHero.jsx`, `FinanceDetailPanel.jsx` | T | Hide HT when `showHt` is false. |
| `components/property/` | `PropertyTariffTab.jsx` | T | Caption per regime (rule 12f) from the settings payload. |
| `plugins/accounting-export/` | `PlatformAccountsPage.jsx` | T | Commission and compensation VAT fields hidden in `not_subject` (they cannot apply). |
| `hooks/` | `useVatRegime.js` | C | Load state, preview (debounced 300 ms), switch, delete. |
| `api.js` | `api.js` | T | `getVatRegime`, `previewVatSwitch`, `switchVatRegime`, `deleteVatPeriod`. |
| `constants/` | `vatRegime.js` | C | French labels of scopes and buttons. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `StatusBadge`, `SummaryItem`, `ErrorAlert`, `LoadingState`, `SettingsFormPage`, `PageActionBar` (via `SettingsFormPage`) | No new generic needed. |
| **Created (new generic)** | — | — |
| **Specific (kept feature-local)** | `VatRegimeSwitchDialog`, `VatPeriodHistory` | Tied to the VAT regime's rules and payload; the history's shape (dated periods with a scope) exists nowhere else. |

### 4.3 API contract

All under the admin guard; « Comptable » may `GET`.

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/settings/vat-regime` | — | `{ inForce: Period, periods: Period[], mentions: [{ key, label }], accountingExportActive: bool }` | `Period = { id, regime, rate, legalMention, legalMentionText, basis, effectiveFrom, createdAt, createdByName, reservations: n, deletable: bool, label }` — `label` is the server's sentence (« Depuis le 01/01/2027 · réservations prises à partir de cette date »). |
| POST | `/api/settings/vat-regime/preview` | `{ regime, rate?, legalMention?, basis, effectiveFrom? }` | `{ fingerprint, reassigned, collected, touristTaxChanged, touristTaxDelta, touristTaxKept, openLinks, exportMonths: ['2026-05', …], devisDrafts, accountingExportActive }` or 422 `{ errors: { effectiveFrom?: string, rate?: string, regime?: string } }` | Pure read. |
| POST | `/api/settings/vat-regime/switch` | preview body + `{ fingerprint, acknowledged? }` | 201 `{ period: Period, reassigned }` | 409 `{ error: 'preview_stale' }`; 422 as preview, or `{ errors: { acknowledged } }` for scope `all`. |
| DELETE | `/api/settings/vat-regime/periods/:id` | — | 204 | 409 `{ error: 'period_in_use' \| 'not_latest' \| 'initial_period' }`. |
| PUT | `/api/settings` | `vat: { rate?, legalMention? }` | as today | Edits the period in force (rule 9); 422 `vatRate` when `not_subject`. |
| — | Every quote payload | — | adds `vatRegime` | `vatPercentage*` keep their names. |
| — | Finance payloads | — | adds `showHt` | — |

Messages (422): « Date antérieure au dernier changement (01/01/2027) », « Au plus un an à l'avance », « Au plus un an en arrière, sinon correction »,
« Régime déjà en vigueur », « Taux entre 0 et 100 », « Confirmation requise ».

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS vat_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regime TEXT NOT NULL CHECK (regime IN ('subject', 'not_subject')),
  rate REAL NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <= 100),
  legalMention TEXT CHECK (legalMention IS NULL OR legalMention IN ('art_293_b', 'art_261_d_4')),
  basis TEXT NOT NULL CHECK (basis IN ('all', 'booking', 'arrival')),
  effectiveFrom TEXT,                       -- YYYY-MM-DD; NULL for basis 'all'
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  createdBy INTEGER REFERENCES users(id),
  note TEXT,
  CHECK ((regime = 'subject' AND legalMention IS NULL) OR (regime = 'not_subject' AND rate = 0 AND legalMention IS NOT NULL)),
  CHECK ((basis = 'all') = (effectiveFrom IS NULL))
);
ALTER TABLE reservations ADD COLUMN vatPeriodId INTEGER REFERENCES vat_periods(id);   -- guarded

-- seed (only when the table is empty)
INSERT INTO vat_periods (regime, rate, basis, note)
  SELECT 'subject', COALESCE(vatRate, 10), 'all', 'initial' FROM app_settings WHERE id = 1;
UPDATE reservations SET vatPeriodId = 1 WHERE vatPeriodId IS NULL;

CREATE TRIGGER IF NOT EXISTS trg_reservations_vat_period AFTER INSERT ON reservations
WHEN NEW.vatPeriodId IS NULL BEGIN
  UPDATE reservations SET vatPeriodId = (
    SELECT p.id FROM vat_periods p
    WHERE p.basis = 'all'
       OR (p.basis = 'booking' AND date(NEW.createdAt, 'localtime') >= p.effectiveFrom)
       OR (p.basis = 'arrival' AND NEW.startDate >= p.effectiveFrom)
    ORDER BY p.id DESC LIMIT 1)
  WHERE id = NEW.id;
END;
```

The server runs with `TZ=Europe/Paris`, so `'localtime'` is Paris. `utils/vatRegime.js` implements the
same predicate for the preview, the live devis and minimal test schemas; a parity test runs both on a
matrix (§7).

**Data impact:** additive only. No price, payment or tax column is written by the migration. Every
existing row points at period 1 whose rate is the current rate, so every reader returns what it returns
today (rule 23). Rollback = the pre-migration backup the updater already takes.

## 6. UI / UX

Interactive mockups: [docs/specs/2026-10-28-vat-optional-mode.html](../docs/specs/2026-10-28-vat-optional-mode.html).

### 6.1 Paramètres › TVA & exercice — card « TVA »

- Title « TVA », then a `StatusBadge`: « Assujetti · 10 % » (success soft) or « Sans TVA » (neutral).
- `subject`: the « Taux de TVA (%) » field as today. `not_subject`: a « Mention légale » select (the two
  mentions of rule 2). Both save with the page's Save.
- « Historique »: one line per period, newest first, the server's `label`, author and date in caption;
  « Correction » tag for scope `all`; « Prévu » tag for a future-dated period; « Annuler ce changement »
  text button on a deletable one (ConfirmDialog).
- A secondary button « Changer de régime… » opens the dialog. Page label stays « TVA & exercice »: the
  page still holds the exercise and is where VAT is switched back on.

### 6.2 Dialog « Passer sans TVA » / « Passer à la TVA »

- Target summary (one line), then the rate field (to `subject`) or the mention select (to `not_subject`).
- « Appliquer à » — three radio cards: « Réservations prises à partir du » [date], « Séjours qui
  commencent à partir du » [date], « Toutes les réservations — correction ». Date defaults to today.
- « Ce qui change » — the preview as 2–5 short lines, only the non-zero ones:
  « 9 réservations passent sans TVA, dont 1 déjà encaissée. » · « Prix inchangés. » · « Taxe de séjour
  recalculée sur 2 séjours (+0,96 €). » · « 40 taxes de séjour figées inchangées. » · « 5 liens de paiement
  ouverts gardent leur montant. » · « Écritures modifiées : mai à octobre 2026. »
- Correction: checkbox of rule 19; button « Corriger toutes les réservations » (warning colour).
  Otherwise « Passer sans TVA » / « Passer à la TVA » (primary). Disabled while the preview loads or an
  input is refused; field errors under the field.
- 409: an inline `ErrorAlert` « Les réservations ont changé. Aperçu mis à jour. » and a new preview.

### 6.3 Documents

- Résumé tarifaire: subject → « Total HT » / « TVA 10 % » captions (today); not_subject → one caption
  « TVA non applicable, art. 293 B du CGI ».
- Devis PDF: see rule 12b; the mention in italic under « TOTAL ».

### 6.4 Responsive

- `xs`: the dialog is fullScreen (FormDialog); radio cards stack full-width, the date field sits under its
  radio; the preview lines wrap; buttons stack, primary last. History lines wrap to two lines (label,
  then author · date). No horizontal scroll.
- `md` / `lg`: dialog `maxWidth="sm"`; the card stays in the 900 px form column.

### 6.5 Page action bar

Unchanged: `SettingsFormPage` already renders `PageActionBar` with Save / Cancel for the rate and the
mention. The switch has its own confirmation and never dirties the form.

## 7. Test plan

Each test file opens with the spec and rules it covers. Counts are targets.

### Server unit tests

- [ ] `tests/vat-regime-golden.unit.test.js` — rule 23 (8): quotes of every Solio stay and devis, stored
      summaries, devis PDF draw list, link baskets (deposit, balance, full, complement), accounting CSV per
      month, finance payloads, tourist-tax page rows, refund lines. Captured in Lot 0 on unchanged code
      (`GOLDEN_UPDATE=1` is only legitimate in that commit), on `productisationGoldenFixture.buildSolioDb`
      plus two Estiva stays (proportional tax) and one installment plan.
- [ ] `tests/vat-regime-readers.unit.test.js` — rule 8 (3): no `vatRate FROM app_settings` outside
      `vatRegimeModel.js`; each of the eleven readers answers the row's period on a two-period DB.
- [ ] `tests/vat-regime-assignment.unit.test.js` — rules 4, 5, 6, 7 (12): trigger on each insert path,
      booking vs arrival vs all, Paris midnight, future-dated period, latest-wins, edit keeps the period,
      live devis, conversion; JS/SQL parity over a 40-row matrix.
- [ ] `tests/vat-regime-migration.unit.test.js` — rules 21, 22 (5): seed from the current rate, backfill,
      idempotent re-run, mirror column, fresh install.
- [ ] `tests/vat-regime-rate-in-force.unit.test.js` — rule 9 (3).
- [ ] `tests/vat-regime-not-subject-prices.unit.test.js` — rules 10, 11, 13 (8): same TTC on direct,
      platform, discounted, installment stays; proportional tax rises by the rate; frozen and declared
      taxes untouched; mixed-period finance sum.
- [ ] `tests/vat-regime-not-subject-documents.unit.test.js` — rules 1, 2, 12a, 12b, 12e, 12f (8): stored
      and live summary payloads, PDF columns, labels, mention FR/EN, summary wording.
- [ ] `tests/vat-regime-not-subject-links.unit.test.js` — rule 12c (4).
- [ ] `tests/vat-regime-not-subject-finance.unit.test.js` — rule 12d (4).
- [ ] `plugins/accounting-export/tests/accounting-export-not-subject.unit.test.js` — rule 12g, rule 20 and
      accountant-accounting-export rule 36 (7): no 4457x, commission TTC without 44566, compensation 0 %,
      refund avoir 0 %, balanced entries, mixed month.
- [ ] `tests/vat-regime-switch.unit.test.js` — rules 3, 14, 15, 16, 18, 19 (16): each scope, bounds and
      messages, identical-target refusal, transaction (all-or-nothing), history entries, refund re-rate,
      delete unused / refuse used / refuse initial, acknowledgement, admin only.
- [ ] `tests/vat-regime-preview.unit.test.js` — rule 17 (8): each count against a crafted DB, fingerprint,
      409 on a changed set.
- [ ] `tests/single-vat-rate-period.unit.test.js` — single-vat-rate rule 14 (2).
- [ ] `tests/payment-links-vat-period.unit.test.js` — payment-links-vat rule 11 (2).

≈ 90 server cases, 14 files.

### Client tests (Vitest)

- [ ] `components/__tests__/SettingsVatSection.regime.test.jsx` (6): badge per regime, rate vs mention,
      history tags, delete button only when deletable.
- [ ] `components/__tests__/VatRegimeSwitchDialog.switch.test.jsx` (9): scope radios, date refusal from
      the 422, acknowledgement gating, button labels, 409 alert, fullScreen on xs.
- [ ] `components/__tests__/PricingSummary.not-subject.test.jsx` (3).

### E2E (Playwright)

- [ ] `e2e/specs/settings/vat-regime-switch.spec.js` (3): switch to « Sans TVA » from today → a new reservation's résumé
      and devis PDF show the mention, an old one keeps « TVA 10 % »; correction → every fiche without VAT;
      switch back. Mobile viewport for the dialog.

### Prod-copy proof (manual, not committed data)

- [ ] `scripts/vat-regime-golden-prod.mjs` — on a prod copy, hashes the quote, stored summary, PDF draw
      list and baskets of every reservation and devis, plus the CSV of every month, before Lot 1 and after
      each lot: **0 differences** on the 58 + 5 rows of the shadow. Prints ids and hashes only, never
      names.

### Manual UI verification

- [ ] Happy path: Paramètres › TVA & exercice → « Changer de régime… » → « Séjours qui commencent à partir
      du » today → preview lines → confirm → history shows the period; a new direct quote has no VAT.
- [ ] Refusals: a date before the last change, a date two years ahead, a correction without the checkbox.
- [ ] Future-dated switch → « Prévu » → « Annuler ce changement ».
- [ ] Mobile (390 px): dialog full screen, radio cards stacked, no horizontal scroll.
- [ ] Regression: Solio's devis PDF, accounting CSV of October and finance dashboard are unchanged.

## 8. Out of scope

- **Franchise thresholds**: GuestFlow neither tracks the turnover nor warns when a threshold is crossed.
- **A dated rate change** inside `subject` (10 % → 20 % from a date). The model supports it (a `subject`
  period with another rate); the dialog only offers the other regime.
- **Invoices** — GuestFlow issues devis and payment links, no invoice; the mention applies to the
  documents that exist.
- **Rewriting sent documents**: PDFs already emailed and Qonto links already open stay as sent.
- **Per-line VAT exemptions** (an option outside VAT while the stay is taxed).
- **Activating or deactivating the accounting plugin from the dialog** — it stays in Paramètres › Plugins.
- **Renaming the page** — it keeps « TVA & exercice ».

## 9. Open questions

All four resolved by Adrien on 2026-10-28, each as proposed.

- Q1: What does « réservations à venir » mean for a switch?
  - **Resolved 2026-10-28:** both « prises à partir du » (default) and « séjours qui commencent à partir
    du » are offered, plus the correction scope (rule 14).
- Q2: Is the VAT regime its own setting, or does it ride on the accounting plugin?
  - **Resolved 2026-10-28:** its own dated core setting, independent of the accounting plugin (§1.2, rule 20).
- Q3: May a correction rewrite months already sent to the accountant?
  - **Resolved 2026-10-28:** yes, listed in the preview and acknowledged by a checkbox (rule 19); a frozen or
    declared tourist tax never moves (rule 11).
- Q4: Are the two fixed mentions enough, or is a free text needed?
  - **Resolved 2026-10-28:** the two fixed mentions, FR and EN (rule 2).

## 10. Implementation — ordered lots, each shippable

| Lot | Content | Visible change | Gate |
|---|---|---|---|
| 0 | Golden harness + prod-copy script, on unchanged code | none | golden captured |
| 1 | `vatRegimeModel` reading `app_settings.vatRate`; the eleven readers swept to `forRow` | none | golden byte-identical; prod-copy 0 diff |
| 2 | Schema, seed, backfill, trigger; resolver reads periods | none | golden; migration tests; prod-copy 0 diff |
| 3 | `not_subject` rendering in quote, summaries, PDF, links, finance, accounting plugin | none (no way to switch yet) | golden; not-subject suites |
| 4 | Switch API, preview, dialog, history, delete; plugin bump; changelog | the feature | all suites + E2E + manual |

Estimated size: ~16 server files touched, 4 created; ~10 client files touched, 5 created; 18 test files;
≈ 105 test cases. Lots 1 and 2 carry the risk; lots 3 and 4 are unreachable for Solio by construction.
