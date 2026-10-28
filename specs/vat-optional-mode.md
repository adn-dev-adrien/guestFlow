# VAT optional mode — a dated VAT regime (« Assujetti » ↔ « Sans TVA »)

| Field | Value |
|---|---|
| **Status** | Implemented (Lot 5 — franchise threshold follow-up, amendment of 2026-10-28 — included) |
| **Branch** | `feature/vat-optional-mode` _(user-managed)_ |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Related** | [single-vat-rate.md](single-vat-rate.md) (the one rate — amended by its rule 14), [payment-links-vat.md](payment-links-vat.md) (link baskets — amended by its rule 11), [accountant-accounting-export.md](accountant-accounting-export.md) (journal — amended by its rule 37), [fiscal-year-and-nights-sold.md](fiscal-year-and-nights-sold.md) (the exercise, unchanged), [tourist-tax-matches-the-office-calculation.md](tourist-tax-matches-the-office-calculation.md) (the HT base of the proportional tax), [plugins-phase-p-productisation.md](plugins-phase-p-productisation.md) (GuestFlow sold to other operators), [finance-dashboard-redesign.md](finance-dashboard-redesign.md) (the Suivi financier — gains one card), [shell-and-home-day-first.md](shell-and-home-day-first.md) (the home's attention box — gains one core subject) |
| **HTML summary** | [docs/specs/2026-10-28-vat-optional-mode.html](../docs/specs/2026-10-28-vat-optional-mode.html); franchise threshold: [docs/specs/2026-10-28-vat-franchise-threshold.html](../docs/specs/2026-10-28-vat-franchise-threshold.html) |

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

### 1.4 Impact measured on the shadow (prod copy, at the time of writing: 2026-10-28; figures move with the data — the dialog's preview is the live answer)

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

### 1.5 Franchise threshold (feedback of 2026-10-28, second pass)

> Lorsqu'on est sans TVA, ajoute un suivi de seuils de franchise et affiche-le dans la partie suivi
> financier. Tu ajoutes un emplacement pour saisir la valeur du seuil qui sera setté par l'utilisateur
> lorsqu'il est sûr de ce seuil.

An operator under the « franchise en base » (art. 293 B) stays out of VAT only while its turnover stays
under a threshold set by law and revised over time. Crossing it brings VAT back — the switch of rule 14.
GuestFlow does not know the figure that applies to a given operator (it depends on the activity and
changes with finance laws), so **the operator types it**; GuestFlow never ships, suggests or asserts a
legal amount. What GuestFlow does know is the money: every payment is already dated, per bucket, in
`financeDashboardModel.paymentsLedger` ([financeDashboardModel.js:324](../server/src/models/financeDashboardModel.js#L324)
— acompte, solde / versement plateforme, compléments, échéances, notes en séjour, ajustements à
l'arrivée, minus refunds on their own date). The share of a payment that is tourist tax is already
derived per stay by `htAmount` ([financeModel.js:120](../server/src/models/financeModel.js#L120)). The
expected dates of unpaid buckets already exist (`depositDueDate`, `balanceDueDate`, installment
`dueDate`, platform payout = `endDate + payoutDueDays`, [financeModel.js:195-255](../server/src/models/financeModel.js#L195)).
An amount typed in Paramètres and read by the Suivi financier already exists too: the revenue goal
(`utils/revenueGoals.js`, `SettingsFiscalYearSection`, the goal bar of `FinanceHero`). The follow-up
reuses all four; it adds no new money rule.

Scope: **core**, like the regime it depends on (§1.2). No plugin involved.

## 2. Goal

An operator who is not liable to VAT runs GuestFlow without any VAT on screens, documents, links and
accounting, with the right legal mention; and an operator who changes status can switch, from a date,
for the reservations to come — or correct every reservation after a misconfiguration — through one
explained confirmation, with a dated, permanent history. A VAT-registered install sees no difference.

An operator under the franchise sees, in the Suivi financier, its turnover of the calendar year against
the threshold it typed itself, with the projection to 31 December from the stays already booked, and is
warned before and when it crosses it.

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
7. **A devis not converted is a live offer** (narrowed by rule 25): it is always resolved as if booked today (rule 5 with
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
15. **Bounds** (the identity check is restated by rule 28; a decimal comma is a rate; an empty rate is refused, an absent one means 10): `effectiveFrom` is a valid date, ≥ the `effectiveFrom` of the latest dated period (the
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
18. **Undo of an unused change** (extended to a change that has not started by rule 26): The latest period, when no reservation references it (a future-dated
    switch, or a mistake caught at once), can be deleted (« Annuler ce changement »). Otherwise the
    history is immutable; a wrong switch is fixed by another switch or a correction.
19. **Scope `all` asks for an explicit acknowledgement** (rule 24 asks it for any scope that rewrites collected money or booked months): (a checkbox « Les écritures déjà transmises
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

### 3.5 Follow-ups of the review (2026-10-28)

Appended, never renumbered; each narrows or completes a rule above.

24. **Acknowledgement whenever money or books are rewritten.** Whatever the scope, a switch whose preview
    has `collected > 0` or a non-empty `exportMonths` needs `acknowledged: true` (the preview says so in
    `needsAcknowledgement`; the server refuses with 422 `acknowledged` otherwise; the dialog shows the
    checkbox, worded for the books, for the collected stays, or for the documents). The correction (rule 19)
    always asks.
25. **A devis is live only while it is open.** Draft or sent and not expired → resolved as if booked today
    (rule 7). Accepted or expired → the period it carries. Converted → the period of the reservation it
    became, so the devis and its reservation always print the same regime.
26. **A switch that has not started is undone exactly.** The period stores, per reservation it moved, the
    period it had (`vat_periods.movedFrom`). While its date is still ahead, « Annuler ce changement » is
    offered even though reservations moved: each goes back to its previous period (its refund lines re-rated,
    a history line « changement annulé »); the stays the switch re-priced get back exactly the figures it
    wrote (the period stores them, `vat_periods.repriced`: what each column held before and after; undo takes
    the switch's shift out of what the column holds now, so a later edit is kept), a stay the switch skipped is
    not touched; the links it retired are not reopened; a reservation born under
    the period since falls to the period the others give it — its tax then follows by the same targeted write of rule 27, with the
    same refusals; its devis go to the previous period. The undo answers 200 with `notRepriced` — the born stays it left on their stored tax (refused by the
    write, frozen or declared included), told in the page's toast. It is REFUSED (409 `stay_settled`, naming
    the stays) when a stay the switch re-priced has since had the RE-PRICED bucket paid (balance or
    complement, as the period recorded it), or its tax frozen or declared: the books and the tourist-tax return would disagree with the money, and the way back is a new
    switch. Once the date has come, rule 18 applies again.
27. **The tourist tax and totals are re-priced by a targeted write, not by re-saving the fiche.** Inside the
    switch transaction — and inside the retroactive rate edit of rule 9 — each moved stay of a
    proportional-tax property whose tax is neither frozen nor declared gets the engine's figures computed
    twice: under its old period (before the move) and under its new one. The stay is accepted only when every
    non-tax figure is identical in both (`finalPrice`, `totalPrice`, `depositAmount`, discounts, options,
    resources, commissions, due dates…). Then ONLY an allowlist is written — `touristTaxTotal`,
    `balanceAmount`, `complementAmount`, each moved by exactly what the engine's own figure moved, plus
    `updatedAt`, `vatPeriodId` and one `reservation_history` line. Every other column and every child row
    (options, custom options, resources, nights, installments, snapshots, iCal lock, stored due dates) stays
    byte for byte; the fiche's full save is never used (it rewrites too much). The preview is the same
    computation played in a savepoint, so the stored tax equals the announced line. A stay that is not
    accepted keeps its stored figures and is reported (« garde sa taxe de séjour enregistrée »), in the
    preview, in the switch's response (`notRepriced`) and after a rate edit (`vatNotRepriced`). A stay with
    an installment plan is never re-priced (no installment carries the tax): it is reported with its reason
    (« échéancier : à recalculer depuis la fiche »).
28. **The identity check compares with the latest period**, not with today's: after a switch dated ahead,
    the way back is offered and the same target is refused. The dialog builds its target from the latest
    period (`state.latest`), and still shows the period in force as the current regime.
29. **The settings mirror follows the calendar.** `app_settings.vatRate` is refreshed at the hourly tick
    (`scheduledTasks.tickVatRateMirror`), so a period that starts today is mirrored within the hour.
30. **The resolver is strict.** `forRow` refuses a row that names no id, no stored period and is not a devis,
    unless it says `newSale: true` (the engine does, for a stay not stored yet): it throws, and in
    production logs loudly and answers today's regime. `null` still means « the regime in force ».
31. **The fingerprint covers the source rates.** It hashes the moved set, the target and every period's
    content plus the settings mirror: a rate edited between the preview and the switch gives a 409. The
    months of the books are those of the journal's own predicates (paid, not in cash, a real amount; a
    refund that is not internal; a compensation received).

32. **Open payment links follow the amount.** After the write, every open deposit, balance, full or
    complement link — of the stay and of its converted devis — whose amount no longer matches its bucket is
    retired inside the transaction (status `cancelled`, reason `amount-changed`, deactivation owed to the
    provider); the provider is told AFTER the commit (the poll retries a refusal). The preview's
    `linksReplaced` is exactly that set, and its line says « Envoyer un nouveau lien depuis la fiche ». A link
    whose amount does not move stays open. The same holds for an undo and for a rate edit.
33. **A rate is a plain decimal.** `5`, `5.5`, `5,5` — never `0x10`, `1e1`, a blank, a sign: refused (the
    settings field answers 400 `SETTINGS_INVALID`, the switch 422), never a 500. A blank or null rate is
    refused too, never turned into 10 % (only an ABSENT rate on the switch means 10): the page shows
    « Taux requis. » and does not send it; under « Sans TVA » a blank rate (the page's echo) is ignored. The rate edit reports the stays that kept their figures.
34. **A link is retired only by the write that made it stale, and a paid one is still booked.** Rule 32
    retires the links that matched their bucket before the re-price and no longer do; a link that already
    disagreed with its bucket is left alone, as the fiche's save does. A link minted on a devis that became a
    reservation, retired for an amount change and paid anyway, is booked on that reservation
    (`bookPaidAfterAmountChange` follows `convertedReservationId`). The preview's `openLinks` subtracts only
    the retired links of the moved reservations themselves.

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

### 3.6 Franchise threshold follow-up

35. **When it applies.** The follow-up exists only while the period in force today is `not_subject`
    with the mention `art_293_b` (« franchise en base »). Under `subject`, or under `art_261_d_4`
    (an exemption that does not depend on turnover), the threshold field, the Suivi financier card and
    the home alert are absent; the stored threshold is kept, unused. _(Q12)_
36. **The threshold is typed by the operator, never supplied.** One amount, `app_settings.vatFranchiseThreshold`
    (euros, NULL = not set), edited in Paramètres › TVA & exercice, card « TVA », under the mention
    select, saved with the page's Save. GuestFlow ships no default, no placeholder figure and no
    legal amount in any text. Validation (server authoritative, same parser as the revenue goal):
    empty → NULL; spaces and a decimal comma accepted (« 30 000,00 »); > 0; at most 2 decimals;
    ≤ 10 000 000. Messages: « Montant supérieur à 0 €. Vide pour ne pas en fixer. », « Un montant en
    euros (ex. 12 500). », « Deux décimales au plus. », « 10 000 000 € au plus. ». A malformed value
    answers 400 `SETTINGS_INVALID` with the message under `errors.vatFranchiseThreshold` (like every settings
    field); a non-empty amount sent while rule 35 does not apply (the mention sent in the same save counts)
    → 422 « Seuil sans objet hors franchise ». The same amount sent again says nothing new. The day it is saved is
    stored (`vatFranchiseThresholdSetAt`) and shown in caption. _(Q10: one amount, not two.)_
37. **What counts — « chiffre d'affaires encaissé » of the calendar year.** The figure is the sum, over
    every payment row of `paymentsLedger` dated **1 January – 31 December** of the year (Europe/Paris,
    the row's own date — a December acompte for a March stay counts in December), of:
    - a. the amount **gross of what the platform took out** — the row's commission
      (`acompteCommissionAmount` on the acompte, `platformCommissionAmount` on the solde / payout) **and the
      platform penalty** (`platformPenaltyAmount`, deducted from the payout) are added back: both are costs,
      the guest paid the full price; _(Q8)_
    - b. **without tourist tax** — multiplied by the stay's non-tax share, the `htAmount` ratio of the
      finance dashboard taken with the row's own period rate (0 under `not_subject`, so the ratio is
      `finalPrice ÷ (finalPrice + touristTaxTotal)`; under a `subject` period of the same year it also
      removes the VAT, so a mixed year adds HT figures);
    - c. **refunds** (non-`internal`) subtract on their refund date, with the same ratio;
    - d. **caisse interne** buckets and `internal` refunds are **left out**, exactly as in « Encaissé »;
      _(Q9)_
    - e. a **cancellation compensation** received by the operator counts on its received date, **at face
      value** — an indemnity carries neither VAT nor tourist tax, so no share is taken out of it, even when
      it is linked to a stay; a cancelled stay's acompte counts as received then refunded (the `retained`
      avoir of a cancellation that keeps the acompte included), and the compensation that replaces it
      counts once it is received. A stay whose client or logement was deleted is left out, as in
      « Encaissé » (the ledger's own joins).
    The calendar year is used whatever the exercise of Paramètres (the exercise drives the books, the
    franchise is judged per calendar year). Every reservation of every logement counts; the Suivi
    financier's window and logement filter do not apply to the card. _(Q7: encaissé, not séjours.)_
38. **Projection to 31 December** (current year only): the collected figure of rule 37 plus every
    amount **still expected before 31 December** on a reservation of kind `reservation` (never
    `cancelled`, never a devis): each unpaid bucket whose expected date — acompte / solde due date,
    installment due date, platform payout `endDate + payoutDueDays`, arrival complement on `startDate`,
    end-of-stay complement on `endDate` — falls **between 1 January and 31 December** of the year,
    **including** dates of the year already past (late money is still expected). Money expected before 1
    January stays visible in « En retard », not in this projection: an old unticked solde must not inflate
    every year's projection for ever. The pending cancellation compensations whose expected date is in the
    same range are added, at face value. Same treatment a–d as rule 37. Unpriced stays add 0. The past year has
    no projection: its figure is final.
39. **Levels**, derived on the server from `collected`, `projected` and `threshold` (constant
    `NEAR_RATIO = 0.8`):
    - `over` — collected > threshold → tone error, title « Seuil dépassé », text « {montant} au-delà du
      seuil. Retour à la TVA à prévoir. » with an action « Passer à la TVA… » that opens Paramètres ›
      TVA & exercice;
    - `near` — collected ≥ 80 % of the threshold → tone warning, « Seuil proche », « Reste {montant}
      avant le seuil. »;
    - `projected_over` — collected < 80 % but projected > threshold → tone warning, « Projection
      au-delà » (short, so the badge does not wrap on a phone), « {montant} attendus d'ici le 31/12 avec les réservations en cours. »;
    - `ok` — otherwise → tone neutral, « Sous le seuil », « Reste {montant} avant le seuil. ».
    Ratios are rounded to the whole percent for display only; comparisons use cents. `= threshold`
    exactly is `near`, not `over`.
40. **No threshold set** → no gauge, no level, no home alert. The card shows the collected figure of the
    year and a discreet « Saisir le seuil » link to Paramètres › TVA & exercice. The Suivi
    financier is an admin page (`/api/finance/*` is outside the accountant's allowlist), so the card has
    one audience.
41. **Last year beside it.** The card adds one caption line « {année − 1} : {montant} » with the figure
    of rule 37 for the previous calendar year (0 € shown, never hidden, as soon as the install has
    one reservation in that year; absent otherwise).
42. **Home alert.** The home's attention box gains a core subject `vat-franchise`, severity `todo` for
    `near` and `projected_over`, `urgent` for `over`, never pinned; title « Seuil de franchise »,
    detail « 84 % atteint » / « Dépassé de 1 240 € » / « Projection : 104 % ». Absent for `ok`, without
    threshold, or when rule 35 does not apply. A failed read is named in `unavailable`, like every
    source (shell-and-home-day-first rule 20). _(Q11)_
43. **Read-only, cheap.** The follow-up writes nothing besides the threshold. It reads through
    `financeModel` / `paymentsLedger` and is computed on request (no cache, no scheduled task); one
    request for the card, one source for the home.
44. **A VAT-registered install sees no difference** (extends rule 23): with no `not_subject` period
    in force, `GET /api/finance/vat-franchise` answers `{ applies: false }`, the settings payload
    carries the new keys with `applies: false`, the home attention payload is byte-identical, and the
    Suivi financier renders exactly as before.

**Edge cases:**
- Switch to « Sans TVA » on 1 March: the year's figure still counts January–February (HT, rule 37b) —
  the franchise is judged on the whole year.
- A threshold lowered below the figure: the level is recomputed at the next read; no stored state.
- A refund in January of an acompte received in December: lowers the new year, not the old one.
- A platform payout grouping three stays: three ledger rows, one per stay, each on the payout date.
- Year with only cancelled stays fully refunded: collected 0 €, card shown with 0 €.
- A stay priced 0 € with only tourist tax: ratio 0, counts 0.
- Threshold « 0 », « -5 », « 12,345 », « abc », « 1e5 » → refused with the rule-36 message.

---

## 4. Architecture

> Fat backend: the period resolution, the preview, every derived « showHt », mention text and VAT split
> live on the server. The client renders the payloads and holds the dialog's draft inputs.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Rule 22: `vat_periods` table, `reservations.vatPeriodId`, seed + backfill, `trg_reservations_vat_period` AFTER INSERT trigger, all idempotent. |
| `models/` | `vatRegimeModel.js` | C | The leaf: read periods, `forRow` / `rateForRow` (resolves from the row, completing it from the database), period in force, `inForceBlock`, rate / mention of the period in force, mirror `app_settings.vatRate`. The only reader of that column. Takes the database as a parameter, so a minimal test schema without `vat_periods` answers the historical 10 %. |
| `models/` | `vatRegimeSwitchModel.js` | C | Preview (the switch itself played in a savepoint and rolled back, so the preview is exact), switch (one transaction), undo of an unused period, the settings card's state. Split from the leaf because it calls the pricing engine, which reads the leaf. |
| `utils/` | `vatRegimeMigration.js` | C | Rule 22: table, column, seed, backfill (the same predicate as the trigger), trigger, mirror — idempotent, run on every boot. |
| `models/` | `settingsModel.js` | T | `vatRate` writes route to the period in force (rule 9). |
| `models/` | `financeModel.js` | T | `htAmount` per row via `forRow`; `showHt` in the dashboard payloads (rule 12d). |
| `models/` | `refundsModel.js` | T | Re-rate lines of reassigned reservations (rule 16). |
| `models/` | `reservationsModel.js` | T | `addHistoryEntry` (existing, `:1541`) — one entry per reassigned reservation (rule 16). |
| `utils/` | `vatRegime.js` | C | Pure: predicate of rule 5, mention texts (rule 2), bounds validation (rule 15), the period a switch inserts, the preview fingerprint, the French sentences of a period and of « Ce qui change » (month range, plurals). |
| `utils/` | `pricing.js` | T | `getGlobalVatRate` is gone: the engine asks `forRow` with its own `bookingId` (a stored stay keeps its period), `kind` (a devis is live) and `bookingDate` / `startDate` (a new stay is priced under today's regime). The quote gains `vatRegime { periodId, regime, rate, legalMention, legalMentionText, legalMentionTextEn }`; the three `vatPercentage*` keys carry the period's rate. |
| `utils/` | `devisPdf.js` | T | Rate and layout from `full.vatRegime` (attached by `devisModel.enrichDevis`); `not_subject` layout and mention (rule 12b, FR/EN labels). |
| `utils/` | `devisQuote.js`, `publicPaymentMode.js`, `storedLinkComponents.js` | T | Basket rate from the row's period (rule 12c). |
| `utils/` | `cancellationRequalification.js` | — | Unchanged; its caller passes the row's rate. |
| `controllers/` | `vatRegimeController.js` | C | GET state, POST preview, POST switch, DELETE period; admin check; 409 / 422 shapes. |
| `controllers/` | `reservationsController.js` | T | `storedSummary` from the row's period (rule 12a). |
| `controllers/` | `paymentsController.js`, `refundsController.js`, `reservationCancellationController.js` | T | Rate from the row's period. |
| `controllers/` | `settingsController.js`, `settingsSummaryController.js` | T | Rate edit → period in force (422 when `not_subject`); summary wording (rule 12e). |
| `routes/` | `settings.js` | T | Mount `/api/settings/vat-regime*` (thin). |
| `middleware/` | `enforceRoleAccess.js` | T | The accountant may `GET /settings/vat-regime`. |
| `utils/` | `settingsResponse.js` | T | `vat: { regime, rate, legalMention }` of the regime in force. |
| `plugins/accounting-export/` | `accountingModel.js`, `accountingExport.js` | T | Rate per row via `sdk.coreModule('vatRegimeModel')`; `not_subject` entries without VAT, commission TTC without 44566, compensation 0 % (rule 12g). Plugin version bump + changelog line. |
| `plugins/sdk/` | core module list | T | Expose `vatRegimeModel` to plugins (`forRow`, `rateForRow`, `inForceBlock`): SDK 2.10.0, `coreModules.json`, `coreModuleHistory.json`. |
| `middleware/` | — | — | Existing admin role guard reused. |
| `scheduledTasks.js` | `scheduledTasks.js` | T | `tickVatRateMirror` at the hourly tick (rule 29); nothing else: a future-dated period needs no job, rule 5 is evaluated at insert. |
| `utils/` | `settingsValidation.js` | T | `validateVatRate` accepts a decimal comma. |
| `database.js` | `database.js` | T | `tryAddAppSettingsCol('vatFranchiseThreshold', 'REAL')` and `('vatFranchiseThresholdSetAt', 'TEXT')` — NULL for every existing install. |
| `utils/` | `vatFranchise.js` | C | Pure: `parseThreshold` (reuses `revenueGoals.parseGoalAmount` with its own messages), `turnoverOf({ rows, compensations, from, to, share })` (rule 37 on ledger rows and received compensations), `expectedOf({ stay, installments, … })` (rule 38), `wordsOf` and `attentionSummary` (rules 39, 42), `levelOf({ collected, projected, threshold })` (rule 39), French titles / texts / home details. |
| `models/` | `vatFranchiseModel.js` | C | `getFollowUp({ today })`: applies? (rule 35 via `vatRegimeModel.inForceBlock`), reads every stay through `financeModel.getLedgerStays`, their ledger through `financeDashboardModel.paymentsLedger` (returned by the factory for it, `withCommission: true`), the stay's own `htAmount` ratio at its period's rate, the unpaid buckets and installments, the received compensations; returns the card payload. |
| `models/` | `financeDashboardModel.js` | T | `paymentsLedger` is returned by the factory, and with the opt-in `withCommission` each row carries `commission` (the share added back by rule 37a); `isPlatformStay` is exported. Without the option the rows, hence the « Encaissé » table, are unchanged. |
| `models/` | `financeModel.js` | T | `getLedgerStays()`: every `reservation` and `cancelled` stay, with the shape of `getSummary`'s rows. |
| `models/` | `settingsModel.js` | T | Reads the two columns; `setVatFranchiseThreshold(amount, today)` writes NULL or the amount, and the day only when the amount really changes. |
| `controllers/` | `financeController.js` | T | `getVatFranchise` handler → `vatFranchiseModel.getFollowUp`. |
| `controllers/` | `settingsController.js` | T | `vat.franchiseThreshold` validation (rule 36): 400 for a malformed amount, 422 when rule 35 does not apply. |
| `routes/` | `dashboard.js` | T | Core source `vat-franchise` (rank 25, handler `financeController.getVatFranchise`), `skip` when rule 35 does not apply — so a VAT-registered install does not even declare the subject. |
| `utils/` | `dashboardAttention.js` | T | `CORE_SUMMARIES['vat-franchise']` (rule 42). |
| `utils/` | `settingsResponse.js` | T | `vat` block gains `franchise: { applies, threshold, setAt }`. |
| `routes/` | `finance.js` | T | `GET /vat-franchise` (thin). |
| `middleware/` | `enforceRoleAccess.js` | — | Unchanged: `/api/finance/*` stays admin-only. |
| `scheduledTasks.js` | — | — | None (rule 43). |
| `plugins/` | — | — | None (core, §1.5). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/settings/` | `VatFiscalSettingsPage.jsx` | T | Hosts the regime card; the switch never goes through the page's Save. |
| `components/` | `SettingsVatSection.jsx` | T | Current regime badge, rate field (`subject`) or mention select (`not_subject`), history, « Changer de régime… ». |
| `components/` | `VatRegimeSwitchDialog.jsx` | C | Specific: inputs of rule 14 on `FormDialog`, server preview, acknowledgement, 409/422 display. |
| `components/` | `VatPeriodHistory.jsx` | C | Specific: dated list of periods, « Annuler ce changement » on an unused latest one. |
| `components/` | `PricingSummary.jsx`, `reservation/StoredPricingSummary.jsx` | T | Render `vatRegime` from the payload (rule 12a). |
| `components/` | `FinanceHero.jsx`, `FinanceDetailPanel.jsx` | T | Hide HT when `showHt` is false. |
| `components/property/` | `PropertyTariffTab.jsx` | T | Caption per regime (rule 12f) from `useVatRegime`. |
| `plugins/accounting-export/` | `PlatformAccountsPage.jsx` | T | Commission and compensation VAT fields hidden in `not_subject` (they cannot apply). |
| `hooks/` | `useVatRegime.js` | C | Load state, carry the preview / switch / delete calls (the 300 ms debounce lives in the dialog, which owns the draft). |
| `api.js` | `api.js` | T | `getVatRegime`, `previewVatSwitch`, `switchVatRegime`, `deleteVatPeriod`. |
| `constants/` | `vatRegime.js` | C | French labels of scopes and buttons. |
| `components/` | `SettingsVatSection.jsx` | T | « Seuil de franchise (€) » field under the mention select while the draft mention is art. 293 B; caption « Saisi le 12/03/2026 » or the hint « Montant fixé par la loi pour l'activité. À vérifier avant saisie. ». |
| `components/` | `ThresholdMeter.jsx` | C | **Generic**: a horizontal meter `{ value, projected?, limit, tone, ariaLabel }` — filled bar to `value`, hatched extension to `projected`, a tick at `limit`, overflow drawn past the tick. Generic because the goal bar of `FinanceHero` and any future quota (nights per year, micro-BIC ceiling) are the same shape. |
| `components/` | `VatFranchiseCard.jsx` | C | Specific: title, `StatusBadge` of the level, the two figures (« Encaissé {année} », « Projection au 31/12 »), `ThresholdMeter`, level text, last year caption, « Saisir le seuil » / « Passer à la TVA… » action. Renders the payload only. |
| `pages/` | `FinancePage.jsx` | T | Loads `api.getVatFranchise()` once (and on « Actualiser »); renders `VatFranchiseCard` between the hero and the insights when `applies`. |
| `components/` | `attentionSubjects.js`, `VatFranchiseAlert.jsx` | T / C | Subject `vat-franchise` → `AttentionCard` whose « Voir le suivi » opens `/finance`. |
| `hooks/` | `useSettingsForm.js` | T | The `vat` draft gains `franchiseThreshold` (from `franchise.threshold`); the server's `franchise` block is read-only. |
| `api.js` | `api.js` | T | `getVatFranchise()`. |
| `constants/` | `vatRegime.js` | T | Labels of the field and the card. |
| `constants/` | `settingsMenu.js` | T | Search keywords of `/settings/tva-exercice` gain « Seuil de franchise ». |
| `utils/` | `validation.js` | T | `vatThresholdInputError` — UX mirror of rule 36 (the server re-validates). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog`, `StatusBadge`, `Card`, `InsightCard` tones, `SummaryItem`, `ErrorAlert`, `LoadingState`, `SettingsFormPage`, `PageActionBar` (via `SettingsFormPage`) | No new generic needed. |
| **Created (new generic)** | `ThresholdMeter` (Lot 5) | A horizontal meter `{ value, projected?, limit, tone, ariaLabel }`: the goal bar of `FinanceHero` and any future quota are the same shape. |
| **Specific (kept feature-local)** | `VatRegimeSwitchDialog`, `VatPeriodHistory`, `VatFranchiseCard` | Tied to the VAT regime's rules and payload; the history's shape (dated periods with a scope) exists nowhere else. |

### 4.3 API contract

All under the admin guard; « Comptable » may `GET`.

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/settings/vat-regime` | — | `{ inForce: Period, latest: Period, periods: Period[], mentions: [{ key, label, short }], accountingExportActive: bool }` | `Period = { id, regime, rate, legalMention, legalMentionText, basis, effectiveFrom, createdAt, createdAtDay, createdByName, reservations: n, deletable: bool, scheduled: bool, correction: bool, initial: bool, label }` — `scheduled`: the period has not started (rule 26); `correction`: scope `all` after the initial period; `createdAtDay`: the Paris day; `createdByName`: a name, or « Un administrateur », never an email (the accountant reads it) — `label` is the server's sentence (« Depuis le 01/01/2027 · réservations prises à partir de cette date »). |
| POST | `/api/settings/vat-regime/preview` | `{ regime, rate?, legalMention?, basis, effectiveFrom? }` | `{ fingerprint, reassigned, collected, touristTaxChanged, touristTaxDelta, touristTaxKept, openLinks, exportMonths: ['2026-05', …], devisDrafts, linksReplaced, notRepriced, needsAcknowledgement, fromRegime, lines: ['9 réservations passent sans TVA, …'], accountingExportActive }` or 422 `{ errors: { effectiveFrom?: string, rate?: string, regime?: string } }` | Pure read. |
| POST | `/api/settings/vat-regime/switch` | preview body + `{ fingerprint, acknowledged? }` | 201 `{ period: Period, reassigned }` | 409 `{ error: 'preview_stale' }`; 422 as preview, or `{ errors: { acknowledged } }` for scope `all`. |
| DELETE | `/api/settings/vat-regime/periods/:id` | — | 204 | 409 `{ error: 'period_in_use' \| 'not_latest' \| 'initial_period' }`. |
| PUT | `/api/settings` | `vat: { rate?, legalMention? }` | as today, `vat` = `{ regime, rate, legalMention }` | Edits the period in force (rule 9); 422 `vatRate` when `not_subject`, 422 `legalMention` when `subject`. The page sends back only what it changed, but a value that says nothing new (a null mention, a rate of 0 under « Sans TVA ») is not a change. |
| — | Every quote payload | — | adds `vatRegime` | `vatPercentage*` keep their names. |
| — | Finance payloads | — | adds `showHt` | — |
| GET | `/api/devis` | — | each row adds `vatRegimeKind` and `vatShowTtc` | `vatShowTtc` is the same on every row: the « TTC » wording stays while one quote of the list is under VAT (decided by the server). |
| GET | `/api/finance/vat-franchise` | — | `{ applies: false }` or `{ applies: true, year: 2026, asOf: '2026-10-28', threshold: 30000.00 \| null, thresholdSetAt: '2026-03-12' \| null, collected: 22510.40, projected: 27380.20, ratio: 0.7503 \| null, projectedRatio: 0.9127 \| null, level: 'ok'\|'near'\|'projected_over'\|'over'\|null, tone, title, text, action: { label, path } \| null, previousYear: { year: 2025, collected: 31204.10 } \| null, settingsPath: '/settings/tva-exercice' }` | Admin only. The projection is the current year's (the card is always about today's year). The 30 000 above is an example payload, not a default. |
| PUT | `/api/settings` | `vat: { franchiseThreshold: '30 000' \| number \| null }` | `vat.franchise = { applies, threshold, setAt }` | 400 `{ code: 'SETTINGS_INVALID', errors: { vatFranchiseThreshold: '<message rule 36>' } }` for a malformed amount; 422 with « Seuil sans objet hors franchise » outside the franchise. |
| GET | `/api/dashboard/attention` | — | may contain `{ key: 'vat-franchise', count: 1, title, detail, severity }` | Rule 42. |

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

-- Rule 26: vat_periods also carries `movedFrom TEXT` (JSON: reservation id -> previous period id).
-- The trigger falls back to the first period when no predicate holds: COALESCE((SELECT … LIMIT 1), (SELECT MIN(id) FROM vat_periods)).
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

Lot 5 (franchise threshold):

```sql
ALTER TABLE app_settings ADD COLUMN vatFranchiseThreshold REAL;        -- guarded; NULL = not set
ALTER TABLE app_settings ADD COLUMN vatFranchiseThresholdSetAt TEXT;   -- guarded; YYYY-MM-DD
```

Additive, NULL by default: an existing install (Solio) has no threshold and is `subject` — nothing
renders (rule 44). Not encrypted (not a secret).

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

### 6.6 Paramètres › TVA & exercice — threshold field

- Only under « Sans TVA · art. 293 B », below « Mention légale », same 320 px column.
- `TextField` « Seuil de franchise (€) », `inputMode="decimal"`, empty by default, no placeholder figure.
- Helper: empty → « Montant fixé par la loi pour l'activité. À vérifier avant saisie. »; set →
  « Saisi le 12/03/2026 ». An invalid value → red message of rule 36 under the field, Save disabled
  (mirror), the server re-validates.
- The field exists only while the draft shows « Sans TVA · art. 293 B ». When it is hidden — another mention
  picked, or a switch of regime — it gives back the stored amount, blocks Save for nothing and sends nothing,
  so the server's « Seuil sans objet hors franchise » can never land on a field the operator cannot see.
- « Saisir le seuil » of the Suivi financier opens this page on `#seuil-franchise`: the field takes focus.

### 6.7 Suivi financier — card « Seuil de franchise »

- Between the hero and the « Faits marquants », full width, white card (not ink: the hero stays the
  only dark block).
- Header: « Seuil de franchise » + `StatusBadge` of the level (« Sous le seuil », « Seuil proche »,
  « Projection au-delà », « Seuil dépassé »); caption « Année civile 2026 · tous logements · au 28/10 »,
  without the date when no threshold is set.
- Two figures side by side: « Encaissé » {collected} and « Projection au 31/12 » {projected}; under
  them the `ThresholdMeter` (solid = encaissé, hatched = projection, tick = seuil) and one line
  « 75 % du seuil de 30 000 € ». Level text (rule 39) in the level's tone. Caption « 2025 : 31 204 € ».
- No threshold: one line « Encaissé 2026 : 22 510 € » + text button « Saisir le seuil », which opens
  Paramètres › TVA & exercice on `#seuil-franchise`: the field is focused and centred.
- A negative figure (a January refund of a December acompte) shows its signed amount; the percentage shows
  0 % and the meter draws 0. The meter's reading for assistive tech is the server's sentence; its maximum
  follows the value once the threshold is crossed.
- The page waits for the card's read before drawing (no late pop-in pushing the insights down); a failed
  read hides the card, nothing else.
- `over`: card border in error, action button « Passer à la TVA… » → Paramètres › TVA & exercice.
- Motion: the meter fills from 0 on first render, 400 ms ease-out, `prefers-reduced-motion` → none.

### 6.8 Responsive

- `xs`: the two figures stack; the meter is full width; the « 75 % du seuil » line wraps under it; the
  action button full width. No horizontal scroll.
- `md+`: figures on one row, meter below at 100 % of the card.

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
      accountant-accounting-export rule 37 (7): no 4457x, commission TTC without 44566, compensation 0 %,
      refund avoir 0 %, balanced entries, mixed month.
- [ ] `tests/vat-regime-switch.unit.test.js` — rules 3, 14, 15, 16, 18, 19 (16): each scope, bounds and
      messages, identical-target refusal, transaction (all-or-nothing), history entries, refund re-rate,
      delete unused / refuse used / refuse initial, acknowledgement, admin only.
- [ ] `tests/vat-regime-preview.unit.test.js` — rule 17 (8): each count against a crafted DB, fingerprint,
      409 on a changed set.
- [ ] `tests/single-vat-rate-period.unit.test.js` — single-vat-rate rule 14 (2).
- [ ] `tests/payment-links-vat-period.unit.test.js` — payment-links-vat rule 11 (2).

- [ ] `tests/vat-franchise-threshold.unit.test.js` — rules 35, 36 (9): parse accepted forms
      (« 30 000,00 », 30000, empty → null), each refusal message, 400 on the endpoint, 422 when rule 35 does not apply (a mention sent in the same
      save counts), `setAt` written on change only, cleared with the amount, kept across a switch to `subject`.
- [ ] `tests/vat-franchise-turnover.unit.test.js` — rules 37, 41 (13): calendar-year bounds, acompte in December for a stay in March, commission added back (acompte and
      payout), tourist-tax ratio, mixed year HT, refund on its own date, caisse interne excluded,
      internal refund excluded, cancellation compensation counted, installments, previous year.
- [ ] `tests/vat-franchise-projection.unit.test.js` — rule 38 (8): each expected-date source, past
      unpaid counted, cancelled / devis / caisse interne / after 31/12 excluded, unpriced adds 0.
- [ ] `tests/vat-franchise-levels.unit.test.js` — rules 35, 39, 40 (8): four levels, equality is `near`,
      cents comparison, texts, no threshold → null level, not applicable outside the franchise.
- [ ] `tests/vat-franchise-attention.unit.test.js` — rules 42, 43 (5): summary per level, absent for
      `ok` / no threshold / not applicable, never pinned, failed source named, read-only.
- [ ] `tests/vat-regime-golden.unit.test.js` — rule 44 (+2): the settings payload only adds an absent
      follow-up, the attention payload does not declare the subject for a `subject`-only database.


≈ 90 server cases, 14 files; Lot 5 adds 57 cases in 5 new files (and +2 golden cases).

### Client tests (Vitest)

- [ ] `components/__tests__/SettingsVatSection.regime.test.jsx` (6): badge per regime, rate vs mention,
      history tags, delete button only when deletable.
- [ ] `components/__tests__/VatRegimeSwitchDialog.switch.test.jsx` (9): scope radios, date refusal from
      the 422, acknowledgement gating, button labels, 409 alert, fullScreen on xs.
- [ ] `components/__tests__/PricingSummary.not-subject.test.jsx` (3).
- [ ] `components/__tests__/SettingsVatSection.franchise-threshold.test.jsx` (10): field only under
      293 B, hint vs `Saisi le`, refusal mirror, number on blur.
- [ ] `hooks/__tests__/useSettingsForm.vat-franchise.test.jsx` (3): draft from the stored amount, sent only when changed.
- [ ] `components/__tests__/ThresholdMeter.meter.test.jsx` (4): fill, projection, overflow, aria.
- [ ] `components/__tests__/VatFranchiseCard.levels.test.jsx` (6): each level, the way back to VAT, no threshold,
      nothing outside the franchise.
- [ ] `pages/__tests__/FinancePage.vat-franchise.test.jsx` (3): the card between hero and insights, reload on « Actualiser », hidden when not applicable or failed, « Saisir le seuil ».

### E2E (Playwright)

- [ ] `e2e/specs/settings/vat-regime-switch.spec.js` (3): switch to « Sans TVA » from today → a new reservation's résumé
      and devis PDF show the mention, an old one keeps « TVA 10 % »; correction → every fiche without VAT;
      switch back. Mobile viewport for the dialog.
- [ ] `e2e/specs/finance/vat-franchise.spec.js` (2): switch to « Sans TVA » → type a threshold → the
      Suivi financier shows the card with its level; empty the field → the card invites to set it.
      Mobile viewport for the card.

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
- [ ] Shadow copy switched to « Sans TVA »: figure of the year checked by hand against the « Encaissé »
      tile + commissions − tourist tax (three stays).
- [ ] Refusals in the field: « 0 », « -5 », « 12,345 ».
- [ ] Mobile (390 px): card stacked, no horizontal scroll.
- [ ] Solio (`subject`): Suivi financier and home unchanged.

## 8. Out of scope

- **A dated rate change** inside `subject` (10 % → 20 % from a date). The model supports it (a `subject`
  period with another rate); the dialog only offers the other regime.
- **Invoices** — GuestFlow issues devis and payment links, no invoice; the mention applies to the
  documents that exist.
- **Rewriting sent documents**: PDFs already emailed and Qonto links already open stay as sent.
- **Per-line VAT exemptions** (an option outside VAT while the stay is taxed).
- **Activating or deactivating the accounting plugin from the dialog** — it stays in Paramètres › Plugins.
- **Renaming the page** — it keeps « TVA & exercice ».
- **Supplying the legal threshold**: GuestFlow never ships, suggests or updates a legal amount; the
  operator types it (rule 36).
- **Automatic switch back to VAT** when the threshold is crossed: the card points to the switch
  (rule 14); the operator decides the date.
- **A second, « majoré » threshold** (Q10).
- **Per-activity thresholds** (sale of goods vs services) — one amount for the whole install.
- **Emails or push** on crossing — the home box and the card only.

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

Raised by the review of 2026-10-28, for Adrien and his accountant. The spec takes no position on the law:

- Q5: **A platform's commission invoiced from another EU country.** Under « Sans TVA », the journal books the
  commission TTC with no deductible-VAT line (rule 12 (g)), whatever the platform row says. Does the
  accountant want any specific entry for a commission invoiced without French VAT by a platform established
  in another EU member state (a reverse-charge treatment, or none)? Until answered, GuestFlow books the
  commission as a cost with no VAT line.
- Q6: **Which date decides the regime of a stay: the sale or the payment?** GuestFlow assigns the regime by
  the booking day or the arrival day, as the operator chooses (rule 14), and each reservation keeps it. Does
  the accountant want the regime of an encaissement to follow the date of its payment instead (an acompte
  collected before a switch for a stay booked after it, or the reverse)? Until answered, every entry of a
  reservation follows that reservation's regime.

Raised by the franchise-threshold amendment (feedback of 2026-10-28, second pass); all six resolved by Adrien on 2026-10-28:

- Q7: Which turnover is compared with the threshold?
  - encaissé of the calendar year, each payment on its date (rule 37) — follows the bank.
  - Stays of the year, attributed like the Suivi financier (solde date / departure) — matches the hero, less exact for acomptes received the year before.
  - **Resolved 2026-10-28:** base: encaissé of the calendar year, each payment on its date (rule 37).
- Q8: Platform stays: gross or net of commission?
  - gross — the guest paid the full price to the operator; the commission is a cost.
  - Net — same figure as « Encaissé », lower than the turnover by the commissions.
  - **Resolved 2026-10-28:** gross, commission included (Adrien) — the guest paid the full price; the commission is a cost (rule 37a).
- Q9: Caisse interne (off the books)?
  - excluded, like every finance figure of GuestFlow.
  - Included — the turnover is the turnover; the card then differs from « Encaissé » by the cash.
  - **Resolved 2026-10-28:** internal cash (caisse interne) excluded (Adrien), like every finance figure (rule 37d).
- Q10: How many thresholds?
  - one amount, as asked.
  - Two: « seuil » + optional « seuil majoré » (beyond it, VAT is due immediately) — one more field and a fifth level.
  - **Resolved 2026-10-28:** one threshold amount, typed by the user in Paramètres › TVA & exercice (rule 36).
- Q11: Home alert?
  - yes, in the attention box, from « Seuil proche » (rule 42).
  - Suivi financier only.
  - **Resolved 2026-10-28:** alert in the attention box from « Seuil proche » (rule 42).
- Q12: Which « Sans TVA » periods get the follow-up?
  - art. 293 B only (the franchise) — the 261 D 4° exemption does not depend on turnover.
  - Every « Sans TVA » period, title « Seuil de chiffre d'affaires ».
  - **Resolved 2026-10-28:** art. 293 B only (rule 35).

## 10. Implementation — ordered lots, each shippable

| Lot | Content | Visible change | Gate |
|---|---|---|---|
| 0 | Golden harness + prod-copy script, on unchanged code | none | golden captured |
| 1 | `vatRegimeModel` reading `app_settings.vatRate`; the eleven readers swept to `forRow` | none | golden byte-identical; prod-copy 0 diff |
| 2 | Schema, seed, backfill, trigger; resolver reads periods | none | golden; migration tests; prod-copy 0 diff |
| 3 | `not_subject` rendering in quote, summaries, PDF, links, finance, accounting plugin | none (no way to switch yet) | golden; not-subject suites |
| 4 | Switch API, preview, dialog, history, delete; plugin bump; changelog | the feature | all suites + E2E + manual |
| 5 | Threshold column + field, `vatFranchise` util/model, endpoint, `ThresholdMeter`, `VatFranchiseCard`, home source | the follow-up, only under « Sans TVA · 293 B » | golden (rule 44); franchise suites; E2E; manual |

Estimated size: ~16 server files touched, 4 created; ~10 client files touched, 5 created; 18 test files;
≈ 105 test cases. Lots 1 and 2 carry the risk; lots 3 and 4 are unreachable for Solio by construction.

Lot 5 ships after Lot 4 (it needs a way to be `not_subject`), on its own commit/PR.
Estimated size of Lot 5: server 9 files touched, 2 created; client 7 touched, 2 created; 9 test files;
≈ 60 test cases. Low risk: read-only, additive column, hidden for VAT-registered installs.


## 11. Implementation progress (2026-10-28)

Review fixes of the same day: rules 24-31, the client items (devis status, scope cards, short mentions,
TTC/HT wording, history captions, stacked dialog actions), and a base fix for the English devis summary.
Preview time measured on the shadow copy (machine under load): about 770 ms for a correction of 58
reservations, about 300 ms for an arrival scope of 9; nothing was optimised.

All four lots are done, committed in order on `feature/vat-optional-mode`; Lot 0 was committed alone on the
unchanged code and every later lot kept its capture byte-identical.

| Lot | Result |
|---|---|
| 0 | `vat-regime-golden.unit.test.js` (188 artefacts on the Solio-shaped fixture) and `scripts/vat-regime-golden-prod.mjs` (475 artefacts on the shadow copy: 63 quotes, 58 fiches, 5 devis PDF, 245 link baskets, 36 months of journal, finance, tourist-tax pages, 5 cancellations). |
| 1 | Eleven readers swept to `vatRegimeModel.forRow`: 0 difference. |
| 2 | Schema, trigger, resolver on periods: 0 difference on both. |
| 3 | `not_subject` rendering; the capture ignores only the keys the regime added (`vatRegime`, `vatPeriodId`, `showHt`). A first draft of the PDF change altered the bytes of a VAT-registered devis; the golden caught it. |
| 4 | Switch API, preview, dialog, history, undo, E2E. |

Deviations from the draft, all written back above: the engine resolves through its own `bookingId` / `kind` /
`bookingDate` instead of a new `vatPeriodId` argument; the devis PDF reads `full.vatRegime`; the preview is
the switch played in a savepoint; the preview carries its `lines`; the 300 ms debounce lives in the dialog;
`PUT /api/settings` treats a value that says nothing new as no change; a missing `vat_periods` table, or one
that cannot be read, answers the historical default (minimal test schemas). A real bug found by the readers
suite: a finance query selecting explicit columns lost the reservation's id, hence its period.

Tests: server 6972 / 0 failed (full suite); new server files 13 (`vat-regime-*`, `single-vat-rate-period`,
`payment-links-vat-period`, plugin `accounting-export-not-subject`); client 3 new files (26 cases) and the
full run, whose failures under load (machine at load 200) pass when re-run alone; E2E `vat-regime-switch`
(4) green; `check-spec-coverage` 23/23.

### Lot 5 — franchise threshold follow-up (2026-10-28)

Rules 35-44, decisions Q7-Q12 resolved by Adrien the same day, all as recommended (gross of commission,
caisse interne excluded). Server: `vatFranchise` (pure) + `vatFranchiseModel` (read-only), `GET
/api/finance/vat-franchise`, the two `app_settings` columns, the settings field, the `vat-franchise` home
subject. Client: `ThresholdMeter` (generic), `VatFranchiseCard`, the field of `SettingsVatSection`,
`VatFranchiseAlert`. No plugin touched, no SDK bump.

Review fixes of 2026-10-28 (two Opus reviews), written back into rules 37, 38, 39 and §6.6-6.7: the platform
penalty is added back with the commission; the projection ignores unpaid money older than 1 January and
adds the pending compensations of the year; compensations count at face value; a hidden threshold field
blocks and sends nothing; the meter's reading is valid past the limit and for a negative figure; the page
waits for the card's read; « Saisir le seuil » focuses the field.

Deviations from the amendment, written back above: the Suivi financier is admin-only, so the accountant
audience of rules 29/40 and the null `settingsPath` are gone; `paymentsLedger` gets an opt-in
`withCommission` instead of a `cash` flag (the ledger already excludes the caisse interne), so the «
Encaissé » payload stays byte for byte the same; the home source needs a `skip` for rule 44 (the
`declared` list would otherwise differ); a malformed amount answers 400 like every settings field, only
« sans objet » is 422; the settings and the golden suites gained the absent `franchise` block.

Checked on the shadow copy switched to « Sans TVA » through the real dialog: the year's figure
(29 901,57 €) matches an independent SQL sum of the buckets (deposit, solde with commission added back,
complements, refunds, compensations, tourist tax removed) to the cent; levels `ok`, `near`, `over` drawn at
1280 / 900 / 390 px, home line « Dépassé de 4 902 € », no horizontal scroll.

Tests: server 7539 / 0 failed; client 2783 / 0 failed (531 files); `vat-franchise.spec.js` 3 green, full
E2E 170 green (two specs that fail only under parallel load pass alone); `check-spec-coverage` ok for
this spec, `vite build` ok.
