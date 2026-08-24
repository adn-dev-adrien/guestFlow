# Offered tourist tax → out of the brut + compta pass-through + cascade summary

| Field | Value |
|---|---|
| **Status** | Implemented (compta: no change needed) |
| **Branch** | `feature/fiche-total-sejour-net-of-commission` (stacked on PR #302) |
| **Created** | 2026-06-26 |
| **Author** | Adrien |
| **Related PR** | #302 (extends it) |

---

## 1. Context

Builds on PR #300 (the platform_reversed tax is taken out of the brut) and PR #302 (`sejourNetTotal`,
fiche cascade start). Two remaining problems for a **platform that collects the tourist tax AND remits
it to the commune itself** (« platform » / offered case — `touristTaxOfferedByPlatform`):

1. **Engine.** When the operator enters the brut (« montant total payé par le client », which includes
   the tax the guest paid), the engine bakes the tax into the pinned accommodation → `finalPrice`/CA
   is over-stated by the tourist tax. Confirmed: brut 204.80 (200 accom + 4.80 tax) → `finalPrice`
   204.80 instead of 200, net 174.80 instead of 170. Same class of bug PR #300 fixed for case 1.
2. **Compta.** The offered tax is currently absent from our books (`touristTaxTotal = 0`). Adrien wants
   it **visible as a pass-through** (account 46710000), like the reversed/owner cases — without it ever
   becoming revenue (CA).

Separately, the fiche summary order is hard to follow; Adrien validated a **running-subtotal cascade**
ending on « ce que vous percevez » = versement plateforme + compléments perçus sur place.

Resolved decisions (AskUserQuestion 2026-06-26): unified model — **engine separates the offered tax
from the brut** (accommodation = 200) **and** **compta books it as a 46710000 pass-through** (visible,
never CA). Commission button already subtracts the offered tax (shipped earlier on this branch).
> **2026-08-24 — both halves of that decision are reversed** by
> `specs/platform-brut-excludes-offered-tourist-tax.md`: neither the engine nor the commission button
> subtracts the offered tax any more, because the brut never contained it. Only the cascade (§3.7)
> and the « no compta change » conclusion (§3.4-3.6) survive from this spec.

## 2. Goal

For an offered-tax platform booking, the accommodation/CA excludes the tourist tax, the tax shows in
compta as a pass-through (not revenue), and the fiche summary reads as a clear cascade of subtotals
ending on what the operator actually earns.

## 3. Functional rules

### Engine (`pricing.js`)
1. ~~When a brut is pinned **and** the tax is offered-by-platform (`touristTaxOfferedByPlatform`), the
   brut→accommodation back-solve subtracts the **original** tourist tax (the pre-zeroing
   `touristTaxBreakdown.touristTaxTotal`), exactly like the reversed term added by PR #300:
   `accommodation = max(0, brut − extra-guest − pre-arrival options/resources − reversedTax − offeredTax)`.~~
   **SUPERSEDED 2026-08-24 by `specs/platform-brut-excludes-offered-tourist-tax.md` rule 2.** The
   premise below — « the brut the guest paid includes the tax » — is false: the number the operator
   copies off the statement is what the platform **bills us**, and Gîtes de France, Booking and Airbnb
   all print it tourist-tax-excluded. Subtracting our own estimate under-stated the CA *and* the
   commission by that estimate (accountant's report, réservation #22225), and the estimate is never
   the platform's figure anyway (Booking bills 4,4 % of the stay where we compute a nightly per-person
   rate). The back-solve now keeps only the `reversedTax` term.
2. ~~Consequence: `finalPrice` = real accommodation (200), `totalStayPrice` = 200 (offered tax stays 0),
   net perçu = 200 − commission.~~ **SUPERSEDED with rule 1** — `finalPrice` is now the whole brut.
   `platformGrossAmount` and `touristTaxOriginalTotal` are still exposed for the cascade.
3. **No change** to direct, reversed (case 1, already handled), owner (case 3), or any booking without
   a brut. The offered tax **amount** is unchanged (still 0 in `touristTaxTotal`, original kept).

### Compta (`accountingModel.js`) — **no change needed (resolved 2026-06-26)**
4. The compta CA is built from **`finalPrice`** (hébergement + options + ressources), which already
   **excludes** the tourist tax — the gross « Total du séjour » of the cascade is a display figure, not
   the CA basis. The tax is handled separately: 46710000 for the cases we collect it (direct / reversed
   / owner), and **0 in the books for the offered case** (the platform collects + remits it to the
   commune — it isn't the operator's liability). So the offered tax is correctly **never in the CA**.
5. With the §3.1 engine fix, the offered-case `finalPrice` = the real accommodation (tax taken out of
   the brut), so the CA is right for new/re-saved bookings. The existing test
   `accounting-model-tourist-tax` (« offered → no tax in the books ») stays green — **unchanged**.
6. (Earlier idea of a 46710000 pass-through for the offered tax was dropped: it rested on the false
   premise that the CA included the tax. Caisse-interne amounts still never appear in compta.)

### Fiche cascade (`PricingSummary.js`) — **implemented 2026-06-26** (validated layout)
7. The bottom block is a running-subtotal cascade. **« Total du séjour » reverts to the GROSS**
   (hébergement + toutes options/ressources + taxe — `finalPrice + touristTaxOriginalTotal`),
   superseding the #302 « Total du séjour = net ». For a platform reservation:
   - **Total du séjour** (gross)
   - − **Taxe de séjour (plateforme)** (offered case = `touristTaxOriginalTotal`)
   - − **Compléments (perçus sur place)** (`complementAmount`)
   - = **Montant soumis à commission** (`preArrivalAmount` = total − offered tax − compléments)
   - − **Commission acompte / solde**
   - = **Versement plateforme** (`platformNetReceivedAmount`, else `preArrivalAmount`)
   - + **Compléments (perçus sur place)**
   - = **Total perçu sur le séjour** (`sejourNetTotal` = versement + compléments — « ce que vous gagnez »)
   Intermediate subtotals are hidden when no deduction applies. **Direct** → a single « Total du
   séjour » (+ a « dont complément à percevoir sur place » line when there's an on-arrival amount).
   The offered tourist tax shows a « Plateforme » tag (not struck-through / « offert »).

## 4. Architecture

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `pricing.js` | T | Add the `offeredTaxInBrut` subtraction term (§3.1). |
| `models/` | `accountingModel.js` | T | Book the offered tax as a 46710000 pass-through (§3.4). |
| `components/` | `PricingSummary.js` | T | The cascade layout (§3.7). |
| tests | server + client | C | Engine (offered+brut), accounting (offered → pass-through, balances), PricingSummary (cascade). |

## 5. Data model

No schema change. The offered tax is recomputed by the engine (`touristTaxOriginalTotal`) and read by
the accounting export from the quote.

## 6. UI / UX

Cascade as in §3.7 (validated mockup). Responsive: same Stack, no layout-width change.

## 7. Test plan

> **Sensitive (pricing + compta). If an existing test breaks or a behaviour changes, STOP and decide
> together before adjusting it.**

- [x] `pricing` — offered tax + brut → finalPrice = accommodation (tax out), net = accom − commission.
- [x] `accountingModel` — **no change**: the existing « offered → no tax in the books » test stays green
  (CA already excludes the tax — §3.4).
- [x] `PricingSummary` — cascade subtotals + labels for offered/commission/complement and direct cases.

## 8. Out of scope

- Propagating `sejourNetTotal` to the finance dashboards (still the deferred PR 2).
- Non-offered tax accounting (unchanged).

## 9. Open questions

Resolved 2026-06-26: unified model (engine separates offered tax + compta pass-through). Commission
button subtraction already shipped on this branch.
