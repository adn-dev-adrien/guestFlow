# Arrival complement total computed by the server

| Field | Value |
|---|---|
| **Status** | Draft |
| **Branch** | `feature/sas-arrival-total-server-side` _(user-managed)_ |
| **Created** | 2026-10-23 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

The arrival SAS recap (`client/src/plugins/sas/ReservationSasDialog.jsx`, plugin `sas`) shows the
arrival complement the guest owes and decides whether the operator settles it **in one gesture**
together with the stay ([single-payment-at-check-in.md](single-payment-at-check-in.md) §3.1). Both
answers are computed **in React** today, from figures the client partly owns and partly rebuilds:

| Client value | Where | What it does |
|---|---|---|
| `bedLines` | `ReservationSasDialog.jsx:692-701` | prices each missing linen element as `item.price × qty` |
| `cleaningLine`, `bathLinenLine` | `:702-715` | copies the server's price, nets it to 0 € when offered |
| `soldOptionLines` | `:753-760` | prices each prestation sold at check-in as `unitPrice × units` |
| `arrivalAdded` | `:761-762` | sum of the four kinds above |
| `sasOriginSum` | `:769-771` | rebuilds, from `r.options`, what a prior run of this SAS already put in `complementAmount` |
| `preservedArrivalSum` | `:772-775` | re-edit lines whose label no longer maps to a priced item |
| `pluginRecapLines`, `pluginRecapSum` | `:777-780` | asks every plugin step for its `recapLines` and sums them with `storedPluginLines` |
| `complementDetailLines` | `:787-829` | itemises the stored complement (options, resources, custom, extra guests, tourist tax) |
| `preExistingOfferDelta` | `:833-836` | what this run's « Offrir » toggles take out of / give back to the stored complement |
| **`arrivalComplementTotal`** | `:841-844` | `max(0, complementAmount − sasOriginSum − preExistingOfferDelta) + arrivalAdded + preservedArrivalSum + pluginRecapSum` |
| **`unifiableNow`** | `:845-848` | `arrival && complementOpen && stayPayment.applicable && arrivalComplementTotal > 0` |
| « Total à percevoir à l'arrivée » | `:1683-1687` | `stayDue + total` |
| sale-step subtotals | `:1376`, `:1425`, `:1446-1457`, `:1531` | « 4 petits déjeuners — 32,00 € », « Total restauration : 67,00 € » |

`unifiableNow` is then **sent back** to the server as the split decision —
`arrivalPaymentSplit: splitSettlement || !unifiableNow` (`:1068`) — and the server obeys it
(`server/src/plugins/sas/controller.js:365-386`). So a client-side sum decides which settlement path
the commit takes.

The server already owns most of the arithmetic, in a different place:

- `reservationsModel.commitArrivalSas` (`server/src/models/reservationsModel.js:2728`) applies the
  offered set (`applyOfferedComplementExtras`, `:2829`), re-prices the sold options
  (`resolveSasOptionSales`, `:2228`), resolves the cleaning / bath-linen catalogue options
  (`getSasUpsellOptions`, `applyUpsell` `:2911-2938`), replaces the SAS-origin lines and moves
  `complementAmount` by `next = max(0, complementAmount − priorSum + added)` (`:2940`), then hands
  the amount back to an operator adjustment if there is one (`reapplyComplementOverride`, `:409`).
- The plugin lines are billed by the `sasCommit` hooks (`server/src/utils/sasCommitHooks.js`,
  `prepare`), whose `complementItems(reservation, payload)` is the server-side twin of the client
  `recapLines`.
- The itemised stored complement already exists server-side:
  `buildArrivalComplementDetail(id, { includeOffered: true })` (`reservationsModel.js:2290`), served
  to the **departure** SAS as `arrivalComplement`.

### 1.1 What the code reading found

1. **Two implementations of the same total.** The client formula and the model's delta arithmetic
   compute the same number by different routes. Every SAS spec since August added a term to both
   (`sasOriginSum` for catalogue upsells, `preExistingOfferDelta` for « Offrir », the extra guests,
   the tourist tax, plugin lines). Nothing ties them together except the client tests' hard-coded
   totals.
2. **The linen elements are not re-priced at commit.** `complementItems` carries `{ label, amount }`
   built by the client (`:1048-1051`), and the model stores `amount` verbatim (`:2824`, `:2903`). The
   « the server re-prices every line at commit » sentence of
   [single-payment-at-check-in.md](single-payment-at-check-in.md) §3.1 rule 1 is true for the
   catalogue options and the plugin lines, **not** for the linen elements nor for the preserved
   re-edit lines.
3. **An operator adjustment silently wins over the recap.** When the fiche carries a
   `complementAmountOverride` ([adjustable-complement-amounts.md](adjustable-complement-amounts.md)
   rule 4), the commit writes the SAS lines then resets `complementAmount` to the override. The
   recap, which knows nothing about the override, announces `override + added`: the operator may
   collect an amount the books will not show. (To confirm on a copy of production — §9 Q3.)
4. **The plugin money is computed twice.** `hourly-resources` keeps a `supplements` map in its step
   value only so that its client `recapLines` can show what the server will bill
   (`client/src/plugins/hourly-resources/sasStep.js:27-31`); the same figure is recomputed by its
   `complementItems` hook (`server/src/plugins/hourly-resources/sasStep.js:41-47`).

The owner's rule ([CLAUDE.md](../CLAUDE.md) §6.0, restated 2026-10-23): **the front only displays
money, it never computes it**, so that a figure is the same wherever it is read.

## 2. Goal

The arrival recap shows the lines, the total and the « one gesture or two » decision **as the server
computes them**, live while the operator toggles « Offrir » or changes what is sold — with the very
code the commit runs, so that what the operator is told to collect is what the books record.

---

## 3. Functional rules

### 3.1 One planner, two callers

1. **A single core function plans the arrival commit.** `reservationsModel.planArrivalSas(reservationId,
   draft, { pluginItems })` reads the reservation and returns the plan: every recap line, the stored
   complement before and after this run, and the amounts below (§4.3). It **never writes**.
2. **The commit executes the plan, it does not recompute it.** `commitArrivalSas` calls
   `planArrivalSas` inside its transaction and writes what the plan says: the SAS-origin rows to
   replace, the sold options, the upsells, and `complementAmount = plan.complementAfter`. The
   arithmetic of `reservationsModel.js:2824-2943` moves into the planner; the commit keeps only the
   writes. Preview and commit therefore cannot diverge — there is only one computation.
3. **The preview endpoint runs the same planner on a draft.**
   `POST /api/reservations/:id/sas/arrival/preview` takes **the same body as the commit** (minus
   nothing — the settlement fields are simply ignored) and answers the recap (§4.3). It writes
   nothing: no row, no history, no plugin `write`, no `arrivalSasDoneAt`.
4. **The draft is the commit body.** The dialog builds one `draft` object from its state and sends it
   to both the preview and the commit. There is no second serialisation that could drift.
5. **The commit never trusts the preview.** No amount, no `unifiable`, no line from a preview response
   is ever sent back. The commit re-plans from the draft and the database as they are at that moment.

### 3.2 What becomes intent

6. **Linen elements are sent as intent and priced by the server.** `complementItems` (`{ label,
   amount, offered }`) is replaced by `linenItems: [{ itemId, qty, offered }]`; the planner prices
   each from `linenItemsModel` (`price × qty`, rounded to the cent). An unknown `itemId` or a
   non-positive `qty` is dropped. Finding 2 of §1.1 closes.
7. **Preserved re-edit lines are referenced, not re-sent.** A stored SAS-origin custom line whose label
   no longer maps to a priced item is kept by `customOptionId`: `keptLines: [{ customOptionId,
   offered }]`. The planner reads its stored amount; the client never sends one. A line absent from
   `keptLines` is dropped, as today.
8. **The split decision moves to the server.** The dialog sends `arrivalPaymentSplit` = the operator's
   « Régler séparément » choice only. The server unifies when `!arrivalPaymentSplit && plan.unifiable`;
   when the plan is not unifiable it applies the two separate settlements whatever the dialog sent.
9. **`unifiable` is the server's composition of rule 1 of single-payment-at-check-in.md**: arrival
   mode, `complementOpen`, `stayPayment.applicable`, and `plan.arrivalComplementTotal > 0`. Same three
   terms as today, now evaluated on the planned total.

### 3.3 The plugin steps

10. **A plugin's recap lines come from its `sasCommit` hook.** The preview calls
    `sasCommitHooks.prepare({ reservation, pluginSteps: draft.pluginSteps })` exactly like the commit;
    `prepare` returns the items and the stored lines of a plugin that is off (rule 8 of
    plugins-phase-3c-hourly-resources.md). Its `writes` are discarded by the preview.
11. **`complementItems` must be pure.** The hook is now called on every preview, i.e. many times per
    check-in: it may read, never write, and must return the same items for the same reservation and
    payload. `validate` likewise.
12. **A refusal is answered by the preview too.** When a hook's `validate` refuses the draft (e.g. the
    `SLOT_CONFLICT` of the hourly-resources step), the preview answers the same status and body as the
    commit would. The recap shows it before « Valider », instead of after.
13. **The client `recapLines` contract is removed, with no deprecation window** (decided 2026-10-23).
    The dialog no longer reads it; the lines a plugin bills are those of the preview. A step that still
    declares it is a step built against SDK 1.x. `recapNotes` (not money — e.g. « 1,5 h non
    planifiée ») stays a client contract.
14. **SDK 2.0.0.** Removing an entry point of the client SDK is a MAJOR bump
    (`server/src/plugins/sdk/version.js` header; plugins-phase-4-registry.md rule 3): `SDK_VERSION`
    goes from `1.7.0` to `2.0.0`. The SDK changelog says: « `sas.arrival.steps[].recapLines` is
    removed — bill through `ctx.sasCommit().complementItems`, now also called by the arrival preview
    and required to be pure ». `hourly-resources` drops its `recapLines` and the `supplements` map of
    its step value.
14bis. **A 2.0.0 host refuses every plugin declaring `^1.x`** (plugins-phase-4-registry.md rule 12: the
    SDK must satisfy the manifest's `sdk` range). Every in-repo plugin therefore moves its range to
    `^2.0.0` **in the same release**, with a version bump and a changelog line (rule 28 of the same
    spec). The fourteen manifests and their current range:

    | Plugin | `sdk` today |
    |---|---|
    | `accounting-export`, `sas`, `school-holidays` | `^1.0.0` |
    | `hourly-resources` | `^1.1.0` |
    | `gate-access`, `gites-de-france-intake`, `linen`, `tariff-recipes` | `^1.4.0` |
    | `google-calendar`, `neat`, `weather-alerts` | `^1.5.0` |
    | `booking-intake`, `online-payment` | `^1.6.0` |
    | `website-booking` | `^1.7.0` |

    Release steps, in this order, inside the single feature PR then the release:
    1. bump `SDK_VERSION` to `2.0.0` and remove `recapLines` from the client contract;
    2. move all fourteen `sdk` ranges to `^2.0.0`, bump each plugin's version (major for
       `hourly-resources`, whose step contract changes; minor for the others, whose code does not
       move) and add a French changelog line (« Compatible avec GuestFlow et son SDK 2. »);
    3. `node scripts/check-plugin-versions.mjs` must pass on the PR (it already checks the bump and the
       changelog lines);
    4. the release publishes the core and the fourteen packages together (`release.yml`), so an
       instance updating to it gets plugins it can load;
    5. **plugins installed from outside this repository** (built against `^1.x`) are refused by the new
       host until their author republishes them against `^2.0.0`; the release notes' operator digest
       says so in one line. No such plugin is known today — to check against the registry before the
       release.

### 3.4 The dialog

15. **The recap renders the preview, nothing else.** Every amount on the recap — each line, « Total »,
    « Total complément », « Total à percevoir à l'arrivée », the « encaisser le supplément » warning —
    is a field of the latest preview response. The client keeps no `round2`, no `reduce` over money,
    no `× price`.
16. **The sale steps render the preview too.** « 4 petits déjeuners — 32,00 € » and « Total
    restauration : 67,00 € » read the `sales` block of the preview (§4.3). The counts the operator
    types (mornings, covers, units) stay local UI state.
17. **When a preview is requested.** On entering the recap, and on entering the two sale steps:
    immediately. On every later change of the draft: after **200 ms** without a further change
    (one stepper tap-tap-tap is one request). « Offrir » is a change like the others.
18. **Latest wins.** Each request carries a client sequence number; a response whose number is not the
    latest is discarded, and the previous in-flight request is aborted (`AbortController`). Same
    pattern as `pricingQuoteRequestRef` in `client/src/pages/ReservationPage.jsx:1332-1334`.
19. **The toggle answers at once, the money follows.** « Offrir » flips to « ✓ Offert » on press (it is
    the operator's decision, local state). The amounts of the recap keep their last server value,
    dimmed, with a thin progress bar under the total, until the preview answers. No client estimate is
    ever shown in between.
20. **« Valider et terminer » waits for a fresh preview.** It is disabled while the latest draft has no
    answer yet or the last answer was an error. A fresh preview typically lands within one round trip;
    the button never commits against a total the operator has not seen.
21. **A failed preview is said, not hidden.** On a network error or a 5xx, the total area shows
    « Total indisponible » with « Réessayer »; lines show their label without amount; the settlement
    buttons and « Valider » are disabled. On a 409 refusal (rule 12) the recap shows the refusal's own
    message and a « Revenir à l'étape » link to the step that caused it.
22. **The total the operator saw is compared at commit, never enforced** (decided 2026-10-23). The
    commit body carries `displayedArrivalTotal` (the `arrivalComplementTotal` of the preview shown).
    The commit always goes through on its own plan. When the two differ by a cent or more, the
    response carries `warning: { code: 'ARRIVAL_TOTAL_DIFFERED', displayed, stored }` and the dialog,
    instead of closing, shows the stored total with the difference before « Fermer ». It is a
    comparison, never an amount: rule 5 holds.
22bis. **The difference is kept in the audit trail.** The `sas_arrival` history entry of that commit
    (`recordSasHistory`, `server/src/plugins/sas/controller.js:108`) records « Total affiché au récap :
    85,00 € — total enregistré : 90,00 € », so a later question about what the guest was told has an
    answer on the fiche's « Historique des modifications ». No entry is added when the totals match.
23. **Reception role.** The preview is open to the reception role (door money, like `GET .../sas`):
    `stayDue` is 0, `unifiable` is false, and no revenue field is served — the same guards as
    `buildStayPayment` / `buildArrivalPayment`.

### 3.5 The adjusted complement

24. **The recap shows what the commit will store.** When `complementAmountOverride` is set and the
    complement is open, `arrivalComplementTotal` is what `reapplyComplementOverride` will leave, and
    the response carries `adjusted: { amount, engineAmount }`. The recap adds under the total:
    « Montant ajusté sur la fiche (calcul : 85,00 €) ». The exact behaviour is subject to §9 Q3.

**Edge cases:**
- Complement already paid (`complementPaid = 1`) and a prestation sold now → the planner routes the sale
  to the end-of-stay complement, as the commit does (`reservationsModel.js:2944-2975`);
  `arrivalComplementTotal` is the frozen amount and `supplementOutsideComplement` carries the sale, which
  feeds the existing « ⚠ Le complément était déjà marqué payé » warning.
- Re-opened SAS → the SAS-origin lines of the prior run are planned as replaced, never added: a re-run with
  an unchanged draft previews the stored total (85,00 € stays 85,00 €, not 170,00 €).
- Plugin off since the last run → its stored line comes back from `prepare` (rule 10), unofferable.
- Preview arrives after the dialog was closed → ignored (the sequence guard is reset on close).
- Offline at the door → rule 21; the commit would fail the same way, so nothing is lost but time.

---

## 4. Architecture

> **Fat backend, thin frontend.** This spec exists to move the last money arithmetic of the arrival
> SAS out of `client/`. What stays client-side is UI state (the draft) and plumbing (debounce,
> sequence guard).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `reservationsModel.js` | T | New `planArrivalSas(id, draft, { pluginItems })` (pure read: lines, before/after, totals, sales, adjusted); `commitArrivalSas` executes the plan instead of recomputing; linen priced from `linenItemsModel`; `keptLines` read by `customOptionId`. |
| `utils/` | `arrivalSasPlan.js` | C | Pure arithmetic of the plan (delta, offered netting, override, rounding) on plain rows — unit-testable without a database. |
| `utils/` | `sasCommitHooks.js` | T | Doc comment: `complementItems` / `validate` are pure and called by the preview; no behaviour change. |
| `plugins/sas/` | `controller.js` | T | New `previewArrival`; shared `normaliseArrivalDraft(req)` (reception strip, `withoutLinenDecisions`, `prepare`) used by preview and commit; `arrivalPaymentSplit` decided from the plan (rule 8); `displayedArrivalTotal` comparison → `warning` + history line (rules 22, 22bis). |
| `plugins/sas/` | `sasAudit.js` | T | History label for the displayed-vs-stored difference (rule 22bis). |
| `plugins/sas/` | `arrivalRecap.js` | C | Shapes a plan into the recap payload of §4.3 (pure). |
| `plugins/sas/` | `index.js` | T | Route `POST /api/reservations/:id/sas/arrival/preview` + reception allowlist entry. |
| `plugins/sas/` | `manifest.json` | T | Version bump + changelog line (French). |
| `plugins/*/` | `manifest.json` ×14 | T | `sdk` range `^2.0.0`, version bump, changelog line (rule 14bis); `hourly-resources` major. |
| `plugins/sdk/` | `version.js` | T | `SDK_VERSION = '2.0.0'` (rule 14). |
| `plugins/sdk/` | `coreModules.json` | T | Expose `planArrivalSas`. |
| `database.js` | — | — | (none) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | Remove `bedLines` pricing, `soldOptionLines` amounts, `arrivalAdded`, `sasOriginSum`, `preservedArrivalSum`, `pluginRecapLines`/`Sum`, `storedPluginLines`, `complementDetailLines` amounts, `preExistingOfferDelta`, `arrivalComplementTotal`, `unifiableNow`; build one `draft`; render the preview. |
| `plugins/sas/` | `useArrivalRecapPreview.js` | C | Debounced (200 ms), latest-wins, abortable call; exposes `{ recap, pending, error, retry, freshFor(draft) }`. |
| `plugins/sas/` | `arrivalDraft.js` | C | Pure builder: dialog state → draft (intent only, no amount). Shared by preview and commit. |
| `plugins/hourly-resources/` | `sasStep.js`, `index.js`, `SasSchedulingStep.jsx` | T | Drop `recapLines` and the `supplements` map. |
| `plugins/sdk/` | `index.js` | T | JSDoc of the `sas.*.steps` contract: `recapLines` removed (SDK 2.0.0). |
| `api.js` | `api.js` | T | `previewArrivalSas(id, draft, { signal })`. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `OfferableLine`, `StatusBadge`, `ErrorAlert`, `PaymentModeButtons` (local) | Unchanged visuals. |
| **Created (new generic)** | — | The hook is SAS-specific: its payload is the arrival recap. |
| **Specific (kept feature-local)** | `useArrivalRecapPreview`, `arrivalDraft` | Only the arrival SAS previews this plan. If the departure follow-up (§8) needs the same plumbing, the hook is generalised then. |

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| POST | `/api/reservations/:id/sas/arrival/preview` | the arrival commit body (below) | `ArrivalRecap` | admin + reception; writes nothing; 404 / 403 `SAS_LOCKED` / plugin 409 as the commit |
| POST | `/api/reservations/:id/sas/arrival` | same body + settlement fields + `displayedArrivalTotal` | `{ ok, complementAmount, recap: ArrivalRecap, warning: null \| { code: 'ARRIVAL_TOTAL_DIFFERED', displayed, stored } }` | always commits on its own plan; `warning` when displayed ≠ stored by ≥ 0,01 € (rules 22, 22bis) |

**Draft / commit body** (changes in bold; everything else as today):

```jsonc
{
  "cautionReceived": true,
  "linenItems": [{ "itemId": 3, "qty": 1, "offered": false }],      // replaces complementItems
  "keptLines": [{ "customOptionId": 41, "offered": false }],         // re-edit only
  "cleaningAdded": true, "cleaningOffered": false,
  "bathLinenAdded": false, "bathLinenOffered": false,
  "soldOptions": [{ "optionId": 6, "occurrences": [{ "date": "2027-07-11", "time": "08:30" }], "persons": 2 }],
  "offeredExtras": [{ "kind": "option", "id": 5 }],
  "pluginSteps": { "resourceScheduling": { "blocks": [], "resourceIds": [] } },
  // settlement — ignored by the preview
  "arrivalPaymentMode": "card", "arrivalPaymentSplit": false,
  "stayPaid": true, "stayPaidCash": false,
  "displayedArrivalTotal": 85.00                                     // commit only — compared, never used
}
```

**`ArrivalRecap`:**

```jsonc
{
  "lines": [
    { "key": "option:5", "group": "existing", "label": "Repas du soir", "qty": 16, "unitPrice": 5.00,
      "real": 80.00, "billed": 80.00, "offerable": true, "offered": false },
    { "key": null, "group": "existing", "label": "Taxe de séjour", "qty": 1, "unitPrice": 4.80,
      "real": 4.80, "billed": 4.80, "offerable": false, "offered": false },
    { "key": "bed:3", "group": "added", "label": "Taie d'oreiller", "qty": 1, "unitPrice": 5.00,
      "real": 5.00, "billed": 0, "offerable": true, "offered": true },
    { "key": "hourly-resources:evening:2", "group": "plugin", "label": "Bain nordique — soirée",
      "qty": 1, "unitPrice": 20.00, "real": 20.00, "billed": 20.00, "offerable": false, "offered": false }
  ],
  "existingTotal": 84.80,              // stored complement net of this run's SAS lines and offers
  "addedTotal": 20.00,                 // what this run adds (billed)
  "arrivalComplementTotal": 104.80,    // what the commit will store in complementAmount
  "stayDue": 0,                        // stayPayment.total when the stay step runs; 0 for reception
  "totalAtArrival": 104.80,            // stayDue + arrivalComplementTotal
  "unifiable": false,
  "complementOpen": true,
  "nothingToCollect": false,
  "supplementOutsideComplement": 0,    // sale routed to end-of-stay because the complement is paid
  "adjusted": null,                    // { "amount": 50.00, "engineAmount": 85.00 } — rule 24
  "sales": {                           // sale-step subtotals (rule 16)
    "breakfast": { "units": 4, "amount": 32.00 },
    "catering": { "options": [{ "optionId": 16, "units": 2, "amount": 50.00 }], "amount": 50.00 }
  }
}
```

`key` is the offer key the dialog already uses (`option:<id>`, `resource:<id>`, `custom:<id>`,
`extraGuests:0`, `bed:<itemId>`, `cleaning`, `bathLinen`, `kept:<customOptionId>`); the toggle sends
it back in the draft. Amounts are euros rounded to the cent by the server.

---

## 5. Data model

No schema change. `complementItems` disappears from the commit body (client and server ship in one
archive — no compatibility shim). Stored rows are written exactly as today: the planner reproduces
the current arithmetic before the commit starts using it, and the parity tests (§7) prove it on the
existing fixtures.

**Data impact:** none on existing rows. A re-run of an already committed SAS re-prices its linen
elements from the current « Facturables » price instead of the price the client had loaded — the
same value unless the price changed between the load and the commit.

## 6. UI / UX

The recap looks the same. What changes is **where its figures come from** and three states:

- **Pending** — after a change, the amounts keep their last value at 55 % opacity and a 2 px
  indeterminate bar runs under « Total ». « Valider et terminer » is disabled. No spinner on the
  lines.
- **Error** — « Total indisponible » in place of the total, « Réessayer » text button beside it; lines
  keep their label, amounts become « — ». Settlement buttons and « Valider » disabled.
- **Refusal** (409 from a plugin) — `ErrorAlert` with the server's message (e.g. « Ce créneau vient
  d'être pris ») and « Revenir à l'étape ».
- **Total differed at commit** (rules 22, 22bis) — the check-in is recorded. Instead of closing, the
  dialog shows a warning (`warning` colour, not error): « Enregistré à 90,00 € — le récap affichait
  85,00 €. » with the stored recap below and a single « Fermer ». The difference is on the fiche's
  history.
- **Adjusted** (rule 24) — a muted line under the total: « Montant ajusté sur la fiche (calcul :
  85,00 €) ».

Copy is short and impersonal: no « vous », nothing about the internal mechanics.

**Responsive:**
- `xs` (the dialog is full-screen, the operator is standing at the door with a phone): the recap
  scrolls; the total line and the settlement buttons sit in the thumb footer as today. The pending
  bar is attached to the total line so it stays visible in the footer. « Réessayer » is a 44 px
  target.
- `md` / `lg`: unchanged layout; the same states.
- No layout shift between pending and answered: amounts keep their width (`tabular-nums`, reserved
  min-width), the toggled line does not move.

**Page action bar:** not applicable — the SAS is a dialog, not a page.

## 7. Test plan

Figures reused from the existing SAS fixtures (`client/src/plugins/sas/__tests__/sasFixtures.jsx` and
the specs they cite).

### Server unit tests

- [ ] `server/src/tests/sas-arrival-plan.unit.test.js` (pure `arrivalSasPlan.js`, rules 1, 6, 9, 24):
  - pillow 1 × 5,00 € + ménage 80,00 € → `arrivalComplementTotal` 85,00; pillow offered → 80,00;
  - stored « Panier gourmand » 20,00 € offered → 0,00, `nothingToCollect` false (owed before the run);
  - « Repas du soir » 16 × 5,00 = 80,00 + tourist tax 4,80 → 84,80; the tax line `offerable: false`;
  - extra guests 40,00 → 40,00; offered → 0,00;
  - breakfast 2 mornings × 2 persons × 8,00 → `sales.breakfast` { units 4, amount 32,00 };
  - « Le repas des trappeurs » 1 × 2 × 25,00 + « Planche S » 17,00 → `sales.catering.amount` 67,00;
    covers lowered to 1 → 42,00;
  - re-edit with unchanged draft: stored 85,00 with 85,00 SAS-origin → 85,00 (not 170,00);
  - stay 480,00 + complement 50,00 → `unifiable` true, `totalAtArrival` 530,00; complement offered to
    0 → `unifiable` false;
  - override 50,00 with engine 85,00 → `arrivalComplementTotal` 50,00, `adjusted` { 50,00, 85,00 }.
- [ ] `server/src/plugins/sas/tests/sas-arrival-preview.unit.test.js` (rules 2, 3, 5, 8, 12, 22, 23):
  - **parity** — for each scenario above, `commit().complementAmount === preview().arrivalComplementTotal`;
  - the preview writes nothing: reservation row, `reservation_options`, `reservation_custom_options`,
    `reservation_resources`, history and `arrivalSasDoneAt` identical before and after;
  - a commit body carrying `arrivalPaymentSplit: false` on a non-unifiable plan settles separately;
  - linen priced from « Facturables »: item at 5,00, draft qty 2 → 10,00, whatever the client sends;
  - unknown `itemId` and `qty: 0` dropped;
  - `displayedArrivalTotal` 85,00 vs plan 90,00 with `card` → committed at 90,00, settled, response
    `warning` { displayed 85,00, stored 90,00 }, and the `sas_arrival` history entry carries the
    difference; same totals (85,00 / 85,00) → `warning: null`, no history line about it;
  - reception user: `stayDue` 0, `unifiable` false, no revenue field;
  - SAS locked for reception → 403 `SAS_LOCKED` on the preview too.
- [ ] `server/src/plugins/hourly-resources/tests/sas-preview-hook.unit.test.js` (rules 10-12):
  evening supplement 20,00 appears once in the preview, its `write` is not called, a stale block
  answers 409 `SLOT_CONFLICT` on the preview.
- [ ] `server/src/tests/sas-commit.unit.test.js` (existing) — still green unchanged on the money it
  stores: the refactor of rule 2 is behaviour-preserving.

### Client tests (Vitest)

Every SAS dialog test that asserts a total now mocks `api.previewArrivalSas` with the server's answer
instead of letting the component compute it. The assertions stay (« Total : 85,00 € ») and prove the
component **renders** the field; the arithmetic they used to prove moves to the server tests above.

| File | Tests touching a total | Migration |
|---|---|---|
| `ReservationSasDialog.arrival.test.jsx` | 4 | preview fixtures 85,00 / 5,00 / 80,00 / 84,80 |
| `ReservationSasDialog.offered-lines.test.jsx` (arrival half) | 3 | assert the draft's `offeredExtras` / `linenItems[].offered` after « Offrir », and that the total shown is the second preview's |
| `ReservationSasDialog.catering.test.jsx` | 6 | `sales` block 32,00 / 67,00 / 50,00 / 0,00 |
| `ReservationSasDialog.extra-guests.test.jsx` | 3 | 40,00 → 0,00 |
| `ReservationSasDialog.evening-supplement.test.jsx` | 1 | plugin line from the preview, `recapLines` absent |
| `ReservationSasDialog.plugin-lines-off.test.jsx` | 1 | stored plugin line from the preview |
| `ReservationSasDialog.stay-payment.test.jsx` / `recap-payment.test.jsx` | 4 | `unifiable` from the preview; commit sends the operator's split only |
| `ReservationSasDialog.upsells.test.jsx`, `thumb-footer.test.jsx` | 6 | totals from the preview |

New: `ReservationSasDialog.recap-preview.test.jsx` (rules 15-22) — 200 ms coalescing (three taps →
one call), latest-wins (a slow first answer arriving after the second is ignored), pending dims and
disables « Valider », error shows « Total indisponible » + « Réessayer », 409 refusal message, a
commit answering `warning` keeps the dialog open on « Enregistré à 90,00 € — le récap affichait
85,00 € ». And `arrivalDraft.test.js` — the draft carries no amount.

SDK 2.0.0 (rules 13, 14, 14bis): `server/src/tests/sdk-v2-ranges.unit.test.js` — every in-repo
manifest's `sdk` range is satisfied by `SDK_VERSION`; a step declaring `recapLines` has no effect on the
recap (client test in `ReservationSasDialog.evening-supplement.test.jsx`).

### Manual UI verification

- [ ] Happy path: arrival with linen + ménage, offer the pillow, total 85,00 → 80,00, commit, fiche
  shows 80,00.
- [ ] Unified payment: last-minute direct stay 480,00 + repas 50,00 → « Total à percevoir à
  l'arrivée : 530,00 € », « CB / Chèque », fiche shows one payment.
- [ ] Edge: dev server stopped mid-recap → « Total indisponible », « Valider » disabled, restart →
  « Réessayer » restores.
- [ ] Mobile (375 px): pending bar visible in the thumb footer, no layout shift on toggle.
- [ ] Regression: departure SAS unchanged (still client-computed, §8).

## 8. Out of scope

- **The departure recap.** `endOfStayTotal`, `recalledArrivalAmount`, `departureGrandTotal`
  (`ReservationSasDialog.jsx:925-963`) and the extinguisher subtotal stay client-computed. Same
  method, separate spec (`sas-departure-total-server-side`), once this one is in.
- The breakfast composition pre-fill (`breakfastFoodFor`, `:986-990`): counts of food, not money.
- `recapNotes` of plugin steps: text, not money.
- Any change to what is billed or how it is booked: the planner reproduces the commit's current
  arithmetic, it does not change it.

## 9. Open questions

- Q3: Finding 3 of §1.1 (override wins silently) is read from the code, not observed. **Default:**
  verify on a copy of production, before implementing, that a SAS run on an adjusted complement
  stores the override; then confirm rule 24 (show the adjusted amount) or switch to refusing new lines
  on an adjusted complement.
- Q5: Debounce of 200 ms — no latency figure exists yet for a SAS call from the phone used at the
  door (Wi-Fi or 4G). **Default:** start at 200 ms and measure on that phone during the manual check;
  tune only if the measure says so.

**Resolved (2026-10-23, owner on PR #759):**
- Q1: Should the preview run on every step? → **No.** Only on the recap and the selling steps
  (rule 17 as written).
- Q2: `recapLines` deprecated in 1.8.0 or removed now? → **Removed now**, which needs SDK 2.0.0 and
  moves every in-repo plugin's `sdk` range in the same release (rules 13, 14, 14bis).
- Q4: Refuse the commit on a one-cent difference? → **No.** The commit goes through; the response
  warns and the history keeps the difference (rules 22, 22bis).
