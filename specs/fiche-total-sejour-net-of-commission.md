# Fiche résa — « total du séjour » = net perçu + compléments + résumé plateforme

| Field | Value |
|---|---|
| **Status** | Implemented (PR 1 — fiche + engine) |
| **Branch** | `feature/fiche-total-sejour-net-of-commission` _(user-managed)_ |
| **Created** | 2026-06-26 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

In the reservation fiche, the right-panel [PricingSummary.js](../client/src/components/PricingSummary.js)
shows « Total du séjour TTC » = the **gross** stay (`totalStayPrice = finalPrice + touristTaxTotal`).
For a platform reservation with a commission it then deducts the commission(s) and shows
« Net perçu TTC ». Adrien wants the **total du séjour** to represent what the operator actually
realises = **net perçu + compléments**, computed by the engine and reused everywhere the stay total
is displayed, plus a few layout/labelling changes on the fiche.

Resolved decisions (AskUserQuestion 2026-06-26):
- **Accounting is UNCHANGED.** Compta keeps booking CA brut + the platform commission as a separate
  expense line, and caisse-interne complements are still never emitted. (The current model already
  satisfies « compta = total séjour, sauf compléments caisse-interne → net perçu ; la caisse interne
  n'apparaît jamais ».) **No change to `accountingModel.js`.**
- **HT / TVA unchanged.** The complement's extras (options/resources) are already inside the displayed
  Total HT / TVA; the on-arrival tourist tax stays out of HT/TVA (no VAT). → no figure change, only a
  guard test that the extras are accounted for.

## 2. Goal

The fiche (and every display of the stay total) shows « Total du séjour TTC » = **net perçu +
compléments** (net of the platform commission), with the complement line moved up next to the tax, a
new « Montant soumis à commission » line (= the brut), and « Net perçu TTC » renamed « Versement
Plateforme ». Accounting and HT/TVA figures are untouched.

## 3. Functional rules

### Engine (`pricing.js`)
1. Expose a new quote field **`sejourNetTotal`** (TTC) =
   `netReceived + nonCashComplementAmount` where:
   - `netReceived` = `platformNetReceivedAmount` when a commission applies (commission > 0), else
     `preArrivalAmount` (no commission → net = pre-arrival).
   - `nonCashComplementAmount` = `complementAmount` minus the part settled **caisse interne**
     (`complementPaidCash` / `endOfStayComplementPaidCash`) — caisse-interne never inflates the total.
2. **Other cases (must hold):**
   - Direct / platform without commission → `sejourNetTotal = preArrivalAmount + complementAmount`
     `= totalStayPrice` (today's value, unchanged).
   - Platform with commission → `sejourNetTotal = totalStayPrice − totalPlatformCommission`
     (ignoring the rare auto-gap), i.e. net of commission.
   - Complement settled caisse interne → excluded from `sejourNetTotal` (= net perçu only when the
     whole complement is off-books).
3. `totalStayPrice` (gross) is **kept** and still returned — the brut « Montant soumis à commission »
   and the commission deduction lines need it. Only the *displayed/aggregated* « total du séjour »
   switches to `sejourNetTotal`.

### Fiche display (`PricingSummary.js`)
4. **Move** the « Complément à percevoir » line so it renders **right after « Taxe de séjour »**
   (before the HT/TVA block), instead of at the bottom.
5. **« Total du séjour TTC »** shows `sejourNetTotal` (net of commission).
6. Add a line **« Montant soumis à commission »** = the brut (`platformGrossAmount`) **right after**
   « Total du séjour TTC », shown only when a brut exists (platform reservation with a brut entered).
7. Rename **« Net perçu TTC » → « Versement Plateforme »** (value unchanged = `platformNetReceivedAmount`).
8. HT / TVA lines unchanged (the complement extras are already included; guard with a test).

### Finance displays (everywhere the stay total is shown) — **implemented 2026-06-26**
9. The Suivi financier « total de séjour » figures now show the **« total perçu »** (net of the platform
   commission), with caisse-interne complements excluded — done at the **finance layer** in
   `financeModel.js`: `totalSejour(r)` subtracts `platformCommission(r)` (acompte + solde commission;
   0 on direct), and `comptaCollected(r)` (« Encaissé ») subtracts the commission of each **paid**
   échéance. This propagates to every consumer: the summary cards (revenu total / encaissé / en attente,
   year cards), `revenueByProperty`, the projection, the breakdown dialogs, and the « Suivi
   opérationnel » tables (`getOperational` → pending / upcoming / period). **Accounting export
   unchanged** (CA stays gross with the commission as a separate expense). `remainingToPay` (reste à
   payer) stays the **gross** still-owed amount (it's what's unpaid, not what we net).
10. The caisse-interne carve-out lives at this finance layer (the engine `sejourNetTotal` doesn't have
    the cash flags). No double-count: `totalSejour` sums the stored deposit/balance (gross of
    commission) + non-cash complements, then subtracts the commission once.

## 4. Architecture

> **Fat backend.** The engine computes `sejourNetTotal`; the finance model reuses the same rule for
> its aggregates; the client only renders. No business math added to React.

### 4.1 Server side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `utils/pricing.js` | T | Compute + return `sejourNetTotal` per the §3 engine rules. Keep `totalStayPrice`, `platformNetReceivedAmount`, `complementAmount` as-is. |
| `models/` | `models/financeModel.js` | T | Replace the displayed stay-total basis (`totalSejour(r)` and the operational/summary aggregates) with the net-of-commission rule, **mirroring the engine** (net perçu + non-cash complement). Add a shared helper so the engine and the model can't drift. |
| `models/` | `models/accountingModel.js` | — | **Untouched** (decision: compta unchanged). A guard test pins that the accounting totals/commission lines do NOT move. |

### 4.2 Client side

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `components/PricingSummary.js` | T | Move the complement line; switch the total to `sejourNetTotal`; add « Montant soumis à commission »; rename to « Versement Plateforme ». |
| `pages/` / others | finance displays | T/— | Read the new total field where the stay total is shown (most read it straight from the payload — likely no change beyond the model). |

**Component reuse:** no new component.

### 4.3 API contract

`calculateReservationQuote` / `/finance/*` payloads gain `sejourNetTotal` (number). Existing fields
keep their meaning. No breaking removal.

## 5. Data model

No schema change.

## 6. UI / UX

Fiche summary bottom (platform + commission case), top→bottom:
`Taxe de séjour` → **`Complément à percevoir`** → `Total HT` → `TVA` → **`Total du séjour TTC`**
(= net perçu + compléments) → **`Montant soumis à commission`** (= brut) → `Commission acompte −` →
`Commission solde −` → **`Versement Plateforme`** (= net perçu) → `Acompte` → `Solde` → `Caution`.
Direct / no-commission: no « Montant soumis à commission », no commission lines, no « Versement
Plateforme »; « Total du séjour TTC » = today's value. Responsive: unchanged (same Stack).

## 7. Test plan

> **Pricing engine is sensitive — per Adrien: if any existing test breaks or a behaviour changes,
> STOP and decide together before adjusting it.**

### Server unit tests
- [ ] `pricing` — `sejourNetTotal` for: direct (= totalStayPrice), platform+commission
  (= totalStayPrice − commission), platform no commission, caisse-interne complement (excluded),
  owner-collect tax complement.
- [ ] `financeModel` — operational/summary stay totals equal the engine `sejourNetTotal` rule.
- [ ] `accountingModel` guard — CA brut + commission line + caisse-interne exclusion **unchanged**.

### Client unit tests (vitest)
- [ ] `PricingSummary` — complement line is after the tax; « Total du séjour TTC » = `sejourNetTotal`;
  « Montant soumis à commission » = brut; « Versement Plateforme » label; HT/TVA include the extras.

### Manual UI verification
- [ ] Platform-with-commission fiche shows the new order/labels and the net total.
- [ ] Direct reservation unchanged.

## 8. Out of scope

- Accounting model changes (explicitly unchanged).
- HT/TVA recomputation (extras already included; tax stays out of VAT).

## 9. Open questions

Resolved (2026-06-26): compta unchanged; HT/TVA = extras only (already included). Remaining to confirm
at plan validation: the exact list of finance consumers to switch to `sejourNetTotal` (§3.9) — to be
enumerated precisely before coding.
