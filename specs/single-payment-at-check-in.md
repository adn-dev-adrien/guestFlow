# One payment at check-in — the stay and the complement settled in a single gesture

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/single-payment-at-checkin` |
| **Created** | 2026-08-30 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Since [collect-stay-payment-at-check-in.md](collect-stay-payment-at-check-in.md) (v2.8.0) the arrival
SAS can collect **two different things** at the door:

- the **stay** itself — acompte + solde still unpaid, the last-minute case;
- the **arrival complement** — what the guest owes on top: linen, cleaning, and the prestations sold
  during the check-in itself (breakfast, restauration —
  [sas-breakfast-and-catering-upsell.md](sas-breakfast-and-catering-upsell.md)).

Rule 22 of that spec made them **settle separately, on purpose**: they are different accounting
objects, and one may be deferred to the check-out while the other is collected. The recap therefore
shows « Règlement du séjour » and « Règlement du complément », two button rows, and the commit writes
two independent settlements.

**Reality at the door contradicts that shape.** A last-minute guest arrives, takes a « repas des
trappeurs » during the check-in, and hands over **one card, once, for the whole thing**. GuestFlow
then records *two* collections: a `balance` and a `complement`. The operator sees two ticks on the
fiche and **two entries in the Comptabilité** (badge **S** and badge **C**) for a single 530 € line on
the bank statement — and has to remember, months later, that those two rows were one payment.

The separation is not wrong; it is just not always true. What is missing is the ability to say
« the guest paid everything, once ».

## 2. Goal

When the guest settles the stay and the arrival complement **in one gesture**, the operator records
**one payment**: one button in the SAS, one payment on the fiche, one encaissement in the
Comptabilité — while the accounting ventilation (revenue accounts, VAT rates, tourist tax,
commission) stays exactly as correct as it is today.

## 3. Functional rules

### 3.1 The unified settlement in the SAS recap

1. **When both sides are collectible at the door**, the arrival recap shows **one settlement block**
   instead of two: the « Total à percevoir à l'arrivée » line, followed by a single row of buttons.
   « Both collectible » is **composed**, not answered by a single server flag (corrected 2026-08-30,
   during implementation):
   - the **« Séjour à régler » step is shown** (`stayPayment.applicable` — the server's call, rule 6
     of [collect-stay-payment-at-check-in.md](collect-stay-payment-at-check-in.md));
   - the **complement is still open** (`arrivalPayment.complementOpen` — the server's call);
   - and the complement has a **live total > 0**.

   That last term is the one that had to move. The first attempt asked the server « is the stored
   `complementAmount` > 0? », which is **false in the very case this spec exists for**: a « repas des
   trappeurs » sold *during* the check-in is not in `complementAmount` when the SAS payload is built.
   The recap owns that total already (it renders it), so it composes the condition. No money is
   decided client-side: every line is re-priced by the server at commit, as always.
2. **Three buttons, same component and grammar as today** ([sas-recap-payment-buttons.md](sas-recap-payment-buttons.md)):
   - **CB / Chèque** → everything is settled, ordinary accounting;
   - **Payé en liquide** → everything is settled in the **caisse interne**, off the books, on both
     sides at once ([cash-complement-and-endofstay-finance.md](cash-complement-and-endofstay-finance.md));
   - **Plus tard** → nothing is collected, and **each side keeps its own meaning of « later »**: the
     stay stays due exactly as it is, the complement is recalled at the check-out
     ([recall-unpaid-arrival-complement-at-checkout.md](recall-unpaid-arrival-complement-at-checkout.md)).
     That is precisely what the two independent defers do today; unifying the button does not unify
     what being unpaid means.
3. **« Plus tard » is pre-selected**, and clicking the active mode again returns to it — the same
   fallback rule the two blocks already follow. Committing without touching the buttons writes
   nothing, on either side.
4. **« Régler séparément » stays one tap away.** A link under the unified block reveals the two
   blocks exactly as they are today. Rule 22's case is real — a guest who pays the stay by transfer
   and the extras in cash, a complement deferred while the stay is collected — and the unified
   settlement must never make it unreachable. The choice is **per check-in, not a setting**: it is
   local wizard state, nothing is persisted about it beyond what was actually collected.
5. **When only one side is collectible**, nothing changes: a stay with no complement, or a complement
   with no stay due, shows the single block it already shows, with its existing wording.

### 3.2 What is written

6. **The buckets are untouched in structure.** A unified settlement writes exactly what the two
   separate ones write today — `depositPaid` / `balancePaid` / `complementPaid`, their dates, their
   cash flags, the `*PaidAtArrival` markers — with **the same date and the same cash flag on every
   bucket it covers**. No amount moves between buckets, so the accounting ventilation is unchanged by
   construction.
7. **The group is recorded, not guessed.** A new nullable column
   `arrivalPaymentGroup` on `reservations` holds the JSON of the single payment:
   `{ "at": "2026-08-30", "cash": 0, "buckets": ["balance", "complement"] }`. It is written by the SAS
   commit when — and only when — the operator used the unified settlement.
   **Deriving the group instead (« same date + same cash flag ») is refused**: a complement genuinely
   collected by a second, separate card payment on the same day would be merged into the first, and
   the operator would have no way to tell the app it was wrong.
8. **The group is cleared** whenever any bucket it names stops being settled — re-opening the SAS and
   choosing « Plus tard », un-ticking « Solde payé » on the fiche, or a `PATCH /reservations/:id/payment`
   that flips a bucket back. Same ownership discipline as the `*PaidAtArrival` markers
   ([collect-stay-payment-at-check-in.md](collect-stay-payment-at-check-in.md) rule 15): the app never
   claims a single payment it no longer owns.
8bis. **La dissolution d'un paiement unique laisse une trace** (ajouté le 2026-08-31, depuis la
    production). La règle 8 fait mourir le groupe avec n'importe laquelle de ses échéances — mais elle
    le faisait **en silence** : aucune ligne d'historique, donc un opérateur voyait son encaissement
    disparaître sans le moindre moyen de savoir ce qui l'avait effacé. C'est ce silence qui a rendu les
    deux bugs du 2026-08-31 impossibles à diagnostiquer depuis l'application — il a fallu lire la base
    de production. La ligne dit **ce qui disparaît et pourquoi** : « Paiement unique à l'arrivée :
    184,95 € le 2026-08-30 (solde, complément de fin de séjour) → dissous — « solde » n'est plus
    encaissé ». Elle est écrite au point d'écriture unique (`releaseArrivalPaymentGroup`), donc par
    tous les chemins qui dissolvent, et par le SAS re-joué en « Plus tard ». Elle ne change aucun
    comportement : elle rend le comportement lisible.

9. **`complementPaidAtArrival`** — a new marker, mirroring the two stay ones, so a re-opened SAS knows
   the complement settlement is **its own** and may undo it. Today the complement has no such marker
   because it has always been the SAS's business; the group makes the ownership explicit.
10. **History**: the commit records one line « Encaissé à l'arrivée — paiement unique » with the
    amount, the mean and the buckets covered, instead of the two separate lines
    ([arrival-departure-sas.md](arrival-departure-sas.md) §3.7).

### 3.3 The Comptabilité

11. **The ventilation does not change.** `encaissementsByMonth` keeps emitting **one entry per
    bucket**: the stay carries hébergement + taxe de séjour + commission at their own accounts, the
    complement carries « prestations complémentaires » at the general VAT rate. Merging them into one
    accounting object would merge two revenue accounts and two VAT rates, which is the one thing this
    change must not do.
12. **Each entry carries its group**: a `paymentGroup` field (`{ id, at, cash, total }`) so the
    reading side can tell that two entries are one collection. Entries with no group are unchanged.
13. **The Comptabilité page renders one card per group**: header « Encaissé le 30/08 — 530,00 € »,
    and inside it the per-bucket mini-journals it already draws, one under the other. The
    encaissements table shows **one row** for the group, with its total and a combined badge, and the
    per-bucket rows are reachable by unfolding it.

    > **Livrée à moitié, complétée le 2026-09-01.** Seules les CARTES de journal regroupaient ; le
    > tableau « Encaissements du mois », juste en dessous, listait toujours une ligne par échéance.
    > L'opérateur y lisait donc deux versements là où son relevé bancaire n'en porte qu'un — signalé en
    > production sur les réservations 22281 (281,98 €) et 12 (27 €). Le tableau replie désormais les
    > lignes d'une même collecte (`groupPreviewRows`), affiche la **somme** des échéances dans les
    > colonnes d'argent et la date du groupe, et se déplie sur le détail par échéance : la ventilation
    > comptable, elle, n'a jamais fusionné. La charge utile du tableau (`platformsPreview`) transporte
    > pour cela le `paymentGroup` de chaque écriture. Cliquer la ligne ouvre la fiche comme avant ;
    > seul le bouton de dépliage arrête la propagation.
    >
    > La « pastille combinée » annoncée ci-dessus est remplacée par le **bouton de dépliage**, dans la
    > même colonne de 32 px : sur une ligne repliée, l'affordance vaut mieux qu'une étiquette, et les
    > pastilles par échéance réapparaissent dans le détail — là où elles disent quelque chose.
14. **The accountant's export is unchanged** (decision, §9 Q1): it keeps one journal entry per bucket.

    > **Révisé le 2026-08-31** par
    > [arrival-payment-detail-and-adjustment.md](arrival-payment-detail-and-adjustment.md) rule 28 :
    > l'export gagne deux TYPES d'écritures — le rabais accordé (`70900000`) et le pourboire
    > (`75880000`). La forme par échéance, elle, ne change toujours pas : c'est ce que cette règle
    > protégeait. À annoncer au comptable avant le premier export qui en porte une.
    The grouping is what the *operator* reads in the app; the accountant's file keeps the shape their
    tooling already ingests. Changing the export is a separate decision, to be taken with them.
15. A **caisse interne** group is excluded from the accounting exactly as its buckets already are —
    the group changes nothing about what is on or off the books.

### 3.4 The fiche

16. The reservation's finance section gains, above the buckets, a **« Encaissé à l'arrivée »** line
    when a group exists: « Paiement unique de 530,00 € le 30/08 — CB / Chèque », followed by what it
    covered (« solde 480,00 € · complément 50,00 € »). Caisse interne is spelled out when it applies.
    **Superseded on 2026-08-31** by
    [arrival-payment-detail-and-adjustment.md](arrival-payment-detail-and-adjustment.md) §3.1: the
    caption now lists the PRESTATIONS the payment covered rather than its buckets. The bucket caption
    survives as the fallback for a payment whose contribution snapshots were never captured (rule 8
    there), so nothing is lost when the detail cannot be built.
17. **The per-bucket controls stay exactly as they are.** They are still separate amounts with
    separate accounting; the group is a reading aid above them, not a replacement. Un-ticking one of
    them clears the group (rule 8) and the line disappears — the fiche never shows a payment that is
    no longer true.

**Edge cases:**
- Complement already paid before the SAS → no unified block; the existing « ⚠ Le complément était déjà
  marqué payé » warning is unchanged.
- `stayDue = 0` (the ordinary prepaid stay) → no unified block, no group, nothing new. The overwhelming
  majority of check-ins are unaffected.
- Reception-only user → never sees the stay side at all ([reception-role-checkin-only.md](reception-role-checkin-only.md)),
  so never the unified block either; the complement settles as today.
- Everything offered (`total = 0`) → nothing to collect, no block.
- Re-opening a SAS that made a unified payment → the block reopens on its stored mode, and « Plus
  tard » undoes **both** sides together.
- A group whose complement is later adjusted on the fiche → the group keeps the amount actually
  collected; the difference is an ordinary unpaid complement.

---

## 4. Architecture

> **Fat backend.** The group, its amount, which buckets it covers and every write live on the server.
> The client renders the payload, holds one `arrivalPayMode` string plus a `splitSettlement` boolean
> until the commit, and computes no amount.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `controllers/sasController.js` | T | `commitArrival` accepts the unified mode (`arrivalPaymentMode` + `arrivalPaymentSplit`), drops it for a reception-only user, and passes it down. |
| `controllers/` | `controllers/reservationsController.js` | T | `updatePayment` and the full save clear `arrivalPaymentGroup` when they un-settle a bucket the group names (rule 8). |
| `models/` | `models/reservationsModel.js` | T | `commitArrivalSas`: settle the stay buckets and the complement in one pass when the mode is unified, write `arrivalPaymentGroup` + `complementPaidAtArrival`, revert them together on « Plus tard ». New `releaseArrivalPaymentGroup(reservationId, bucket)`. |
| `models/` | `models/accountingModel.js` | T | `encaissementsByMonth` selects `arrivalPaymentGroup` (behind the usual column guard) and attaches `paymentGroup` to the entries the group names. **No change to which entries are emitted, nor to their content.** |
| `utils/` | `utils/accountingExport.js` | T | `entryToStructured` carries `paymentGroup` through. Found only in the browser: the page reads the **mapped** entry, which rebuilds the object from an explicit field list, so a field not listed there never reaches the UI. Covered by a test. |
| `utils/` | `utils/arrivalPaymentGroup.js` | C | Pure: parse / build / validate the group JSON, and answer « does this bucket belong to the group? ». Unit-testable, no DB. |
| `utils/` | `utils/sasAudit.js` | T | The « Encaissé à l'arrivée — paiement unique » history line (rule 10). |
| `utils/` | `utils/receptionView.js` | T | Drop the unified-mode fields from a reception commit, fail-closed. |
| `database.js` | `database.js` | T | Idempotent migration: `arrivalPaymentGroup` TEXT NULL, `complementPaidAtArrival` INTEGER NOT NULL DEFAULT 0. |
| `schema.sql` | `schema.sql` | T | The same two columns on the baseline table. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/sas/ReservationSasDialog.jsx` | T | The unified settlement block on the arrival recap, the « Régler séparément » escape hatch, and the commit payload. Its tests go in `ReservationSasDialog.recap-payment.test.jsx` (CLAUDE.md §9). |
| `components/` | `components/reservation/FinanceSection.jsx` | T | The « Encaissé à l'arrivée » line above the buckets (rule 16). |
| `pages/` | `pages/AccountingPage.jsx` | T | Exported pure `groupEntries(entries)` folds the entries of one collection into one block; the journal renders a framed card per group — header « Encaissé le … — … € » + a « Paiement unique » chip — holding the per-bucket `JournalEntryCard`s untouched. A group left with a single entry falls back to a plain card. |
| `pages/` | `pages/ReservationPage.jsx` | T | Carries the server-shaped `arrivalPayment` into the fiche form (and clears it on a blank form), like `midStaySettledNotes`. |
| `components/` | `components/PaymentModeButtons` _(existing)_ | — | Reused as-is — the unified block is the same control with a different label. |

### 4.3 API contract

- `GET /api/reservations/:id/sas?mode=arrival` — the payload gains
  `arrivalPayment: { complementOpen: bool, group: {…}|null }`. Deliberately **not** a single
  `unifiable` flag: see rule 1 — the server cannot know what the check-in is about to sell.
- `GET /api/reservations/:id` — the fiche payload gains `arrivalPayment`, the group **shaped for
  display** (`{ at, total, cash, means, covers: [{ bucket, label, amount }] }`) or `null`. The raw
  `arrivalPaymentGroup` column rides along untouched for the SAS, which re-reads the stored group.
- `POST /api/reservations/:id/sas/arrival` — the body gains `arrivalPaymentMode`
  (`'card' | 'cash' | 'later' | null`) and `arrivalPaymentSplit` (bool). When `arrivalPaymentSplit`
  is true the existing `complementSettled` / `complementPaidCash` / `stayPaid` / `stayPaidCash` fields
  are honoured exactly as today; when it is false they are ignored in favour of the unified mode.
  Both absent → unchanged behaviour, so an older client keeps working.
- `GET /api/accounting/encaissements` — each entry gains an optional `paymentGroup`. Additive.

## 5. Data model

Two columns on `reservations`, both idempotent, both harmless to existing rows:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `arrivalPaymentGroup` | TEXT | NULL | JSON of the single arrival payment: `{ at, cash, total, buckets[] }`. `total` is what the guest actually handed over, kept as collected so a later complement adjustment never rewrites history. NULL = no unified payment (every existing row). |
| `complementPaidAtArrival` | INTEGER | 0 | The SAS settled the complement itself, so a re-open may undo it (mirrors `depositPaidAtArrival` / `balancePaidAtArrival`). |

No data is migrated, no amount is recomputed: an existing reservation reads exactly as it does today.

## 6. UI / UX

- **Recap — unified** (default when rule 1 holds): « Séjour : 480,00 € », the complement detail lines,
  « Total complément : 50,00 € », then **« Total à percevoir à l'arrivée : 530,00 € »** in bold,
  the three buttons, and a discreet « Régler séparément » link underneath.
- **Recap — separated**: the two blocks exactly as they are in v2.8.0, plus a « Régler en une fois »
  link to go back.
- **Fiche**: one line above the payment buckets — « Encaissé à l'arrivée : paiement unique de
  530,00 € le 30/08 (CB / Chèque) — solde 480,00 € · complément 50,00 € ».
- **Comptabilité**: one journal card per group, its header carrying the group total and its body the
  per-bucket mini-journals it already draws; one encaissements row, unfoldable.
- **Responsive**: the unified block is one `PaymentModeButtons` row — it already stacks on `xs`. The
  Comptabilité group card must not widen the table on mobile: the per-bucket detail unfolds
  vertically, never sideways.

## 7. Test plan

### Server unit tests — 24 new, suite at 3737
- `arrivalPaymentGroup` (pure): build / parse / reject malformed JSON; bucket membership.
- `commitArrivalSas`: unified card → stay + complement settled, same date, group written; unified cash
  → both cash-flagged and off the books; « Plus tard » → nothing written on either side; re-open then
  « Plus tard » → both reverted and the group cleared; split mode → the v2.8.0 behaviour, untouched.
- Ownership: a fiche `PATCH` that un-ticks the solde clears the group; one that changes nothing does not.
- `encaissementsByMonth`: two entries still emitted, both carrying the same `paymentGroup`; a cash
  group emits none; an ungrouped reservation is unchanged.
- Reception: the unified fields are dropped, never rejected.

### Client tests (vitest) — 11 new, suite at 1168
- `ReservationSasDialog.recap-payment.test.jsx`: the unified block appears only when both sides are
  collectible; « Régler séparément » restores the two blocks; the commit payload carries the mode.
- `FinanceSection`: the « Encaissé à l'arrivée » line appears with a group and disappears without.
- `AccountingPage`: two entries sharing a group render one card.

### Full suites (2026-08-30)
- [x] `cd server && npm test` — 3737 tests.
- [x] `cd client && npx vitest run` — 1168 tests.
- [x] `cd client && npm run build`.
- [x] `npm run test:e2e` — 65 passed, 1 skipped.

### Manual UI verification
- A real last-minute reservation: check-in, sell a repas, settle everything by CB → one line on the
  fiche, one card in the Comptabilité, both numbers matching the bank.
- The same in caisse interne → nothing in the Comptabilité, « soldé » on the fiche.
- « Régler séparément » → the v2.8.0 behaviour, verified unchanged.
- Mobile (`xs`) at 420 px on the recap and the Comptabilité.
- [x] **Done 2026-08-30** on a copy of the production data (Gîte, réservation 22273, solde 652 € dû):
      a « repas des trappeurs » sold during the check-in raised the complement to 150 €, the recap
      showed « Total à percevoir à l'arrivée : 802,00 € » under a single « Règlement », « CB / Chèque »
      settled both sides, the fiche shows « Encaissé à l'arrivée : paiement unique de 802,00 € le
      30/08/2026 — CB / Chèque — solde 652,00 € · complément 150,00 € », and the Comptabilité shows one
      card « Encaissé le 30/08/2026 — 802,00 € » holding the two balanced journals (70600000 Location
      gîte / 70600010 Prestation complémentaire), each with its own VAT. Checked at 420 px and 1280 px.

## 8. Out of scope

- **Merging the two accounting entries into one journal entry** (§9 Q1) — the export keeps its shape
  until the accountant says otherwise.
- The **end-of-stay** complement and the mid-stay notes: they are collected at another moment, so they
  are never part of an arrival group.
- A **partial** payment (the guest pays the stay and half the extras): out of scope, the two sides
  remain all-or-nothing, as they are today.
- Any change to **who owes what** — this spec moves no money between buckets.

## 9. Open questions

- **Q1 — should the accountant's export merge a group into a single balanced journal entry?** One bank
  receipt is arguably one entry with several credit lines and one debit on 512. Rule 14 keeps the
  current shape on purpose; the answer belongs to the accountant, not to the app.
- **Q2 — should a group also be offerable as a whole?** « Offrir » works line by line today
  ([sas-offer-complement-lines.md](sas-offer-complement-lines.md)); nothing here changes it, but a
  fully offered complement inside a group is worth a look during implementation.
