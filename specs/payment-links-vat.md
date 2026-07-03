# VAT on Qonto payment links (items basket)

| Field | Value |
|---|---|
| **Status** | Implemented _(2026-07-03)_ — builder + qontoClient basket + money guard + all 3 link-creation flows wired; unit-tested (1973 green) + live-sandbox-validated (exact to the cent). Hosted-page card E2E deferred to the next prod sandbox run. |
| **Branch** | `feature/payment-links-vat` |
| **Created** | 2026-07-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Related** | [online-payments-qonto.md](online-payments-qonto.md) (link creation), [public-online-payment.md](public-online-payment.md) (UC2 amounts), [single-vat-rate.md](single-vat-rate.md) (the one global `vatRate`), [public-online-deposit.md](public-online-deposit.md) (deposit/balance links get the same treatment) |

---

## 1. Context

Every Qonto payment link is created with a single basket item at **`vat_rate: "0"`**
([qontoClient.js:119-133](../server/src/utils/qontoClient.js#L119)). The hosted payment page therefore
displays « TVA (%) 0 % — Montant de la TVA 0,00 EUR — Total HT = Total TTC » (seen on the 2026-07-02
prod E2E screenshots), which is wrong: GuestFlow has a configured global VAT rate
(`app_settings.vatRate`, default 10 %, Paramètres → « Taux de TVA »), the pricing engine already
decomposes every TTC total into HT + VAT (`accommodationVatAmount`, `optionsVatAmount`,
`resourcesVatAmount`, `totalVatAmount` — [pricing.js:1561-1578](../server/src/utils/pricing.js#L1561)),
and the devis PDF prints the same decomposition. The **tourist tax is VAT-exempt** (outside every VAT
bucket, engine + PDF).

All prices in GuestFlow are **TTC**; VAT is always *extracted* (`HT = TTC / (1 + rate/100)`), never
added on top. The Qonto `POST /v2/payment_links` payload supports an **`items[]` array where each item
carries its own `title`, `quantity`, `unit_price {value, currency}` and `vat_rate` (string)** — the
current code simply always builds one item with rate "0". Three flows share the single
`createPaymentLink` call site (admin deposit-request email, admin link-without-email, public UC2), so
one change covers everything.

## 2. Goal

The Qonto/Mollie payment page displays the real VAT of the stay (10 % on accommodation/options/
resources, tourist tax exempt) — while the **charged total remains exactly** the GuestFlow amount, to
the cent. If Qonto's API cannot represent that exactly, fall back to the current single 0 %-VAT line
(total-only display) — decision Adrien 2026-07-03.

## 3. Functional rules

1. **The charged total is inviolable.** Whatever the items breakdown, the amount the guest pays MUST
   equal `amountCents` exactly. Any representation that shifts the total by even one cent is rejected
   in favor of the fallback (rule 6).
2. **Items per link type** (amounts TTC, VAT extracted at the global `vatRate` read from
   `settingsModel` at link-creation time):
   - `full` (public UC2): item « Séjour et prestations » = `finalPrice` at `vatRate` + item
     « Taxe de séjour » = `touristTaxTotal` at `"0"` (only when the tax is part of the charge;
     omitted when `collectedOnArrival` or zero).
   - `deposit`: single item « Acompte séjour » at `vatRate` (deposit base is accommodation-only —
     VAT-liable, no tax component per [tourist-tax-on-solde.md](tourist-tax-on-solde.md)).
   - `balance`: item « Solde séjour » = balance minus tourist tax at `vatRate` + item
     « Taxe de séjour » at `"0"` (the tax rides on the solde).
   - `complement`: single item at `vatRate` (existing complement flows).
3. **Qonto semantics (VERIFIED in sandbox 2026-07-03 — see §9):** `unit_price.value` is **HT**; Qonto
   computes each item's total as **`round_half_up(unit_price × (1 + vat_rate/100), 2)`** and the link
   `amount` is the **sum of the per-item totals**. So the builder sends HT per taxable item and
   guarantees the exact charged total this way:
   - For each **taxable** component (TTC amount, rate `r`): `HT = floor(TTC / (1 + r/100), 2)` (floor,
     not nearest → the per-item total after Qonto's rounding is always ≤ TTC, so the residual is
     always **non-negative**, ≤ ~0.01 per item).
   - `predictedTotal = Σ round_half_up(HT_i × (1 + r_i/100), 2) + Σ (0%-line values)`.
   - `residual = targetTotalCents − predictedTotal` (≥ 0). Fold it into a **0 %-VAT line**: add it to
     the tourist-tax item when present, else append a « Ajustement » 0 %-VAT item (only when
     residual > 0). Result: `amount == targetTotal` **to the cent**, all line values non-negative.
4. **`vat_rate` is a STRING** (Qonto rejects numbers — existing guard comment in `qontoClient`);
   values are the global rate rendered as e.g. `"10"` / `"10.0"` (format confirmed in sandbox) and
   `"0"` for exempt items.
5. **Post-create verification (money guard):** the create response DOES expose `amount.value`
   (confirmed §9). After `createPaymentLink`, assert `amount.value` (in cents) == `amountCents`; on
   mismatch, **throw** (the pay flow fails safe — the guest never receives a wrong-amount link) and
   log the built items + the Qonto amount for diagnosis. Because the builder computes the residual
   with Qonto's exact rule, a mismatch means Qonto changed behavior — surface it loudly rather than
   silently overcharge. (There is no link-cancel API; failing the request is the safe action.)
6. **Fallback (user decision):** when the exact representation is impossible (API rejection, rounding
   not compensable, semantics unclear), keep the single-item `vat_rate:"0"` payload — total-only,
   no VAT detail — rather than risk a wrong charge or a wrong VAT display.
7. Applies to **all** link-creation flows (UC1 deposit email, admin payment-links, public UC2
   full/deposit/balance) — the items builder is shared, callers only pass the amounts they already
   resolve.

**Edge cases:**
- `vatRate = 0` in settings → all items at `"0"` (equivalent to today, still split stay/tax lines).
- `touristTaxTotal = 0` or collected on arrival → no tax item.
- Rounding: HT extraction per item rounded to 2 decimals; the adjustment item (rule 3) absorbs ±0,01-0,02 €.
- Legacy open links (created before this change) keep their 0 % display — no retro-edit (Qonto links are immutable).

---

## 4. Architecture

> **Fat backend, thin frontend.** No client change at all — the items are built server-side; the
> hosted page is Qonto's.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `qontoClient.js` | T | `createPaymentLink` accepts an `items[]` param (title/amountCents/vatRate each); keeps the single-item signature as sugar; stringifies `vat_rate`. |
| `utils/` | `paymentLinkItems.js` | C | Pure builder: `(type, { amountCents, taxCents, vatRate })` → items array per rule 2 + HT/adjustment math per rule 3. Unit-tested exhaustively (rounding table). |
| `utils/` | `paymentRequestService.js` | T | `ensurePaymentLink` resolves the tax component alongside the amount (new optional `resolveTaxCents` dep) and passes the built items to `createLink`. |
| `controllers/` | `paymentsController.js` | T | Wire vatRate (settingsModel) + tax component into the createLink dep (admin flows). |
| `controllers/public/` | `publicPaymentController.js` | T | Ditto for the public flow (full: finalPrice vs touristTaxTotal split — data already at hand in `fullPaymentCents`'s row). |
| `models/` | `settingsModel.js` | — | (none — `vatRate` already exposed) |

### 4.2 Client side (`client/src/`)

None. (Plugin: none either — the payment page is Qonto-hosted.)

**Component reuse declaration (mandatory):** no client change — n/a.

### 4.3 API contract

No GuestFlow API change. Qonto payload change only:

```json
{ "payment_link": { "reusable": false, "potential_payment_methods": ["credit_card","apple_pay"],
  "items": [
    { "title": "Séjour et prestations", "quantity": 1, "unit_price": { "value": "…", "currency": "EUR" }, "vat_rate": "10" },
    { "title": "Taxe de séjour",        "quantity": 1, "unit_price": { "value": "…", "currency": "EUR" }, "vat_rate": "0" }
  ], "redirect_url": "…" } }
```

---

## 5. Data model

None. (`payment_links.amountCents` stays the single source of the charged total.)

**Data impact:** none.

## 6. UI / UX

- **Qonto hosted page** (not ours): shows one line per item with its VAT %, correct « Montant de la
  TVA » and « Total TTC » = charged amount. Example (E2E stay of 2026-07-02): « Séjour et prestations
  10 % — 256,25 € ; Taxe de séjour 0 % — 9,80 € ; TVA 23,30 € ; Total TTC 266,05 € ».
- No GuestFlow screen affected. No PageActionBar impact.

## 7. Test plan

### Server unit tests
- [x] `payment-link-items.unit.test.js` — items per type (rule 2), integer half-up rounding matching the live probe, floor-HT + residual folding, deposit-only Ajustement, vatRate 0, tax 0/on-arrival, **two exhaustive 1-cent sweeps** proving `Σ Qonto line totals == charged amount` for every total 1–2000 € (9 tests).
- [x] `qonto-client.unit.test.js` — multi-item VAT basket payload pinned (HT unit prices, string `vat_rate`) + money guard throws on amount mismatch / passes on match (+3 tests).
- [x] Full suite green (1973 tests). Existing `payment-request-service` / `public-payment-controller` tests still pass (items are opt-in; no-items → legacy single line).

### Manual UI verification (sandbox — done 2026-07-03)
- [x] Q1 semantics: `100.00 @ "10"` → link `amount 110.00` ⇒ **HT, Qonto adds VAT**; half-up per line confirmed.
- [x] Live builder validation against Qonto sandbox: the real E2E basket (256.25 @10 + 9.80 @0) → `amount 266.05` **exact**, VAT shown 23,30 €; the residual case (256.24 stay) → `266.04` exact (tax line carries +1 cent); deposit-only → exact. All three: `Qonto amount == expected` to the cent.
- [ ] Full card-payment E2E on the hosted page (deferred to the next prod sandbox E2E run; the amount/VAT are API-verified above — the hosted page bounced to the dev-portal sign-in, a sandbox-only artifact).

## 8. Out of scope

- Multi-rate VAT (the app is single-rate by design — [single-vat-rate.md](single-vat-rate.md)).
- Retro-editing existing open links.
- VAT on the WordPress-side display (site shows TTC totals only, unchanged).
- Fixing the pre-existing admin-`full` inconsistency (admin `full` links charge `finalPrice` WITHOUT
  tourist tax while public `full` includes it — noted during exploration; separate decision needed).

## 9. Open questions

- Q1 (**RESOLVED 2026-07-03, live sandbox probe**): `unit_price.value` is **HT** — Qonto adds VAT on
  top. Probe: one item `unit_price 100.00 @ vat_rate "10"` → link `amount.value = "110.00"`. Rounding
  is **half-up** per item: `232.95 @10 → 256.25` (256.245 rounds up), `100.05 @10 → 110.06`
  (110.055 rounds up), `232.96 @10 → 256.26`. Basket = **sum of per-item rounded totals**:
  `232.95@10 (→256.25) + 9.80@0 = 266.05` exact. Drives rule 3's floor-HT + residual algorithm.
- Q2 (**RESOLVED 2026-07-03**): `vat_rate` accepted as a decimal **string**; Qonto echoes it as
  `"10.00"`. We send `String(rate)` (e.g. `"10"`); `"0"` for exempt lines. Numbers are rejected
  (existing guard comment stands).
