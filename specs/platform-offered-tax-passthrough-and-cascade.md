# Offered tourist tax → out of the brut + compta pass-through + cascade summary

| Field | Value |
|---|---|
| **Status** | Draft |
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

## 2. Goal

For an offered-tax platform booking, the accommodation/CA excludes the tourist tax, the tax shows in
compta as a pass-through (not revenue), and the fiche summary reads as a clear cascade of subtotals
ending on what the operator actually earns.

## 3. Functional rules

### Engine (`pricing.js`)
1. When a brut is pinned **and** the tax is offered-by-platform (`touristTaxOfferedByPlatform`), the
   brut→accommodation back-solve subtracts the **original** tourist tax (the pre-zeroing
   `touristTaxBreakdown.touristTaxTotal`), exactly like the reversed term added by PR #300:
   `accommodation = max(0, brut − extra-guest − pre-arrival options/resources − reversedTax − offeredTax)`.
2. Consequence: `finalPrice` = real accommodation (200), `totalStayPrice` = 200 (offered tax stays 0),
   net perçu = 200 − commission. `platformGrossAmount` (the brut, 204.80) and `touristTaxOriginalTotal`
   (4.80) are already exposed for the cascade.
3. **No change** to direct, reversed (case 1, already handled), owner (case 3), or any booking without
   a brut. The offered tax **amount** is unchanged (still 0 in `touristTaxTotal`, original kept).

### Compta (`accountingModel.js`)
4. For an offered-tax platform booking, book the **original** tourist tax (`quote.touristTaxOriginalTotal`)
   on the 46710000 pass-through account, carved out of the gross encaissement — never on a 70xxx
   revenue line. The balance entry carries it (the platform settles it with the booking).
5. Caisse-interne amounts must still never appear in compta (unchanged).
6. Invariant: Σ debits = Σ credits per entry; CA excludes the tax; the CCLIENT/bank debit = net = the
   virement (gross − commission − tax-to-commune).

### Fiche cascade (`PricingSummary.js`)
7. Replace the bottom block with a running-subtotal cascade (validated layout):
   - composition (hébergement, options, ressources, taxe de séjour) → **Total payé par le client** (brut);
   - − Taxe reversée à la commune (offered case) − Commission plateforme → **= Versement plateforme**;
   - + Complément (perçu sur place) → **= Total perçu sur le séjour** (= `sejourNetTotal`).
   Each deduction starts from the previous subtotal; lines that don't apply are hidden (direct → just
   « Total du séjour » = « Total perçu »).

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

- [ ] `pricing` — offered tax + brut → finalPrice = accommodation (tax out), net = accom − commission.
- [ ] `accountingModel` — offered tax → 4.80 on 46710000, CA = 200, net debit = virement, entry balances.
- [ ] `accountingModel` guard — reversed/owner/direct unchanged.
- [ ] `PricingSummary` — cascade subtotals + labels for offered/commission/complement and direct cases.

## 8. Out of scope

- Propagating `sejourNetTotal` to the finance dashboards (still the deferred PR 2).
- Non-offered tax accounting (unchanged).

## 9. Open questions

Resolved 2026-06-26: unified model (engine separates offered tax + compta pass-through). Commission
button subtraction already shipped on this branch.
