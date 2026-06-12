# J-1 reminder — unpaid complement to collect + per-item breakdown

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/j1-complement-to-collect` _(user-managed)_ |
| **Created** | 2026-06-12 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The arrival card already surfaces a **« Complément à percevoir »** (money the host collects on arrival —
options/resources/custom-options flagged `inComplement`, plus the tourist tax when
`touristTaxInComplement`). The J-1 reminder email (`arrival_reminder_1d`) says nothing about it. The
operator wants the guest told, the day before, that a complement remains to be paid on arrival — and,
when possible, **what it corresponds to** (the option(s) that produced it).

## 2. Goal

When a reservation still has an **unpaid complement**, the J-1 email tells the guest the amount to settle
on arrival and, when the complement is made of identifiable items, lists them (label + amount).

## 3. Functional rules

1. The complement notice appears **only** when `complementAmount > 0` **and** `complementPaid` is falsy
   (flag `complementToCollect`).
2. The notice states the amount (`{{complementAmount}}`, formatted `123,45 €`) to settle **on arrival**.
3. When the complement is composed of identifiable in-complement items, the notice lists them as
   *label (amount)*, comma-separated — built from:
   - `reservation_options` rows with `inComplement=1` and `offered=0` → `options.title` + `totalPrice`;
   - `reservation_resources` rows with `inComplement=1` and `offered=0` → `resources.name` + `totalPrice`;
   - `reservation_custom_options` rows with `inComplement=1` and `offered=0` → `description` + `amount`;
   - the **tourist tax** when `touristTaxInComplement` and `touristTaxTotal > 0` → « Taxe de séjour » +
     `touristTaxTotal`.
4. The breakdown may be **partial** vs. the total (the complement can also include an accommodation
   "auto-gap" not tied to an option). Copy uses « Il comprend notamment : … » so a partial list reads
   correctly; the **authoritative total** is always `{{complementAmount}}`.
5. If there are **no** identifiable items (pure auto-gap), only the amount sentence is shown — no
   "comprend" clause, no empty artefact.
6. The whole sentence is **computed server-side** as one variable `{{complementNotice}}`, gated by
   `{{#if complementToCollect}}` — the template stays declarative (single-level conditional; the
   breakdown can't be a nested `{{#if}}`).
7. Tone stays warm. French copy.

**Edge cases:**
- Complement paid → no notice.
- `complementAmount` 0 → no notice.
- Offered (free) in-complement items → excluded from the breakdown (amount 0, not "to collect").

---

## 4. Architecture

> **Fat backend, thin frontend.** The breakdown query, the partial-vs-total wording, and the formatted
> sentence are built server-side. The template only renders `{{complementNotice}}` behind a flag.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `controllers/emailsController.js` | T | `loadReservationGraph` also loads `reservation_custom_options` (label `description`, `amount`, `inComplement`, `offered`); passes `customOptions` to `buildContext`. (Options + resources already loaded with `inComplement`.) |
| `utils/` | `utils/emailContextBuilder.js` | T | Accept `customOptions`; compute `flags.complementToCollect`, `vars.complementAmount`, and `vars.complementNotice` (amount sentence + optional « Il comprend notamment : {label (amount), …} »). |
| `utils/` | `utils/emailAutoSendRunner.js` | T | Load custom options per reservation + pass to `buildContext` (cron parity). |
| `utils/` | `utils/defaultEmailTemplatesRegistry.js` | T | Add the `{{#if complementToCollect}}{{complementNotice}}{{/if}}` block to the J-1 default body. |
| `database.js` | `database.js` | T | Idempotent content migration: append the complement block to the in-place J-1 body iff it still matches the previously-shipped body. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `pages/EmailTemplatesPage.js` | T | Picker chips: variable `{{complementNotice}}` (+ `{{complementAmount}}`) and condition `{{#if complementToCollect}}`. |

**Component reuse declaration:** none created.

### 4.3 API contract

No new endpoints / no signature changes. The J-1 preview/send render the complement notice when relevant.

---

## 5. Data model

No schema change. Reads existing columns: `reservations.complementAmount`, `complementPaid`,
`touristTaxInComplement`, `touristTaxTotal`; `reservation_options.inComplement`/`totalPrice`/`offered`;
`reservation_resources.inComplement`/`totalPrice`/`offered`; `reservation_custom_options.inComplement`/
`amount`/`offered`/`description`.

- **Content migration (idempotent, boot):** the seeded J-1 body gains the complement block only when it
  still equals the previously-shipped body (operator edits preserved).

## 6. UI / UX

J-1 email — added block (after the caution reminder), example:

```
{{#if complementToCollect}}{{complementNotice}}

{{/if}}
```

Where `complementNotice` renders e.g.:
> *Un complément de 55,00 € sera à régler directement sur place à votre arrivée. Il comprend notamment : Petit déjeuner (15,00 €), Ménage (40,00 €).*

or, with no identifiable items:
> *Un complément de 30,00 € sera à régler directement sur place à votre arrivée.*

- No layout change; editor gains 2–3 picker chips.

## 7. Test plan

### Server unit tests
- [x] `email-context-builder.unit.test.js` (+5): `complementToCollect` true only when amount > 0 and
  unpaid; `complementNotice` lists in-complement options/resources/custom-options + tourist tax with
  amounts; excludes offered (free) items; no "comprend" clause when no items; empty when paid or 0.
- [x] `email-template-renderer.unit.test.js` (+3): the J-1 body renders the complement sentence (with
  and without the breakdown) and nothing when paid.
- [x] Test DDLs (emails-controller / auto-send-runner / manual-queue) gain `reservation_custom_options`;
  full server suite 1465 green. Content migration (chained) verified on a copy of the production DB.

### Manual UI verification
- [ ] Preview J-1 for a platform reservation with an unpaid complement made of 2 options → amount +
  "Il comprend notamment : …".
- [ ] Preview when the complement is paid → no notice.
- [ ] Preview with a complement that has no in-complement items (auto-gap) → amount only.

## 8. Out of scope

- Surfacing the complement notice in other templates (J-7, etc.).
- Reconciling a partial breakdown to the exact total (auto-gap accommodation is intentionally not itemised).
- Any change to how the complement total is computed.

## 9. Open questions

Resolved during scoping (2026-06-12):
- **Show a per-item breakdown?** → Yes when items are identifiable (`inComplement` options/resources/
  custom-options + tourist tax); partial lists use « Il comprend notamment : … » with the authoritative
  total stated.
