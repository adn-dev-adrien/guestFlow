# Hide already-settled SAS steps (caution received, cleaning included)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/sas-hide-settled-steps` _(user-managed)_ |
| **Created** | 2026-07-03 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [arrival-departure-sas.md](arrival-departure-sas.md), [reopen-completed-sas.md](reopen-completed-sas.md) |

---

## 1. Context

The arrival SAS wizard (`ReservationSasDialog`) walks the operator through a sequence of
single-purpose pages. Two of them stay visible even when there is nothing left to decide:

- **Caution.** The arrival caution page is already hidden on a *fresh* check-in once the caution
  is received ([`ReservationSasDialog.js:296`](../client/src/components/sas/ReservationSasDialog.js#L296),
  `!r.cautionReceived`). But when the operator **reopens a completed SAS**
  ([reopen-completed-sas.md](reopen-completed-sas.md) §3 rule 3), the caution page reappears
  pre-ticked — noise, since the caution is already settled.
- **Ménage.** The cleaning page is **always** in the arrival key list
  ([`ReservationSasDialog.js:306`](../client/src/components/sas/ReservationSasDialog.js#L306)).
  When the cleaning is already included (a cleaning option on the reservation — detected the same way
  as the J-1 email, by `autoOptionType='cleaning'` tag **or** by the option name containing « ménage »,
  see [`utils/cleaningOption.js`](../server/src/utils/cleaningOption.js) — or a property default), the
  page only shows an informational *« ✅ Le ménage est inclus »* screen with no action — pure noise.

There is no online caution payment: `cautionReceived` is set only by the SAS itself or by the
reservation fiche. So « caution déjà payée » always means `cautionReceived = 1`.

## 2. Goal

In the arrival SAS, the caution page never appears once the caution is received (including when
reopening a completed SAS), and the ménage page never appears when the cleaning is already included.
The client reminder previously carried by the included-ménage page moves to the recap so it is not
lost.

## 3. Functional rules

1. **Arrival caution page — hidden whenever received.** The arrival `caution` (and its dependent
   `cautionReport`) step is shown only when `cautionAmount > 0` **and** `cautionReceived` is falsy —
   with **no re-edit exception**. This reverses [reopen-completed-sas.md](reopen-completed-sas.md)
   §3 rule 3 *for the arrival caution*: a received caution is no longer reachable from the SAS, even
   when reopening a completed SAS.
2. **Commit stays faithful.** With the caution page hidden, the commit already sends
   `cautionReceived: undefined` (tri-state, [`ReservationSasDialog.js:426`](../client/src/components/sas/ReservationSasDialog.js#L426)),
   so the server **leaves the received marker untouched**. No value is changed by hiding the page;
   a received caution stays received.
3. **Arrival ménage page — hidden whenever included.** The arrival `cleaning` step is dropped from
   the key list when `cleaning.included` is true (reservation carries a cleaning option — matched by
   `autoOptionType='cleaning'` tag **or** by name « ménage », see [`utils/cleaningOption.js`](../server/src/utils/cleaningOption.js)
   — or the property offers cleaning as a default). When cleaning is **not** included, the page
   still appears so the operator can offer / add the ménage (unchanged).
4. **Client reminder moves to the recap.** The reminder previously shown on the included-ménage page
   (*« Rappeler au client : la vaisselle doit être faite et rangée, et les poubelles vidées. »*) is
   shown on the **arrival recap** page instead, and only when `cleaning.included` is true (i.e. exactly
   the case where the dedicated page was removed).
5. **Scope = arrival only.** The **departure** « Retour caution » page (`cautionReturn`) is
   **unchanged** — it is a different action (returning the caution), not an « already settled » state,
   and it stays reachable in re-edit to correct a mis-marked return.
   > **Revised 2026-08-03** — the **departure** « Ménage de fin de séjour » page is **no longer
   > unconditional**: it is dropped when `cleaning.included` is true, exactly like the arrival one.
   > Rationale: when the cleaning is already sold (booked option, « Ménage » added at check-in, or
   > property default) the *host* does it, so there is nothing to assess — and answering « Pas OK »
   > billed the cleaning a **second time** on top of the arrival complement. See
   > [defer-arrival-complement-to-checkout.md](defer-arrival-complement-to-checkout.md) §3.1, which
   > also adds the authoritative server-side guard.

**Edge cases:**
- Caution received → reopen a completed arrival SAS → **no** caution page; the caution stays received
  (untouched on commit). The recap still notes « Caution marquée comme perçue » from the pre-filled
  state. Correcting a *mis-marked* caution from the SAS is **out of scope** — use the reservation fiche.
- Cleaning included + nothing else to settle → arrival SAS = intro + (portal/options/… as applicable) +
  recap, with the ménage reminder on the recap.
- Cleaning **not** included → ménage page shown exactly as before (« Le ménage n'a pas été pris » +
  « Ajouter le ménage » / « Non merci »).
- Cleaning added *during* the SAS (not included) → page stays visible on re-edit (`included` is false),
  so the operator can still review / un-add it.

---

## 4. Architecture

> **Fat backend, thin frontend.** No business logic moves to the client. The server already computes
> `cleaning.included` ([`sasController.js:33`](../server/src/controllers/sasController.js#L33)) and
> exposes `cautionReceived` ([`reservationsModel.js:524`](../server/src/models/reservationsModel.js#L524)).
> This change only adjusts which server-provided flags gate a page — pure rendering/UX. No new
> calculation on the client.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| — | — | — | Original change: no server change — `getSas` already returned `cleaning.included` and `reservation.cautionReceived`. |
| controllers | `controllers/sasController.js` | T | **2026-08-01 fix.** `getSas` computes `cleaning.included` via the shared `isCleaningOption` helper (tag or name « ménage »), replacing the tag-only `some(o => o.autoOptionType === 'cleaning')`. |
| utils | `utils/cleaningOption.js` | C | **2026-08-01 fix.** New shared helper — single source of truth for "is this option the cleaning?", consumed by both `sasController` and `emailContextBuilder`. |
| utils | `utils/cleaningOptionSeed.js` | T | **2026-08-01 fix.** Dropped the `alreadyTagged` early-return so a duplicate untyped « Ménage » is promoted too (idempotent UPDATE). |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/sas/ReservationSasDialog.js` | T | `activeKeys`: drop the `isEditing` exception for the arrival `caution` step; drop the `cleaning` step when `data.cleaning.included`. Arrival `recap`: render the vaisselle/poubelles reminder when `cleaning.included`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | — | Behavioral change inside the existing wizard. |
| **Created (new generic)** | — | None. |
| **Specific (kept feature-local)** | `ReservationSasDialog` | Existing SAS wizard, feature-local by design. |

### 4.3 API contract

Unchanged. No endpoint added or modified; request/response shapes identical.

---

## 5. Data model

No schema change. No migration. No data impact.

## 6. UI / UX

- **Arrival SAS stepper** loses the caution band when the caution is received, and the ménage band
  when the cleaning is included. The stepper simply gets shorter; navigation (« Précédent » /
  « Suivant ») is unchanged.
- **Arrival recap** gains one secondary line when the cleaning is included:
  *« Ménage inclus — rappeler au client : la vaisselle doit être faite et rangée, et les poubelles
  vidées. »* (`Typography variant="body2" color="text.secondary"`).
- **Responsive:** the dialog remains `fullScreen` on mobile (`xs`); removing pages only shortens the
  flow, no layout change at any breakpoint. The recap reminder wraps naturally on `xs`.
- **`PageActionBar`:** N/A — this is a modal wizard with its own footer navigation, not a route-level
  page.

## 7. Test plan

### Server unit tests
- [ ] None — no server logic changes. (The existing `sas-commit.unit.test.js` tri-state coverage
  already asserts that an absent `cautionReceived` leaves the marker untouched.)

### Client unit tests (`client/src/components/sas/__tests__/ReservationSasDialog.test.js`) — 14/14 green
- [x] Arrival, `cautionReceived = 1` on a fresh reservation → no `caution` band, wizard reachable
  (existing « linen OK », « breakfast hidden » tests already seed `cautionReceived: 1`).
- [x] Arrival, `cautionReceived = 1` **and** `arrivalSasDoneAt` set (re-edit) → still **no** `caution`
  band; the commit sends `cautionReceived: undefined` (marker untouched). (Rewrote the reopen test.)
- [x] Arrival, `cleaning.included = true` → no `cleaning` band; the recap shows the vaisselle/poubelles
  reminder.
- [x] Arrival, `cleaning.included = false` → `cleaning` band present (« Ajouter le ménage »); recap has
  no reminder (asserted in the full-flow test).
- [x] Departure unchanged: « Ménage de fin de séjour » still present (departure cleaning tests green).

### Verification performed
- [x] Component-render tests (jsdom, `@testing-library/react`) exercise every branch above — 14/14 green.
  These render the real `ReservationSasDialog` and assert the page presence/absence + the commit payload,
  so they cover the caution-hidden / ménage-hidden / recap-reminder behaviour directly.
- [x] Full client Vitest suite: 603/603 green. Full Playwright E2E suite: 28 passed / 1 skipped.
- [ ] Live browser SAS drive **not** performed — it needs a reservation seeded with a received caution /
  included cleaning that the E2E fixtures don't set up. Covered instead by the render tests above.

## 8. Out of scope

- **Departure** caution-return / end-of-stay cleaning gating — unchanged (rule 5).
- **Correcting a mis-marked caution from the SAS** — once received, the caution page is gone; the fix
  path is the reservation fiche.
- Any server / DB / API change.

## 9. Open questions

- **Resolved 2026-07-03 (AskUserQuestion):** caution scope = **hide everywhere**, including when
  reopening a completed SAS (not just fresh check-in). Reverses reopen-completed-sas §3 rule 3 for the
  arrival caution.
- **Resolved 2026-07-03 (AskUserQuestion):** the included-ménage client reminder (vaisselle/poubelles)
  is **kept, moved to the recap** rather than dropped with the page.
- **Resolved 2026-08-01 (bug fix):** the ménage page reappeared even when the guest had booked cleaning.
  Root cause = detection relied solely on the `autoOptionType='cleaning'` tag, and a second operator
  « Ménage » option (untagged) was never promoted by the boot seed (a stale `alreadyTagged` early-return
  bailed once the first « Ménage » was tagged). Fix (server): (1) `getSas` now detects cleaning via the
  shared [`utils/cleaningOption.js`](../server/src/utils/cleaningOption.js) helper — tag **or** name
  « ménage », same rule as the J-1 email; (2) [`cleaningOptionSeed.js`](../server/src/utils/cleaningOptionSeed.js)
  dropped the early-return so it tags **every** untyped « Ménage » on each boot (still idempotent).
