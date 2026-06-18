# Arrival & departure SAS (guided check-in / check-out wizard)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/arrival-departure-sas` _(user-managed)_ |
| **Created** | 2026-06-12 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On the Planning, each arrival shows a `ReservationCard` and each departure a `DepartureMiniRow`. Today a
click navigates to the full reservation page. At check-in / check-out the operator has a mental checklist
(collect the caution, review options, check the bed linen, handle cleaning, collect the complement, return
the caution…). Nothing guides them through it, and the money to collect on arrival / departure is easy to
forget.

The operator wants a **SAS** ("airlock"): clicking a planning card opens a **sequence of single-purpose
popup pages**, each covering one thing to handle, with a **Quitter** button on every page to abort back to
the planning. Decisions are accumulated and **committed once at the final summary**.

## 2. Goal

From the Planning, the operator runs a guided **arrival SAS** (and a **departure SAS**) that walks through
every relevant step for that reservation, computes what's still to collect, and — on a single final
confirmation — records the caution status and the complement(s) on the reservation.

## 3. Functional rules

### 3.0 Launch & shell
1. **Launch from two explicit buttons on each planning tile** (decision 2026-06-13, superseding the
   "click the whole card" model): every arrival card / departure row carries an
   **« Ouvrir la réservation »** icon button (`ArticleIcon`, → reservation page) and a **SAS** icon
   button (`ChecklistIcon`, → arrival resp. departure SAS). The card body itself is **not** clickable.
   - **Placement (decision 2026-06-14):** the two buttons sit **top-right** on tablet/desktop (`sm+`);
     on **mobile** (`xs`) they move to a **dedicated row at the bottom of the card, right-aligned**, so
     the « Prêt » / « Effectué » chip no longer pushes them off-frame. Rendered once (a `useMediaQuery`
     branch, not a CSS `display` toggle) so there is no duplicate button in the DOM.
   - **A finished SAS stays re-openable**: when `arrivalSasDoneAt` (resp. `departureSasDoneAt`) is set,
     the SAS button shows a green ✓ (`CheckCircleIcon`) but **stays clickable** (tooltip « Revoir /
     modifier le check-in/check-out »); clicking re-opens the wizard pre-filled with the prior data
     (specs/reopen-completed-sas.md, 2026-06-15 — superseded the 2026-06-13 disabled-lock).
   - **The client name is a link** → opens the client fiche (`/clients?clientId=…`). Everything else on
     the tile is inert. The full reservation page also stays reachable via a discreet
     **« Ouvrir la fiche »** link in the SAS header once the SAS is open.
2. The SAS is a **stepper of pages** (MUI Dialog, `fullScreen` on mobile). Every page has **Quitter** (abort
   → back to planning, **nothing written**) and a forward action. Non-applicable pages are **skipped**.
   **Visual shell (refonte 2026-06-15, see §6):** a mode-coloured header band (arrivée = orange chaleureux,
   départ = ardoise) carrying the step icon + short title + a progress bar « Étape X/Y » + a ✕ that *is* the
   Quitter; a large centred step icon + large heading in the body; big, colour-coded action buttons pinned at
   the bottom; a « ‹ » **« Précédent »** arrow (from the 2nd page on) goes back one page. The **single commit
   at the recap is unchanged** — going back / forward writes nothing until « Valider et terminer ». (The
   former forward-only rule was relaxed to allow going back — specs/extinguisher-seal-and-repair-amounts.md
   §3.2 rule 7.)
3. **All writes happen once**, at the final **« Valider et terminer »** of the recap page (decision: write at
   final validation). Quitting before then changes nothing. (One server commit endpoint per SAS.)
4. State accumulated during the SAS (caution decision, selected missing linen elements, cleaning-added flag)
   lives in client memory until the commit.

### 3.1 Arrival SAS — pages (in order, each conditional)
5. **Récap séjour (intro, always).** Client, logement (+ plateforme), dates + heures d'arrivée/départ, nombre
   de personnes, bed config. Button **Commencer**.
5.bis **Code portail (only if a portal code is configured).** Shows the access/gate code to give to the
   client (global setting `portalCode`, §3.5). Informational. Button **Suivant**.
6. **Caution (only if `cautionAmount > 0` AND not `cautionReceived`).** Shows the caution amount. Buttons:
   - **Fait** → marks the caution to be validated on commit (`cautionReceived=1`, `cautionReceivedDate=today`).
   - **Reporté** → defer; this page is **re-shown right before the recap** (rule 11).
7. **Options réservées (only if the reservation has ≥ 1 option/resource).** Read-only list of the options +
   resources selected for the stay (title + qty). Button **Suivant**.
8. **Linge de lit (only if the reservation has a bed-linen alert, reusing the planning card flag
   `bedLinenAlert`).** Two sub-cases:
   - **capacity mismatch** → *« Vérifier les draps avec le client (le linge prévu ne couvre pas le nombre de
     personnes). »* Buttons **OK** (→ next page) / **Pas OK** (→ rule 9).
   - **no linen taken** → *« Le client n'a pas pris le linge de lit. »* Same **OK / Pas OK**.
   - Never shown for linen-by-default properties (the flag is already null there).
9. **Éléments de linge manquants (only when rule 8 = « Pas OK »).** Lists the operator-defined priced
   **bed-linen** elements (`category='bed'`: taie d'oreiller, housse de couette, sur-matelas, drap-housse, …)
   from **Réglages → Blanchisserie** (§3.4). The operator ticks the missing elements and sets a **quantity**
   per element. Each selected line `(label, qty × price)` is **accumulated into the arrival complement**
   (committed at the recap). Button **Suivant**.
10. **Ménage.**
    - **Cleaning included** (reservation has the cleaning option `autoOptionType='cleaning'`, or it's a
      property default) → *« Le ménage est inclus. Rappeler : la vaisselle doit être faite et rangée, les
      poubelles vidées. »* Button **Suivant**.
    - **Cleaning not included** → *« Le ménage n'a pas été pris. Tarif ménage pour ce logement : X €. »*
      Buttons **Ajouter le ménage** (→ accumulates the cleaning charge into the arrival complement + adds the
      cleaning option to the reservation) / **Non merci** (→ next).
11. **Caution reportée (only if rule 6 = « Reporté »).** Re-shows the caution page once more before the recap.
12. **Récapitulatif (always).** Shows the **arrival complement to collect** = **existing `complementAmount`**
    (before the SAS) **+** the items added during the SAS (linen elements + cleaning), **with the full detail
    line by line**. Also shows the caution status (Fait / non traité). Buttons **Valider et terminer**
    (commit) / **Quitter**.

### 3.2 Departure SAS — pages (in order, each conditional)
13. **Récap séjour (intro, always).** Client, logement, dates, heure de départ. Button **Commencer**.
14. **Ménage de fin de séjour (always).** *« Le ménage de fin de séjour a-t-il été fait correctement ? »*
    Buttons **OK** / **Pas OK**. **Pas OK** → the **end-of-stay complement** gets the property's cleaning
    price added (§3.3).
14.bis **Serviettes / draps manquants (always).** *« Des serviettes ou des draps sont-ils manquants ? »*
    Buttons **Non** (→ next) / **Oui** (→ rule 14.ter).
14.ter **Éléments manquants (only when 14.bis = « Oui »).** Lists **all** priced Blanchisserie items (bed +
    towel categories) with a **quantity** picker; `Σ (qty × price)` is **added to the end-of-stay
    complement** (§3.3). Button **Suivant**.
15. **Réception des clés (always).** *« Avez-vous récupéré les clés ? »* Buttons **Oui** / **Non** (a
    checklist gate — no DB write; **Non** just leaves a visible reminder on the recap). Button **Suivant**.
16. **Caution à rendre (only if `cautionAmount > 0` AND `cautionReceived` AND not `cautionReturned`).**
    *« Rendre la caution de X €. »* Buttons **Rendue** (→ `cautionReturned=1`, `cautionReturnedDate=today` on
    commit) / **Dégât / litige** (→ not returned, left for manual handling — decision: no retained amount).
17. **Récapitulatif fin de séjour (only if the end-of-stay complement ≠ 0, else a short closing page).**
    Shows the **end-of-stay complement** with its detail (cleaning + missing linen/towels), the caution
    status, and the keys reminder if « Non ». **Valider et terminer** (commit) / **Quitter**.

### 3.3 Complements
17. **Arrival complement** = the reservation's existing `complementAmount` **plus** the SAS-added items
    (linen elements + cleaning). On commit, the added items are written as `reservation_custom_options` with
    `inComplement=1` and the reservation is re-priced (the engine recomputes `complementAmount`), so the
    detail is durable + visible on the reservation and in the J-1 email breakdown.
18. **End-of-stay complement** is a **separate, dedicated amount** (decision 2026-06-12), stored on the
    reservation (`endOfStayComplementAmount` + paid flag + detail). It does **not** touch the arrival
    `complementAmount`. The departure SAS sets it = **cleaning price** (ménage « Pas OK ») **+** the
    **missing linen/towels** selected at rule 14.ter.
19. Both complements round to 2 decimals and never go negative.
19.bis **Recap detail with quantities + prices (2026-06-18).** When there is a complement to settle, the
    recap lists **each line** — the pre-existing in-complément extras (options / resources / custom, with
    their quantity + unit price), the SAS-added items, and the end-of-stay lines — formatted
    « libellé : qté × prix unitaire = total » (just « libellé : total » when qty ≤ 1), instead of a lump
    « Déjà dû ». Applies to both the arrival and the departure recap. Display-only (totals unchanged).

### 3.4 Priced linen items (Réglages → Blanchisserie)
20. The **« Stock blanchisserie »** settings page + menu entry is **renamed « Blanchisserie »** (route
    unchanged). It gains **two editable, reorderable tables** of priced items `{ label, price }`, stored in
    one `linen_priced_items` table with a `category` column:
    - **Éléments de linge de lit** (`category='bed'`): taie d'oreiller, housse de couette, sur-matelas,
      drap-housse, … — used by the **arrival** linen page (rule 9).
    - **Serviettes** (`category='towel'`): the operator adds the towel variants they want (serviette de bain,
      de toilette, drap de plage, …) with a price each.
    Both categories are listed at the **departure** missing-items page (rule 14.ter). Add / edit / remove /
    reorder per table. Persisted server-side.

### 3.5 Portal / access code
21. A **single global `portalCode`** (the domain's gate code) is configured in **Réglages** (general
    settings). The arrival SAS rule 5.bis shows it; empty → that page is skipped. (Decision 2026-06-12:
    global, per the operator's « dans les settings » — see §9 if it should later become per-property.)

**Edge cases:**
- Caution already received → no caution page on arrival; caution-return page on departure only if received.
- Reservation with no options, linen fine, cleaning included → arrival SAS = intro + (caution?) + ménage
  (included) + recap (complement = pre-existing only).
- `complementPaid=1` on arrival: adding items still records them; the recap warns the arrival complement was
  already marked paid (so the operator knows to collect the delta manually). (Open question §9.)
- Quitter at any point → no DB change (state was in memory only).
- A property with no cleaning option / no price configured → the « ajouter le ménage » action is disabled
  with a hint to set the price in the options.

---

## 4. Architecture

> **Fat backend, thin frontend.** The SAS *page applicability*, the *cleaning price for the property*, the
> *bed-linen alert*, the *priced linen elements*, and the *complement recompute* are all resolved
> server-side. The client renders the stepper and holds in-memory selections until the single commit call.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` | `database.js` | T | Migrations: `linen_priced_items` table; `reservations.endOfStayComplementAmount` / `endOfStayComplementPaid` / `endOfStayComplementPaidDate` / `endOfStayComplementDetail` (idempotent ADD COLUMN). |
| `models/` | `models/linenItemsModel.js` | C | CRUD for `linen_priced_items` (list / replace-all). |
| `models/` | `models/reservationsModel.js` | T | Reuse `getByIdWithDetails`; add `commitArrivalSas` / `commitDepartureSas` (caution flags, insert custom options inComplement + re-price for arrival; set end-of-stay complement for departure). |
| `controllers/` | `controllers/reservationsController.js` (or new `sasController.js`) | C/T | `getSasData(id, mode)` assembles the SAS payload (applicable pages + data: caution, options list, bedLinenAlert, cleaning included? + property cleaning price, existing complement, linen elements). `commitArrivalSas` / `commitDepartureSas`. |
| `utils/` | `utils/bedLinenAdequacy.js` | REUSE | Same `bedLinenAlert` already used by the planning card. |
| `utils/` | `utils/pricing.js` | REUSE | Re-price on arrival commit so `complementAmount` reflects the added inComplement items. |
| `controllers/` | `controllers/settingsController.js` + `models/settingsModel.js` | T | Add `portalCode` to the settings columns; wire the linen-items CRUD (dedicated route) for the Blanchisserie page. |
| `routes/` | `routes/reservations.js`, `routes/settings.js` (or `linenItems.js`) | T | `GET /reservations/:id/sas?mode=arrival|departure`, `POST /reservations/:id/sas/arrival`, `POST /reservations/:id/sas/departure`; `GET/PUT /settings/linen-items`. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `components/` | `components/sas/ReservationSasDialog.js` | C | The stepper shell (Dialog, Quitter, « Ouvrir la fiche », progress); drives the page sequence from the server payload. Mode `arrival` / `departure`. |
| `components/` | `components/sas/*Page.js` | C | One small component per page: `SasIntroPage`, `SasCautionPage`, `SasOptionsPage`, `SasLinenPage`, `SasLinenItemsPage`, `SasCleaningPage`, `SasRecapPage` (+ departure `SasDepartureCleaningPage`, `SasCautionReturnPage`, `SasDepartureRecapPage`). Kept feature-local under `components/sas/`. |
| `pages/` | `pages/PlanningPage.js` | T | Card/row click opens the SAS dialog (arrival vs departure) instead of navigating; refresh the planning row after commit. |
| `components/` | `ReservationCard.js`, `DepartureMiniRow.js` | T | `onOpen` now opens the SAS (handler swap in the parent). |
| `pages/` | `pages/LinenStockPage.js` | T | Renamed « Blanchisserie »; add the two priced-items editors (bed elements + towels), add/remove/reorder. |
| `pages/` | `pages/SettingsPage.js` | T | Add a **Code portail** field (general settings). |
| `App.js` | `App.js` | T | Menu label « Stock blanchisserie » → « Blanchisserie ». |
| `api.js` | `api.js` | T | `getReservationSas`, `commitArrivalSas`, `commitDepartureSas`, `getLinenItems`, `updateLinenItems`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FormDialog` patterns, MUI `Dialog`/`Stepper`/`Chip`, `ConfirmDialog` | Reused. |
| **Created (new generic-ish)** | `ReservationSasDialog` + per-page components under `components/sas/` | Feature-local; the dialog shell could later be generalised but is kept specific for now. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/sas?mode=arrival\|departure` | — | `{ mode, reservation:{…}, pages:[…], portalCode, caution:{amount,received,returned}, options:[…], bedLinenAlert, cleaning:{included, price}, existingComplement, endOfStayComplement, linenItems:[{id,label,price,category}] }` | Server decides which pages apply + supplies their data. |
| POST | `/api/reservations/:id/sas/arrival` | `{ cautionReceived:bool, complementItems:[{label, amount}] }` | `{ ok, complementAmount }` | Single commit: caution + custom options inComplement + re-price. |
| POST | `/api/reservations/:id/sas/departure` | `{ cautionReturned:bool, endOfStayComplementAmount, endOfStayComplementDetail }` | `{ ok }` | Single commit: caution-return + end-of-stay complement. |
| GET | `/api/settings/linen-items` | — | `[{ id, label, price, category, sortOrder }]` | Priced items (bed + towel). |
| PUT | `/api/settings/linen-items` | `[{ label, price, category }]` | `[…]` | Replace-all (both categories). |

---

## 5. Data model

- **New table `linen_priced_items`** (idempotent):
  ```sql
  CREATE TABLE IF NOT EXISTS linen_priced_items (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    label     TEXT NOT NULL,
    price     REAL NOT NULL DEFAULT 0,
    category  TEXT NOT NULL DEFAULT 'bed',   -- 'bed' | 'towel'
    sortOrder INTEGER NOT NULL DEFAULT 0
  );
  ```
- **`app_settings.portalCode TEXT DEFAULT ''`** — the domain gate code (idempotent ADD COLUMN), edited on
  the general Réglages page.
- **`reservations` new columns** (idempotent ADD COLUMN, default 0/null): `endOfStayComplementAmount REAL
  NOT NULL DEFAULT 0`, `endOfStayComplementPaid INTEGER NOT NULL DEFAULT 0`, `endOfStayComplementPaidDate
  TEXT`, `endOfStayComplementDetail TEXT` (JSON/text breakdown for display).
- **`reservations` SAS-done markers** (idempotent ADD COLUMN, default null): `arrivalSasDoneAt TEXT`,
  `departureSasDoneAt TEXT` — set / refreshed to `datetime('now')` by the respective commit; drive the
  green-✓ state of the planning SAS buttons. The button stays clickable so a finished SAS can be
  re-opened + re-edited (specs/reopen-completed-sas.md; superseded the 2026-06-13 disabled-lock).
- Arrival complement items reuse `reservation_custom_options` (`inComplement=1`, plus `sasArrivalOrigin=1`
  since 2026-06-15 so a re-opened SAS can REPLACE them without double-charging — specs/reopen-completed-sas.md).

**Data impact:** purely additive. Existing reservations get `endOfStayComplementAmount = 0`. No recompute of
existing reservations needed.

## 6. UI / UX

- **Guided coloured shell (refonte 2026-06-15 — direction « bandeau coloré + guidé », mobile-first).**
  - **Header band**, full-width, **mode-coloured**: arrivée = orange chaleureux (orange/`warning` tones),
    départ = ardoise (blue-grey), white text. Shows the **current step icon** + a short **step title**
    (e.g. « MÉNAGE »), the **client + logement** on a second line, a **✕** on the right that **is the
    Quitter** (closes, writes nothing), and a thin **progress bar + « Étape X/Y »** (index in `activeKeys`).
    A discreet **« Ouvrir la fiche »** action stays in the band.
  - **Body**: a **large centred step icon** (~56–64 px), a **large heading** (`h5`, the step's question /
    title), supporting text at `body1` (bigger than before), then the step's interactive content
    (steppers / fields / chips) with generous spacing and padding (`p: { xs: 2, sm: 3 }`).
  - **Intro page (mobile redesign 2026-06-15)**: leads with the **property photo** (same image as Réglages
    → logement, served via `reservation.propertyPhoto`), then the **property name centred**, the **client
    name centred, in blue, larger, wrapping onto 2 lines** if it doesn't fit, the **platform badge styled
    exactly like the planning** (outlined box, `getPlatformColor` border + text, `formatPlatformLabel`),
    then **arrival + departure rows in the planning format** (coloured ARRIVÉE / DÉPART chip + date + time
    pill, left-aligned) and a **people icon + count**. The big centred step icon is suppressed on the intro
    (the photo leads).
  - **Footer — yes/no answer colour code (2026-06-15)**: each yes/no page renders its two buttons via the
    shared `AnswerButtons` — the **reassuring** answer is **white-on-blue** and sits **on top** (mobile
    `column-reverse` → last child on top), the **problem** answer is **black-on-red** below. Mapping by
    *meaning*, not literal Oui/Non: linge **OK** / serviettes-draps **Non** / clés **Oui** / extincteur
    **Oui** (plomb présent) / retour caution **Rendue** / caution **Fait** = blue; their counterparts
    (Pas OK / Oui / Non / Non / Dégât-litige / Reporté) = red. Navigation buttons (Commencer / Suivant /
    Valider et terminer) stay primary blue. The arrival **« ménage »** upsell (Non merci / Ajouter le
    ménage) is **not** a yes/no safety question → kept **neutral** (Ajouter = primary blue, Non merci
    discreet). Buttons full-width + stacked on `xs`, side-by-side on `sm+`, touch targets ≥ 48 px;
    « Valider et terminer » keeps its commit spinner.
  - **Extincteur** is now a yes/no page (**Oui** = plomb présent = blue / **Non** = manquant = red),
    replacing the former in-body Switch; clicking advances immediately. At departure the body keeps a static
    hint that an absent seal adds the configured amount to the end-of-stay (the charge lands in the recap).
  - **iOS PWA wake fix (2026-06-15)**: the dialog sets `disableEnforceFocus` / `disableRestoreFocus`. On an
    installed iOS PWA the page is frozen on screen-lock / app-switch; on resume MUI's focus trap could keep
    stealing focus and leave the answer buttons unresponsive — relaxing the trap restores interactivity.
  - **Mobile unresponsive-buttons fix (2026-06-18)**: the same focus trap still occasionally grabbed focus
    on open / re-render on mobile Safari, so « Suivant » / answer taps did nothing then a burst registered
    and skipped steps (random per step, sometimes blocking at « Commencer »). Adding `disableAutoFocus`
    (the trio `disableAutoFocus` + `disableEnforceFocus` + `disableRestoreFocus`) fully relinquishes MUI's
    focus management so taps stay reliable. The wizard needs no auto-focus.
  - **Per-step icons** (MUI): intro = MeetingRoom (arrivée) / Logout (départ) ; portail = Dialpad ;
    caution / report = Savings ; options = RoomService ; petit-déj = FreeBreakfast ; linge / linenItems =
    KingBed ; ménage = CleaningServices ; serviettes manquantes = DryCleaning ; clés = VpnKey ; retour
    caution = Savings ; récap = FactCheck. The breakfast drink steppers keep their café / thé / chocolat icons.
- **Responsive**: `fullScreen` on `xs`; one action per row, full-width buttons on mobile; comfortable
  centered dialog on `md+`. Touch targets ≥ 44px.
- **Money**: amounts shown via the French currency format; the recap lists each line (label + amount) then
  the total to collect, distinguishing **« déjà dû »** (pre-existing complement) from **« ajouté »** (SAS).
- **Blanchisserie page**: existing stock fields kept; a new « Tarifs des éléments de linge » table below,
  with add-row / edit / delete / drag-reorder, saved with the page.
- **States**: loading while fetching the SAS payload; error → retry; empty linen-items list → the « Pas OK »
  path shows a hint to configure prices in Blanchisserie.

## 7. Test plan

### Server unit tests (`tests/sas-commit.unit.test.js`, +8)
- [x] `linenItemsModel`: replace-all drops empty labels, re-numbers per category, list ordered.
- [x] `getCleaningPriceForProperty`: per-property override wins over base; null when no cleaning option.
- [x] `commitArrivalSas`: caution received set; linen + cleaning items inserted as custom options
      `inComplement=1`; `complementAmount` = previous + added; frozen when `complementPaid`; zero/blank
      items ignored.
- [x] `commitDepartureSas`: caution returned set on « Rendue », untouched on « litige »; end-of-stay
      complement amount + detail stored.
- [x] Full server suite 1481 green; migrations verified on a DB copy.

### Client IHM tests (vitest, `components/sas/__tests__/ReservationSasDialog.test.js`, +3)
- [x] Arrival full flow: caution « Fait », linen « Pas OK » **reveals** the priced-items page (regression
      for the async-navigation bug), cleaning added → recap total → `commitArrivalSas` called with the
      exact `{ cautionReceived, complementItems }` payload.
- [x] Arrival linen « OK » **skips** the priced-items page.
- [x] Departure: cleaning page shows « ménage fait correctement ? OK/Pas OK » (regression — it used to
      render the arrival UI), missing/keys flow, recap, `commitDepartureSas` payload.
- [x] **Refonte 2026-06-15** (direction « bandeau coloré + guidé ») is **visual-only**: the 7 vitest cases
      above stay green unchanged (same step strings, button labels and commit payloads); client build green.
      The footer « Quitter » moved into the band ✕; the redundant in-body « Petit déjeuner » heading was
      dropped (the band title carries it) so `findByText('Petit déjeuner')` still resolves to one node.
- [x] **Mobile refinements 2026-06-15** (intro redesign + yes/no colour code + extinguisher Oui/Non + iOS
      wake fix): a new vitest case asserts the intro renders the property photo + centred client name +
      ARRIVÉE/DÉPART chips + people count; the extinguisher walkthroughs now click **Oui** (présent) /
      **Non** (manquant) instead of a Switch + Suivant, and the departure-seal billing test answers
      **Non** (the charge surfaces in the recap, not the body). 10 vitest cases green; full client suite
      green; server suite green (the `getByIdWithDetails` photo field is additive).

### Planning-tile launch tests (vitest, `ReservationCard.test.js` + `DepartureMiniRow.test.js`)
- [x] « Ouvrir la réservation » button → `onOpenReservation(id)`; SAS button → `onOpenSas(id)`.
- [x] SAS button shows a green ✓ when `arrivalSasDoneAt` / `departureSasDoneAt` is set but **stays
      clickable** to re-open + re-edit the SAS (specs/reopen-completed-sas.md; was a disabled no-op
      until 2026-06-15).
- [x] Client name link → `onOpenClient(clientId)`; toggling the ready/done checkbox fires no open handler;
      with all handlers omitted the tile is read-only (no action buttons, plain-text client name).

### E2E (Playwright smoke)
- [x] `auth/sidebar-navigation.spec.js` + `linen/stock-roundtrip.spec.js` updated for the « Stock
      blanchisserie » → « Blanchisserie » heading rename (they asserted the old title — caused the smoke
      failure).

### Manual UI verification (done live in the browser 2026-06-12)
- [x] Arrival + departure SAS run end-to-end; commits verified in the DB (then reverted). Two bugs found
      and fixed during this pass (async navigation skip + departure cleaning UI).
- [ ] Arrival SAS happy path (caution unpaid + linen mismatch + cleaning not included): each page appears,
      recap totals = existing + added, commit writes caution + custom options, planning refreshes.
- [ ] « Reporté » caution re-appears before the recap.
- [ ] Quitter mid-SAS writes nothing.
- [ ] Departure SAS: ménage « Pas OK » adds the cleaning price to the end-of-stay complement; caution
      « Rendue » marks returned.
- [ ] Blanchisserie: add/edit linen element prices; they appear in the arrival linen-items page.
- [ ] Mobile (`xs`): full-screen stepper, buttons stacked.

## 8. Out of scope

- Payment capture / online payment of the complements (the SAS records what's due; collection is manual).
- Editing arbitrary reservation fields from the SAS (only caution + complement items).
- A retained-amount workflow on caution damage (decision: « Rendue / litige » only).
- History/audit of SAS runs beyond the resulting reservation writes.

## 9. Open questions

Resolved during scoping (2026-06-12):
- **Arrival complement already `complementPaid=1`** → record the delta + warn (do not unfreeze/re-collect).
- **Cleaning "included"** = reservation cleaning option **OR** property-default cleaning (both count).
- **Departure extras** → only **keys received** (rule 15) + **missing serviettes/draps** (rules 14.bis/ter);
  no other extras.
- **Portal code** → a **single global** `portalCode` in Réglages (per « dans les settings »). If the gîtes
  ever need distinct gate codes, move it to a per-property field (small change) — flag if so.
