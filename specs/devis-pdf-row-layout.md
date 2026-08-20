# Devis PDF — pricing-table row layout

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/devis-pdf-row-layout` |
| **Created** | 2026-08-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The devis PDF prints its pricing table row by row in
[devisPdf.js](../server/src/utils/devisPdf.js). Until now `drawRow` picked one of **two fixed row
heights** — 20 px, or 28 px when the row struck an original price or carried a badge — and placed
every piece of text at a hard-coded offset inside it. Nothing was ever measured.

Two user-reported defects follow from that, both visible on a real devis:

1. **A designation that does not fit on one line overflows its row.** Long option labels
   (« Location du linge de toilette pour l'ensemble des voyageurs, serviettes et draps de bain
   compris ») wrap onto a second line that PDFKit happily draws **outside** the 20 px band — over
   the next row's grey stripe and its separating rule. The second line reads as struck through.
2. **The « Offert » badge collides with the label it qualifies.** The badge was drawn at
   `rowY + 3` and the label at `rowY + 10`: 7 px apart for a 7.5 pt badge, i.e. touching. On an
   offered line the label also sat on the taller 28 px variant, so a wrapped label spilled out too.

## 2. Goal

A pricing-table row on the devis PDF is always tall enough for what it prints: a long designation
wraps inside its own row, and an offered line shows its « Offert » badge clearly detached above the
label.

## 3. Functional rules

1. **A row is as tall as its content.** Its height is derived from the measured height of the
   designation, of the badge when there is one, and of the money column — never from a constant.
2. **The designation may wrap freely.** Two, three or more lines stay inside the row's band; the
   row grows by exactly one line height per extra line.
3. **The badge owns the line above the label.** When a row carries a badge (« Offert », a discount
   percentage), the badge is printed on its own line at the top of the row and the label starts
   **at least 4 px below it**. The badge never overlaps the label.
4. **Everything else aligns with the label's first line** — quantity, VAT rate, unit price HT and
   total TTC, plus the struck original when there is one. The badge line is an annotation above,
   not a line the amounts align to.
5. **A struck original reserves its own line.** When a row prints a "was" price struck through, the
   amount actually billed is printed one struck-line below it, and the row is tall enough for both.
6. **Vertical padding is uniform:** 7 px above the first line, 6 px below the last one, for every
   row of the table.
7. **The row height is what the page-break check uses.** `checkBreak` receives the real height, so
   a tall row is moved whole to the next page instead of being cut by the page footer.
8. **The rest of the document is unchanged** — column positions, colours, fonts, the strike-through
   rendering, the totals block, the payment schedule and the per-page footer all stay as they were.

**Edge cases:**
- Empty designation → the row still has one line's worth of height (rules 1 + 6).
- Designation longer than the money column, and vice-versa → the taller of the two drives the height.
- A badge on a row that also strikes an original (the standard offered line) → badge line, then the
  label + struck original, then the billed amount: three stacked levels, all inside the row.
- A tall row landing at the bottom of a page → moved whole to the next page (rule 7).

**Cost accepted:** rows are 2–20 px taller than before, so a devis with many options reaches a
second page slightly earlier. Legibility wins — this is the "augmente la hauteur si besoin" the
user asked for.

---

## 4. Architecture

Presentation-only change, entirely inside the PDF renderer. No endpoint, no payload, no client code.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | — | — | (none) |
| `controllers/` | — | — | (none) |
| `models/` | — | — | (none) |
| `middleware/` | — | — | (none) |
| `utils/` | [devisPdf.js](../server/src/utils/devisPdf.js) | T | New module-level pure `resolveRowGeometry()` (row height + badge/label/amount offsets, exported under `__test`); `drawRow` measures its text with `heightOfString` and places it from those offsets; the struck "was" amount + its strike line move to a small `drawStruckAmount()` helper used by both money columns. |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | — | — | (none) |

**Notes:**
- `resolveRowGeometry` is a pure function of measured heights — no PDFKit dependency — which is what
  makes the geometry unit-testable: PDFKit encodes text as glyph indexes, so a rendered row can't be
  inspected from the output bytes.
- No new dependency.

### 4.2 Client side (`client/src/`)

Untouched — the PDF is generated server-side and streamed to the browser.

**Component reuse declaration:** not applicable (no client change).

### 4.3 API contract

Unchanged. `GET /api/devis/:id/pdf` still returns the same PDF stream; only its layout differs.

---

## 5. Data model

No schema change, no migration, no data impact.

## 6. UI / UX

The PDF's « Détail tarifaire » table, per row:

```
┌────────────────────────────────────────────────────────────────────────────┐
│  (7 px)                                                                     │
│  OFFERT                            ← badge, 7.5 pt bold green, own line     │
│  (4 px)                                                                     │
│  Petit-déjeuner continental servi   6      54,55 €   10,00%      60,00 €    │ ← label line
│  en terrasse tous les matins                 0,00 €               0,00 €    │ ← billed amount
│  (6 px)                                                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

- A row without badge and without a struck price is a single line: label, quantity, HT, VAT, TTC.
- The grey zebra stripe of even rows covers the whole (now variable) height.
- Copy unchanged: « OFFERT », « Remise −X % », the column headers, the totals.

**Responsive behavior:** not applicable — an A4 PDF has one fixed layout.

**Sticky action bar:** not applicable — no page is added or modified.

## 7. Test plan

### Server unit tests
- [x] `tests/devis-pdf-row-layout.unit.test.js` (C, 7 tests) — on `resolveRowGeometry`: a plain row
  keeps label and amount on one line (rule 4); a 3-line designation grows the row by exactly two
  line heights (rules 1–2); a badge sits ≥ 4 px above the label and makes the row taller instead of
  overprinting it (rule 3); a struck original puts the billed amount one line below and fits both
  (rule 5); the taller of the two columns drives the height (rule 1); an empty designation still
  yields a usable row (edge case). Plus a render smoke test on a devis whose option labels wrap.
- [x] Existing PDF suites still green (`devis-pdf`, `devis-pdf-en`, `devis-pdf-quote-parity`,
  `devis-pdf-extra-guest-row`, `devis-pdf-date-validity-tax`, `offered-lines-struck-on-pdf`) —
  3398 server tests pass.

### Manual verification
- [x] Rendered a devis carrying a 2-line option label, two offered options (one of them 2 lines) and
  an offered resource: every label stays inside its row, no line crosses a rule, each « OFFERT »
  badge is detached above its label. *(PDF rasterised and inspected.)*
- [x] Rendered a short devis with a manual accommodation price + one offered option: totals block,
  bank details, payment schedule and caution unaffected.
- [x] Rendered a 22-option devis spanning 3 pages, then walked the generated content streams: no row
  text falls outside its own band on any page, and no row text is drawn under the page footer. The
  same check on the pre-fix renderer flags 8 overflowing rows — i.e. it does catch the bug it proves
  fixed.

## 8. Out of scope

- The « Détail du séjour » block above the table, whose values could in theory wrap too.
- The totals block, payment schedule and footer geometry.
- Any change to what a row *says* (labels, badge wording, amounts) — pure geometry here.
- Reducing the vertical space the totals block reserves (`checkBreak(rowY + 10, 170)`), which is why
  a table ending low on a page pushes the totals to the next one.

## 9. Open questions

None.
