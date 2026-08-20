# The payment link must ask for the amount the devis shows

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/payment-link-quote-parity` _(Claude-managed)_ |
| **Created** | 2026-08-20 |
| **Approved** | 2026-08-20 |
| **Author** | Adrien |
| **Amends** | [devis-pdf-total-parity.md](devis-pdf-total-parity.md) §3.1 rule 1 (the replay has one more consumer), [online-payments-qonto.md](online-payments-qonto.md) §9 (« all amounts from the engine » — spelled out), [tourist-tax-on-solde.md](tourist-tax-on-solde.md) rule 1 (a devis now obeys it too) |
| **Related PR** | _(opened at the end of implementation)_ |

---

## 1. Context

Two independent defects, both found on 2026-08-20 while checking what a Qonto payment page really
charges. Both make the guest read one amount and pay another.

### 1.1 The link re-quoted the stay from a hand-rolled input

[`paymentsController.runDevisEngineQuote`](../server/src/controllers/paymentsController.js) built its
own pricing-engine input to resolve the amount of a deposit / balance / full link. That input was a
subset of what the authoritative replay carries, and every missing field costs money:

| Missing input | What the payment page did |
|---|---|
| `cardOccurrences` | **The option disappeared entirely.** The engine reads a planning-card option with no moment as « not taken » ([pricing.js](../server/src/utils/pricing.js) card branch) — a breakfast or « Le repas des trappeurs » on the devis was simply not charged. |
| resource `sessions` | An hourly resource (bain nordique) was re-priced from its quantity alone instead of its booked hours ([hourly-resource-quantity-and-sas-scheduling.md](hourly-resource-quantity-and-sas-scheduling.md) §1 defect 3). |
| `offeredOptionIds` | An option the operator offered came back at full price. |
| the price-lock snapshot | A devis quoted before a tariff change was re-priced at today's tariff ([devis-extras-parity-and-price-lock.md](devis-extras-parity-and-price-lock.md) §3 rule 13). |
| per-line `inComplement`, `touristTaxInComplement`, `extraGuestSurchargeOffered`, `planningCardAsQuantity` | Routing and waivers lost; a public (site) devis re-priced its card options on the wrong basis. |

This is the **exact list** [devis-pdf-total-parity.md](devis-pdf-total-parity.md) §1 drew up for the
PDF on 2026-08-17. That bundle fixed the PDF by routing it through `devisModel.recomputeQuote(id)` and
wrote the rule down (§3.1 rule 1: « **the** way to obtain the pricing-engine quote of a persisted
devis »). The payment path was simply never migrated — it kept its copy of the mapping.

### 1.2 The devis displayed an acompte that nobody else agreed with

[`resolvePaymentSchedule`](../server/src/models/devisModel.js) re-derived the acompte at read time as
`depositPercent × (finalPrice + touristTaxTotal)` — the **tax-inclusive** total. But
[tourist-tax-on-solde.md](tourist-tax-on-solde.md) rule 1 (2026-06-23) says the opposite, and the
engine has applied it since: **the acompte is computed on the accommodation alone, the whole tourist
tax rides on the solde**. `create` / `update` already store what the engine decided; only the display
recomputed its own figure on top.

Measured on a 3-night stay at 100 €/nuit + 80 € de ménage + 50 € de repas, taxe 6 € :

| | Acompte |
|---|---|
| Stored row (`quote.depositAmount`), guest email (`{{depositAmount}}`), Qonto page | **129,00 €** |
| Devis screen + devis PDF (`enrichDevis`) | **130,80 €** |
| The same stay once converted into a **réservation** | **129,00 €** |

So a devis promised an acompte 1,80 € above what its own email announced and what the payment page
charged — a gap that grows with the tourist tax — and the accounting export
([tourist-tax-on-solde.md](tourist-tax-on-solde.md) rule 5) books 0 € of tax on the deposit entry
whatever the devis claimed.

## 2. Goal

A Qonto payment page asks for exactly what the devis shows, and the devis shows exactly what the
engine decided: one quote, one acompte/solde split, one number in the email, on the screen, on the PDF
and on the payment page.

## 3. Functional rules

### 3.1 One replay, for the payment amounts too

1. `runDevisEngineQuote(id)` **is** `devisModel.recomputeQuote(id)`. The inline engine input in
   `paymentsController` is deleted, along with its `calculateReservationQuote` import.
2. Both money resolvers read that quote: `resolveAmountCents` (deposit / balance / full) and
   `resolveVatComponents` (the VAT basket of [payment-links-vat.md](payment-links-vat.md) rule 2).
   Consequence, all obtained for free: a scheduled card option is charged, an hourly resource is
   charged for its booked hours, an offered line stays at 0 €, and a price-locked devis is charged the
   tariff it was quoted under.
3. `recomputeQuote` returns `null` for anything that is not a devis (a **reservation** keeps its stored
   `depositAmount` / `balanceAmount` columns, which are engine-written) and on any engine failure — the
   existing fallback to the stored row is unchanged, and so is `resolveVatComponents` returning `null`
   (the caller then builds its safe single-line basket).
4. The two resolvers take their quote source as an optional last argument, so the money path is
   unit-testable on an in-memory devis instead of the production database.

### 3.2 A devis's acompte obeys the tourist-tax rule

5. `resolvePaymentSchedule` stops re-deriving the acompte/solde **amounts**: it returns the split
   stored on the row — the one `create` / `update` wrote from the engine, i.e.
   `acompte = depositPercent × accommodation` and `solde = the rest + the whole tourist tax`
   ([tourist-tax-on-solde.md](tourist-tax-on-solde.md) rule 1).
6. It keeps owning what is genuinely devis-specific: the **due dates** — acompte due at the quote's
   `validUntil` ([payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) §3.1
   rule 5), solde stay-relative and clamped to the issue date — and the displayed `totalStayPrice`,
   which stays **tax-inclusive** (it is the total of the stay, not an échéance).
7. **A stored `0` is authoritative**: a last-minute devis with no acompte keeps 0 and is never
   re-derived to a percentage.
8. **A legacy row with no stored split at all** (`depositAmount` / `balanceAmount` NULL — never 0)
   falls back to the historic derivation rather than displaying nothing.

**Edge cases:**

- Devis created or re-saved since 2026-06-23 → screen, email, PDF and payment page agree immediately.
- Devis stored **before** that (their columns hold the old tax-inclusive split) → the screen keeps
  showing what was promised; the payment page follows the engine, so the two only realign when the
  operator re-saves the quote. Measured on the production-like database: **1 devis** concerned (a
  draft), gap 13,10 €. Deliberately not migrated — rewriting the amounts of a quote already sent is a
  decision for its operator, one re-save away.
- A reservation (not a devis) → nothing changes: no replay, stored columns, as today.
- Tourist tax collected on arrival / routed to the complement → untouched: the tax is already out of
  the acompte/solde split, on both paths.

**Explicitly not decided here:** the admin `full` link charges `finalPrice` (tax-EXCLUSIVE) while the
public `full` link charges the tax-inclusive total. That inconsistency is pre-existing and was already
parked as « separate decision needed » in [payment-links-vat.md](payment-links-vat.md) §8; this spec
does not move it, it only makes both sides read the same quote.

---

## 4. Architecture

> **Fat backend.** Nothing moves to the client: this is one server-side call site replacing a
> duplicated engine input, plus one read-time recomputation deleted in the model.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `controllers/paymentsController.js` | T | `runDevisEngineQuote` delegates to `devisModel.recomputeQuote`; the inline engine input and the `calculateReservationQuote` import are removed; the two resolvers accept an injectable quote source and are exposed via `__test`. |
| `models/` | `models/devisModel.js` | T | `resolvePaymentSchedule` returns the stored (engine) acompte/solde instead of re-deriving them from the tax-inclusive total; still resolves the due dates and `totalStayPrice`; guarded fallback for a legacy row with no stored split. |
| `utils/`, `routes/`, `database.js` | — | — | (none — no schema change, no migration) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | — | — | **None.** The devis screen already renders `depositAmount` / `balanceAmount` as served; it now receives the corrected figures. |

**Component reuse declaration:** not applicable — no component is created, consumed or changed.

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/api/devis/:id` | `depositAmount` / `balanceAmount` are now the engine's split (they were re-derived tax-inclusive). Same field names, same shape. |
| POST | `/api/reservations/:id/payment-links` · `/payment-emails` | Unchanged contract; the `amountCents` of a **devis** link is now resolved from the authoritative replay. |

---

## 5. Data model

**No schema change, no migration, no backfill.** `reservations.depositAmount` / `balanceAmount` were
already written from the engine by `create` / `update`; this change stops shadowing them at read time.

**Data impact:** none on stored rows. Displayed amounts change only for devis whose stored split
already disagreed with the display (see the edge case above).

## 6. UI / UX

No layout change. On a saved devis, « Acompte » and « Solde » now read the engine's split — e.g. on a
3-night stay at 100 €/nuit with 12,75 € of tourist tax: **acompte 90,00 €** (30 % of the 300 € of
accommodation) and **solde 222,75 €** (210,00 + 12,75), instead of an acompte of 93,83 € that matched
neither the email nor the payment page. « Total séjour » keeps showing 312,75 €.

Responsive: unchanged (no markup touched). Sticky action bar: unchanged.

## 7. Test plan

### Server unit tests — `tests/payment-link-quote-parity.unit.test.js` (9 new)

- [x] A devis carrying a **scheduled card option**: deposit / balance / full link amounts equal the
      devis's own figures.
- [x] The **acompte/solde split** on the devis screen equals the engine's — acompte on the
      accommodation, the whole tourist tax on the solde, `totalStayPrice` still tax-inclusive.
- [x] A devis with **no acompte** keeps 0; a **legacy row** with a NULL split falls back to the
      historic derivation.
- [x] An **offered** option is not re-billed by the link.
- [x] **Price lock**: a tariff rise after the quote was issued never reaches the payment page.
- [x] The **VAT basket** is built from the same quote and sums to the charged amount, tourist tax as a
      0 % line on the solde.
- [x] A **reservation** (no replay) keeps the stored column, and its VAT components stay `null`.
- [x] **REGRESSION** — the input the controller used to build, kept as an executable description of the
      bug: the meal vanishes from the quote *and* the offered linen comes back at full price.

### Full suites

- [x] `cd server && npm test` — **3242 tests, 0 failure**.
- [x] `cd client && npx vitest run` — **1017 tests, 0 failure**.
- [x] `npm run test:e2e`.
- [x] `cd client && npm run build`.

### Manual UI verification (2026-08-20, Chrome + dev server)

- [x] New devis (3 nuits × 100 €, taxe 12,75 €): the creation preview shows acompte 90,00 € / solde
      222,75 €; **after saving, the devis screen shows the same 90,00 € / 222,75 €** (it showed
      93,83 € before the fix) and `GET /api/devis/:id` returns the same figures.
- [x] The existing legacy draft is untouched (its stored split is displayed as before).
- [x] Test devis deleted afterwards.

## 8. Out of scope

- The admin-vs-public `full` link inconsistency (see §3.2, parked in
  [payment-links-vat.md](payment-links-vat.md) §8).
- Migrating the acompte/solde of devis stored before 2026-06-23 (one re-save realigns them).
- The reservation side: its amounts already come from the engine.

## 9. Open questions

Settled on 2026-08-20 (questionnaire):

- **The link or the devis?** → **the devis was wrong**: the payment link already followed
  `tourist-tax-on-solde.md`, so the fix aligns the devis display on the engine rather than putting a
  tax share back into the acompte.
