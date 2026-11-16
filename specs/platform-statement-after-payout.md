# Platform statement correctable after the payout

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/platform-statement-after-payout` |
| **Created** | 2026-11-16 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The Suivi financier's « À vérifier » card lists every finished platform stay whose « Montant total payé par le
client » (`platformGrossAmount`) is empty ([finance-data-checks.md](finance-data-checks.md) rule 8). The operator
cannot act on most of these lines without breaking something else:

- The statement fields (brut, taxe retenue, commissions) only open from the amount of a platform row
  ([reservation-payment-ledger.md](reservation-payment-ledger.md) rule 25), and **only while the payout is not
  received**: « Once the payout is received they are locked like a paid row ».
- A finished stay is locked. On a locked fiche every amount opens the lock reason instead
  (« Séjour commencé : déverrouiller la fiche pour modifier les montants. »).
- Unlocking does not help: an unlocked started fiche keeps its final price (D21, `savePriceGuards.unlockedPriceRefusal`),
  and entering the brut pins the total séjour (platform-payment-entry rule 1), so the save is refused with
  « Fiche déverrouillée : le prix final doit rester à … ».

Real case in production (2026-11-16): reservation **202605014** (id 22211, Abracadaroom, 10→11/10/2026). The
operator typed the platform's **net** (171,14 €) into « Prix ajusté » in June, before the « Paiement plateforme »
fields existed in this form, and marked the solde received on 05/06. The brut was 215,00 € with a 20,4 % commission
(43,86 €) — the same rate as the three other Abracadaroom stays (143804: 315 € → 64,26 €; 148153: 244 € → 49,78 €;
1439598: 720,82 € → 147,05 €). The money is right; the books carry 171,14 € of turnover and no commission, and
the stay stays on « À vérifier » forever. The only way out today is to undo the received payout, unlock, and
then hit the D21 refusal.

## 2. Goal

The platform's statement — brut, taxe retenue, commissions — stays **correctable on a platform row whatever its
state**: received or not, fiche locked or not. Correcting it after the payout is normally a
**reclassification** — the money received does not move, only how it splits between turnover and commission — and
when the typed figures do not give the transfer, the operator is warned, not blocked.

## 3. Functional rules

1. **The statement opens on every platform payout row.** On a platform reservation (a named channel), clicking the
   amount of the solde / « Versement » row opens the « Relevé plateforme » panel, including when the payout is
   received and when the fiche is locked; the padlock is no longer shown on that row. The panel already carries the
   acompte commission of a platform that takes one, so the acompte row keeps its own amount editor unchanged, as do
   direct-channel rows and the complement rows.
2. **Same fields as today.** The panel holds the fields of `PlatformStatementEditor` with their labels, helpers
   and « Calculer la commission » button unchanged (platform-payment-entry, platform-per-echeance-commission,
   platform-tourist-tax-out-of-the-commission).
3. **A received row shows what came in.** When the row is received, the ledger gives the panel
   `amountEdit.received = { date, net, label }` and the panel prints the label read-only: « Virement reçu le 05/06 :
   171,14 € ». Under the fields it prints the server's reading of the typed statement (a preview, nothing written,
   §4.3): « Net : 171,14 € — identique au virement ✓ » in the success tone, or the gap of rule 4. « Calculer la
   commission » computes from the typed « Virement reçu », else from this received net. A statement the preview
   refuses (rule 7, invalid money) shows the refusal in the error tone and disables « Valider ».
4. **Received ⇒ a gap is accepted, with a warning** (Q1, 2026-11-16). On a received row, a statement whose net
   differs from the net received by more than half a cent is **accepted**. Before « Valider » the panel shows the
   gap in the warning tone: « Net : 168,20 € — le virement reçu est de 171,14 € (écart 2,94 €). Le relevé sera
   enregistré avec cet écart. » and « Valider » stays enabled. After the write the row carries the existing
   reconciliation chip « écart : 2,94 € » ([reservation-payment-ledger.md](reservation-payment-ledger.md) rule 26),
   which stays until the statement or the transfer is corrected. The net received is `platformPayoutAmount` when
   stored, otherwise the stored net (pre-arrival amount of the row minus its stored commission). The server never
   refuses on this gap; the response carries `netGap` (signed, euros) and the worded `netLabel`, and the toast after
   « Valider » reads « Relevé enregistré avec un écart sur le virement. » instead of « Relevé enregistré. ».
5. **Written immediately, outside the fiche save.** « Valider » posts the statement to its own endpoint (§4.3) and
   reloads the fiche; it never goes through « Enregistrer ». So a locked fiche needs no unlock, and the D21 price
   freeze does not apply: the final price moves because the platform's figures are entered, not because the stay
   is re-priced. After the write the fiche reloads the statement fields and the solde from the server, so its live
   quote lands on the stored final price and a later « Enregistrer » is not refused by D21. While the fiche holds
   unsaved edits the panel's fields are disabled with « Fiche modifiée : enregistrer ou annuler les modifications
   avant de corriger le relevé. » — the same guard as a payment mark on a locked fiche.
6. **What the correction may change.** The pre-arrival buckets (`depositAmount` / `balanceAmount` of the platform
   rows), the commissions (`platformCommissionAmount`, `acompteCommissionAmount`), `platformGrossAmount`,
   `platformTouristTaxAmount`, `finalPrice`, and the stored split contributions that follow them.
7. **What it never changes.** Payment marks, dates and methods; the complement and end-of-stay complement (amounts
   and marks); the tourist tax (`touristTaxTotal`, frozen fields, declaration); options, resources, dates and
   occupancy. If the re-quote with the new statement would move any of these, the server refuses (409
   `STATEMENT_WOULD_REPRICE`) with « Ce relevé modifierait aussi <ce qui bouge> : déverrouiller la fiche pour
   corriger le séjour. »
8. **The transfer is recorded.** On a received row whose `platformPayoutAmount` is empty, the correction stores the
   net received there (the transfer as it was before the correction), so the reconciliation chip compares the new
   statement with the real transfer: « ✓ cohérent avec le virement » or « écart : … » (rule 4).
9. **The books follow, on the same date.** The encaissement keeps its date (05/06 in the real case); its entry is
   re-split: turnover on the brut (accommodation / options as today), the commission booked, and the net = brut −
   commission, as the books already read a platform stay. With no gap (rule 4) that net is the transfer, unchanged.
   With a gap, the books carry the typed statement and the chip shows the difference with the real transfer. A
   bank line already matched to this payout stays matched. On a stay subject to VAT the collected VAT follows the
   turnover: on 202605014 (VAT 10 %) the June entry goes from 155,58 HT + 15,56 VAT to 195,45 HT + 19,55 VAT, plus
   43,86 € of commission (account 622600) — measured on a copy of the production database on 2026-11-16.
10. **Traced.** The correction writes one `reservation_history` row, `eventType = 'platform_statement'`, listing the
    changed fields with before/after; the history renders it as « Relevé plateforme corrigé ».
11. **Not received ⇒ the existing flow, through the endpoint when locked.** On an unreceived platform row of an
    unlocked fiche the panel keeps today's draft flow (« Valider » into the form, then « Enregistrer »). On a locked
    fiche it posts to the endpoint with rules 6-7, without rule 4 (nothing has come in yet).
12. **Cancelled stays are out.** A cancelled reservation keeps `mode: 'none'` on its rows: nothing to correct.
13. **The « À vérifier » line clears by itself** once `platformGrossAmount` is stored (finance-data-checks rule 8
    unchanged).

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | New / Touched | Responsibility |
|---|---|---|---|
| `routes/` | `reservations.js` | T | `PATCH /:id/platform-statement` and `POST /:id/platform-statement/preview` → controller (not a devis, not a duplicate set aside, not the reception role). |
| `controllers/` | `platformStatementController.js` | N | Thin: body → model (`dryRun` for the preview) → `{ netGap, netLabel, changed }` or the refusal. |
| `models/` | `platformStatementModel.js` | N | Replays the stored stay twice (`quoteStoredReservation`: as stored, with the typed statement), applies rules 4, 6-8 in one transaction, re-captures the solde's frozen split when it had one (`captureBucketSplit`), writes the history row (rule 10). |
| `utils/` | `platformStatementCorrection.js` | N | Pure: statement parsing and validation, net received (rule 4), the figures the statement would move (rule 7), the columns to write (final price moved by the pre-arrival difference only, immune to engine drift), the signed gap and its sentence. |
| `utils/` | `storedReservationQuote.js` | T | Exports `pricedProjection` (line and night comparison of rule 7). |
| `utils/` | `reservationLedger.js` | T | Received platform payout row: `amountEdit.mode = 'statement'` (was `locked`), with `received: { date, net, label }` read from the stored row. |

No change to `savePriceGuards` (D21 stays for the fiche save), nor to the accounting models: they already read
the stored buckets and commission.

### 4.2 Client side (`client/src/`)

| Layer | File | New / Touched | Responsibility |
|---|---|---|---|
| `components/` | `reservation/FinanceSection.jsx` | T | `onAmountClick`: a row in `statement` mode opens the panel even when locked; when the row is received or the fiche locked, the panel previews through the server and « Valider » PATCHes, toasts, then `reloadReservationFinance()`; a modified fiche disables it (rule 5). |
| `components/` | `reservation/PlatformStatementEditor.jsx` | T | Specific (existing). Optional `received`, `preview`, `lockedReason` props: the received line, the server's net sentence (debounced 250 ms), « Valider » disabled on a refusal only. |
| `components/` | `reservation/ReservationHistoryPanel.jsx` | T | `platform_statement` → « Relevé plateforme corrigé ». |
| `pages/` | `ReservationPage.jsx` | T | `reloadReservationFinance` re-reads the statement fields and the solde the PATCH wrote. |
| `services` | `api.js` | T | `previewPlatformStatement(id, body)`, `updatePlatformStatement(id, body)`. |

No new generic component: the panel is the existing platform-specific editor.

### 4.3 API contract

`PATCH /api/reservations/:id/platform-statement`

```json
{ "platformGrossAmount": 215, "platformTouristTaxAmount": null,
  "platformCommissionAmount": 43.86, "acompteCommissionAmount": null }
```

- 200 → `{ netGap, netLabel, changed }`: `netGap` signed euros (0 when the statement gives the transfer, and on an
  unreceived payout), `netLabel` `{ tone: 'done' | 'warning', label }` or `null` when nothing was received,
  `changed` the columns written. The client then re-reads the fiche (`GET /api/reservations/:id`).
- 400 `NOT_A_PLATFORM_STAY` (direct channel, cancelled, not a reservation), 400 `INVALID_STATEMENT` (negative
  money, commissions above the brut, empty body).
- 409 `STATEMENT_WOULD_REPRICE` (rule 7), with `moved: ['la taxe de séjour', …]` (the words of the refusal).
- 403 for the reception role; 404 for an unknown stay.

`POST /api/reservations/:id/platform-statement/preview` — same body, same answers, nothing written.

## 5. Data model

No schema change. Columns written: listed in rule 6, plus `platformPayoutAmount` (rule 8) and one
`reservation_history` row.

## 6. UI / UX

The solde row of a received platform payout today shows a padlock. After the change, clicking the amount opens
the panel under the row (same place as today's unreceived statement):

```
Solde · Reçu le 05/06 · Abracadaroom                       171,14 €  ✎
┌──────────────────────────────────────────────────────────────────┐
│ Virement reçu le 05/06 : 171,14 €                                │
│ Montant total payé par le client  [ 215,00 € ]                   │
│ Commission solde (€)              [  43,86   ] Calculer la comm. │
│ Net : 171,14 € — identique au virement ✓                         │
│ [Valider]  [Annuler]                                             │
└──────────────────────────────────────────────────────────────────┘
```

- **Mobile (xs):** the panel is full width under the row and its fields stack in one column (the editor's container
  query); buttons keep the existing editor's 44 px targets.
- Interactive summary for decision: `docs/specs/2026-11-16-platform-statement-after-payout.html`.

## 7. Test plan

### Server unit tests

`server/src/tests/platform-statement-after-payout.unit.test.js` (8):
- rules 4, 6, 8, 10 — received solde, brut + commission keeping the net: written, final price moved by the brut only,
  transfer stored, marks / tax / complement untouched, history row;
- rule 4 (Q1) — a net different from the transfer is written, `netGap` returned, the ledger row shows « écart »;
- rules 3-4 — the preview words the net (success / warning) and writes nothing;
- rules 1, 3 — a received platform solde is in `statement` mode with `received { date, net, label }`;
- rule 7 — a statement that would move a not-yet-frozen percentage tax → 409 `STATEMENT_WOULD_REPRICE`, nothing written;
- rule 11 — a locked unreceived solde is written without the transfer comparison;
- rule 12 and validation — direct, cancelled, negative, over-commissioned, empty → refused;
- pure — transfer, final price by the pre-arrival difference (the 202605014 replay: 215 → 285), signed gap.

### Client tests

`client/src/components/reservation/__tests__/FinanceSection.platform-statement-after-payout.test.jsx` (8): the
received row opens on a locked fiche with its transfer line; « Calculer la commission » reads the received net; the
gap warning keeps « Valider » enabled; a refusal disables it; « Valider » PATCHes and reloads; an unreceived row on a
locked fiche writes at once; on an unlocked fiche it stays a draft; a modified fiche disables the fields.

### Manual UI verification

Done 2026-11-16 on a copy of the production database (secrets purged, port 3201/4200): fiche 202605014 → « Versement
Abracadaroom » 171,14 € → panel « Virement reçu le 05/06 : 171,14 € » → 215 → « Calculer la commission » (43,86) →
« Net : 171,14 € — identique au virement ✓ » → Valider → « Relevé enregistré. », row 215,00 € with « ✓ cohérent
avec le virement », history « Relevé plateforme corrigé » (5 fields), the stay gone from « À vérifier ». At 390 px:
no horizontal scroll, commission 40 → the warning gap. June books measured on the same copy (rule 9).

## 8. Out of scope

- Correcting the amount actually received (undo the payout, as today).
- A bulk fix of every stay listed by « À vérifier ».
- Re-computing a tourist tax already collected or declared from the corrected price.

## 9. Open questions

_None open._

**Resolved 2026-11-16 (Adrien):**
- **Q1 — Strict net?** No: a statement whose net differs from the transfer is **accepted with a warning** (rule 4),
  the gap stays visible on the row through the reconciliation chip.
- **Q2 — Locked unreceived rows?** **Included** (rule 11): same hole, same endpoint, without the net comparison.
