# Caution live from the property setting

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/caution-live-from-property` _(user-managed)_ |
| **Created** | 2026-06-26 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The security deposit (« caution ») shown to the operator in the arrival/departure **SAS**,
on the reservation fiche, on the dashboard and in the guest reminder emails is **not** the
amount currently configured on the property. It is a **frozen snapshot** copied into
`reservations.cautionAmount` when the reservation is created:

- Manual creation: `cautionAmount: prop.defaultCautionAmount ?? 500`
  ([ReservationPage.js:947](../client/src/pages/ReservationPage.js#L947)).
- iCal import: `property.defaultCautionAmount || 0`
  ([propertyIcalModel.js:468](../server/src/models/propertyIcalModel.js#L468)).

Every read path then displays that stored snapshot:
- SAS — `r.cautionAmount` ([ReservationSasDialog.js:527](../client/src/components/sas/ReservationSasDialog.js#L527)),
  fed by `reservationsModel.getByIdWithDetails`.
- Fiche pricing card — `form.cautionAmount` ([PricingSummary.js:775](../client/src/components/PricingSummary.js#L775)),
  **display-only, no editable input exists**.
- ReservationCard « Caution à percevoir » + Dashboard — `r.cautionAmount` from `reservationsModel.list`.
- Reminder emails — `r.cautionAmount` ([emailContextBuilder.js:268](../server/src/utils/emailContextBuilder.js#L268)).

**Symptom (confirmed by the user):** the operator changed the property's « Caution par défaut »
in Settings **after** reservations already existed. Those reservations keep the old snapshot, so the
SAS asks the guest for the wrong amount.

Key fact: the caution is **never editable per reservation** — there is no input for it anywhere in the
reservation form. It is already, conceptually, a property attribute. Only the frozen copy is wrong.

## 2. Goal

As long as the caution has **not yet been collected**, the amount shown to the operator and the guest is
**always the amount currently configured on the property** (`properties.defaultCautionAmount`). Once the
caution is **marked as received**, the **collected amount is frozen** on the reservation and never moves
again, even if the property's default changes afterwards.

## 3. Functional rules

1. **Effective caution amount** for a reservation:
   - `cautionReceived = 0` → the property's current `defaultCautionAmount` (**live**).
   - `cautionReceived = 1` → the **frozen** `reservations.cautionAmount` (the amount actually collected).
2. To make rule 1 truthful, the live property amount is **frozen into `reservations.cautionAmount` at the
   exact moment `cautionReceived` flips to 1** (so the stored value is the amount in effect when the
   cheque/imprint was taken, not the creation-time snapshot). Both receipt paths do this freeze:
   the arrival SAS commit (`commitArrivalSas`) and the inline « Marquer caution reçue » toggle
   (`markPayment`).
3. Clearing the flag (`cautionReceived` → 0) makes the amount live again (the stored value is ignored
   on read while not received).
4. Rule 1's effective amount applies everywhere the caution **amount** is displayed or used for
   guest-facing wording: the arrival/departure SAS, the reservation fiche pricing card, the
   ReservationCard « Caution à percevoir » chip, the Dashboard arrival checklist, and the reminder emails
   (`{{cautionAmount}}`, `cautionNotBanked`, `cautionNotReceived`).
5. The per-reservation **state flags** are unchanged: `cautionReceived` / `cautionReceivedDate` /
   `cautionReturned` / `cautionReturnedDate`.
6. The SAS « caution » step still appears only when the (effective) amount `> 0` and the caution has not
   yet been received (arrival) / not yet returned (departure) — existing condition, new amount source.
7. No editable per-reservation caution field is introduced. The property's « Caution par défaut »
   ([PropertyDetail.js:871](../client/src/pages/PropertyDetail.js#L871)) remains the single place to set it.
8. No data migration: the column already exists; the freeze happens going forward, and not-yet-received
   reservations are computed live at read time.

**Edge cases:**
- Property caution = 0 and not received → no caution step in the SAS, no caution line in emails. Correct.
- Caution received at 500, property later raised to 700 → SAS/fiche/departure keep **500** (the collected
  amount, frozen on receipt). This is the point of rule 2.
- Property raised from 500 → 700 **before** receipt → SAS shows 700 live; collecting it freezes 700.
- iCal reservation with no property match → unchanged (still 0).
- Reservations whose caution was marked received **before this feature shipped**: their stored
  `cautionAmount` is the creation-time snapshot, which for them equals the property default at the time
  (no per-reservation editing ever existed), so the frozen value is already correct.

---

## 4. Architecture

> **Fat backend, thin frontend.** The resolution happens entirely on the server, at the reservation
> read layer and the email-context builder. The client renders the `cautionAmount` it receives —
> **zero client changes**.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `reservationsModel.js` | T | **Read:** `getByIdWithDetails` + `list` select `p.defaultCautionAmount` and return the **effective** caution (received ? stored : property). **Write:** `commitArrivalSas` freezes `cautionAmount = property.defaultCautionAmount` when setting `cautionReceived = 1`. |
| `controllers/` | `reservationsController.js` | T | `markPayment`: when `cautionReceived` → 1, also freeze `cautionAmount` from the property (single UPDATE with a subselect). |
| `utils/` | `emailContextBuilder.js` | T | Compute `cautionAmountNum` as `cautionReceived ? r.cautionAmount : property.defaultCautionAmount`. |
| `tests/` | `reservations-caution-live.unit.test.js` | C | Not-received reservation returns property default; received reservation keeps frozen amount; freeze-on-receipt writes the property value; email context follows the same rule. |
| `database.js` | — | — | (none — no schema change, no migration) |

No route/controller signature change: `getByIdWithDetails` and `list` keep the same payload **shape**,
only the `cautionAmount` **value** is now authoritative.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| — | — | — | **None.** SAS, PricingSummary, ReservationCard and Dashboard already read `cautionAmount` from the server; they automatically show the live value. |

### 4.3 API contract

Unchanged shape. `GET /api/reservations`, `GET /api/reservations/:id` (and `/:id/sas`) now return the
property's current caution in the existing `cautionAmount` field.

## 5. Data model

No schema change. `reservations.cautionAmount` now holds the **collected amount, frozen at receipt**;
it is authoritative only while `cautionReceived = 1`. While `cautionReceived = 0`, the displayed amount
is read live from `properties.defaultCautionAmount` and the stored value is ignored.

## 6. UI / UX

No visual change. Same caution line / chip / SAS step; the number is now correct after a settings change.
Mobile/desktop unaffected (no layout touched).

## 7. Test plan

**Server unit (new `reservations-caution-live.unit.test.js`):**
1. Not-received reservation whose stored snapshot ≠ property default → `getByIdWithDetails` and `list`
   return the **property default**.
2. Received reservation → both read paths return the **frozen stored amount**, even when the property
   default differs.
3. Marking a caution received (SAS commit and `markPayment`) freezes `cautionAmount = property default`.
4. `emailContextBuilder` `cautionAmount` / `cautionNotReceived` follow `received ? stored : property`.

**Existing suites to re-run / update:**
- `cd server && npm test` — update any email-context caution fixture that set `r.cautionAmount` to instead
  set `property.defaultCautionAmount`.
- `cd client && npx vitest run` — SAS / PricingSummary / ReservationCard tests; update mocked fixtures if a
  test asserted a `cautionAmount` that came from the reservation rather than the property.

**Manual:**
1. Set property A caution to 500, create a reservation, open its arrival SAS → shows 500.
2. Change property A caution to 700 in Settings → reopen the **same** reservation's SAS → shows 700.
3. Dashboard arrival checklist + ReservationCard chip + fiche pricing card all show 700.
4. Trigger / preview the J-1 reminder → caution wording reads 700.

**Manual (freeze):**
5. Property = 500, create reservation, mark caution « reçue » in the fiche → raise property to 700 →
   the reservation's caution stays **500** everywhere (fiche, SAS départ).
6. Property = 500, create reservation, raise property to 700 **before** receipt → SAS shows 700; collect
   it → frozen at 700.

## 8. Out of scope

- **Devis PDF caution** (`devisPdf.js`, `devisModel.js`): a devis is a point-in-time quote document; its
  caution legitimately stays the snapshot captured when the quote was issued. Unchanged.
- Per-reservation caution override / per-platform caution: not introduced.
- Dropping the `reservations.cautionAmount` column: deferred (kept for audit history); no value in removing now.

## 9. Open questions

_(none — behavior confirmed: live from property, ignore the frozen amount.)_

## 10. Implementation progress

- [x] `getByIdWithDetails` + `list` return effective caution (received ? stored : property)
- [x] `commitArrivalSas` freezes caution from property on receipt
- [x] `markPayment` freezes caution from property on receipt
- [x] `emailContextBuilder` caution = received ? stored : property
- [x] New server unit test (`reservations-caution-live.unit.test.js`)
- [x] Server suite green (1868/0); email + SAS fixtures updated
- [x] End-to-end verification on a real-DB copy (live when not received, frozen 500 when received)
- [x] Changelog fragment
