# Departure recap computed by the server

| Field | Value |
|---|---|
| **Status** | Draft |
| **Branch** | `docs/sas-departure-recap-server` |
| **Created** | 2026-10-24 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

[sas-arrival-total-server-side.md](sas-arrival-total-server-side.md) (PR #759) moved every amount of
the **arrival** SAS recap to the server: one planner, `reservationsModel.planArrivalSas`, shared by a
preview endpoint and the commit; the dialog sends intentions and renders the answer. Its §8 left the
**departure** recap out, « same method, separate spec ». This is that spec.

The check-out recap (`client/src/plugins/sas/ReservationSasDialog.jsx`, mode `departure`, plugin
`sas`) shows the end-of-stay complement, recalls an arrival complement never collected, lets the
operator offer any line, and decides whether a settlement is asked. All of it is computed **in
React** today:

| Client value | Where (`ReservationSasDialog.jsx`) | What it does | Consumed by |
|---|---|---|---|
| `realOfStoredLine` | `:65-68` | real price of a stored line; falls back to `qty × unitPrice` for an offered row without `originalAmount` | carried, preserved and recalled lines |
| re-edit seed | `:528-568` | rebuilds the missing-item quantities from the stored detail, `qty \|\| round(amount / price)` (`:552`), and the offered keys | `missingDep`, `extinguisherQty`, `preservedDeparture`, `offered` |
| `billed` | `:717` | nets a line to 0 € when its key is offered | every line below |
| `depMissingLines` | `:811-820` | prices each missing towel / sheet as `item.price × qty` (`:815`) | recap, **commit body** |
| `depCleaningLine` | `:822-826` | copies `data.cleaning.price` into a « Ménage de fin de séjour » line | recap, **commit body** |
| `extinguisherLines` | `:834-843` | prices each extinguisher tariff as `price × qty` | recap, step subtotal `:1514` |
| `carriedEndOfStayLines` | `:851-869` | every stored line tagged `source` (deferred bath linen, mid-stay sales, **and the « Ajustement » line**) | recap, **commit body** (re-sent verbatim, amount included) |
| `preservedDepartureLines` | `:872-874` | stored lines whose label maps to no priced item | recap, **commit body** |
| **`endOfStayTotal`** | `:877` | sum of the four kinds above | `departureGrandTotal` |
| `arrivalRecall` | `:881-885` | « recall the arrival complement » = amount > 0 and unpaid — the same test the model makes again at `reservationsModel.js:3338-3339` | which lines show, whether `offeredArrivalExtras` is sent |
| `arrivalRecallLines` | `:889-897` | the recalled lines, offered netting | recap |
| **`recalledArrivalAmount`** | `:898-902` | `max(0, amount − Σ newly offered + Σ un-offered)` — the client twin of `planOfferedComplementExtras` (`reservationsModel.js:588`) | « Sous-total arrivée » `:1745`, grand total |
| `midStayAlreadySettled` | `:905-910` | sum of the mid-stay notes already collected | « Déjà réglé en séjour » |
| **`departureGrandTotal`** | `:911` | `endOfStayTotal + recalledArrivalAmount` | « Total à percevoir » `:1748-1757`, « Rien à percevoir » `:1707`, the settlement buttons `:1759` |
| `toDetailLine` | `:968-976` | serialises each line **with `amount: l.real`** | commit body `:1031-1056` |

The commit then trusts most of those amounts. `controller.commitDeparture`
(`server/src/plugins/sas/controller.js:535`) passes `endOfStayComplementDetail` through, and
`reservationsModel.commitDepartureSas` (`server/src/models/reservationsModel.js:3321`) stores each
line's `amount` as sent (`offerLine`, `:3374-3381`), re-prices **only** the extinguisher charges
(`:3388-3405`), then re-sums through `writeEndOfStayDetail` (`:540`).

### 1.1 What the code reading found

1. **Three of four departure line kinds are stored at the browser's price.** The missing linen
   (`price × qty`, client), the end-of-stay cleaning (`data.cleaning.price` loaded with the dialog) and
   the carried / preserved lines (re-sent with their `amount`) are written verbatim. Only the
   extinguisher lines are priced by the server (specs/extinguisher-seal-and-repair-amounts.md §3.2). A
   price changed in « Facturables » between the dialog load and « Valider » is not seen; a crafted body
   can store any amount.
2. **The operator's end-of-stay adjustment is shown as an offerable line, then ignored.** The
   « Ajustement » line (`{ source: 'adjustment' }`, `server/src/utils/endOfStayAdjustment.js`) matches
   the `source` filter of `carriedEndOfStayLines`, so the recap lists it, counts it and offers an
   « Offrir » toggle on it. The commit drops it (`writeEndOfStayDetail` filters adjustment lines,
   `reservationsModel.js:546`) and recomputes it so the stored total stays the announced amount. When
   the run adds a line, the recap shows `announced + added` while the books keep `announced`; offering
   the adjustment raises the displayed total and changes nothing stored. Same shape as finding 3 of the
   arrival spec. (Read from the code; to confirm on a fixture — §9 Q4.)
3. **The recalled arrival amount ignores the arrival adjustment.** `applyOfferedComplementExtras`
   (`reservationsModel.js:669`) re-applies `complementAmountOverride` after an « Offrir » at check-out
   (`reapplyComplementOverride`, `:410`); the client subtracts the offered line from the stored amount.
   With an adjusted arrival complement, offering a recalled line moves the displayed total, not the
   stored one.
4. **Two implementations of « is the arrival recalled? ».** The dialog (`:881-885`) and the model
   (`:3338-3339`) decide it separately; the dialog's answer also decides whether the offered set is
   authoritative (rule 6.ter of sas-offer-complement-lines.md). They agree today by construction only.
5. **No plugin bills at check-out.** The `sas.departure.steps` slot exists (`:350`) and has no
   contributor in the repository; the departure commit never calls `sasCommitHooks`. Nothing priced by
   a plugin is involved — which keeps the SDK impact additive (§3.5).

The owner's rule ([CLAUDE.md](../CLAUDE.md) §6.0, restated 2026-10-23): **the front only displays
money, it never computes it**, so that a figure is the same wherever it is read.

## 2. Goal

The check-out recap shows its lines, its totals and whether a settlement is asked **as the server
computes them**, live while the operator offers a line or counts a missing towel — with the very code
the commit runs, so that what the operator collects at the door is what the books record.

---

## 3. Functional rules

### 3.1 One planner, two callers

1. **A single core function plans the departure commit.** `reservationsModel.planDepartureSas(reservationId,
   input)` reads the reservation and returns the plan: every recap line, the end-of-stay complement
   and the recalled arrival complement before and after this run, and the amounts of §4.3. It **never
   writes**. Its pure arithmetic lives in `utils/departureSasPlan.js` (`departureLines`,
   `endOfStayAfter`, `recalledArrivalAfter`, `isRecalled`), which reuses `reconcileEndOfStayLines` and
   the `round2` / `totalDiffered` of `utils/arrivalSasPlan.js` instead of copying them.
2. **The commit executes the plan, it does not recompute it.** `commitDepartureSas` calls
   `planDepartureSas` at the start of its transaction and writes what the plan says: the offered flags
   of the recalled lines (`planOfferedComplementExtras` → writes), the end-of-stay detail, and the
   settlement. The pricing and netting of `reservationsModel.js:3338-3410` move into the planner; the
   commit keeps only the writes. Preview and commit therefore cannot diverge.
3. **The preview endpoint runs the same planner on a draft.**
   `POST /api/reservations/:id/sas/departure/preview` takes **the same body as the commit** (the
   settlement fields are ignored) and answers the departure recap (§4.3). It writes nothing: no row, no
   history, no `departureSasDoneAt`, no `checkOutDone`.
4. **The draft is the commit body.** The dialog builds one `draft` object (`departureDraft.js`) from
   its state and sends it to both the preview and the commit.
5. **The commit never trusts the preview.** No amount, no line, no `recalled` flag from a preview
   response is ever sent back; the commit re-plans from the draft and the database as they are then.

### 3.2 What becomes intent

6. **Missing linen is sent as intent and priced by the server.** `missingItems: [{ itemId, qty,
   offered }]` replaces the priced lines; `reservationsModel.resolveSasDepartureItems` prices each from
   `linen_priced_items` (`price × qty`, rounded to the cent). An unknown `itemId` or a non-positive
   `qty` is dropped. All categories count (bed and bath), as today at check-out.
7. **The end-of-stay cleaning is a yes/no.** `cleaningCharged: boolean` (the « Pas OK » answer) and
   `cleaningOffered: boolean` replace the line. The server prices it with
   `getCleaningPriceForProperty`, and never bills it when the cleaning is sold
   (`isCleaningSoldForReservation`, rule 3 of defer-arrival-complement-to-checkout.md, unchanged).
8. **Extinguisher charges stay as they are** (`extinguisherCharges: [{ repairKey, qty, offered }]`,
   already intent); their pricing moves from the commit body into the planner.
9. **Stored lines are referenced, never re-sent.** Every line already in `endOfStayComplementDetail`
   that this run does not rebuild — a carried line (`source` set: deferred bath linen, mid-stay sale)
   or a preserved one (label mapping to no priced item) — is **kept by the server** from the stored
   detail. The draft only carries its offered decision: `storedLines: [{ key, offered }]`. The `key` is
   issued by the server (§4.3: `stored:<index>:<fingerprint>`, the fingerprint hashing label, amount,
   `source` and `key` of the stored line). A key that no longer matches the stored line is ignored —
   the line is billed at its real price — and rule 22 reports the difference. A stored line absent
   from `storedLines` is kept as stored.
10. **The adjustment line is never a recap line.** The « Ajustement » line of the stored detail is
    filtered out of the plan's lines and re-computed by `reconcileEndOfStayLines` exactly as the commit
    does today; the recap announces it as `adjusted` (rule 24). Finding 2 of §1.1 closes.
11. **The recalled arrival lines keep their offered set.** `offeredArrivalExtras: [{ kind, id }]` is
    unchanged. Whether the set is authoritative is decided by the planner's `isRecalled`, never by the
    dialog: the dialog sends the set whenever it has one, the server ignores it when the arrival is not
    recalled (rule 6.ter of sas-offer-complement-lines.md). Finding 4 closes.
12. **The re-edit seed comes from the server.** `GET /api/reservations/:id/sas?mode=departure` serves
    `departureSeed: { missingItems: { [itemId]: qty }, cleaningCharged, extinguisherQty: { [repairKey]:
    qty }, offeredKeys: [...] }`, built from the stored detail by the same reader as the planner. The
    dialog seeds its state from it and no longer divides an amount by a price (`:552`).

### 3.3 The dialog

13. **The recap renders the preview, nothing else.** Every amount on the check-out recap — each line,
    « Sous-total arrivée », « Total à percevoir » / « Total fin de séjour », « Déjà réglé en séjour » —
    is a field of the latest preview response. The client keeps no `round2`, no `reduce` over money,
    no `× price`, no `realOfStoredLine`.
14. **What the recap shows is the server's call too.** Whether the arrival lines are recalled, and
    whether they merge into the list or sit under « Compléments d'arrivée non perçus » (`recall.framing`
    = `merged` | `alone`), whether « Rien à percevoir » shows (`nothingToCollect`, now evaluated on the
    planned total), whether a settlement is asked (`settleable`) and whether the money is already in
    (`endOfStayPaid`) are fields of the preview.
15. **The extinguisher page renders the preview.** « Sous-total : 30,00 € » under the extinguisher
    tariffs reads `extinguisherTotal`; « — » until the server answered. The quantities stay local UI
    state. The missing-items page shows the unit price only (a served value), no subtotal, as today.
16. **When a preview is requested.** On entering the recap and the extinguisher page: immediately. On
    every later change of the draft: after **200 ms** without a further change. « Offrir » is a change
    like the others.
17. **Latest wins.** Each request carries a sequence number; a response that is not the latest is
    discarded and the previous request aborted (`AbortController`) — the same hook as the arrival,
    generalised (§4.2).
18. **The toggle answers at once, the money follows.** « Offrir » flips to « ✓ Offert » on press. The
    amounts keep their last server value, dimmed, with a thin progress bar under the total, until the
    preview answers. No client estimate is ever shown in between.
19. **« Valider et terminer » waits for a fresh preview.** Disabled while the latest draft has no answer
    or the last answer was an error, labelled « Calcul du total… » while pending — the arrival's
    `waiting` (`:1909`) now applies to both modes.
20. **A failed preview is said, not hidden.** On a network error or a 5xx the total area shows
    « Total indisponible : pas de réponse du serveur. » with « Réessayer »; lines keep their label, their
    amounts become « — »; the settlement buttons and « Valider » are disabled. The settlement buttons
    stay enabled while a preview is only pending: choosing a mode moves no money.
21. **Reception role.** The preview is open to the reception role, like the departure read and commit
    (door money). It serves no revenue figure; the same view guard as `toReceptionReservationView`.

### 3.4 The commit answers with what it stored

22. **The total the operator saw is compared at commit, never enforced.** The commit body carries
    `displayedDepartureTotal` (the `grandTotal` of the preview shown). The commit always goes through on
    its own plan. When the two differ by a cent or more, the response carries `warning: { code:
    'DEPARTURE_TOTAL_DIFFERED', displayed, stored }` and the dialog, instead of closing, shows the stored
    total with the difference before « Fermer ». `stored` is the end-of-stay amount plus the recalled
    arrival amount as written.
23. **The difference is kept in the audit trail.** The `sas_departure` history entry of that commit
    gets one more change, field `departureRecapTotal`, labelled « Total du récapitulatif de départ »,
    from « affiché 80,00 € » to « enregistré 85,00 € ». No entry when the totals match.
24. **The recap shows what the commit will store when a total is adjusted.** With an
    `endOfStayComplementAmountOverride`, `endOfStayTotal` is the announced amount and the response
    carries `adjusted.endOfStay: { amount, engineAmount }`; with a `complementAmountOverride` on a
    recalled arrival, `recall.total` is what `reapplyComplementOverride` leaves and
    `adjusted.arrival` says so. The recap adds a muted line under the total: « Montant ajusté sur la
    fiche (calcul : 93,00 €) ». Findings 2 and 3 close.
25. **The commit response is the recap.** `{ ok, recap: DepartureRecap, warning }`; the dialog reads no
    amount from anywhere else after a commit.

### 3.5 SDK and plugins

26. **SDK 2.1.0, additive.** `planDepartureSas` and `resolveSasDepartureItems` join the
    `reservationsModel` list of `server/src/plugins/sdk/coreModules.json`, and `departureSasPlan` joins
    the core modules of `server/src/plugins/sdk/index.js` (the `sas` plugin's `departureRecap.js` reads
    it as `arrivalRecap.js` reads `arrivalSasPlan`). Adding entry points is a MINOR bump
    (`plugins/sdk/version.js`): `2.0.0` → `2.1.0`. No plugin range moves (`^2.0.0` accepts 2.1.0); only
    `sas` is bumped (minor, with a French changelog line), as `check-plugin-versions.mjs` requires.
27. **No departure money contract for plugin steps.** `sas.departure.steps` keeps `recapNotes` (text)
    only. Billing at check-out through a `sasCommit` hook is out of scope (§8); a step that wants it
    later gets it the arrival way, server-side.

**Edge cases:**
- End-of-stay complement already paid (single payment at check-in, or a prior check-out) →
  `endOfStayPaid: { date, cash }`, label « Total fin de séjour », no « à percevoir » (rule 9bis of
  recall-unpaid-arrival-complement-at-checkout.md); the settlement buttons reopen on the stored mode.
- Re-opened departure SAS with an unchanged draft → the planned total equals the stored one (80,00 €
  stays 80,00 €, never 160,00 €): the run's own lines are rebuilt, the others kept (rule 9).
- Cleaning sold after an end-of-stay ménage was billed → the planner drops the stored ménage line, the
  recap shows it gone before « Valider » (today it disappears only after the commit).
- Mid-stay sync rewrote the detail between load and commit → stale `storedLines` keys ignored, the
  line billed, rule 22 warns.
- Preview answers after the dialog closed → ignored (the sequence guard resets on close).
- Offline at the door → rule 20; the commit would fail the same way.

---

## 4. Architecture

> **Fat backend, thin frontend.** This spec moves the last money arithmetic of the SAS out of
> `client/`. What stays client-side is UI state (the draft) and plumbing (debounce, sequence guard).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `reservationsModel.js` | T | New `planDepartureSas(id, input)` (pure read: lines, before/after, totals, recall, adjusted) and `resolveSasDepartureItems(id, { missingItems, cleaningCharged, cleaningOffered, extinguisherCharges, storedLines })` (intent → priced lines); `buildDepartureSeed(id)` (rule 12); `commitDepartureSas` executes the plan instead of pricing. |
| `utils/` | `departureSasPlan.js` | C | Pure arithmetic: stored-line keys and fingerprints, offered netting, end-of-stay total through `reconcileEndOfStayLines`, recalled amount with the arrival override, `isRecalled`. |
| `utils/` | `arrivalSasPlan.js` | T | None in behaviour; `round2` / `totalDiffered` imported by the new module. |
| `plugins/sas/` | `controller.js` | T | New `previewDeparture`; shared `normaliseDepartureDraft(req)` (extinguisher setting, reception guard) used by preview and commit; `displayedDepartureTotal` → `warning` + history line (rules 22-23); `getSas` serves `departureSeed`. |
| `plugins/sas/` | `departureRecap.js` | C | Shapes a plan into the `DepartureRecap` payload (pure). |
| `plugins/sas/` | `index.js` | T | Route `POST /api/reservations/:id/sas/departure/preview` + reception allowlist entry. |
| `plugins/sas/` | `manifest.json` | T | Minor bump + French changelog line. |
| `plugins/sdk/` | `version.js`, `index.js`, `coreModules.json` | T | `2.1.0`; expose `departureSasPlan`, `planDepartureSas`, `resolveSasDepartureItems` (rule 26). |
| `database.js` | — | — | (none) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | Remove `realOfStoredLine`, `billed`, `depMissingLines`, `depCleaningLine`, `extinguisherLines` pricing, `carriedEndOfStayLines`, `preservedDepartureLines`, `endOfStayTotal`, `arrivalRecall`, `arrivalRecallLines`, `recalledArrivalAmount`, `midStayAlreadySettled`, `departureGrandTotal`, `toDetailLine`, the departure branch of the re-edit seed; render the preview; reuse `RecapPreviewError` and the commit-warning panel for both modes. |
| `plugins/sas/` | `useSasRecapPreview.js` | C (rename of `useArrivalRecapPreview.js`) | Same hook, the request function passed in (`api.previewArrivalSas` / `api.previewDepartureSas`) — §4.2 of the arrival spec foresaw it. |
| `plugins/sas/` | `departureDraft.js` | C | Pure builder: dialog state → departure draft (intent only, no amount). |
| `api.js` | `api.js` | T | `previewDepartureSas(id, draft, { signal })` with `readOnly: true`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `OfferableLine`, `StatusBadge`, `ErrorAlert`, `PaymentModeButtons` (local), `RecapPreviewError` (local) | Unchanged visuals. |
| **Created (new generic)** | — | |
| **Specific (kept feature-local)** | `useSasRecapPreview`, `departureDraft` | SAS-only plumbing; one hook for both recaps instead of two. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/reservations/:id/sas?mode=departure` | — | as today + `departureSeed` | rule 12 |
| POST | `/api/reservations/:id/sas/departure/preview` | the departure commit body | `DepartureRecap` | admin + reception; writes nothing; 404 / 403 `SAS_LOCKED` as the commit |
| POST | `/api/reservations/:id/sas/departure` | same body + settlement + `displayedDepartureTotal` | `{ ok, recap: DepartureRecap, warning: null \| { code: 'DEPARTURE_TOTAL_DIFFERED', displayed, stored } }` | always commits on its own plan (rules 22-23) |

**Draft / commit body** (changes in bold):

```jsonc
{
  "cautionReturned": true,
  "cleaningCharged": true, "cleaningOffered": false,              // replaces the ménage line
  "missingItems": [{ "itemId": 4, "qty": 2, "offered": false }],   // replaces the priced linen lines
  "storedLines": [{ "key": "stored:0:9f3a1c2e", "offered": true }],// replaces carried + preserved lines
  "extinguisherSealOkAtDeparture": 0,
  "extinguisherCharges": [{ "repairKey": "extinguisher_seal", "qty": 1, "offered": false }],
  "offeredArrivalExtras": [{ "kind": "custom", "id": 41 }],
  // settlement — ignored by the preview
  "complementsSettled": true, "complementsPaidCash": false,
  "displayedDepartureTotal": 92.50                                  // commit only — compared, never used
}
```

`endOfStayComplementDetail` disappears from the body (client and server ship in one archive — no shim).

**`DepartureRecap`:**

```jsonc
{
  "lines": [
    { "key": "depCleaning", "group": "endOfStay", "label": "Ménage de fin de séjour", "qty": 1, "unitPrice": 80.00,
      "real": 80.00, "billed": 80.00, "offerable": true, "offered": false },
    { "key": "dep:4", "group": "endOfStay", "label": "Serviette", "qty": 2, "unitPrice": 6.50,
      "real": 13.00, "billed": 13.00, "offerable": true, "offered": false },
    { "key": "stored:0:9f3a1c2e", "group": "stored", "label": "Linge de toilette", "qty": 1, "unitPrice": 24.00,
      "real": 24.00, "billed": 0, "offerable": true, "offered": true },
    { "key": "ext:extinguisher_seal", "group": "extinguisher", "label": "Plomb d'extincteur", "qty": 1, "unitPrice": 30.00,
      "real": 30.00, "billed": 30.00, "offerable": true, "offered": false },
    { "key": null, "group": "recalled", "label": "Taxe de séjour", "qty": 1, "unitPrice": 4.80,
      "real": 4.80, "billed": 4.80, "offerable": false, "offered": false },
    { "key": "custom:41", "group": "recalled", "label": "Lit bébé", "qty": 1, "unitPrice": 7.70,
      "real": 7.70, "billed": 7.70, "offerable": true, "offered": false }
  ],
  "endOfStayTotal": 123.00,           // what the commit stores in endOfStayComplementAmount
  "extinguisherTotal": 30.00,         // the extinguisher page subtotal (rule 15)
  "recall": { "shown": true, "framing": "merged", "total": 12.50 },   // null when nothing is recalled
  "grandTotal": 135.50,               // endOfStayTotal + recall.total
  "settleable": true,                 // grandTotal > 0
  "nothingToCollect": false,          // stored buckets clear AND grandTotal <= 0
  "endOfStayPaid": null,              // { "date": "2027-07-14", "cash": false } when already collected
  "midStaySettled": 0,                // « Déjà réglé en séjour » — informative, never in grandTotal
  "adjusted": null                    // { "endOfStay": { "amount": 50.00, "engineAmount": 93.00 }, "arrival": null }
}
```

`key` is what the toggle sends back (`depCleaning`, `dep:<itemId>`, `ext:<repairKey>`,
`stored:<i>:<fingerprint>`, `option:<id>` / `resource:<id>` / `custom:<id>` / `extraGuests:0` for the
recalled lines). Amounts are euros rounded to the cent by the server.

---

## 5. Data model

No schema change. The stored detail keeps exactly its current shape (labels, `qty`, `unitPrice`,
`amount`, `offered`, `originalAmount`, `source`, `key`, `repairKey`); the planner reproduces today's
arithmetic and the parity tests (§7) prove it on the existing fixtures before the commit uses it.

**Data impact:** none on existing rows. A re-run re-prices missing linen and the cleaning from the
current « Facturables » / property price instead of the price the dialog had loaded — the same value
unless the price changed in between, which is the point (finding 1).

## 6. UI / UX

The recap looks the same, minus the « Ajustement » line (now a muted note under the total). What
changes is where its figures come from, and four states shared with the arrival recap:

- **Pending** — amounts keep their last value at 55 % opacity, a 2 px indeterminate bar (« Calcul du
  total ») runs under the total, « Valider et terminer » reads « Calcul du total… » and is disabled. The
  toggled line flips at once.
- **Error** — « Total indisponible : pas de réponse du serveur. » + « Réessayer » on the soft error
  background; line amounts « — »; settlement buttons and « Valider » disabled. Before any answer, the
  same panel replaces the list.
- **Total differed at commit** — the check-out is recorded; the dialog stays open on « Enregistré à
  85,00 € — le récap affichait 80,00 €. » / « L'écart est noté dans l'historique de la fiche. » and one
  « Fermer ».
- **Adjusted** — « Montant ajusté sur la fiche (calcul : 93,00 €) » under the total.

Copy is short and impersonal: no « vous », nothing about the internal mechanics.

**Responsive** (to check at 375, 900 and 1280 px):
- `xs` (full-screen dialog, operator at the door with a phone): the recap scrolls, « Valider » stays in
  the thumb footer, the pending bar is attached to the total; « Offrir », « Réessayer » and the
  settlement buttons are 44 px targets. A slow 4G answer (≈ 1 s) never moves the layout: amounts are
  `tabular-nums`, « — » holds the same width.
- `md` / `lg`: unchanged layout; the same states.

**Page action bar:** not applicable — the SAS is a dialog.

## 7. Test plan

Figures reuse the existing departure fixtures (`ReservationSasDialog.departure.test.jsx`,
`offered-lines`, `upsells`) plus fictional towel and extinguisher prices.

### Server unit tests

- [ ] `server/src/tests/sas-departure-plan.unit.test.js` (rules 1, 2, 6-12, 24) — pure arithmetic and the
  plan on a migrated in-memory database:
  - ménage « Pas OK » at 80,00 → `endOfStayTotal` 80,00; offered → 0,00, real kept;
  - cleaning sold → `cleaningCharged: true` bills nothing; a stored ménage line is dropped;
  - towel 6,50 × 2 → 13,00 priced from « Facturables »; unknown item and qty 0 dropped; price changed
    to 7,00 after load → 14,00;
  - extinguisher seal 30,00 × 1 → 30,00 and `extinguisherTotal` 30,00; offered → 0,00;
  - carried bath linen 24,00 kept without being sent; offered by its key → 0,00; a stale key → billed
    24,00;
  - recall: tax 4,80 + lit bébé 7,70 → `recall.total` 12,50, merged with 80,00 → `grandTotal` 92,50;
    lit bébé offered → 84,80; tax not offerable; recall alone → `framing: 'alone'`;
  - paid arrival complement → `recall` null, the offered set ignored; arrival worth 0 € → set ignored;
  - end-of-stay override 50,00 with lines 80,00 + 13,00 → `endOfStayTotal` 50,00, `adjusted.endOfStay`
    `{ 50, 93 }`, no « Ajustement » line in `lines` (Q4);
  - arrival override 10,00 on a 12,50 recall, lit bébé offered → `recall.total` 10,00 (finding 3);
  - mid-stay notes 33,33 settled → `midStaySettled` 33,33, `grandTotal` unchanged;
  - re-run with an unchanged draft → the stored total, not doubled; `departureSeed` rebuilds
    `{ 4: 2 }`, the cleaning and the offered keys.
- [ ] `server/src/plugins/sas/tests/sas-departure-preview.unit.test.js` (rules 3, 5, 21-23, 25 — the real
  controller): preview answers and writes nothing (`departureSasDoneAt`, `checkOutDone`, history all
  untouched); commit = preview (92,50); displayed 80,00 vs stored 85,00 → committed, warned, history
  « affiché 80,00 € » → « enregistré 85,00 € »; no line when equal; reception reaches the preview; locked
  SAS → 403; unknown stay → 404.
- [ ] `server/src/tests/plugins-sdk-core-modules-contract.unit.test.js` updated (rule 26): the three new names listed,
  `SDK_VERSION` 2.1.0 accepted by `^2.0.0`.
- [ ] Existing, green unchanged on behaviour, fixtures moved to the intent body:
  `sas-commit.unit.test.js` (37 departure commits), `sas-offer-complement-lines.unit.test.js` (14),
  `departure-sas-keeps-the-payment.unit.test.js` (7), `platform-extra-guest-complement.unit.test.js` (1),
  `plugins/sas/tests/reception-sas-lock.unit.test.js` (4), `end-of-stay-adjustment.unit.test.js`.

### Client tests (Vitest)

Every departure suite mocks `api.previewDepartureSas` with `departurePreviewLikeTheServer(api)` (added
to `__tests__/sasPreviewFake.js`). The assertions stay (« Total à percevoir : 92,50 € ») and prove the
component renders the field; after a gesture a money assertion awaits the answer (`findByText`).

| File | Tests touching the departure | Migration |
|---|---|---|
| `ReservationSasDialog.departure.test.jsx` | 6 | commit body: `cleaningCharged`, `missingItems`, `displayedDepartureTotal`; totals awaited |
| `ReservationSasDialog.offered-lines.test.jsx` | 3 | totals awaited after « Offrir »; `storedLines[].offered`; the 0 € arrival case asserts the set is sent and ignored server-side |
| `ReservationSasDialog.upsells.test.jsx` | 2 departure cases | the carried bath linen comes from the preview, is not re-sent |
| `ReservationSasDialog.thumb-footer.test.jsx` | « Rien à percevoir » cases | `nothingToCollect` read from the preview |
| `ReservationSasDialog.recap-payment.test.jsx`, `extinguisher-off.test.jsx`, `phase-2.test.jsx`, `access-and-mode.test.jsx` | 1 each or more | the preview mock only |

New: `ReservationSasDialog.departure-preview.test.jsx` (rules 13-20, 22) — the draft carries no amount;
three quick « + » on a towel → one request; a slow answer overtaken is ignored; « Calcul du total… »
disabled while pending; « Total indisponible » + « Réessayer »; the warning after a commit on another
total. And `departureDraft.test.js` (rules 4, 6-9, 11). `useArrivalRecapPreview` tests follow the rename.

### E2E

`npm run test:e2e` — the departure SAS scenarios unchanged in what they assert.

### Manual UI verification (fictional stay, 375 / 900 / 1280 px)

- [ ] Happy path: ménage « Pas OK » 80,00 + 2 serviettes 13,00 → « Total à percevoir : 93,00 € »;
  « Offrir » on the ménage → 13,00 €; back to 93,00 €.
- [ ] Slow server (1,2 s injected): amounts dimmed, bar under the total, « Calcul du total… ».
- [ ] Offline: « Total indisponible », amounts « — », « Valider » disabled; « Réessayer » restores.
- [ ] Price changed elsewhere before « Valider » (serviette 6,50 → 7,00): recorded at 94,00 €, warning,
  history line.
- [ ] Adjusted end-of-stay (50 €): no « Ajustement » line, the muted note under the total.
- [ ] Regression: arrival recap unchanged (shared hook), its suites and E2E green.

## 8. Out of scope

- Billing at check-out by a plugin (`sasCommit` hook on the departure): no plugin needs it (§1.1
  finding 5).
- Showing the stay still owed at check-out (a direct stay deferred at check-in): today it only hides
  « Rien à percevoir »; §9 Q2.
- The arrival re-edit seed (`:519-528` still divides an amount by a price): same fix, arrival side,
  if Q5 says so.
- Any change to what is billed or how it is booked: the planner reproduces the commit's arithmetic.

## 9. Open questions

- **Q1 — Identity of a stored end-of-stay line.** The detail is JSON without row ids. Proposed default
  (rule 9): `stored:<index>:<fingerprint>`, a stale key ignored and reported by rule 22. Alternative:
  give every stored line a stable `lineId` at write time (no column, but every detail writer changes).
- **Q2 — The stay still owed at check-out.** `nothingToCollect` at departure counts a direct stay's
  unpaid acompte / solde (`plugins/sas/nothingToCollect.js`), yet the check-out recap has no stay block:
  with nothing billed the recap shows no total and no badge — the money still owed is not named. Add a read-only
  « Séjour encore dû » line in this spec, or leave it to a separate one?
- **Q3 — « Déjà réglé en séjour » for the reception role.** `midStaySettledNotes` is not in the
  reception reservation view (`utils/receptionView.js:22`), so a reception user never sees that line
  today. Serve `midStaySettled` to reception (it is door money already collected), or keep it admin-only?
- **Q4 — The « Ajustement » line on the recap (finding 2).** Read from the code only, no copy of
  production at hand: confirm on a fixture that an end-of-stay adjusted to 50 € keeps 50 € after a
  check-out adding 13 €, before choosing the default of rule 24 (announced amount + computed one beside
  it).
- **Q5 — Arrival seed symmetry.** Move the arrival re-edit seed to the server in the same PR (one more
  reader, same pattern), or keep this PR departure-only?
- **Q6 — Preview on the extinguisher page.** Rule 16 previews on the recap and on the extinguisher page
  (its subtotal). Alternative: drop that subtotal and preview on the recap only — one request fewer per
  check-out.
