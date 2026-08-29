# Offer a complement line from the SAS (geste commercial at check-in / check-out)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/sas-offer-complement-lines` _(user-managed)_ |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

Both SAS recaps end on a « Règlement » block that says **how** the money was collected — CB / Chèque,
Payé en liquide, and (arrival only) En fin de séjour
([sas-recap-payment-buttons.md](sas-recap-payment-buttons.md)). What they cannot express is the fourth
real-world answer: **« je ne le fais pas payer »**.

The operator hits it at the door regularly — two missing pillowcases on a loyal guest, an end-of-stay
cleaning that was almost done, a late bath-linen upsell handed over as a gesture. Today the only ways
out are all wrong:

- charge it anyway (the guest is billed for something that was offered),
- click « Non merci » on the upsell step (the option is never activated, so the **laundry and the linen
  stock stop counting the towels** even though the guest took them),
- leave the recap unsettled (the amount stays « à percevoir » forever in the finance views).

The fiche already has the right vocabulary: every extra carries an **« Offrir / ✓ Offert »** toggle
([PricingSummary.jsx](../client/src/components/PricingSummary.jsx)) which puts the line at **0 €** while
keeping its real price struck through — a lossless, reversible geste commercial handled by the pricing
engine (`applyOfferedToLine`, [pricing.js:798](../server/src/utils/pricing.js#L798)). The SAS never got
that toggle. Issue **#429**.

## 2. Goal

On **both** SAS recaps, the operator can offer **any billable line** of what is left to collect: the line
drops to 0 €, its real price stays visible (struck through), and the total to collect follows — so a
geste commercial is recorded as such instead of being billed, hidden, or left pending.

## 3. Functional rules

### 3.1 The toggle

1. **Every offerable line of the recap carries an « Offrir » / « ✓ Offert » toggle**, per line — same
   vocabulary and behaviour as the fiche (decision 2026-08-17: line-by-line, not one global button).
   Tapping it toggles the line between *billed* and *offered*.
2. **An offered line renders its real price struck through and counts 0 €** in the recap total.
3. **Offering is lossless and reversible**: the real price is preserved (`originalTotalPrice` for a
   catalogue line, the stored `amount` for a custom line, `qty × unitPrice` for an end-of-stay line), so
   un-offering restores exactly the same amount — during the same SAS run *and* after a re-open.
3.bis **A « préservée » check-out line is lossless too** (fix 2026-08-29). The lines of rule 6.bis —
   whose label no longer maps to a priced item — carry only a label and a total, no unit price. Offered,
   they were stored `1 × 0 €` and **their price was gone for good**: the re-opened recap showed 0 € and
   withdrawing the gesture billed 0 € instead of what the guest owed. Two halves, both required:
   - **Server** — `commitDepartureSas` keeps the real price recoverable as `qty × unitPrice`, the form
     a re-open reads back. A line arriving with no usable unit price is collapsed to
     `1 × <the real total>` rather than stored at zero. No new field, same invariant.
   - **Client** — the re-open reads a preserved line the way it already reads a carried one (an offered
     line is worth `qty × unitPrice`), and carries its quantity and unit price back into the commit
     instead of flattening the line to « 1 × 0 € ».
   The arrival side never had the defect: a SAS custom line stores its `amount` whatever its `offered`
   flag, and the read layer exposes it as `unitPrice`.
4. The gesture is **decided in memory and written at the single commit**, like every other SAS decision.
   Quitter → nothing written.

### 3.2 Which lines are offerable

5. **Arrival recap** — offerable:
   - the pre-existing in-complement extras (catalogue options, resources, custom lines);
   - the lines the arrival SAS itself adds: the **bed-linen elements**, the **ménage** upsell and the
     **linge de toilette** upsell.
6. **Departure recap** — offerable:
   - the end-of-stay lines the departure SAS bills: **ménage de fin de séjour**, **serviettes / draps
     manquants**, **frais extincteur**;
   - the lines carried from the arrival SAS (`source`-tagged, e.g. a deferred bath linen) and the
     mid-stay lines stored in the same detail;
   - the **recalled arrival lines** (`recall-unpaid-arrival-complement-at-checkout.md`) — the arrival
     complement is collected at the door, so it must be offerable there too.
6.bis **Side fix — the carried-over check-out lines are now displayed.** Lines from a prior departure
   commit whose label no longer maps to a priced item (renamed / deleted since) were re-sent on every
   re-commit but shown nowhere and counted in no total, so the recap under-stated what the server would
   store. They now appear in the recap list like any other line — and are therefore offerable too.
6.ter **The offered set only speaks for the lines the recap rendered** (fix 2026-08-29, réservation
   Geuffrard). `offeredArrivalExtras` is *authoritative*: a recalled line absent from it is billed back.
   But the check-out recap only recalls the arrival complement when something is still owed on it
   (`amount > 0` and unpaid — `recall-unpaid-arrival-complement-at-checkout.md`), and **an arrival
   complement made entirely of gestes commerciaux is worth 0 €** — so the recap showed nothing, sent an
   empty set, and the server read it as « plus rien n'est offert » and billed every offered line back at
   check-out. Two guards, both required:
   - **Client** — the departure commit sends `offeredArrivalExtras` **only when the recall block was
     rendered**; otherwise the field is omitted (`undefined` = « leave every flag as it is »).
   - **Server** — `commitDepartureSas` re-reads the recall condition itself and ignores the field when
     the arrival complement is not recallable. The rule is business logic, so the backend owns it and
     no client version can re-open the hole.
   Un-offering at the door is untouched: as soon as something is owed, the recap renders every arrival
   line and its set is authoritative again.
   **Known limitation, accepted:** offering the *whole* arrival complement makes it worth 0 €, so the
   check-out recap stops recalling it and the gesture can no longer be undone from the SAS. It is
   undone on the fiche, whose « Offrir » toggle re-quotes the reservation server-side. Before this fix
   the undo happened by itself, wrongly, on every re-commit — that was the bug.
7. **Never offerable — no toggle rendered:**
   - the **taxe de séjour** (decision 2026-08-17): it is reversed to the commune, so it can never be a
     geste commercial. It stays due and visible on both recaps.
   - the un-itemised **« Complément d'arrivée »** remainder and the « Déjà dû » lump fallback — nothing
     addressable behind them.
   - the read-only reminders (« Déjà réglé en séjour », unplanned resource hours): they are not
     collections.
8. **« Offrir » ≠ « Non merci ».** On the ménage / linge de toilette upsell steps, « Non merci » still
   means *the guest did not take it* (no option activated at all). Offering it on the recap means *the
   guest took it, the host does not bill it*: the catalogue option stays activated (`inComplement = 1`,
   `sasArrivalOrigin = 1`) so the **laundry and the linen stock keep counting it**, at 0 €.

### 3.3 Money

9. **An offered line leaves the money buckets** — it is neither « à percevoir » nor revenue:
   - an offered arrival extra sets `offered = 1` on its row (`totalPrice = 0` for a catalogue
     option/resource; a custom line keeps its `amount` and is worth 0 by the existing
     `CASE WHEN offered` read), and `complementAmount` is decreased by the line's real price;
   - an offered end-of-stay line is stored in `endOfStayComplementDetail` with `offered: 1` and
     `amount: 0` (keeping `label`, `qty`, `unitPrice`, and any `source` / `key` / `repairKey` tag), and
     `endOfStayComplementAmount` is the sum of the **non-offered** lines only.
10. **No new bucket, no new column, no migration.** Offering reuses the `offered` flag that already
    exists on `reservation_options` / `reservation_resources` / `reservation_custom_options`, and a
    plain `offered` field inside the end-of-stay detail JSON. Every downstream view (finance, compta,
    dashboard, « reste à percevoir ») therefore sees a smaller amount with no extra plumbing — the
    invariant `comptaCollected + remainingToPay === totalSejour` keeps holding by construction.
11. **The settlement block follows the total.** With everything offered the total is 0 € → the
    « Règlement » buttons disappear (there is nothing to collect) and the commit settles nothing.
12. **A collected complement is frozen, as today.** The arrival complement already marked
    `complementPaid = 1` is not re-priced by the SAS commit, so its lines cannot be offered from the SAS
    (existing rule, unchanged); the fiche stays the way to fix an over-collected stay.

### 3.4 Re-open

13. **Re-opening a committed SAS restores the offered state** from the reservation
    ([reopen-completed-sas.md](reopen-completed-sas.md)): an offered arrival extra reopens as
    « ✓ Offert », an end-of-stay line stored `offered: 1` reopens offered with its real price, and
    un-toggling it on a re-commit bills it again.
14. **Offered lines stay visible on the recaps.** The arrival recap lists the in-complement extras
    *including* the offered ones (struck through, 0 €) — otherwise a gesture could never be undone.

### 3.5 History

15. **The commit records the gesture** in « Historique des modifications » (§3.7 of
    [arrival-departure-sas.md](arrival-departure-sas.md)): offered lines appear in the complement detail
    the audit already renders, tagged « offert », so the fiche shows *what* was offered and *when*.

**Edge cases:**
- Offering every line of a recap → total 0 €, no « Règlement » block, commit writes the offers and
  settles nothing.
- Tourist tax alone left after offering everything else → the recap still shows a positive total (the tax)
  and the settlement buttons stay.
- An offered upsell (`ménage` / `linge de toilette`) followed by « Non merci » on its step → the option is
  removed; the offer disappears with it (nothing to offer).
- Re-committing a departure SAS after offering a mid-stay line → the line keeps its `source`/`key` tag and
  stays offered; the money it used to carry is not silently re-routed.
- A reservation whose complement is already paid → recap unchanged (no toggles on a frozen complement).

---

## 4. Architecture

> **Fat backend, thin frontend.** The client sends *intent* — which lines the operator offered — and the
> server resolves the prices, applies the `offered` flags, and recomputes both complement amounts. No
> total is ever trusted from the client (unchanged contract).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/reservationsModel.js` | T | `arrivalComplementDetailFromReservation(r, { includeOffered })` adds a `ref` (`{ kind, id }`) to every line and, on demand, includes the offered in-complement extras (`amount: 0`, `originalAmount`, `offered: 1`). `commitArrivalSas` accepts `offeredExtras` (refs) + per-item `offered` on `complementItems` + `cleaningOffered` / `bathLinenOffered`; applies the flags and adjusts `complementAmount` by the exact real price of each line that changed state. `commitDepartureSas` accepts `offered` on the detail lines + on `extinguisherCharges`, stores them at 0 € with their real price kept recoverable as `qty × unitPrice` (§3.1 rule 3.bis), and sums only the billed ones; `offeredArrivalExtras` applies the same arrival-row logic at check-out — but only after re-reading the recall condition itself, so a set sent while the arrival complement is not recallable is ignored rather than billing every offered line back (§3.2 rule 6.ter). |
| `controllers/` | `controllers/sasController.js` | T | Ships `arrivalComplement` with the offered lines included (SAS-only flavour); forwards the new commit fields (validated/normalised) to the model. |
| `utils/` | `utils/sasAudit.js` | T | Renders « (offert) » on the complement lines of the history diff. |
| `routes/` | `routes/reservations.js` | — | (none — same endpoints, additive payload) |
| `database.js` | — | — | (none — no schema change) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `components/sas/ReservationSasDialog.jsx` | T | One `offered` set in the wizard state (keys `option:<id>`, `resource:<id>`, `custom:<id>`, `bed:<itemId>`, `cleaning`, `bathLinen`, `dep:<itemId>`, `depCleaning`, `ext:<repairKey>`, `carried:<i>`, `arr:<kind>:<id>`); every recap line is built with its key + real price and rendered through the new `OfferableLine`; totals count offered lines as 0; the commit maps the set onto the new payload fields; re-open seeds the set from the reservation. |
| `components/` | `components/sas/OfferableLine.jsx` | C | Presentational row: « libellé : qté × PU = total » + an « Offrir / ✓ Offert » toggle, real price struck through when offered. Feature-local (SAS recap semantics). |
| `services/` | `services/api.js` | — | (none — same endpoints) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Button`, `Stack`, `Typography` | Reused as-is. |
| **Created (new generic)** | — | `OfferableLine` stays feature-local: it encodes the SAS recap line grammar (`lineText` + offer toggle). If a second surface ever needs it, promote it to `components/`. |

### 4.3 API contract

Same endpoints, additive fields (no breaking change):

`GET /api/reservations/:id/sas`
- `arrivalComplement.detail[]` lines gain `ref: { kind: 'option'|'resource'|'custom', id }`, and — for
  the SAS payload only — the **offered** in-complement extras are now listed with
  `offered: 1, amount: 0, originalAmount: <real price>`.

`POST /api/reservations/:id/sas/arrival`
- `complementItems[]` gains `offered?: boolean` (bed-linen elements).
- `cleaningOffered?: boolean`, `bathLinenOffered?: boolean` — the upsell is activated but billed 0 €.
- `offeredExtras?: [{ kind: 'option'|'resource'|'custom', id: number }]` — authoritative offered set for
  the pre-existing in-complement extras (absent = leave every flag untouched).

`POST /api/reservations/:id/sas/departure`
- `endOfStayComplementDetail[]` gains `offered?: boolean`.
- `extinguisherCharges[]` gains `offered?: boolean`.
- `offeredArrivalExtras?: [{ kind, id }]` — same contract as `offeredExtras`, applied to the recalled
  arrival complement. **Sent only when the recap recalled that complement** (§3.2 rule 6.ter); the
  server ignores it otherwise, so an omitted or stale field can never bill an offered line back.

---

## 5. Data model

**No migration.** The change reuses existing storage:

| Table / column | Use |
|---|---|
| `reservation_options.offered`, `reservation_resources.offered`, `reservation_custom_options.offered` | 1 = offered; the row's `totalPrice` is 0 (catalogue) / derived 0 (custom). |
| `reservations.complementAmount` | Decreased by the real price of each newly-offered arrival line, increased back when un-offered. |
| `reservations.endOfStayComplementDetail` (JSON) | A line may carry `offered: 1` with `amount: 0` and its `unitPrice` / `qty` intact. |
| `reservations.endOfStayComplementAmount` | Sum of the **billed** lines only. |

## 6. UI / UX

- **Recap line**: the label + price stay on the left, an « Offrir » text button sits on the right. Offered
  → the button reads « ✓ Offert » (filled, `success`), and the amount is rendered `text-decoration:
  line-through` with a « 0 € » next to it.
- **Mobile (`xs`)**: label and toggle share the row (`flexWrap`), the toggle keeps a ≥ 44 px touch target;
  no horizontal scroll. Desktop: same row, toggle right-aligned.
- The « Règlement » block and the total are unchanged apart from following the new total.
- No new loading / empty / error state.

## 7. Test plan

### Server unit tests (`server/src/tests/`)
- [x] `sas-offer-complement-lines.unit.test.js` (new, 17 tests):
  - arrival commit with `offeredExtras` → row `offered = 1`, `totalPrice = 0`, `complementAmount` reduced
    by exactly the line's real price;
  - un-offering on a re-commit restores the amount (lossless round-trip);
  - `complementItems` with `offered: true` → custom line stored `offered = 1`, amount preserved, not
    counted in `complementAmount`;
  - `cleaningOffered` → the catalogue option is activated (`inComplement = 1`, `sasArrivalOrigin = 1`) at
    `totalPrice = 0`;
  - departure commit with an offered detail line → stored `offered: 1, amount: 0`,
    `endOfStayComplementAmount` counts only the billed lines;
  - offered extinguisher charge → priced then zeroed, real price kept in the line;
  - `offeredArrivalExtras` at check-out → arrival row offered + `complementAmount` reduced;
  - the tourist-tax line is never touched by an offer;
  - `buildArrivalComplementDetail(id, { includeOffered: true })` lists offered lines at 0 € with their
    `originalAmount`, and the detail still sums to `amount`;
  - **(2026-08-29)** a departure commit whose arrival complement is worth 0 € leaves every offered line
    offered — an empty `offeredArrivalExtras` bills nothing back;
  - **(2026-08-29)** a departure commit on a *recalled* complement still un-offers a line absent from
    the set (the guard costs nothing);
  - **(2026-08-29)** an offered detail line with no unit price is stored `1 × <its real total>`, and a
    re-commit that withdraws the gesture bills it at that price again (rule 3.bis).
- [x] Full server suite green.

### Client tests (vitest, `components/sas/__tests__/ReservationSasDialog.test.jsx`)
- [x] Arrival recap: « Offrir » on a bed-linen line → total drops, commit sends
      `complementItems[].offered = true`.
- [x] Arrival recap: offering a pre-existing extra → commit sends its `ref` in `offeredExtras`.
- [x] Departure recap: offering the « Ménage de fin de séjour » line → total drops, commit sends
      `offered: true` on that detail line.
- [x] Departure recap: offering a recalled arrival line → commit sends `offeredArrivalExtras`.
- [x] No toggle on the « Taxe de séjour » line (both recaps).
- [x] Everything offered → the « Règlement » block is gone.
- [x] Re-open: a stored offered line reopens « ✓ Offert ».
- [x] **(2026-08-29)** Departure recap on an arrival complement worth 0 € → the commit omits
      `offeredArrivalExtras` entirely.
- [x] **(2026-08-29)** Re-open: an offered *preserved* check-out line shows its real price, and
      withdrawing the gesture sends `qty`, `unitPrice` and the real `amount` back (rule 3.bis).

### Manual UI verification
- [x] Arrival + departure SAS run in the browser at `xs` and desktop widths, screenshot in the PR.

## 8. Out of scope

- Offering the **taxe de séjour** (decided: never — it is owed to the commune).
- A global « tout offrir » button (line-by-line was chosen; offering N lines is N taps).
- Any change to the accounting routing, the caisse-interne treatment, or the settlement buttons
  themselves.
- Offering lines of a complement already marked paid (fiche territory).
- A « raison du geste » free-text field (not asked; the history already records what was offered).

## 9. Open questions

Resolved during scoping (2026-08-17, issue #429):
- **Portée** → **line by line** on both recaps (rejected: one global « Offert » settlement button).
- **Modèle** → **lines at 0 €** with the real price kept (rejected: a new « offert » status column with
  the amount preserved — it would have needed every finance view to learn a new state).
- **Taxe de séjour** → **never offerable** (rejected: host absorbs it and marks it collected).
- **Check-in too?** → **yes, both SAS** (the same gesture exists at the door on arrival).
