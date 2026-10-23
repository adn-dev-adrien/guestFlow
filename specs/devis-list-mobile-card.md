# Devis list — a readable mobile card

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/devis-list-mobile-card` _(user-managed)_ |
| **Created** | 2026-10-22 |
| **Author** | Adrien |
| **Related PR** | #748 |
| **Mockup** | `docs/specs/2026-10-22-devis-list-mobile-card.html` |

---

## 1. Context

On a phone, the Devis page renders each devis as a card (`DataPageScaffold` mobile-cards mode). Reported
2026-10-22: the logement name is glued to the dates — « Gite10/05/2027 → 13/05/2027 ».

Root cause: the card writes the logement and the dates as two `<Typography variant="caption">` (inline
`<span>`s) and relies on `display="block"` to break the line. MUI 9 dropped system props on `Typography`,
so `display="block"` is silently ignored and both spans run together.

Measured on the same screen (390 px wide), beyond the glued text:

- The first line carries the devis number **and two origin badges** (« Site internet » + « Origine
  inconnue ») that wrap onto a second line — the number takes more room than the guest's name.
- The guest's name, the one thing the operator scans for, is a secondary line.
- Four icon buttons sit on the last line, and the red « Supprimer » is as reachable as « Télécharger le
  PDF ».
- The stay length is never stated; the operator computes nights from two dates.
- The total is summed in React (`finalPrice + touristTaxTotal`), against the fat-backend rule.

## 2. Goal

A card that reads top-down in the order the operator thinks — **who, where, when, how much** — with the
logement and the dates on separate, legible lines, and the destructive action one tap further away.

## 3. Functional rules

1. **Order of the card (xs only).** Line 1: guest name (bold, one line, ellipsis) with the status badge at
   the right. Line 2: logement, with the website marker at the right (both shrink with an ellipsis, the
   marker to at most ~60 % of the line). Line 3: stay label « 10 → 13 mai 2027 · 3 nuits ». Footer, under a
   hairline: devis number (monospace, small) at the left, then the total TTC and the card's actions.
2. **Logement and dates never share a line.** Each is its own block element; no layout relies on a
   `Typography` system prop.
3. **One origin marker.** A website request shows a single badge: the server's `originLabel` when the
   channel is known (« Réseaux sociaux · Instagram »), « Site internet » otherwise. « Origine inconnue »
   alone is never shown as a second badge. The tooltip keeps `originDetail`.
4. **Actions.** A tap anywhere on the card opens the devis (unchanged destination: converted → reservation); for keyboard and screen readers the identity lines (guest, logement, stay) form ONE button, and the PDF / « ⋯ » controls are siblings of it, never nested in a button. Visible
   on the card: « Télécharger le PDF ». « Confirmer en réservation » and « Supprimer » move to a « ⋯ »
   menu; « Supprimer » keeps its confirmation dialog.
5. **Server-shaped fields.** `GET /api/devis` adds to every row `nights` (integer), `stayLabel` (French
   range, year printed once when both dates share it) and `totalTtc` (accommodation + tourist tax, rounded
   like the PDF). The client renders them and stops summing.
6. **Desktop table layout unchanged** by this spec (see §8); it only reads `totalTtc` like the card.

> **Sans test** — règle négative (rien n'est ajouté au tableau) : il n'y a pas de comportement à prouver, la lecture de `totalTtc` est couverte par la règle 5.

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `devisModel.js` | T | `list()` maps each row through the new display helper |
| `utils/` | `stayRangeLabel.js` | C | `nights` + French `stayLabel` from two ISO dates |
| `tests/` | `devis-list-mobile-card.unit.test.js` | C | Label, nights and `totalTtc` cases |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `DevisPage.jsx` | T | New `renderMobileCard`; reads `stayLabel`, `totalTtc`; « ⋯ » menu |
| `components/` | `StatusBadge.jsx` | — | Reused for the single origin marker (the desktop row keeps `OriginBadge`) |
| `components/` | `RowActionsMenu.jsx` | C | Generic « ⋯ » icon button + menu of `{ label, icon, onClick, color }` — any list card needs it |

### 4.3 API contract

`GET /api/devis` — each row gains `nights: number`, `stayLabel: string`, `totalTtc: number`. Additive.

## 5. Data model

None.

## 6. UI / UX

See the mockup. Mobile (xs) only; sm+ keeps the current table.

## 7. Test plan

- Server unit: `stayLabel` same month, across months, across years, missing date; `nights`; `totalTtc`.
- Client vitest `DevisPage.mobile-card.test.jsx`: logement and stay label are distinct elements; one origin
  badge; « Supprimer » only inside the menu.
- Manual: 390 px with a long guest name and a long logement name; 900 px and 1280 px unchanged.

## 8. Out of scope

- The desktop table (its overflow at 1280 px with the sidebar is real, but not what was reported).
- Search or sorting on the list.

## 9. Open questions

Resolved 2026-10-22, both with the proposed option:

1. Actions on the card: **PDF + « ⋯ »** (`RowActionsMenu`: « Confirmer en réservation », « Supprimer »).
2. Origin: **one badge**, shown on the logement line. The client compares `originLabel` with the server's
   « Origine inconnue » to fall back on « Site internet » (the label is the server's, only the choice of
   what to show is the card's).

## 10. Implementation progress

- Server: `utils/stayRangeLabel.js`, `devisModel.list()`; 8 tests in `devis-list-mobile-card.unit.test.js`.
- Client: `RowActionsMenu.jsx` (generic), `DevisPage.jsx` card + `totalTtc` for the table too (the client
  no longer sums); 5 tests in `DevisPage.mobile-card.test.jsx`.
- Checked in a real browser at 390 px (no horizontal scroll, menu opens, « Supprimer » only in the menu) and
  1280 px (table unchanged).
