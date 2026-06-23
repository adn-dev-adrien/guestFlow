# Tourist tax on the solde (not the acompte)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/tourist-tax-on-solde` _(user-managed)_ |
| **Created** | 2026-06-23 |
| **Author** | Adrien |

---

## 1. Context

Today the engine puts the tourist tax into `preArrivalAmount` (`finalPrice − forcedItems + taxInPreArrival`)
and the acompte is `depositPercent × preArrivalAmount` — so **the acompte already carries a share of the
tourist tax**. The payment-flip contribs (`utils/forceItemContribsCapture.js`) snapshot that share
(`touristTaxAcompteContribTtc = taxFull × depositPercent`), which then tells the accounting export which
journal entry (deposit vs balance) credits the tax pass-through account 46710000.

The « Suivi financier › Taxe de séjour » page (`financeModel.getTouristTaxExtraction`) lists a stay's tax
by the **last-night date** (`DATE(endDate,'-1 day')`), independent of payment.

The operator collects the tourist tax with the **solde**, so they want (a) the tax 100 % on the solde (the
acompte = accommodation only), and (b) the tax to show in the declaration on the **month the solde is
paid**.

## 2. Goal

1. When a reservation has an **acompte**, the tourist tax is entirely in the **solde**; the acompte is
   computed on the accommodation only (no tax). No acompte → unchanged (the single solde already holds it).
2. In « Taxe de séjour », a stay's tax appears in the **month its solde was paid** (`balancePaidDate`) —
   and not before the solde is paid. (For tax collected on arrival → complement-paid month.)

Applies to direct **and** platform reservations with an acompte.

## 3. Functional rules

1. **Acompte base = accommodation, tax = 0.** `accommodationPreArrival = max(0, finalPrice − forcedItems)`
   (no tax). The acompte (auto % or manual override, clamped to `accommodationPreArrival`) is computed on
   that. The **solde = (accommodationPreArrival − acompte) + taxInPreArrival** (the whole pre-arrival tax).
2. **No acompte (deposit = 0 / depositDisabled / no-acompte platform):** solde = `accommodationPreArrival +
   taxInPreArrival` = the current `preArrivalAmount` — **unchanged**.
3. **Tax routed to complement** (collected on arrival / `touristTaxInComplement`): unchanged — the tax is
   already out of the acompte/solde (it's in the complement).
4. **Frozen once paid:** a reservation whose acompte/solde are already paid keeps its stored split (the
   model only re-derives unpaid échéances), so this never rewrites already-collected money.
5. **Contribs / accounting:** on the deposit flip the tourist-tax contrib is **0**; the full pre-arrival
   tax rides on the balance entry (46710000 credited on the solde, never the acompte). The accounting
   stays balanced (Σ debits = Σ credits) by construction.
6. **Taxe-de-séjour page:** a stay's tax is attributed to the month of `balancePaidDate` (the solde paid
   date). Stays whose solde isn't paid in/at the queried month don't appear. Tax-collected-on-arrival
   stays use `complementPaidDate`. (Replaces the last-night-date attribution.)

**Edge cases:**
- Manual acompte override > `accommodationPreArrival` → clamped to `accommodationPreArrival` (acompte can't
  exceed the accommodation; the tax always stays on the solde).
- depositPercent 100 % → acompte = full accommodation, solde = just the tax.
- A stay with no tourist tax → no change anywhere.

---

## 4. Architecture

### 4.1 Server
| Layer | File | Responsibility |
|---|---|---|
| `utils/pricing.js` | T | `accommodationPreArrival` base for the deposit; solde = remainder + `taxInPreArrival`; expose `accommodationPreArrival` in the quote for the contribs. |
| `utils/forceItemContribsCapture.js` | T | Deposit flip: tax contrib = 0, deposit fraction computed on `accommodationPreArrival` (so options/resources/accommodation split correctly, tax 0). Balance flip already takes `taxFull − taxAcompte` = full. |
| `models/financeModel.js` | T | `getTouristTaxExtraction`: filter/attribute by `balancePaidDate` (solde) — or `complementPaidDate` for on-arrival — instead of last-night date; only paid soldes appear. |
| `tests/` | C | Engine (tax on solde, override clamp, no-acompte unchanged); contribs (tax acompte = 0, balance = full, conservation); finance (tax appears in the solde-paid month only). |

### 4.2 Client
| Layer | File | Responsibility |
|---|---|---|
| `pages/FinancePage.js` (or the Taxe-de-séjour view) | T (if needed) | Likely no change — the server reshapes the month set. Verify the column labels still make sense (the page is « stays whose tax we collected this month »). |

No schema change (uses existing `balancePaidDate` / `complementPaidDate` / contrib columns).

## 5. Data model

None. Behaviour-only. **Data impact:** unpaid-solde stays drop out of the Taxe-de-séjour page until the
solde is paid (deliberate, per the operator's « déclarer quand encaissé » choice). Existing paid
reservations keep their stored split; re-saving an unpaid one moves its tax to the solde.

## 6. Test plan
- [x] Engine: acompte = `depositPercent × accommodation`; solde = remainder + full tax; no-acompte → unchanged; override clamp (`pricing-tourist-tax-on-arrival-schedule.unit.test.js`).
- [x] Contribs: deposit flip → `touristTaxAcompteContribTtc = 0`; balance flip → full tax; conservation invariant holds (`payment-contrib-capture.unit.test.js`).
- [x] Accounting: the 46710000 tax line lands on the balance entry, not the deposit; Σ debits = Σ credits (`tourist-tax-collection-coverage.unit.test.js`).
- [x] Finance: a stay whose solde is paid in month M shows its tax in M (not the last-night month); unpaid → absent (`tourist-tax-collection-coverage.unit.test.js`).
- [x] Full server suite stays green — **1785 / 1785 pass**.

## 7. Out of scope
- Changing how the tax amount itself is computed (rates, per-night, platform collection) — only its
  acompte/solde placement + the declaration month.
- Splitting the tax across acompte + solde proportionally (the operator wants it 100 % on the solde).

## 8. Open questions
- **Resolved (2026-06-23):** For tax collected on arrival, the Taxe-de-séjour month = `complementPaidDate`
  (the month the complement is encashed). Implemented in `TAX_ON_ARRIVAL_SQL` branch of
  `getTouristTaxExtraction`.
