# The property « Acompte » switch governs the whole deposit

| Field | Value |
|---|---|
| **Status** | Implemented _(2026-09-21)_ — server (rename migration, engine gate, legacy devis derivation) + client (card split) + tests (server 4199 green, client 1284 green, Playwright 68 green). |
| **Branch** | `feature/property-deposit-switch` |
| **Created** | 2026-09-20 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Related** | [public-online-deposit.md](public-online-deposit.md) (creates the toggle — this spec widens it), [disable-deposit-per-reservation.md](disable-deposit-per-reservation.md) (the per-reservation opt-out this reuses), [platform-deposit-toggle.md](platform-deposit-toggle.md) (the per-platform flag), [payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) (the due dates), [editable-deposit-amount.md](editable-deposit-amount.md) (the manual override) |

---

## 1. Context

`properties.publicDepositEnabled` was created by [public-online-deposit.md](public-online-deposit.md)
to answer one narrow question: *when a guest books on the website, do we charge the whole stay or
just the acompte?* It governs nothing else. A reservation or a devis created **in the admin** still
splits 30 % / 70 % from `depositPercent`, whatever the toggle says
([pricing.js:2290](../server/src/utils/pricing.js#L2290),
[devisModel.js:121](../server/src/models/devisModel.js#L121)).

That split is a lie for Solio today: both logements have the toggle OFF and are paid in full at
booking, yet every direct fiche still carries an acompte and a solde, and the property page still
asks for a « % acompte » and an « Acompte (jours après réservation) » that nothing consumes.

The « Acompte & Solde » card compounds it. Six fields sit side by side with no hierarchy — two that
only mean something when there IS an acompte (`% acompte`, `Acompte (jours après réservation)`),
three that apply in every case (`Solde (jours avant)`, `Annulation (jours après échéance du solde)`,
`Caution par défaut`) — and the switch that decides between the two worlds is **last**, below the
fields it governs.

## 2. Goal

The « Acompte » switch on a logement becomes the single place where the operator decides whether that
logement has an acompte at all. OFF, the stay is paid in one go — everywhere, not just on the
website — and the property page stops asking for acompte settings that mean nothing.

## 3. Functional rules

### The switch

1. `properties.publicDepositEnabled` is **renamed** `properties.depositEnabled`. Same 0/1 semantics,
   same stored values, same default (`0`). The name was only ever right while the flag was
   website-only.
2. `depositEnabled = 0` means **this logement has no acompte**: every new or recomputed reservation
   and devis of that property gets `depositAmount = 0`, the solde absorbing the whole pre-arrival
   total — the same end state as a per-reservation `depositDisabled`
   ([disable-deposit-per-reservation.md](disable-deposit-per-reservation.md) rule 2). Direct bookings,
   platform bookings and the public website alike.
3. `depositEnabled = 1` restores today's behaviour in full: the acompte is `depositPercent` % of the
   accommodation pre-arrival total, the per-platform `platformTakesDeposit` flag and the
   per-reservation `depositDisabled` opt-out keep their current meaning, and the website charges the
   acompte instead of the whole stay.

### What the switch must never rewrite

4. **A paid acompte is history and stays untouched.** When `depositPaid = 1` (or
   `depositPaid && balancePaid`), the stored acompte/solde split is preserved on every recompute even
   with `depositEnabled = 0`. The money left the guest's account and an accounting entry was emitted;
   collapsing it into the solde afterwards would desynchronise the export.
   This is the one place where the property gate is weaker than `depositDisabled`, which does zero a
   paid acompte on purpose (its use case is « the platform took it, it never hit my bank »).
5. Precedence, from strongest to weakest, in the direct branch of the pricing engine:
   `depositDisabled` → a paid acompte → **`depositEnabled = 0`** → a manual `depositAmountOverride`
   → the last-minute rule → the automatic `depositPercent` split. The gate sits above the manual
   override on purpose: with the switch OFF the property page offers no acompte setting at all, so a
   frozen override would be an amount nobody can see or explain.
6. Same in the platform branch: `!platformTakesDeposit || depositDisabled` still wins, then a paid
   acompte, then `depositEnabled = 0`, then the existing override / automatic split.
7. The public payment mode ([publicPaymentMode.js](../server/src/utils/publicPaymentMode.js)) keeps
   its current shape — `deposit` only when the property is enabled **and** the stored deposit is
   > 0. With rule 2 the second condition can no longer fire on its own, but it stays: it is the
   defensive read that already covers a missing column or an unknown property.
8. The legacy devis derivation ([devisModel.js:121](../server/src/models/devisModel.js#L121)) — the
   one that re-derives a split for an old row storing neither `depositAmount` nor `balanceAmount` —
   returns a zero acompte when the property is disabled.

### The property page

9. The « Acompte & Solde » card splits in two.
10. **Card « Acompte »** — the switch is the **first** thing in it, followed by one line of caption:
    ON « Le séjour est payé en deux fois : un acompte à la réservation, le solde avant l'arrivée. » /
    OFF « Le séjour est payé en une fois, à la réservation. » When the switch is OFF the card holds
    nothing else. When it is ON it reveals `% acompte` and `Acompte (jours après réservation)`.
11. **Card « Paiement & Caution »** — always visible, whatever the switch: `Solde (jours avant)`,
    `Annulation (jours après échéance du solde)`, `Caution par défaut (€)`. These three apply to a
    single-payment stay exactly as they apply to a split one; hiding them would make an active
    setting unreachable.
12. `Solde (jours avant)` gains a helper text saying what it means in both worlds: « Échéance du
    solde — ou du paiement unique quand l'acompte est désactivé. »
13. Revealing or hiding the acompte fields is **local UI state only**. Nothing is computed on the
    client: the values keep being sent as they are and the server decides what they are worth.

**Edge cases:**

- **A reservation with an unpaid acompte on a now-disabled property** → its stored split survives
  untouched until something recomputes it (an edit of the fiche, a tariff recompute). At that point
  the acompte collapses into the solde, `depositDueDate` becomes NULL and the fiche shows a single
  échéance. Two such reservations exist in prod at the time of writing. This is deliberate: no
  migration rewrites money that was already announced to a guest.
- **A reservation with a PAID acompte on a now-disabled property** → rule 4, nothing moves, ever.
- **`depositEnabled = 1` with `depositPercent = 0`** → deposit 0, everything in the solde, and the
  website falls back to `full`. Unchanged; the switch is not a second way to say « 0 % ».
- **A last-minute stay on an enabled property** → unchanged (the existing last-minute rule already
  collapses the acompte).
- **A property row read without the column** (a minimal test DB) → treated as **enabled**, so no
  suite that never heard of the flag changes behaviour. Real rows always carry it: the column is
  `NOT NULL DEFAULT 0`.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Idempotent rename: when `publicDepositEnabled` is present and `depositEnabled` is not, `ALTER TABLE properties RENAME COLUMN publicDepositEnabled TO depositEnabled`; when neither exists, `ADD COLUMN depositEnabled INTEGER NOT NULL DEFAULT 0` (fresh DB path). |
| `schema.sql` | `schema.sql` | T | Baseline column renamed in the `properties` definition (migrations-baseline convention). |
| `utils/pricing.js` | `pricing.js` | T | Reads `property.depositEnabled` and applies rules 5–6 — one new branch in each of the two deposit chains, placed after the paid branches. |
| `utils/publicPaymentMode.js` | `publicPaymentMode.js` | T | Same query, renamed column (rule 7). |
| `models/devisModel.js` | `devisModel.js` | T | `resolvePaymentSchedule` zeroes the legacy derivation when the property is disabled (rule 8); its narrow `SELECT` gains the column. |
| `models/propertiesModel.js` | `propertiesModel.js` | T | `create`/`update` read `body.depositEnabled` through the existing `toBit` coercion. |
| `controllers/` | — | — | (none — the property routes pass the body through) |
| `routes/` | — | — | (none) |
| `middleware/` | — | — | (none) |
| `scheduledTasks.js` | — | — | (none) |

No new dependency. No route signature changes.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `PropertyDetail.jsx` | T | `publicDepositEnabled` → `depositEnabled` in `NEW_DEFAULTS` and the load mapping; the « Acompte & Solde » card split into « Acompte » (switch first, fields revealed when ON) and « Paiement & Caution ». |
| `components/` | — | — | (none) |
| `hooks/` | — | — | (none) |
| `services/` / `api.js` | — | — | (none — the property form is posted as a generic `FormData` built from `form`) |
| `utils/` | — | — | (none) |
| `constants/` | — | — | (none) |
| `styles/` | — | — | (none) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar` (unchanged page bar), MUI `Card`/`Switch`/`TextField` as the neighbouring cards use them | The two cards are the page's existing `<Card><CardContent>` idiom — the same shape as « Horaires & Ménage » next to them. |
| **Created (new generic)** | — | None. A « card that reveals its body when a switch is on » is one occurrence; extracting it now would be guessing at a second. |
| **Specific (kept feature-local)** | — | None. |

### 4.3 API contract

No endpoint gains or loses a route. Two payload keys are renamed:

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/properties` | `depositEnabled` replaces `publicDepositEnabled` (multipart field, `'true'`/`'false'`) | property row | Coerced to a 0/1 bit by `toBit`. |
| PUT | `/api/properties/:id` | idem | property row | idem |
| GET | `/api/properties[/:id]` | — | `depositEnabled` replaces `publicDepositEnabled` | Client and server ship in one archive, so no consumer can lag (CLAUDE.md §5.6). |

`/public/v1/**` is untouched: the WordPress plugin reads `payment.mode`, never the column.

---

## 5. Data model

- **`properties.publicDepositEnabled` → `properties.depositEnabled`** (`INTEGER NOT NULL DEFAULT 0`).
  Idempotent block in `database.js` guarded on the current column list, mirrored in the `schema.sql`
  baseline. `ALTER TABLE … RENAME COLUMN` preserves every stored value.
- No backfill. Prod holds two properties, both at `0`, which under the new meaning reads « ces
  logements n'ont pas d'acompte » — which is what they actually do.
- No other table, column or index.

**Data impact:** no row is rewritten by the migration. The behavioural consequence is described in
§3 edge cases: reservations carrying an unpaid acompte on a disabled property lose it at their next
recompute, paid ones never.

## 6. UI / UX

### PropertyDetail — right column, top

**Avant / après** (captures réelles de la page du logement « Gite », 2026-09-21) :

![Avant : une tuile « Acompte & Solde » de six champs, le bouton en dernier. Après : une tuile « Acompte » réduite à son bouton, et une tuile « Paiement & Caution » qui garde le solde, l'annulation et la caution.](https://raw.githubusercontent.com/adn-dev-adrien/guestFlow/assets/screenshots/property-deposit-switch/avant-apres.png)

![Après, acompte activé : le bouton révèle « % acompte » et « Acompte (jours après réservation) ».](https://raw.githubusercontent.com/adn-dev-adrien/guestFlow/assets/screenshots/property-deposit-switch/acompte-active.png)

Le même découpage en texte :

```
ACOMPTE OFF                              ACOMPTE ON
┌─ Acompte ──────────────────────┐       ┌─ Acompte ──────────────────────┐
│ (○ ) Acompte                   │       │ ( ●) Acompte                   │
│ Le séjour est payé en une      │       │ Le séjour est payé en deux     │
│ fois, à la réservation.        │       │ fois : un acompte à la         │
└────────────────────────────────┘       │ réservation, le solde avant    │
┌─ Paiement & Caution ───────────┐       │ l'arrivée.                     │
│ Solde (jours avant)     [ 30 ] │       │ % acompte            [ 30 ]    │
│ Échéance du solde — ou du      │       │ Acompte (j. après résa) [ 7 ]  │
│ paiement unique quand          │       └────────────────────────────────┘
│ l'acompte est désactivé.       │       ┌─ Paiement & Caution ───────────┐
│ Annulation (j. après éch.) [7] │       │ … identique …                  │
│ Caution par défaut (€) [ 500 ] │       └────────────────────────────────┘
└────────────────────────────────┘
```

French copy:

| Where | String |
|---|---|
| Card 1 title | `Acompte` |
| Switch label | `Acompte` |
| Caption ON | `Le séjour est payé en deux fois : un acompte à la réservation, le solde avant l'arrivée.` |
| Caption OFF | `Le séjour est payé en une fois, à la réservation.` |
| Card 2 title | `Paiement & Caution` |
| Helper under `Solde (jours avant)` | `Échéance du solde — ou du paiement unique quand l'acompte est désactivé.` |

Other labels and helper texts are carried over unchanged (`% acompte`,
`Acompte (jours après réservation)`, `Solde (jours avant)`,
`Annulation (jours après échéance du solde)`, `Caution par défaut (€)`).

- **States:** no loading or error state of its own — the switch is a field of the page form, saved by
  the existing `PageActionBar` Save. Toggling it marks the form dirty like any other field.
- **Responsive:** both cards inherit the page's existing column flow — side by side from `md`,
  stacked on `xs`. The two acompte fields keep the `flexDirection: { xs: 'column', sm: 'row' }` of the
  row they come from; every field is full-width on `xs`. Touch targets unchanged (MUI `Switch`).
- **PageActionBar:** unchanged — the page already renders it with its Save / Cancel / delete actions.

## 7. Test plan

### Server unit tests
- [x] `tests/property-deposit-switch.unit.test.js` — rules 2, 4, 5, 6: direct reservation on a
      disabled property → `depositAmount = 0`, solde = pre-arrival, `depositDueDate` NULL; the same
      with `depositPaid = 1` → stored split preserved; enabled property → the 30 % split, unchanged;
      a `depositAmountOverride` on a disabled property → still 0 (rule 5 precedence); platform +
      `platformTakesDeposit = 1` on a disabled property → 0 (rule 6); a property row without the
      column → the 30 % split (edge case). Rules 2-3 are the two halves of the switch itself.
- [x] `tests/property-deposit-enabled-column.unit.test.js` — renamed from
      `property-public-deposit-toggle.unit.test.js`: `create`/`update` coerce `'true'` / `'false'` /
      `1` / absent to the right bit on `depositEnabled`.
- [x] `tests/public-payment-mode.unit.test.js` — rule 7: the mode resolver keeps its shape after the
      rename, same assertions.
- [x] `tests/devis-*` — the legacy derivation of rule 8 is covered by the last case of the engine test, which calls `resolvePaymentSchedule` directly.

### Client unit tests
- [x] `pages/__tests__/PropertyDetail.deposit-switch.test.jsx` — rules 9-13: the switch is the first
      control of the « Acompte » card; OFF hides `% acompte` and `Acompte (jours après réservation)`;
      ON reveals them; `Solde (jours avant)` (with its rule-12 helper), `Annulation` and `Caution par
      défaut` are present in both states; and a hidden acompte setting is still carried by the saved
      payload — the reveal is UI state, nothing more.

### Manual UI verification
- [x] Happy path: « Gite » with the switch OFF → the acompte card shows the switch and its caption
      alone; flip ON → the two fields appear; Save; reload → still ON with `% acompte` at 30.
- [x] Edge case: a 7-night direct quote on the disabled property → `acompte 0 €`, no
      `depositDueDate`, `solde 716,80 €` = the whole stay (tax included).
- [x] Regression: the same quote with the switch ON → `acompte 210 €` due 2026-09-28,
      `solde 506,80 €` due 2027-06-10 — the tourist tax still riding the solde.
- [x] Regression: an acompte already `depositPaid` on a disabled property keeps its split
      (covered by the engine test rather than by hand — it needs a paid reservation).
- [x] Mobile (`xs`, 390 px): both cards stack full-width, the two acompte fields go one per row,
      no horizontal scroll.
- [x] Playwright suite green (`npm run test:e2e`) — 68 passed, 1 skipped.
- [x] Migration replayed on a copy of the production database: column renamed, both properties keep
      their `0`, second boot is a no-op.

## 8. Out of scope

- **A per-reservation way to switch the acompte back ON** for a property that has it OFF. The
  opposite exists (`depositDisabled`); this spec does not add its mirror.
- **Renaming « solde » to « paiement »** across the fiche, the compta and the emails when a property
  has no acompte. The domain word stays `solde` everywhere; only a helper text explains it.
- **Migrating the existing reservations** that carry an unpaid acompte on a now-disabled property.
- **The website copy** (plugin summary, success page): already mode-aware since
  [public-online-deposit.md](public-online-deposit.md).
- **The « Relances » / balance-request cron**: untouched.

## 9. Open questions

- Q: Does the switch govern the whole acompte, or is it a purely visual collapse of the card?
  - A (2026-09-20, Adrien): **the whole acompte.** OFF means no acompte anywhere, admin fiches
    included — the screen must not say « acompte désactivé » while a devis still shows one.
- Q: « Caution par défaut » and « Annulation (jours après échéance du solde) » are not acompte
  settings. Do they disappear with the card?
  - A (2026-09-20, Adrien): **no** — they move out into their own card, always visible. Hiding a
    setting that still takes effect is a bug, not a simplification.
