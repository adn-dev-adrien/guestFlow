# Arrival complement total computed by the server

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `docs/sas-arrival-total-server` |
| **Created** | 2026-10-23 |
| **Author** | Adrien |
| **Related PR** | #759 |

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
   input, { withExistingLines })` reads the reservation and returns the plan: every recap line, the
   stored complement before and after this run, and the amounts below (§4.3). It **never writes**.
   `input` is the commit's own input — the resolved complement items (linen, kept lines, plugin
   lines), the upsell answers, the sales intent, the offered set; the commit passes
   `withExistingLines: false`, since it renders nothing. Its pure arithmetic lives in
   `utils/arrivalSasPlan.js` (`upsellOutcome`, `arrivalComplementAfter`, `isUnifiable`,
   `totalDiffered`).
2. **The commit executes the plan, it does not recompute it.** `commitArrivalSas` calls
   `planArrivalSas` inside its transaction and writes what the plan says: the SAS-origin rows to
   replace, the sold options, the upsells, and `complementAmount = plan.engineAfter` (then the
   operator's adjustment, rule 24). The plan is read at the start of the transaction, before any write.
   The offered-extras step is split the same way: `planOfferedComplementExtras` reads, the commit's
   `applyOfferedComplementExtras` writes what it read. The
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
   amount, offered }`) is replaced by `linenItems: [{ itemId, qty, offered }]`;
   `reservationsModel.resolveSasArrivalItems` prices each from `linen_priced_items` (`price × qty`,
   rounded to the cent) before the planner and the commit see it. An unknown `itemId` or a
   non-positive `qty` is dropped. Finding 2 of §1.1 closes. Without the `linen` plugin, the linen
   elements sent are ignored and the bed-linen lines a previous check-in stored are kept as
   `keptLines` (rule 11 of plugins-phase-2-hosts.md).
7. **Preserved re-edit lines are referenced, not re-sent.** A stored SAS-origin custom line whose label
   no longer maps to a priced item is kept by `customOptionId`: `keptLines: [{ customOptionId,
   offered }]`. The server reads its stored amount; the client never sends one. Only the SAS's own
   untagged rows can be kept (`sasArrivalOrigin = 1`, no `sasLineKey`): a plugin's line named here is
   ignored, its plugin bills it. A line absent from `keptLines` is dropped, as today.
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
    goes from `1.8.0` (inte/plugins moved it from 1.7.0 meanwhile) to `2.0.0`. The SDK changelog says: « `sas.arrival.steps[].recapLines` is
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
    2. move all fourteen `sdk` ranges to `^2.0.0`, bump each plugin's version — a patch from
       `check-plugin-versions.mjs --bump` for the twelve whose code does not move, a minor for `sas`
       (1.2.0) and `hourly-resources` (1.1.0), whose behaviour does — and add a French changelog line
       (« Compatible avec le SDK 2 de GuestFlow. »);
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
16. **The sale steps render the preview too.** « 4 petits déjeuners — 32,00 € », each catering row's
    « = 50,00 € » and « Total restauration : 67,00 € » read the `sales` block of the preview (§4.3);
    « — » until the server answered. The counts the operator types (mornings, covers, units) stay
    local UI state.
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
    message (« Ce créneau n’est plus libre. » for `SLOT_CONFLICT`) and « Revenir à l’étape », which
    opens the first plugin page of the run. The payment buttons are left enabled while a preview is
    only pending: choosing a mode moves no money.
22. **The total the operator saw is compared at commit, never enforced** (decided 2026-10-23). The
    commit body carries `displayedArrivalTotal` (the `arrivalComplementTotal` of the preview shown).
    The commit always goes through on its own plan. When the two differ by a cent or more, the
    response carries `warning: { code: 'ARRIVAL_TOTAL_DIFFERED', displayed, stored }` and the dialog,
    instead of closing, shows the stored total with the difference before « Fermer ». It is a
    comparison, never an amount: rule 5 holds.
22bis. **The difference is kept in the audit trail.** The `sas_arrival` history entry of that commit
    commit gets one more entry, field `arrivalRecapTotal`, labelled « Total du récapitulatif
    d’arrivée », from « affiché 85,00 € » to « enregistré 90,00 € », so a later question about what
    the guest was told has an answer on the fiche's « Historique des modifications ». No entry is added
    when the totals match.
23. **Reception role.** The preview is open to the reception role (door money, like `GET .../sas`):
    `stayDue` is 0, `unifiable` is false, and no revenue field is served — the same guards as
    `buildStayPayment` / `buildArrivalPayment`.

### 3.5 The adjusted complement

24. **The recap shows what the commit will store.** When `complementAmountOverride` is set and the
    complement is open, `arrivalComplementTotal` is what `reapplyComplementOverride` will leave, and
    the response carries `adjusted: { amount, engineAmount }`. The recap adds under the total:
    « Montant ajusté sur la fiche (calcul : 85,00 €) ». Verified on a fixture only (§9 Q3): a
    complement adjusted to 50 € keeps 50 € after a check-in that adds 85 € of lines.

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
| `models/` | `reservationsModel.js` | T | New `planArrivalSas(id, input, { withExistingLines })` (pure read: lines, before/after, totals, sales, adjusted) and `resolveSasArrivalItems(id, { linenItems, keptLines })` (intent → priced items); `planOfferedComplementExtras` split out of `applyOfferedComplementExtras`; `commitArrivalSas` executes the plan instead of recomputing; `listSasArrivalCustomLines` returns the row `id`. |
| `utils/` | `arrivalSasPlan.js` | C | Pure arithmetic of the plan (delta, offered netting, override, rounding) on plain rows — unit-testable without a database. |
| `utils/` | `sasCommitHooks.js` | T | Doc comment: `complementItems` / `validate` are pure and called by the preview; no behaviour change. |
| `plugins/sas/` | `controller.js` | T | New `previewArrival`; shared `normaliseArrivalDraft(req)` (reception strip, `withoutLinenDecisions`, `prepare`) used by preview and commit; `arrivalPaymentSplit` decided from the plan (rule 8); `displayedArrivalTotal` comparison → `warning` + history line (rules 22, 22bis). |
| `plugins/sas/` | `arrivalRecap.js` | C | Shapes a plan into the recap payload of §4.3 (pure). |
| `plugins/sas/` | `index.js` | T | Route `POST /api/reservations/:id/sas/arrival/preview` + reception allowlist entry. |
| `plugins/sas/` | `manifest.json` | T | Version bump + changelog line (French). |
| `plugins/*/` | `manifest.json` ×14 | T | `sdk` range `^2.0.0`, version bump, changelog line (rule 14bis). |
| `plugins/hourly-resources/` | — | — | Server side unchanged: its `sasCommit` hook already bills the evening supplement; a preview calls it like the commit. |
| `plugins/sdk/` | `version.js` | T | `SDK_VERSION = '2.0.0'` (rule 14). |
| `plugins/sdk/` | `index.js`, `coreModules.json` | T | Expose the `arrivalSasPlan` core module and `reservationsModel.planArrivalSas` / `resolveSasArrivalItems`. |
| `database.js` | — | — | (none) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/sas/` | `ReservationSasDialog.jsx` | T | Remove `bedLines` pricing, `soldOptionLines` amounts, `arrivalAdded`, `sasOriginSum`, `preservedArrivalSum`, `pluginRecapLines`/`Sum`, `storedPluginLines`, `complementDetailLines`, `preExistingOfferDelta`, `arrivalComplementTotal`, `unifiableNow`; build one `draft`; render the preview (recap and sale steps); the error/refusal panel (`RecapPreviewError`), the warning panel after a commit (rule 22); `PaymentModeButtons` gains `disabled`. |
| `plugins/sas/` | `useArrivalRecapPreview.js` | C | Debounced (200 ms; the first request of a page leaves at once), latest-wins, abortable call; exposes `{ recap, pending, error, fresh, retry }`. |
| `plugins/sas/` | `arrivalDraft.js` | C | Pure builder: dialog state → draft (intent only, no amount). Shared by preview and commit. |
| `plugins/hourly-resources/` | `sasStep.js`, `index.js`, `SasSchedulingStep.jsx`, `SasResourceSchedulingPage.jsx` | T | Drop `recapLines`, the `supplements` map and the `onSupplement` plumbing that fed it. |
| `api.js` | `api.js` | T | `previewArrivalSas(id, draft, { signal })`; `request()` learns `readOnly` so a preview POST does not broadcast « data changed » to the open pages. |

The step contract (`sas.arrival.steps`: `initialValue`, `payloadOf`, `recapNotes`, …) is documented
where the dialog reads it, in `ReservationSasDialog.jsx`; there is no separate client SDK JSDoc to
change.

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
| POST | `/api/reservations/:id/sas/arrival` | same body + settlement fields + `displayedArrivalTotal` | `{ ok, complementAmount, recap: ArrivalRecap, warning: null \| { code: 'ARRIVAL_TOTAL_DIFFERED', displayed, stored }, pluginLines }` | always commits on its own plan; `warning` when displayed ≠ stored by ≥ 0,01 € (rules 22, 22bis) |

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
  "sales": {                           // sale-step amounts (rule 16)
    "breakfast": { "optionId": 6, "units": 4, "amount": 32.00 },   // null when no breakfast is on sale
    "catering": { "options": [{ "optionId": 16, "units": 2, "amount": 50.00 }, { "optionId": 27, "units": 1, "amount": 17.00 }], "amount": 67.00 }
  }
}
```

`group` is `existing` | `added` | `plugin` | `kept`. `key` is the offer key the dialog already uses (`option:<id>`, `resource:<id>`, `custom:<id>`,
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

The recap looks the same. What changes is **where its figures come from** and four states:

- **Pending** — after a change, the amounts keep their last value at 55 % opacity and a 2 px
  indeterminate bar (`LinearProgress`, labelled « Calcul du total ») runs under the total. « Valider
  et terminer » is disabled and reads « Calcul du total… ». The toggled line flips at once.
- **Error** — the total area is replaced by « Total indisponible : pas de réponse du serveur. » with a
  « Réessayer » button, on a soft error background (8 % of `error.main`); the lines keep their label,
  their amounts become « — ». Settlement buttons and « Valider » disabled. Before any answer at all,
  the recap shows the same panel in place of the whole list.
- **Refusal** (409 from a plugin) — the same panel with the server's reason (« Ce créneau n’est plus
  libre. » for `SLOT_CONFLICT`) and « Revenir à l’étape ».
- **Total differed at commit** (rules 22, 22bis) — the check-in is recorded. Instead of closing, the
  dialog shows, in the `warning` colour, « Enregistré à 110,00 € — le récap affichait 105,00 €. » and
  « L’écart est noté dans l’historique de la fiche. », with a single « Fermer » (which then reloads
  the planning).
- **Adjusted** (rule 24) — a muted line under the total: « Montant ajusté sur la fiche (calcul :
  85,00 €) ».

Copy is short and impersonal: no « vous », nothing about the internal mechanics.

**Responsive** (checked in Chromium at 375, 900 and 1280 px, §7):
- `xs` (full-screen dialog, the operator at the door with a phone): the recap scrolls; « Valider » sits
  in the thumb footer as before. The pending bar is attached to the total. « Réessayer » and the
  « Offrir » toggles are 44 px targets.
- `md` / `lg`: unchanged layout; the same states.
- No layout shift between pending and answered: amounts are `tabular-nums`, the toggled line does not
  move.

**Page action bar:** not applicable — the SAS is a dialog, not a page.

## 7. Test plan

Figures reused from the existing SAS fixtures (`client/src/plugins/sas/__tests__/sasFixtures.jsx` and
the specs they cite).

### Server unit tests

- [x] `server/src/tests/sas-arrival-plan.unit.test.js` (14 tests, rules 1, 2, 3, 6, 7, 9, 16, 22, 24 —
  the pure arithmetic and the plan on a migrated in-memory database):
  - pillow 1 × 5,00 € + ménage 80,00 € → 85,00; pillow offered → 80,00 (real price kept);
  - linen priced from « Facturables »: qty 2 → 10,00; unknown item and qty 0 dropped;
  - stored « Panier gourmand » 20,00 € offered → 0,00;
  - « Repas du soir » 16 × 5,00 + tourist tax 4,80 → 84,80; the tax line not offerable;
  - extra guests 40,00 → offered → 0,00;
  - 4 × 8,00 breakfasts + 2 × 25,00 + 17,00 of restauration → 99,00; fewer covers → 42,00;
  - the preview writes nothing; the commit stores the very total it planned (105,00);
  - a re-run with an unchanged draft plans 85,00, not 170,00; a kept line is read from its row;
  - adjusted complement 50,00 with engine 135,00 → stored 50,00, `adjusted` announced (Q3);
  - a paid complement is frozen, the run's lines announced apart (`supplementOutsideComplement`).
- [x] `server/src/plugins/sas/tests/sas-arrival-preview.unit.test.js` (9 tests, rules 2, 3, 5, 8, 9,
  22, 22bis, 23 — the real controller): preview answers and writes nothing; commit = preview (55,00);
  stay 480,00 + complement 50,00 → `unifiable`, 530,00 at arrival, offered to 0 → not unifiable; a
  one-gesture request on a non-unifiable plan settles separately; displayed 5,00 vs stored 10,00 →
  committed, warned, history line « affiché 5,00 € » → « enregistré 10,00 € »; no line when equal;
  reception: no stay amount, never one gesture; locked SAS → 403 on the preview; unknown stay → 404.
- [x] `server/src/plugins/hourly-resources/tests/sas-preview-hook.unit.test.js` (2 tests, rules 10-12):
  the evening supplement 20,00 shows once as a plugin line, the hook's `write` never runs on a
  preview; a stale block answers 409 `SLOT_CONFLICT` on the preview.
- [x] `server/src/tests/sdk-v2-plugin-ranges.unit.test.js` (2 tests, rules 14, 14bis): SDK 2.0.0
  refuses `^1.x`; the fourteen manifests declare `^2.0.0` with a changelog line naming SDK 2.
- [x] Updated: `phase-2-sas.unit.test.js` (reception allowlist has the preview; the linen gate works on
  intents), `reception-sas-lock.unit.test.js` (the mocked model plans), `hourly-evening-billed-once.unit.test.js`
  (a stale dialog naming the plugin's row in `keptLines` gets nothing), `plugins-phase-4-registry.unit.test.js`,
  `plugins-setup-state.unit.test.js`, `hosting-plugin-push.unit.test.js` (fixtures on SDK 2).
- [x] `server/src/tests/sas-commit.unit.test.js` (existing, 54 tests) green unchanged: the refactor of
  rule 2 is behaviour-preserving.

Full suite: `cd server && npm test` — 6 065 tests, all green.

### Client tests (Vitest)

Every SAS dialog suite mocks `api.previewArrivalSas` with `previewLikeTheServer(api)`
(`__tests__/sasPreviewFake.js`, a stand-in that answers for the fixture payload the dialog loaded).
The assertions stay (« Total : 85,00 € ») and prove the component **renders** the field; the
arithmetic moved to the server tests above. After a gesture, a money assertion awaits the answer
(`findByText`) — rule 19.

| File | Migration |
|---|---|
| `ReservationSasDialog.arrival.test.jsx` | commit payload: `linenItems` / `keptLines` / `arrivalPaymentSplit: false` / `displayedArrivalTotal` |
| `ReservationSasDialog.offered-lines.test.jsx` | totals awaited after « Offrir »; `linenItems[].offered` |
| `ReservationSasDialog.catering.test.jsx` | the sale-step amounts awaited (18 assertions) |
| `ReservationSasDialog.extra-guests.test.jsx`, `upsells.test.jsx` | totals awaited; `linenItems` |
| `ReservationSasDialog.evening-supplement.test.jsx`, `plugin-lines-off.test.jsx` | plugin line from the preview; nothing kept |
| the other 10 SAS suites | the preview mock only |

New: `ReservationSasDialog.recap-preview.test.jsx` (6 tests, rules 12, 15, 17-22) — the draft carries
no amount; three quick gestures → one request; a slow answer overtaken by a newer one is ignored;
« Calcul du total… » disabled while pending; « Total indisponible » + « Réessayer »; the 409 refusal;
the warning after a commit on another total, « Fermer » closes. And `arrivalDraft.test.js` (3 tests,
rules 4-7). Full suite: `cd client && npx vitest run` — 399 files, 2 093 tests green.

### E2E

`npm run test:e2e` (on ports 3200/4200 beside another session's servers): 148 passed, 1 skipped.

### Manual UI verification (done 2026-10-23, Chromium, fictional stay)

Stay « Cabane fictive » / « Alex Exemple », complement 20 € (« Panier gourmand »), check-in with one
pillowcase (5 €) and the ménage (80 €), at 375, 900 and 1280 px:
- [x] Happy path: recap « Total : 105,00 € »; « Offrir » on the Panier flips at once, the total follows
  to 85,00 €; back to 105,00 €.
- [x] Slow server (1,2 s injected): amounts dimmed, bar under the total, « Calcul du total… » disabled.
- [x] Offline (preview aborted): « Total indisponible : pas de réponse du serveur. », amounts « — »,
  « Valider » disabled; « Réessayer » restores 105,00 €.
- [x] Price changed elsewhere before « Valider » (ménage 80 → 85 €): recorded at 110,00 €, the dialog
  stays open on « Enregistré à 110,00 € — le récap affichait 105,00 €. »; the fiche history carries
  the difference.
- [x] Regression: departure SAS unchanged (still client-computed, §8) — its suites and E2E green.

## 8. Out of scope

- **The departure recap.** `endOfStayTotal`, `recalledArrivalAmount`, `departureGrandTotal` and the
  extinguisher subtotal stay client-computed. Same method, separate spec
  (`sas-departure-total-server-side`).
- The offer prices shown before a sale (« 8,00 € par personne et par matin — 16,00 € le matin pour
  2 pers. » on the breakfast offer page) and the « supplément » total of the hourly-resources
  scheduling page: shown before any line exists, they belong with the departure follow-up.
- The breakfast composition pre-fill (`breakfastFoodFor`): counts of food, not money.
- `recapNotes` of plugin steps: text, not money.
- Any change to what is billed or how it is booked: the planner reproduces the commit's arithmetic, it
  does not change it.

## 9. Open questions

None left.

**Resolved (2026-10-23, owner on PR #759):**
- Q1: Should the preview run on every step? → **No.** Only on the recap and the selling steps
  (rule 17 as written).
- Q2: `recapLines` deprecated in 1.8.0 or removed now? → **Removed now**, which needs SDK 2.0.0 and
  moves every in-repo plugin's `sdk` range in the same release (rules 13, 14, 14bis).
- Q3: Does an adjusted complement win over the SAS lines? → **Verified on a fixture only** (no copy
  of production at hand): a complement adjusted to 50 € stays at 50 € after a check-in that adds
  85 € of lines (`sas-arrival-plan.unit.test.js`). The default of rule 24 is implemented: the recap
  shows the adjusted amount and the computed one beside it.
- Q4: Refuse the commit on a one-cent difference? → **No.** The commit goes through; the response
  warns and the history keeps the difference (rules 22, 22bis).
- Q5: Debounce → **200 ms**, the first request of a page leaving at once. To measure on the reception
  phone if it ever feels slow.
