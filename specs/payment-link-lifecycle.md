# Payment link lifecycle — no link stays payable longer than its purpose

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/payment-link-lifecycle` _(base `inte/plugins`)_ |
| **Created** | 2026-10-30 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary to validate** | [docs/specs/2026-10-30-payment-link-lifecycle.html](../docs/specs/2026-10-30-payment-link-lifecycle.html) |

---

## 1. Context

### 1.1 The finding that triggered this spec (audit round 6, N2)

A payment link whose stay was deleted (an **orphan**) can still be paid, and nobody is told:

- `paymentPollRunner.applyPaidEffect` returns `{ effect: 'no-reservation' }`;
- `processPaidLink` routes `no-reservation` to no alert branch (only `reservation-cancelled` and the
  `installment-*` effects alert) and answers `status: 'paid'`;
- calling the notifier would not help as it stands: `notificationService.notifyPaidAfterCancel` returns
  `{ skipped: 'not_found' }` when the stay is missing, and the rule-8 retry path
  (`retryPendingCancellationsOnce`, branch `pay.paid` with no reason) hits the same skip.

The 22/10 production copy holds **3 open orphan links**, all `full`, all still payable at Qonto:

| Link | Former stay | Amount |
|---|---|---|
| #13 | 22299 | 762,80 € |
| #14 | 22300 | 214,94 € |
| #16 | 22302 | 672,80 € |

1 650,54 € can be paid into rows that no longer exist. The only signal today is the boot
`console.warn` of [index.js](../server/src/index.js) (« to deactivate by hand at the provider »).
Whether prod has deactivated them by hand since 22/10 is unverified.

### 1.2 What already exists

Deactivation is no longer missing (the 2026-09 note « `deactivate` never called » is out of date):
[paymentLinkDeactivation.js](../server/src/utils/paymentLinkDeactivation.js) calls
`provider.cancelLink` (Qonto `PATCH /v2/payment_links/{id}/deactivate`) in these places:

| Where a link is abandoned | Code | Remote deactivation |
|---|---|---|
| Stay cancelled from the fiche / dashboard | `utils/cancelReservation.js` → `reservationCancellationController` → `deactivateAbandonedLinks` | immediate, marker on failure |
| Stay cancelled by an iCal import | `models/icalCancellationModel.js` `abandonOpenLinks` | marker only, poll deactivates |
| Stay / devis / client / property deleted | `deactivateOpenLinksBeforeDelete` (reservations, devis, clients, properties controllers) | immediate; **the delete is refused** when it fails |
| Link replaced (amount drifted, deposit↔full swap, public mode flip) | `paymentRequestService.mintPaymentLink` / `mintInstallmentLink`, `publicPaymentController.pay` → `retireOpenLink` | immediate, marker on failure |
| Amount changed by the fiche, the devis conversion, the VAT regime switch, an installment rebalance | `paymentLinksModel.retireForAmountChange`, `staleLinksOfStay`, `devisModel`, `vatRegimeSwitchModel`, `installmentsController` | marker (`cancelReason = 'amount-changed'`), poll deactivates |
| Bucket settled another way | `paymentLinksModel.retireSettled` (each poll pass and after each paid link) | marker (`cancelReason = 'settled'`) |

The retry loop is `retryPendingCancellations` (plugins-phase-3a rule 8): read the payment, then
`cancelLink`, then clear `remoteCancelPendingAt`; a rate limit stops it.

Every link is **created** in exactly two functions of
[paymentRequestService.js](../server/src/utils/paymentRequestService.js): `mintPaymentLink`
(`deposit` / `balance` / `full`; reached from the fiche « Demander le paiement » / « Renvoyer la
demande », the dashboard « Envoyer la demande / Relancer », the public `/public/v1/booking-requests/:id/pay`,
`POST /api/payments/reservations/:id/payment-links`) and `mintInstallmentLink` (an échéance, from the
fiche and the « à valider » queue). Both **reuse** an open link of the same type while its amount
matches. The SAS creates no link: it records payments at the door, which `retireSettled` turns into
retired links.

Every link is **settled** (marked paid) in `paymentLinksModel.markPaid` (`open | expired → paid`), by
`processPaidLink` (webhook, poll, public `/status`), or in `markRetiredLinkPaid` /
`clearRemoteCancelPending` for a retired link found paid (`settleRetiredPaidLink`,
`bookAmountChangedPaidLink`, `bookInstallmentPaidAfterAmountChange`). Amount-changed paid links are
booked through `ledgerLinks.bookPaidAfterAmountChange`.

### 1.3 The gaps

1. **Orphans:** links of stays deleted *before* the delete guard existed are still open (N2), and a
   payment on them is silent.
2. **Links never expire.** Qonto has no expiry field and answers `expiration_date:
   0001-01-01T00:00:00Z` (`knownExpiryMs` reads it as « none »). A request sent in May stays payable in
   December, at May's amount, and the poll keeps asking about it once a day forever (fair-use cost).
3. **An unpaid stay keeps a payable link after its dates were taken** by another reservation. A devis
   never blocks its dates (only `kind = 'reservation'` rows do, `reservationsModel.getOccupiedReservations`),
   so a platform booking imported by iCal over a direct devis, or a second devis paid first, leaves the
   first link payable: its payment converts the devis into an over-booking (`bookingConflictAt` +
   alert). An unpaid direct reservation overlapped by an iCal import is in the same position.
4. **A stay that has started keeps its open links** — the acompte link of a guest already on site.
5. **A duplicate set aside (`kind = 'superseded'`)** keeps its open links (no code abandons them).

## 2. Goal

A payment link can be paid only while it serves its purpose: at most 36 hours after it was minted,
never once the stay has begun, never on a stay that is gone, cancelled, or whose dates were taken. A
payment that still lands on an orphan link reaches the operator at once.

## 3. Functional rules

Rules are numbered for identity; new ones are appended at the end, never inserted.

### 3.A Vocabulary

1. **Two ways a link leaves `open`.** GuestFlow distinguishes:
   - **lapsed** (`status = 'expired'`): the link ran out of time — its validity ended (rule 6) or the
     stay began (rule 9). The money of a payment made before the deactivation reached the provider is
     **the stay's money** and is booked like any payment (`markPaid` already accepts `expired`, and the
     webhook already processes an `expired` link).
   - **withdrawn** (`status = 'cancelled'`): the link lost its object — stay deleted (orphan), cancelled,
     set aside, dates taken, amount changed, bucket settled, link replaced. A payment found on it is
     handled by the existing rule 8 / rule 24 / rule 31 paths (alert, refund, or booking at the old
     amount); this spec adds the orphan reason (rule 3) and the dates-taken reason, whose payment is
     recorded on the fiche in date conflict (rule 33).
2. **`cancelReason` gains values** (the column keeps its name; it is the reason of either state):
   `orphan`, `superseded`, `dates-taken`, `operator` (rule 42) (withdrawn) and `validity`, `stay-started` (lapsed). A stay
   cancellation keeps writing `NULL` (unchanged: the ledger reads it as « Lien retiré »).

### 3.B Orphan links (decision 1, 2026-10-30)

3. **A payment on an orphan link alerts the admin.** When the paid effect finds no stay
   (`no-reservation`, from `applyPaidEffect` or `bookPaidAfterAmountChange`) — on the live path
   (`processPaidLink`) and on the retry path (`retryPendingCancellationsOnce`, every branch) — the link
   keeps the provider's payment id and date (`paid` on the live path; a withdrawn row stays `cancelled`
   with `paidAt`, as rule 8 already does; a money record, never deleted), nothing is booked,
   no confirmation is sent, and `notifyPaidAfterCancel(link, { orphan: true })` is called.
4. **`notifyPaidAfterCancel` handles a missing stay.** With `orphan: true` (or when the stay is not
   found, whatever the options), it no longer skips: it sends a push and an e-mail
   - subject « Paiement reçu sur un lien sans séjour — {montant} »;
   - body: link number (`#id`), type (acompte / solde / séjour / échéance), amount, the day the link was
     created, the day it was paid, the provider's link id and payment id, and the former stay number
     (`reservationId`, « séjour supprimé ») — **no link to a fiche** (there is none);
   - action line: « Action requise : retrouver le client et rembourser ce paiement depuis votre espace
     du prestataire de paiement. »
   The push carries no `url`. Best-effort, like every admin notification. The payment's id and date
   reach the notifier in the options (`{ orphan: true, paidAt, providerPaymentId }`): the link handed to
   it is the row read before the payment was stamped (implementation reading, 2026-10-30).
5. **At the first boot of this version, the open orphans are withdrawn once.** An idempotent migration
   (`migrations.name = 'orphan_payment_links_withdrawn_v1'`) sets every **open** link whose stay row is
   missing to `cancelled`, `cancelReason = 'orphan'`, `remoteCancelPendingAt = now` (when it has a
   `providerLinkId`), and logs one line per link:
   `[migration:orphan-links] link #13 (full, 762,80 €, former stay 22299) withdrawn: deactivation owed at qonto`.
   No network call at boot (database.js is synchronous). The first poll pass (110 s after boot) reads
   each one's payment, then deactivates it (rule 8); its result is logged per link —
   `[payments] orphan link #13 deactivated at qonto` or, if it had been paid meanwhile, the rule-4 alert
   is sent. An open orphan without a `providerLinkId` (never reached the provider) is withdrawn without the
   marker and logged `… withdrawn: no provider link to deactivate` (reading recorded at implementation,
   2026-10-30). The boot `console.warn` of `index.js` stays, for the cancelled-with-marker orphans still
   owed while the plugin is off.

### 3.C Validity — 36 hours (decision 2c)

6. **Every link minted from this version on is valid 36 hours from its creation.** `mintPaymentLink` and
   `mintInstallmentLink` store `expiresAt = createdAt + 36 h` (ISO, UTC), whatever the provider
   answers (Qonto's zero-time sentinel is ignored as today). The duration is one constant,
   `PAYMENT_LINK_VALIDITY_HOURS = 36` in `server/src/constants/paymentLinks.js`. The 36 h count from the
   creation, never from a send: a send never pushes `expiresAt` back (decided 2026-10-30, §9 Q1); rule 8
   is what keeps a sent link usable. Links already open at the upgrade: rule 34.
7. **A link past its `expiresAt` lapses.** The lifecycle pass (rule 16) moves it `open → expired` with
   `cancelReason = 'validity'` and `remoteCancelPendingAt = now`, then deactivates it at the provider
   (rule 18). A lapsed link leaves the poll worklist (only `open` rows are polled).
8. **A request never carries a link about to lapse.** `mintPaymentLink` / `mintInstallmentLink` reuse an
   open link only while it has at least `PAYMENT_LINK_MIN_REMAINING_HOURS = 24` hours left; otherwise it
   is retired (`retireOpenLink`, reason `validity`, so the existing « paid meanwhile → refused »
   guard applies) and a fresh one is minted. So every e-mail that leaves with a link gives the guest at
   least 24 h, whatever the delay between the mint and the operator's send. The retired link **lapses**
   (`expired`, `validity`, rule 1), it is not withdrawn; it is deactivated at once and gets its last look
   (rule 19). An acompte request and a full request started at the same moment for one stay end with a
   single open link: the mints of a stay run one after the other, whatever their type, under one lock
   `reservation:<id>` shared by a devis and the reservation it became (re-review of #897: retiring an older
   link waits on the provider, and a per-type lock let the other mint slip in, leaving two links open, or
   a full request reusing a link being retired; test `payment-link-concurrent-types`). Its `expiresAt` becomes the moment it lapsed, so its ledger row never names a future end
   (review of #894; the same for a stay-started lapse). A link with no known end (Qonto's sentinel) cannot promise 24 h and is never reused; a link
   whose amount drifted is withdrawn as before (`cancelled`, no reason) (readings recorded at
   implementation, 2026-10-30).

### 3.D The stay's own life (decisions 2a, 2b)

9. **A stay that has begun lapses its links.** From 00:00 Europe/Paris on `startDate`, the open links of
   the stay (and of the devis converted into it) of types `deposit`, `balance`, `full`, `installment`
   lapse with `cancelReason = 'stay-started'`. `complement` links are not concerned (they are paid on
   site). A link **minted on or after** the arrival day (the operator sends the solde to a guest who
   arrived without paying) is not lapsed by this rule; only its 36 h apply. « Séjour passé » means
   exactly this: 00:00 Europe/Paris on the arrival day, not the check-in hour, not the departure
   (decided 2026-10-30, §9 Q3). The arrival day is the converted stay's when the devis was converted
   (a re-dated stay counts at its new date), the devis's own otherwise: a devis whose dates have
   arrived lapses its request too (reading recorded at implementation, 2026-10-30).
10. **An unpaid stay whose dates are taken withdraws its links** (decided 2026-10-30, §9 Q4). Every open
    link of an **unpaid** row (rule 31), whether a devis not converted or a reservation, is withdrawn
    (`cancelReason = 'dates-taken'`) as soon as **a stay that holds the dates** (rule 37) overlaps one of
    its nights. Two unpaid rows on the same nights both keep their links: the first paid wins, and its
    payment, which makes it hold the dates, withdraws the other's (decided 2026-10-30, §9 Q11). The
    overlap is the reservation part of what the public `pay` already reads (`getOccupiedReservations` →
    `buildOccupiedDatesFromReservations` + `rangeHasBlockedNight`, neighbours' late check-out / early
    check-in included; establishment closures left out, §9 Q10), computed **without the row itself** and
    without the stay its devis became. Adrien's two cases:
    - a direct devis sent with its link, then a platform booking imported by iCal on overlapping dates:
      the import withdraws the devis's link, and the over-booking cannot happen;
    - two devis on overlapping dates: the first paid is converted into a reservation, which withdraws
      the other's link.
    The check runs synchronously after every write that makes a reservation appear on nights or move
    onto them (rule 32), the deactivation following the commit; and in the lifecycle pass (rule 16) as
    the safety net for any path rule 32 would miss.
11. **No link is minted on an unpaid row whose dates are taken.** `mintPaymentLink` and
    `mintInstallmentLink` refuse before any provider call when a stay that holds the dates (rule 37)
    overlaps: 409 `DATES_UNAVAILABLE`, « Dates déjà prises par une autre réservation : aucun lien
    créé. » (the public `pay` keeps its own check and wording). An overlap with another **unpaid** row
    refuses nothing (rule 10, first paid wins).
12. **A stay set aside (`superseded`) withdraws its links** (`cancelReason = 'superseded'`), in the
    lifecycle pass and in `supersededDuplicates` when it sets the row aside.
13. **Cancelled and deleted stays keep their current behaviour** (§1.2): immediate deactivation, delete
    refused when it fails. The lifecycle pass also catches any open link whose stay is `cancelled` or
    missing (defence in depth: `cancelReason` `NULL` resp. `orphan`).

### 3.E Payments around the deadline (the 35 h 59 race)

14. **A payment made before the deactivation reached the provider is booked.** Three paths see it:
    - the **webhook** (already processes `open | expired`): `processPaidLink` → `markPaid`
      (`expired → paid`) → the normal effect and confirmation;
    - the **lifecycle pass**, which deactivates **first** and reads the payment **after** (rule 18), so
      no payment can start after the read;
    - one **last look** (rule 19) for a payment the provider completed after that read (a 3-D Secure
      step in flight at the deactivation).
    For a withdrawn link, the existing withdrawn handling applies (alert, nothing booked, refund), plus
    the orphan alert of rule 3; a `dates-taken` link found paid is the exception, recorded on the fiche
    (rule 33).
15. **A new link minted while the old one was paid at the deadline** is the existing double-payment
    case: the first payment settles the bucket, `retireSettled` retires the second link; if both were
    paid, `secondPaidLink` records the refund owed and alerts (rules 23-24, 31 of plugins-phase-3a).
    Nothing new.

### 3.F The lifecycle pass

16. **One pass applies rules 7, 9, 10, 12, 13.** `utils/paymentLinkLifecycle.js` `retireLapsedAndWithdrawn(database, { now })`
    selects, in SQL, every `open` link that crossed a trigger, moves it in one transaction
    (`UPDATE … WHERE id = ? AND status = 'open'`, so a webhook that paid it meanwhile wins), and returns
    the moved rows. Two refinements are read in JS on the rows SQL selected: Qonto's zero-time sentinel
    (no expiry) and the Paris day a link was minted (rule 9), which SQLite cannot compute. Order inside
    the pass: a cancelled or missing stay first (rule 13), then the validity (rule 7), then the arrival
    (rule 9) — a link past several triggers carries the first one's reason. It runs:
    - at the start of every poll pass (`runPaymentPoll`, before `retryPendingCancellations`);
    - from a dedicated plugin job `payment-link-lifecycle` every **15 minutes**, so a validity ends
      within 15 minutes of its 36 h rather than at the next 8-hour poll tick. The job makes provider
      calls only for the rows it moved (and the owed ones, rule 18), never for open links.
17. **The poll no longer lapses links on the provider's expiry alone.** `retireExpired` becomes the
    validity branch of rule 16 (it already reads `expiresAt`; it now also sets the reason and the
    marker). The « without a provider call » wording of payment-polling-fair-use rules 1-2 is amended:
    the expiry is decided without a call, the deactivation then costs one.
18. **Deactivating a link that left `open`.** `retryPendingCancellations` now lists `cancelled` **and**
    `expired` rows with `remoteCancelPendingAt`. For an **expired** row the order is: `cancelLink`, then
    `getPayment`:
    - paid → `processPaidLink` (booked as a payment, rule 14), marker cleared;
    - not paid → marker cleared, `lastLookAt` set to now + 1 h (rule 19);
    - `cancelLink` fails → `alreadyInactive` check as today (a link already dead at the provider is then
      read as above); otherwise the marker stays for the next pass, a `RATE_LIMITED` stops the pass
      without the status call; a `getPayment` that fails after the deactivation keeps the marker too
      (both calls are made again next pass). A refused deactivation (other than a rate limit) still
      reads the payment: a provider refuses to deactivate a link already paid, whose webhook may be lost;
      paid → rule 14, unpaid → the marker stays (review of #894). On the rule-8 path
      (`deactivateAbandonedLinks`), such a refused link found paid is booked at once through
      `processPaidLink` (this rule's path) and the request is refused: 409 `LINK_ALREADY_PAID`, « Le lien
      en cours vient d’être payé : paiement enregistré, aucun nouveau lien créé. ». The fiche reloads as
      paid. A later request on the same bucket (acompte: acompte or full links; solde: solde or full; full:
      all three; an échéance: its own links) first reads its newest lapsed link still owed a deactivation:
      paid → booked and refused the same way, unreadable → 502 `PROVIDER_UNREACHABLE`, unpaid → minted as
      usual (re-review of #894).
    For a **cancelled** row the existing order (read, then deactivate) and branches are kept, plus the
    orphan branch of rule 3 and the dates-taken branch of rule 33.
19. **One last look.** The first lifecycle pass after `lastLookAt` reads the payment once more
    (`getPayment`, origin `last-look`); paid → rule 14; then `lastLookAt` is cleared for good. Cost: one
    call per lapsed link, once. The pass claims the look (clears `lastLookAt`) before the call, so two
    passes at once read it once; a call that fails puts it back for the next pass.
20. **When a deactivation keeps failing.** The marker keeps the link on the retry list (unchanged rule
    8); the ledger row reads « Lien expiré · désactivation en attente chez {Prestataire} » (rule 24).
    After **24 h** of failures the admin gets one notification per link, « Lien de paiement encore actif
    chez {Prestataire} : à désactiver depuis {Prestataire}. » (the plugins-phase-3a rule 9 wording),
    stamped in `deactivationAlertedAt` so it is sent once. A lapsed link still payable is not a money
    risk (rule 14 books it); a withdrawn one is caught by rule 8 as today. Reading recorded at
    implementation (2026-10-30): the alert concerns **lapsed** links only; it is sent by a pass whose
    deactivation attempt failed, when the marker (stamped at the lapse) is 24 h old or more; push and
    e-mail (`notifyDeactivationStuck`), with the fiche link when the stay exists.

### 3.G Fair use and idempotency

21. **Provider calls.** Per link, over its whole life after this spec: one `cancelLink` + one
    `getPayment` at the deactivation + one `getPayment` at the last look — 3 calls once, instead of one
    `getPayment` per day for as long as the link stays open (today an open link is polled daily
    forever). At GuestFlow's volume (a few links a day) this is far below Qonto's 1 000 requests / 10 s
    and 10 000 / 10 min. A `RATE_LIMITED` stops the job like the poll; the rest waits for the next run.
22. **Idempotency.** Every transition is a conditional `UPDATE` on the expected status; the boot
    migration is keyed in `migrations`; the job shares the `retryPendingCancellations` chain (no two
    runs of the same scope at once) and skips while a poll pass runs; `cancelLink` on an already
    inactive link is absorbed by `alreadyInactive`; a webhook replay finds the link `paid` and does
    nothing (`markPaid` flips once); a due last look is claimed before it is read (rule 19). Only the
    lifecycle job skips: a poll tick that meets a running lifecycle pass waits for it, then runs.
23. **The plugin off.** Without a provider nothing is deactivated nor read: the lifecycle job is the
    plugin's, so it does not run, and links keep their state. When the plugin comes back the first run
    catches up (rules 16, 18). The existing uninstall guard on `remoteCancelPendingAt` rows
    (`pluginsModel`) now counts `expired` rows with the marker too. It already counted every row with
    the marker, whatever its status; what had to change is `markPaid`, which now clears the marker and
    `lastLookAt` of the link it flips — otherwise a lapsed link paid by the webhook kept its marker and
    blocked the uninstall for good (reading recorded at implementation, 2026-10-30). « Qonto not
    connected » counts as off: neither the poll nor the lifecycle job runs. The refusal reads « 1 lien
    retiré ou expiré encore actif chez le prestataire : désactivation en cours, réessayer plus tard. »
    (plural « N liens retirés ou expirés encore actifs … »; review of #894).

### 3.H What the operator sees

24. **The ledger row says when the link stops.** `reservationLedger.linkDetail` (server-worded, the
    client prints it):
    - open: « Lien envoyé le {jour} · {montant} · valable jusqu'au {jour} à {hh:mm} »;
    - expired, `validity`: « Lien expiré le {jour} à {hh:mm} »; `stay-started`: « Lien expiré · séjour
      commencé »; with the marker still set: « · désactivation en attente chez {Prestataire} »;
    - cancelled, `dates-taken`: « Lien retiré · dates prises »; `superseded`: « Lien retiré · doublon
      écarté »; `orphan` never shows (no fiche).
    « Renvoyer la demande » keeps rule 28 of the ledger spec: offered on a due row whose link is no
    longer open — so on an expired link — and **not** on `dates-taken` (rule 11 would refuse it).
25. **The devis action bar** « Demander le paiement » keeps working after an expiry (it mints a fresh
    link, rule 8). On a devis or a reservation whose dates are taken, it and « Renvoyer la demande »
    are refused with rule 11's message, shown in the existing error dialog / toast.

### 3.I E-mails that carry a link

26. **Request e-mails always carry a valid link.** The five request templates (`deposit_request`,
    `balance_request`, `full_request`, `installment_request`, and the dashboard / queue sends that use
    them) are sent manually; their link is resolved **at send time** by `ensurePaymentLink` /
    `ensureInstallmentLink`, so rule 8 guarantees ≥ 24 h left. A preview rendered earlier may show an
    older URL: the preview of a request template prints « (lien de paiement créé à l'envoi) » in place
    of `{{paymentLink}}` when no open link has ≥ 24 h left.
    Readings recorded at implementation (2026-10-30): a request template sent from the e-mail dialog or
    the « à valider » queue (`emailsController.send`) resolves its link the same way, through
    `paymentRequests.ensureLink` (`utils/paymentRequests.js`), before the send — so the placeholder
    always tells the truth, and a mint refusal (bucket already paid, provider error) refuses the send
    with the service's own message, nothing sent. The placeholder appears only while a provider is
    connected (the send can mint); without one the template's no-link branch shows, and a provider
    declared but not connected still re-offers an open link that has 24 h left (no mint, no provider
    call). `{{paymentLinkValidUntil}}` previews as « (36 h après l'envoi) » beside the placeholder. An
    installment request follows the same rule with its own open link.
    Review of #897 (2026-10-30): the e-mail dialog posts the **rendered** preview as `overrides`, so the
    send fills it, not the template: the placeholders, and any URL of the stay's links the preview showed
    (read before the send may retire it), become the resolved link, with its own end in place of the old
    one. A placeholder still present after rendering refuses the send (409 `PAYMENT_LINK_PLACEHOLDER`,
    « Lien de paiement indisponible : l'e-mail n'est pas envoyé. », nothing mailed, nothing logged as
    sent); a text that will be given a minted link but carries none (a preview of the no-link branch, a
    deleted link) is refused before the mint (409 `PAYMENT_LINK_MISSING`, « Le lien de paiement manque
    dans le texte : l'e-mail n'est pas envoyé. », worded for a stale preview and a deliberate removal alike). `deposit_request`, `balance_request` and `full_request`
    print their link outside any condition: with no link resolved (no connected provider, no open link
    with 24 h left) they are refused, 409 `NO_PAYMENT_PROVIDER` with the fiche's wording; the acompte
    reminder keeps its no-link branch. A send that cannot leave — no address, an invalid typed one, SMTP
    not configured (logged as failed) — is refused before any link is minted.
27. **Reminders.** `deposit_reminder` gets its link at send time (rule 35). `balance_reminder` never
    gets a link (unchanged).
28. **A link already in an inbox that lapses.** The guest who opens it after the deactivation sees the
    provider's own « inactive link » page (not ours, not translatable). Before the deactivation reaches
    the provider, the link still works and the payment is booked (rule 14). The e-mail states the end of
    validity (rule 36), so the guest knows to ask for a new link.

### 3.J The WordPress pay page (`/public/v1`)

29. **`pay` is unchanged in contract.** It mints or reuses through `ensurePaymentLink`, so rule 8 applies:
    a guest who comes back after 36 h and clicks « Payer » gets a fresh link at today's amount, after the
    availability and stay-rule checks it already makes.
30. **`status` sees a lapsed link.** Besides the open link, `status` reads the devis's latest `expired`
    link once per `OWED_RETRY_MINUTES` (5 min) while its `lastLookAt` is set or it lapsed less than 24 h
    ago, and processes it if paid (`confirmed` / `conflict` as today). When the devis's latest link is
    lapsed and unpaid and none is open, `status` answers **`expired`** (new value, additive). The plugin
    (`blocks/booking/view.js` `renderStatus`) stops polling on `expired` and shows « Ce lien de paiement
    a expiré. Refaire la réservation depuis la page du logement. » (FR / EN keys `paymentExpired`).
    An older plugin treats the unknown value as `pending` and ends on « paymentPending » after its 20
    tries: degraded, not broken — a **Y** change, not an X (§5.6 of CLAUDE.md).
    Readings recorded at implementation (2026-10-30): no lapse timestamp is stored; the moment a link
    lapsed is its `expiresAt` (rule 8 writes the lapse moment there), else, for a `stay-started` lapse,
    00:00 Paris on the devis's `startDate`. The read is a `getPayment` only (the deactivation stays the
    lifecycle pass's), counted through `lastPolledAt` like the retired-link read. « Latest » is the
    devis's own newest link: a withdrawn (`cancelled`) newest link answers `pending` as before. « Unpaid »
    is established only once no look is owed: while its `lastLookAt` or `remoteCancelPendingAt` is set (a
    payment in flight at the deadline may still land), `status` answers `pending`, and `expired` once both
    are cleared (review of #897: the guest coming back from the provider is exactly the one who may have
    just paid). Plugin
    1.19.0, English « This payment link has expired. Please book again from the accommodation's page. »
    ([wordpress-plugin.md](wordpress-plugin.md) rule 34).

### 3.K Decisions of 2026-10-30 (appended; rule numbers are identities)

31. **« Unpaid » (rule 10).** A row is unpaid when no money of the stay is recorded on it nor on the devis
    it came from: `depositPaid`, `balancePaid`, `complementPaid`, `endOfStayComplementPaid` and their
    `…PaidCash` twins all 0, no `reservation_installments` row `paid = 1`, no `payment_links` row `paid`
    (or carrying a `paidAt`). This is the `CARRIES_MONEY` predicate of `supersededDuplicates.js`, moved
    to `utils/stayMoney.js` and shared. A row with an acompte paid and its solde link still open is
    therefore **not** unpaid: it keeps its solde / installment links, and its dates are held (rule 37);
    an iCal booking that lands on them is an over-booking (rule 39) (decided 2026-10-30, §9 Q9).
    A platform reservation is concerned only if it carries a link (it normally carries none).
32. **Every way an overlapping reservation can appear calls rule 10.** One helper,
    `withdrawLinksOverlapping(database, { propertyId, startDate, endDate, causeId })` (in
    `utils/paymentLinkLifecycle.js`), withdraws in the caller's transaction and returns the links for the
    deactivation after the commit (the `icalCancellationModel` pattern). It is called from:
    | Source | Code | Notes |
    |---|---|---|
    | iCal import, new booking or re-dated one | `models/propertyIcalModel.js` (insert / date update of a synced row) | Adrien's case (a) |
    | Manual creation or date / logement change of a reservation | `models/reservationsModel.js` create / update (`performUpdate`) | also covers the SAS and every save-path caller |
    | Platform intakes (Booking, Airbnb, Gîtes de France) | through the fiche save path (`performUpdate`) — they complete an iCal fiche and may correct its dates | no own code |
    | A devis becoming a reservation: paid link (webhook, poll, public `/status`, retry), « Convertir », acceptance | `models/devisModel.js` `convertToReservation` (the single conversion function) | Adrien's case (b) |
    | The website booking engine | creates a devis (`publicBookingRequestController` → `devisModel.create`), which blocks nothing; it reaches rule 10 when its payment converts it (row above) | no own code |
    | A duplicate set aside brought back (« Rétablir ») | `reservationsController` `POST /reservations/:id/restore` | |
    | Boot migrations that create or re-date reservations (`devisFusionMigration`) | — | caught by the lifecycle pass (rule 16) |
    Establishment closures never withdraw links: a closure cannot be saved over an open payment request
    (rule 41, decided 2026-10-30, §9 Q10).
33. **A `dates-taken` link found paid is recorded on the fiche, in date conflict** (decided 2026-10-30,
    §9 Q5). When the deactivation lost the race (payment in flight, webhook, retry, last look), the money
    is booked like a live payment of that link: `markRetiredLinkPaid(id, { reason: 'dates-taken' })`
    (`cancelled → paid`), then the effect of `applyPaidEffect` (a devis is converted with
    `allowConflict: true`; a reservation records the bucket), the row is stamped `bookingConflictAt`, no
    confirmation e-mail is sent, and the admin is alerted: push + e-mail « Paiement reçu sur des dates
    déjà prises — {montant} », with the fiche link, the overlapping reservation, and the action line
    « Action requise : déplacer le séjour ou le rembourser. » (`notifyPaidAfterCancel(link, { datesTaken })`
    and `notifyConflict`).
34. **Links already open at the upgrade get 36 h of grace from the install** (decided 2026-10-30, §9 Q2).
    An idempotent migration (`migrations.name = 'payment_link_validity_backfill_v1'`) sets, on every
    `open` link, `expiresAt = max(createdAt + 36 h, installedAt + 36 h)`, `installedAt` being the
    migration's own run time, and logs one line per link (`[migration:link-validity] link #… expires …`).
    Every open link was created before the install, so this is `installedAt + 36 h` in practice; it
    covers every type, `complement` links and those still carrying Qonto's `0001-…` sentinel included
    (reading recorded at implementation, 2026-10-30).
35. **The acompte reminder mints its link at send time, if the dates are still free** (decided
    2026-10-30, §9 Q6). `deposit_reminder` leaves `PAYMENT_LINK_TEMPLATES`'s read-only re-offer: its send
    (`emailsController.send`) resolves the acompte link through `ensurePaymentLink` like the requests
    (reuse with ≥ 24 h left, else a fresh link). When the dates are taken (rule 11) the reminder is
    refused — 409 `DATES_UNAVAILABLE`, « Dates déjà prises par une autre réservation : relance non
    envoyée. » — and rule 43 tells the guest, the operators and the dashboard (decided 2026-10-30,
    §9 Q12). The preview shows « (lien de paiement créé à l'envoi) » as in rule 26.
    Readings recorded at implementation (2026-10-30, PR3, the mint part; the refusal on taken dates comes
    with rule 11): the reminder's link is minted only while a provider is connected; without one the
    reminder leaves on its « Contactez-nous » branch, never with a stored link nobody reconciles. The
    template stays Manual: only its content and the link it carries change.
36. **`{{paymentLinkValidUntil}}`** (decided 2026-10-30, §9 Q7). A new template token (`templateTokens.js`,
    group `payment`), filled with the `expiresAt` of the link the send carries, in the guest's language
    and Paris time (« lundi 2 novembre à 18 h 00 » / « Monday 2 November at 6:00 pm »), empty with no link.
    The default request templates (`deposit_request`, `balance_request`, `full_request`,
    `installment_request`) and `deposit_reminder` gain one sentence after the link, FR « Ce lien est
    valable jusqu'au {{paymentLinkValidUntil}}. » / EN « This link is valid until
    {{paymentLinkValidUntil}}. », inside `{{#if hasPaymentLink}}` where the template has it. Content
    migration on untouched default templates only (the `email-language-fr-en` rule 6 pattern); an
    operator-edited template keeps its text and can use the token.
    Readings recorded at implementation (2026-10-30): the sentence sits on the line right after the link.
    « Untouched » is judged per side: a French `body` or English `bodyEn` equal, to the character, to one
    of the defaults GuestFlow ever shipped for that template (recognised by SHA-256, every version of the
    registry up to this change) gets the sentence inserted after its link, and nothing else changes
    (`payment_link_valid_until_sentence_v1`, `utils/migrateValidUntilSentence.js`). The defaults evolved
    without rewriting stored rows: on the shadow copy of 22/10 four of the five templates still held an
    older default (never edited), which a comparison with today's default alone would have skipped; all ten
    sides are recognised there. Any other text is the operator's: left as it is and named in the boot log. The formatter is `dateFr.formatMomentLong` (no year: a link lives 36 h; « 1er » on the
    first of the month; English 12-hour clock, « 12:15 am » after midnight). The money and the date travel
    the same way: `sendTemplate` hands the instant (`extraContext.dates`), the sender writes it in the
    guest's language. A template that prints the token outside `{{#if hasPaymentLink}}` is never chosen
    as the no-provider draft (`paymentRequestDraft`, like `{{paymentLink}}`).

### 3.L Decisions of 2026-10-30, second round (Q9–Q12)

37. **A paid acompte holds the dates; only a cancellation frees them** (decided 2026-10-30, §9 Q9). A stay
    **holds its dates** when it is a `kind = 'reservation'` row and either carries money (rule 31: an
    acompte paid is enough, the solde may be open) or comes from a platform (`!isDirectChannel(platform)`:
    the platform collected it). From then on no new reservation can be taken on its nights, the solde
    being paid or not; the only thing that frees them for sale is cancelling the stay (`kind =
    'cancelled'` is never counted). One predicate, `stayMoney.holdsDates(row)`, says it everywhere. A
    devis never holds dates; an unpaid direct reservation keeps today's behaviour (it blocks the
    calendar, rule 38, but does not withdraw anyone's links, rule 10).
38. **Where the hold is enforced — what the code does today and what changes.** Availability already
    counts every `kind = 'reservation'` row, paid or not (`reservationsModel.validateAvailability`,
    `getOccupiedReservations`), so the hold is already enforced on every path GuestFlow decides:
    | Path | Code today | Change |
    |---|---|---|
    | Website engine: calendar, quote, booking request | `computeBlockedDates` (`publicCatalogController`, `publicBookingRequestController` 409 `DATES_UNAVAILABLE`) | none |
    | Public payment `pay` | `computeBlockedDates` → 409 `DATES_UNAVAILABLE` | none |
    | Operator quote (devis) creation / date or logement change | **no availability check**: a devis may be written on taken nights | refused on held dates (rule 46) |
    | Devis conversion (« Convertir », acceptance) | `devisModel.convertToReservation` → `validateAvailability` → 409 `DATES_UNAVAILABLE` | none |
    | Devis conversion by a paid link | `convertToReservation(…, { allowConflict: true })` + `bookingConflictAt` + `notifyBookingConflict` | the alert says « dates réservées » when the overlapped stay holds them (rule 39); rule 33 for a withdrawn link |
    | Manual creation, date / logement change | `reservationsController` create (l. 1427) / update (l. 2064) → `validateAvailability` | none (a save that keeps a pre-existing conflict stays allowed, l. 2038) |
    | « Rétablir » a duplicate | `reservationsController.restore` → `validateAvailability` | none |
    | Platform intakes | fiche save path | none |
    | **iCal import / re-dated iCal booking** | inserted **without** `validateAvailability` (`propertyIcalModel`), `bookingConflictAt` + `notifyBookingConflict(…, { origin: 'ical' })`; a date drift on a locked iCal fiche waits for approval (`icalDateDriftModel`) | rule 39 |
39. **A platform booking on held dates is an over-booking alert.** The platform is the authority on its
    own booking, so the import still records it (unchanged), stamped `bookingConflictAt`. When the stay
    it overlaps holds the dates (rule 37), `notifyBookingConflict` says so: push + e-mail « Surbooking :
    {plateforme} sur des dates réservées » with both stays and the line « Dates réservées par l'acompte
    de {réservation}. Annuler l'une des deux réservations. », and the dashboard's existing conflict
    card shows the same wording. Approving an iCal date drift onto held dates shows the same warning in
    the approval dialog before it applies. Nothing is cancelled automatically.
40. **A closure cannot be saved over a reservation** (decided 2026-10-30, §9 Q10). Unchanged in substance
    (`establishmentClosuresController` 409 `RESERVATION_OVERLAP`), reworded short and impersonal:
    « Réservation sur ces dates : fermeture impossible. », and the answer now lists the stays
    (`reservations: [{ id, label, url }]`, `label` like « 22341 · Marie Dupont · 02/11 → 05/11 »,
    `url` = `/reservations/:id`) so the dialog links each one.
41. **A closure cannot be saved over an open payment request; it warns first.** An open payment request
    is a devis (or a fiche) with an `open` link on nights the closure covers (one logement, or every
    logement for an establishment-wide closure). Save is refused: 409 `OPEN_PAYMENT_REQUEST`,
    « Demande de paiement en cours sur ces dates : la retirer avant d'enregistrer la fermeture. », with
    `requests: [{ reservationId, kind, label, amountLabel, validUntilLabel, url }]` (`label` like
    « Devis D-2026-118 · Marie Dupont », `amountLabel` « 840,00 € », `validUntilLabel` « lien valable
    jusqu'au 01/11 à 06:00 »). The dialog shows the same list **before** Save, as soon as the logement
    and both dates are set: `GET /api/establishment-closures/conflicts?propertyId&startDate&endDate`
    (`{ reservations: [...], requests: [...] }`, the same server checks, read-only), with the warning
    « Demande de paiement en cours sur ces dates. » and one « Ouvrir » link per row. Save stays enabled
    (the server is the judge) and its refusal shows the same list. The operator withdraws each request by
    hand (rule 42), comes back, and saves. Order of the checks: `INVALID_RANGE`, `INVALID_PROPERTY`,
    `RESERVATION_OVERLAP`, `OPEN_PAYMENT_REQUEST`, `CLOSURE_OVERLAP`. A devis **without** an open link on
    those nights gets a warning line too (rule 49) but never blocks the save.
42. **« Retirer le lien », by hand.** The ledger row of an open link (fiche and devis) gains a text button
    « Retirer le lien » → confirmation « Retirer ce lien ? Il ne pourra plus être payé. » (Retirer /
    Annuler) → `POST /api/payments/links/:id/withdraw` → `retireOpenLink` (refused 409
    `LINK_ALREADY_PAID` if the guest has just paid), `cancelReason = 'operator'`, deactivated at the
    provider (marker on failure). Ledger label « Lien retiré le {jour} »; « Renvoyer la demande » is then
    offered as for any retired link. Read-only stays (cancelled, superseded) never show it.
43. **A stay whose dates were taken tells everyone, once** (decided 2026-10-30, §9 Q12, trigger moved by
    §9 Q14). `utils/datesTakenNotice.js` `notifyDatesTaken(reservationId, { takenByReservationId })` runs
    when a stay's link is **withdrawn because its dates were taken** — rule 10, whatever the cause: an
    overlap, the first of two devis paid, a platform booking arriving by iCal — right after the commit
    that withdrew it. The refused acompte reminder (rule 35, at the operator's send or when the pass that
    fills « Emails à envoyer » finds it due on taken dates, where it is never proposed) is one more path
    into the same call. It never runs for a link that lapsed (36 h, stay started), nor for « Retirer le
    lien » (rule 42), nor for a cancellation or a deletion. It does three things, **once per stay** (key
    `dates-taken:<reservationId>`, held in `dates_taken_notices`; a second call finds the row and does
    nothing, so a refused reminder after the withdrawal never sends a second e-mail):
    - **e-mails the guest at once** with the `dates_unavailable_notice` template (rule 44);
    - **pushes every operator** (the `pushNewReservation` fan-out): « Dates prises — {client} », body
      « {logement}, {dates} : dates prises par {réservation}, client prévenu. » (or « client non prévenu :
      {raison} » when the e-mail could not leave), linking the fiche;
    - **raises a dashboard card** « Dates prises » (one row per stay: client, logement, dates, the stay
      that took them, notice sent or not, « Ouvrir » and « Vu »), fed by `GET
      /api/dashboard/dates-taken` and acknowledged by `POST /api/dashboard/dates-taken/:id/acknowledge`.
    The refused reminder is logged in `email_log` as `acknowledged-skip` with `errorMessage =
    'DATES_UNAVAILABLE'` and leaves the queue.
44. **The one guest e-mail that leaves without validation.** Adrien's standing rule is that no guest e-mail
    leaves without his validation (every template in « Manuel » `sendMode`, `autoSendPolicy` failing
    closed, specs/no-automatic-email-without-approval.md). **`dates_unavailable_notice` is an explicit
    exception, granted by Adrien on 2026-10-30**, for this single case: a guest holding a payment
    request for dates someone else just took must not be left to find a dead link.
    - It never goes through `autoSendPolicy` nor the manual queue: `notifyDatesTaken` calls
      `sendReservationTemplateEmail` directly, the way an operator click does. `autoSendPolicy` is
      untouched and still fails closed for every other template; the exception is one named constant,
      `AUTO_SEND_EXCEPTIONS = ['dates_unavailable_notice']` in `autoSendPolicy.js`, with this rule's
      reference, read only by `datesTakenNotice.js` and asserted by a test.
    - It stays traceable: one `email_log` row (`status` `sent` or `failed`, rendered subject and body,
      recipient, `occurrenceKey = 'dates-taken:<reservationId>'`), visible in the fiche's e-mail history
      like any other, with the history label « Envoyé automatiquement (dates prises) ».
    - It fails closed on its own conditions: the template disabled by the operator, no e-mail address,
      no English version for an English-speaking guest, SMTP not configured → nothing leaves, the push
      and the card say « client non prévenu » with the reason.
    - It is sent once per stay (rule 43), even if several links are withdrawn or reminders refused.
    - It carries no link and no amount request.
45. **The `dates_unavailable_notice` template** (`defaultEmailTemplatesRegistry.js`, `sendMode` shown as
    « Automatique (exception) » and not editable, text editable; seeded FR and EN; tone of
    `guest-email-tone`: warm, short, never selling):
    - FR, subject « Vos dates {{propertyWithArticle}} ne sont plus disponibles »; body:
      « Bonjour {{clientFirstName}},
      Les dates que nous vous avions proposées {{propertyWithArticle}}, du {{arrivalDateLabel}} au
      {{departureDateLabel}}, viennent d'être réservées et ne sont plus disponibles. Le lien de paiement
      que vous avez reçu ne fonctionne plus, et rien ne vous a été prélevé.
      Nous sommes désolés de ne pas avoir pu les garder pour vous. Si d'autres dates vous conviennent,
      répondez simplement à ce message.
      À bientôt,
      {{senderName}} »
    - EN, subject « Your dates at {{propertyName}} are no longer available »; body:
      « Hello {{clientFirstName}},
      The dates we offered you at {{propertyName}}, from {{arrivalDateLabel}} to
      {{departureDateLabel}}, have just been booked and are no longer available. The payment link you
      received no longer works, and nothing has been charged.
      We are sorry we could not hold them for you. If other dates suit you, simply reply to this message.
      See you soon,
      {{senderName}} »

### 3.M Decisions of 2026-10-30, third round (Q13–Q16)

46. **A devis cannot be saved on held dates** (decided 2026-10-30, §9 Q13). Creating a devis, or changing
    its dates or logement, onto nights a stay holds (rule 37) is refused: 409 `DATES_HELD`, « Dates déjà
    réservées : devis non enregistré. », with `stays: [{ id, label, url }]` (the `ConflictList` shape of
    rule 40; `label` like « 22341 · Marie Dupont · 02/11 → 05/11 »). Enforced in `devisModel.create` and
    `devisModel.update` (operator source) with `stayMoney.holdsDates`. Other edits of a devis already on
    held dates (text, options, price) are not refused, only a move onto them. An unpaid reservation or
    another devis on the nights refuses nothing (first paid wins, rule 10). The website booking request
    keeps its own `DATES_UNAVAILABLE` check (rule 38).
47. **The notice's trigger is the withdrawal for taken dates** (decided 2026-10-30, §9 Q14) — written in
    rule 43, which it amends.
48. **A devis whose dates were taken stays as it is** (decided 2026-10-30, §9 Q15). Nothing changes on it
    automatically: it stays in the devis list and its fiche, with a « Dates prises » chip in the action
    bar and on the list row (server-shaped `datesTaken: { label, takenBy: { id, label, url } }`). The
    operator decides to offer other dates (a date change, which rule 46 checks) or to archive it.
49. **A closure over a devis without an open link warns, and saves** (decided 2026-10-30, §9 Q16). The
    closure dialog shows the same kind of amber warning line, « Devis en cours sur ces dates. », with
    « Ouvrir » per devis (the `conflicts` answer gains `devis: [{ reservationId, label, url }]`). Save stays
    allowed: unlike an open payment request (rule 41) there is nothing to withdraw, since the guest holds
    no link that could be paid on closed nights. This is how Adrien's « same warning » is read: same
    line and link, no refusal.

**Edge cases:**
- Link paid at 35 h 59, webhook lost, pass at 36 h 10 → deactivation, then `getPayment` says paid →
  booked and confirmed as a normal payment (rule 18).
- Payment completed by the provider after our read (3-D Secure in flight) → the webhook books it; if
  the webhook is lost too, the last look (rule 19) books it 1 h later; beyond that, the bank
  reconciliation shows an unmatched credit.
- Operator clicks « Renvoyer la demande » at 35 h 59 while the guest is paying the old link →
  `retireOpenLink` reads the old link paid → 409 `LINK_ALREADY_PAID`, no new link (existing guard).
- Orphan link paid between two passes → rule 3 alert, link `paid`, nothing booked.
- Devis link paid between the overlapping write and rule 10's withdrawal, or while the deactivation is
  in flight → rule 33: recorded, converted in conflict, alert « déplacer ou rembourser ».
- Two devis on the same nights, both with links: both stay payable; the first paid converts (rule 32),
  holds the dates (rule 37) and withdraws the other's link; if the second was paid in the same seconds,
  rule 33.
- The second devis's guest is told as soon as its link is withdrawn (rules 43-45); its acompte reminder
  falling due later is refused and sends nothing more; the devis stays, marked « Dates prises » (rule 48).
- A closure typed over a devis whose link is open → warning with « Ouvrir »; « Retirer le lien » on the
  devis; the closure then saves (rules 41-42).
- Direct devis + iCal booking on overlapping nights: the import withdraws the devis's link; « Demander
  le paiement » is then refused (rule 11).
- Reservation with an acompte paid and a solde link open, overlapped by an iCal booking → not unpaid
  (rule 31): links kept, dates held (rule 37), over-booking alert (rule 39).
- Installment due on the arrival day, link minted the day before → rule 9 lapses it at 00:00 on the
  arrival day; the operator collects at the door (SAS) or sends a new one that day (exempt from rule 9).
- A stay re-dated later (start moved forward) after its link lapsed for `stay-started` → the link stays
  lapsed; the operator sends a new one.
- Provider down for days → links lapse locally on time, their deactivation is owed; a payment meanwhile
  is booked (lapsed) or caught by rule 8 (withdrawn); rule 20 alerts after 24 h.

---

## 4. Architecture

> **Fat backend, thin frontend.** Every deadline, label and refusal is computed by the server. The
> client prints `link.label` and offers the `resend` action it already receives; it does no date math
> (no countdown).

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `constants/` | `paymentLinks.js` | C | `PAYMENT_LINK_VALIDITY_HOURS = 36`, `PAYMENT_LINK_MIN_REMAINING_HOURS = 24`, `LAST_LOOK_DELAY_MINUTES = 60`, `DEACTIVATION_ALERT_AFTER_HOURS = 24`, reason names |
| `utils/` | `paymentLinkLifecycle.js` | C | `retireLapsedAndWithdrawn(database, { now })` (rule 16: SQL selection + transitions), `withdrawLinksOverlapping` (rules 10, 32), `validityOf(link, now)` (rule 8), `listLastLookDue` (rule 19); pure, injected `now` |
| `utils/` | `paymentRequestService.js` | T | `expiresAt` at mint (rule 6); reuse only with ≥ 24 h left (rule 8); `DATES_UNAVAILABLE` on an unpaid row whose nights are taken (rule 11) |
| `utils/` | `stayMoney.js` | C | `carriesMoney(database, rowId)` (rule 31, moved out of `supersededDuplicates.js`) and `holdsDates(database, row)` (rule 37) |
| `utils/` | `datesTakenNotice.js` | C | `notifyDatesTaken(reservationId, { takenByReservationId })`: guest notice, operator push, dashboard row, once per stay; called after every `dates-taken` withdrawal (rules 10, 32) and from the refused reminder (rules 43-44) |
| `utils/` | `autoSendPolicy.js` | T | `AUTO_SEND_EXCEPTIONS = ['dates_unavailable_notice']`, documented; the policy itself unchanged (rule 44) |
| `utils/` | `defaultEmailTemplatesRegistry.js`, `defaultEmailTemplatesSeed.js` | T | Template `dates_unavailable_notice` FR / EN (rule 45) |
| `utils/` | `notificationService.js` (conflict) | T | `notifyBookingConflict` wording when the overlapped stay holds the dates (rule 39) |
| `utils/` | guest-email pass that fills « Emails à envoyer » | T | Never proposes a `deposit_reminder` on taken dates; calls `notifyDatesTaken` (rule 43) |
| `utils/` | `paymentPollRunner.js` | T | `runLinkLifecycle` (rule 16), run at the start of `runPaymentPoll` and by the plugin job; `no-reservation` → orphan alert (rule 3); expired rows in the retry loop, deactivate-then-read (rule 18); last look (rule 19); stuck-deactivation alert (rule 20); `dates-taken` paid → booked in conflict (rule 33) |
| `utils/` | `paymentLinkDeactivation.js` | T | `deactivateAbandonedLinks` keeps the row's status (`expired` stays `expired`) and stamps the outcome |
| `utils/` | `notificationService.js` | T | `notifyPaidAfterCancel` orphan branch (rule 4), no fiche URL; `datesTaken` wording « déplacer ou rembourser » (rule 33); `notifyDeactivationStuck` (rule 20) |
| `utils/` | `reservationLedger.js` | T | Labels of rule 24; no `resend` on `dates-taken` |
| `utils/` | `supersededDuplicates.js` | T | Withdraws the links of a row it sets aside (rule 12); reads `stayMoney.carriesMoney` |
| `utils/` | `templateTokens.js`, `defaultEmailTemplatesRegistry.js` | T | Token `paymentLinkValidUntil` and the default FR / EN sentence (rule 36) |
| `utils/` | `paymentLinksProviderMigration.js` | T | `migrateLinkLifecycleColumns`: columns `lastLookAt`, `deactivationAlertedAt` (idempotent `ADD COLUMN`, run after the installments rebuild of `payment_links`; also in `schema.sql`) |
| `utils/` | `paymentLinkValidityBackfill.js` | C | Rule 34's one-shot migration, called from `database.js` |
| `utils/` | `localDate.js` | T | `localHourMinute` for the ledger's « à {hh:mm} » (rule 24) |
| `utils/` | `paymentEffectDeps.js` | T | Carries `notifyDeactivationStuck` (rule 20) |
| `models/` | `paymentLinksModel.js` | T | `create` takes `createdAt`; `retireExpired` → reason + marker (rule 17) through `lapseIfOpen`; `cancelIfOpen` takes a reason; `listRemoteCancelPending` / `restoreRemoteCancelPending` include `expired`; `setLastLook` / `claimLastLook` (rule 19); `claimDeactivationAlert` (rule 20); `markPaid` (`open | expired`) clears the marker and `lastLookAt` (rule 23) |
| `models/` | `reservationsModel.js`, `devisModel.js`, `propertyIcalModel.js` | T | Call `withdrawLinksOverlapping` in the write's transaction: create / `performUpdate` (manual, SAS, intakes), `convertToReservation`, iCal insert / re-date (rule 32) |
| `controllers/` | `reservationsController.js` | T | « Rétablir » (`restore`) calls `withdrawLinksOverlapping`; every caller of rule 32 deactivates the returned links after the commit |
| `models/` | `pluginsModel.js` | T | Uninstall guard counts `expired` rows with the marker (rule 23) |
| `controllers/` | `public/publicPaymentController.js` | T | `status`: lapsed-link read and `expired` answer (rule 30) |
| `controllers/` | `emailsController.js` | T | Preview placeholder « (lien de paiement créé à l'envoi) » (rule 26); `deposit_reminder` and the request templates resolve their link at send (`SEND_TIME_LINKS`, rules 26, 35), refused on taken dates (rule 35); fills `paymentLinkValidUntil` (rule 36) |
| `utils/` | `paymentRequests.js` | C | `createPaymentRequests()`: `available()`, `ensureLink(reservationId, type)` for the emails controller (rules 26, 35), the counterpart of `installmentRequests.js` |
| `utils/` | `installmentRequests.js` | T | `resolve` returns `openLink { url, expiresAt }`; the controller decides whether the send would reuse it (rule 26) |
| `controllers/` | `paymentsController.js` | T | `ensurePaymentLinkFor(id, type)` beside `ensureInstallmentLinkFor`; `sendTemplate` hands `expiresAt` as `extraContext.dates.paymentLinkValidUntil` (rule 36) |
| `utils/` | `reservationEmailSender.js`, `dateFr.js` | T | `extraContext.dates` written in the guest's language by `formatMomentLong` (rule 36) |
| `utils/` | `paymentRequestDraft.js`, `emailContextBuilder.js` | T | The no-link draft refuses a template printing the validity outside its condition; the token's default `''` (rule 36) |
| `utils/` | `migrateValidUntilSentence.js` | C | Rule 36's content migration, untouched sides only, called from `database.js` |
| `controllers/` | `establishmentClosuresController.js` | T | `RESERVATION_OVERLAP` reworded + `reservations[]`; new `OPEN_PAYMENT_REQUEST` + `requests[]`; `conflicts` handler (rules 40-41) |
| `models/` | `establishmentClosuresModel.js` | T | `findReservationOverlaps` (all, not the first), `findOpenPaymentRequests(propertyId, start, end)`, `findDevisWithoutLink` (rule 49) |
| `models/` | `devisModel.js` (create / update) | T | 409 `DATES_HELD` on held dates (rule 46); `datesTaken` marker in the devis payloads (rule 48) |
| `controllers/` | `devisController.js` | T | Relays `DATES_HELD` with `stays[]` |
| `routes/` | `establishmentClosures.js`, `payments.js`, `dashboard.js` | T | `GET /establishment-closures/conflicts`, `POST /payments/links/:id/withdraw`, `GET/POST /dashboard/dates-taken` |
| `controllers/` | `paymentsController.js` | T | `withdrawLink` (rule 42) |
| `controllers/` | `dashboardController.js` | T | Dates-taken card list / acknowledge (rule 43) |
| `models/` | `icalDateDriftModel.js` | T | The approval answer carries the held-dates warning (rule 39) |
| `plugins/online-payment/` | `index.js`, `paymentJobs.js` (C) | T | Job `payment-link-lifecycle` every 15 min (first run 15 min after boot), `inProgress` shared with `payment-poll` (rules 16, 22); `paymentJobs.createPaymentJobs` builds both jobs; plugin 1.5.0, `sdk ^2.18.0` |
| `plugins/sdk/` | `version.js`, `coreModules.json`, `coreModuleHistory.json` | T | SDK 2.18.0: `paymentPollRunner.runLinkLifecycle` (specs/plugins-phase-1-sdk.md rule 35) |
| `middleware/` | — | — | (none) |
| `database.js` | `database.js` | T | Table `dates_taken_notices` (rule 43); migrations `orphan_payment_links_withdrawn_v1` (rule 5), `payment_link_validity_backfill_v1` (rule 34), the default-template sentence on untouched templates (rule 36) |
| `tests/` | see §7 | C | One file per subject |

No new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `reservation/FinanceSection.jsx` | T | Prints `d.link.label`, `d.link.resend` and the new server-shaped `d.link.withdraw` action « Retirer le lien » with its confirmation (rule 42) |
| `pages/` | `EstablishmentClosuresPage.jsx` | T | Live `conflicts` check when logement + dates are set; warning list with « Ouvrir » links in the `FormDialog`; renders the 409 lists (rules 40-41) |
| `pages/` | `Dashboard.jsx` | T | « Dates prises » card (rule 43), built like the existing alert cards |
| `pages/` | `ReservationPage.jsx`, `DevisPage.jsx` | T | « Dates prises » chip (rule 48); `DATES_HELD` refusal with its `ConflictList` (rule 46) |
| `components/` | `ConflictList.jsx` | C | Generic « label · detail · Ouvrir » list for a refusal or warning that names records; used by the closure dialog now, reusable by any 409 that names stays |
| `services/` / `api.js` | `api.js` | T | `getClosureConflicts`, `withdrawPaymentLink`, `getDatesTakenAlerts`, `acknowledgeDatesTaken` |
| `pages/` | `ReservationPage.jsx` | — | Unchanged: the 409 `DATES_UNAVAILABLE` message reaches the existing error dialog |
| others | — | — | (none) |

**WordPress plugin** (`integrations/wordpress/guestflow-booking`): `blocks/booking/view.js` handles
`status: 'expired'`; i18n keys `paymentExpired` (FR / EN, `.po` and `.mo`); plugin 1.19.0 (header,
`GF_BOOKING_VERSION`, readme stable tag and changelog).

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `FinanceSection` ledger rows, `FormDialog`, `ConfirmDialog` / `useAppDialogs`, `ErrorAlert`, `PageActionBar`, the dashboard alert-card pattern | |
| **Created (new generic)** | `ConflictList` | A refusal that names records with a link to each is not closure-specific (reservation delete refusals, iCal conflicts could use it) |
| **Specific (kept feature-local)** | — | |

### 4.3 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/api/payments/reservations/:id/payment-links` | Rows carry `expiresAt` (already a column), the new `cancelReason` values, `remoteCancelPending` now also on `expired` rows. Additive. |
| POST | `/api/payments/reservations/:id/payment-links`, `/payment-emails` | New refusal 409 `{ error: 'DATES_UNAVAILABLE', message }` on an unpaid devis or reservation whose nights are taken; a reused link always has ≥ 24 h left. |
| GET | ledger payload (fiche) | `link.label` wording (rule 24). |
| POST | `/api/emails/send` (`deposit_reminder`, `deposit_request`, `balance_request`, `full_request`, `installment_request`) | Resolves the link at send (reuse with ≥ 24 h, else mint) and fills the posted preview with it; a mint refusal answers the service's `{ error, message }` and nothing is sent; 409 `PAYMENT_LINK_MISSING`, `PAYMENT_LINK_PLACEHOLDER`, `NO_PAYMENT_PROVIDER` (requests only) (rule 26); new refusal 409 `DATES_UNAVAILABLE` (rule 35). |
| GET | `/api/emails/preview` | `paymentLink` / `paymentLinkValidUntil` print « (lien de paiement créé à l'envoi) » / « (36 h après l'envoi) » when only the send will create the link (rule 26). |
| GET | `/public/v1/booking-requests/:id/status` | New `status: 'expired'` (additive). |
| POST | `/public/v1/booking-requests/:id/pay` | Unchanged contract. |
| POST / PUT | `/api/establishment-closures` | 409 `RESERVATION_OVERLAP` `{ error, code, reservations[] }` (reworded); new 409 `OPEN_PAYMENT_REQUEST` `{ error, code, requests[] }`. |
| GET | `/api/establishment-closures/conflicts?propertyId&startDate&endDate` | `{ reservations[], requests[], devis[] }`, read-only; `devis[]` only warns (rule 49). |
| POST | `/api/payments/links/:id/withdraw` | `{ link }`; 409 `LINK_ALREADY_PAID`; 404. |
| POST / PUT | `/api/devis` (operator create / update) | New 409 `DATES_HELD` `{ error, code, stays[] }` (rule 46); devis payloads gain `datesTaken` (rule 48). |
| GET / POST | `/api/dashboard/dates-taken`, `/api/dashboard/dates-taken/:id/acknowledge` | Card rows / « Vu ». |

---

## 5. Data model

- `payment_links.expiresAt` (exists): written by GuestFlow at mint, `createdAt + 36 h`.
- `payment_links.cancelReason` (exists, free text): new values `orphan`, `superseded`, `dates-taken`,
  `validity`, `stay-started`.
- `payment_links.lastLookAt TEXT` (new, nullable): when the last look is due (rule 19).
- `payment_links.deactivationAlertedAt TEXT` (new, nullable): rule 20's one-shot alert.
- Migration `orphan_payment_links_withdrawn_v1` (rule 5).
- Migration `payment_link_validity_backfill_v1`: `expiresAt` of links already open at the upgrade = install + 36 h at the earliest (rule 34).
- Content migration of the untouched default templates (rule 36).
- `cancelReason = 'dates-taken'` rows may later become `paid` (rule 33, via `markRetiredLinkPaid`).
- New table `dates_taken_notices` (`id`, `reservationId` UNIQUE, `takenByReservationId`, `emailLogId`, `noticeStatus` `sent | not-sent`, `noticeReason`, `createdAt`, `acknowledgedAt`) (rule 43).
- New default template `dates_unavailable_notice` FR / EN, seeded (rule 45).

**Data impact:** no row is deleted; no paid row is touched (every `UPDATE` filters `status = 'open'`).
The 3 prod orphans move to `cancelled` / `orphan`. Every link open at upgrade lapses 36 h after the
install (rule 34) — operators re-send requests still wanted. A rollback to the previous
version reads the new reasons as « Lien retiré » / « Lien expiré » (unknown values fall to the
generic label) and the new columns are ignored (additive schema, self-update rule 31).

## 6. UI / UX

The interactive visual in the HTML summary shows the fiche's ledger row over time (created → valid →
expired → « Renvoyer la demande » → new link) and the devis conflict case (link withdrawn, new request
refused).

- **Fiche, ledger row (acompte / solde / échéance):** only the grey detail line under the row changes
  (rule 24). « Renvoyer la demande » appears on an expired link, as it already does on « Lien expiré ».
- **Devis and unpaid reservation:** « Demander le paiement » / « Renvoyer la demande » unchanged;
  refused with « Dates déjà prises par une autre réservation : aucun lien créé. » when rule 11 applies;
  the ledger row reads « Lien retiré · dates prises ».
- **E-mails:** request templates and the acompte reminder state « Ce lien est valable jusqu'au … »
  (rule 36); the acompte reminder on taken dates is refused « … relance non envoyée. » (rule 35).
- **Closures page (`EstablishmentClosuresPage`):** in the closure `FormDialog`, once logement and both
  dates are set, the server's `conflicts` answer shows under the dates: a red line « Réservation sur ces
  dates : fermeture impossible. » or an amber line « Demande de paiement en cours sur ces dates. », each
  followed by the `ConflictList` rows with « Ouvrir » (new tab on desktop, same tab on `xs`). Save
  answers with the same lists. Full-screen dialog on `xs`, rows stacked, « Ouvrir » ≥ 44 px.
- **Ledger « Retirer le lien »** next to the open link's detail (rule 42).
- **Closure dialog, devis without a link:** amber line « Devis en cours sur ces dates. » + « Ouvrir »; Save allowed (rule 49).
- **Devis on held dates:** save refused « Dates déjà réservées : devis non enregistré. » with the blocking stays (rule 46); a devis whose dates were taken shows a « Dates prises » chip (rule 48).
- **Dashboard « Dates prises » card** (rule 43).
- **Guest e-mail** `dates_unavailable_notice` (rule 45), « Envoyé automatiquement (dates prises) » in the
  e-mail history.
- **Admin e-mail / push:** rule 4 (orphan), rule 39 (over-booking on held dates), rule 43 (dates prises), rule 33 (paid on taken dates: déplacer ou rembourser), rule 20 (stuck deactivation).
- **WordPress return page:** rule 30.
- **Responsive:** the detail line wraps on `xs` (existing behaviour of the ledger row); the resend
  button keeps its 44 px target; the error dialog is the existing one (full-screen on `xs`). No layout
  change at `md` / `lg`.
- **PageActionBar:** unchanged.

## 7. Test plan

### Server unit tests (one file per subject)
- [x] `tests/payment-link-orphan-alert.unit.test.js` — rules 3-4: live path (link `paid`) and retry path (link stays `cancelled` with its payment), `no-reservation`, nothing booked, no confirmation, alert with link id + amount and no URL.
- [x] `tests/payment-link-orphan-migration.unit.test.js` — rule 5: open orphans withdrawn once, paid / cancelled ones untouched, log lines, second boot does nothing.
- [x] `tests/payment-link-validity.unit.test.js` — rules 6-8, 17: `expiresAt` at mint, lapse at 36 h, reuse below 24 h left mints a new link, reuse above keeps it, a reused link paid meanwhile refuses.
- [x] `tests/payment-link-stay-started.unit.test.js` — rule 9: lapse at 00:00 Paris (DST days included), `complement` untouched, link minted on the arrival day exempt, converted-devis links included.
- [ ] `tests/payment-link-dates-taken.unit.test.js` — rules 10-11, 31-32: overlap by iCal import (Adrien's case a), by the conversion of another devis (case b), by manual creation, re-date, logement change, « Rétablir »; the row itself and its own converted stay never count; a row with an acompte paid keeps its links; two unpaid reservations both withdrawn; mint refused 409.
- [ ] `tests/payment-link-dates-taken-paid.unit.test.js` — rule 33: paid in flight on a devis (converted with `bookingConflictAt`, no confirmation, alert) and on a reservation (bucket recorded, conflict, alert).
- [x] `tests/payment-link-validity-backfill.unit.test.js` — rule 34: grace from the install, idempotent, logged.
- [x] `tests/deposit-reminder-mints-link.unit.test.js` — rules 27, 35: fresh link at send, reuse with ≥ 24 h, a fresh one below, English wording, mint refusal sends nothing, no provider → no link, declared-unready re-offers only, the solde reminder never gets a link, still Manual (9). The refusal on taken dates joins it with rule 11 (PR5/PR6).
- [x] `tests/payment-link-valid-until-token.unit.test.js` — rule 36: FR / EN wording in Paris time (DST), empty without a link, catalogue entry, sentence in every default, both request paths hand `expiresAt`, content migration on every shipped version (an older default keeps the rest of its text), never on an edited side, idempotent, no-link draft (15).
- [ ] Amend `superseded-duplicates` tests for the moved `carriesMoney`.
- [ ] `tests/stay-holds-dates.unit.test.js` — rule 37: acompte paid holds, solde open still holds, platform holds, unpaid direct and devis do not, cancelled frees; two unpaid devis both keep their links, first paid withdraws the other's (Q11).
- [ ] `tests/ical-overbooking-held-dates.unit.test.js` — rules 38-39: import on held dates recorded + conflict + held-dates wording; drift approval warning.
- [ ] `tests/closure-open-payment-request.unit.test.js` — rules 40-41: refusal order, codes, `reservations[]` / `requests[]` shapes, establishment-wide closure, `conflicts` endpoint.
- [ ] `tests/payment-link-withdraw.unit.test.js` — rule 42: withdrawn + deactivated, refused when paid, marker on provider failure, read-only stays refused.
- [ ] `tests/devis-held-dates.unit.test.js` — rule 46: create / re-date onto held dates refused with `stays[]`; onto an unpaid row allowed; other edits of a devis already on held dates allowed; `datesTaken` marker (rule 48).
- [ ] `tests/closure-devis-without-link.unit.test.js` — rule 49: warning listed, save accepted.
- [ ] `tests/dates-taken-notice.unit.test.js` — rules 43-45: sent at the `dates-taken` withdrawal (overlap, first paid, iCal), not for expiry, a started stay or « Retirer le lien »; a later refused reminder sends nothing more; e-mail sent once with its `email_log` row, push, dashboard row, every fail-closed case, reminder never queued on taken dates, `AUTO_SEND_EXCEPTIONS` holds exactly one key and `autoSendPolicy` still refuses every other template.
- [ ] `tests/payment-link-superseded.unit.test.js` — rule 12.
- [x] `tests/payment-link-deadline-race.unit.test.js` — rules 14, 15, 18, 19, 21, 22: paid before deactivation (webhook), paid found after deactivation, paid found at the last look, webhook replay, two concurrent runs.
- [x] `tests/payment-link-deactivation-stuck.unit.test.js` — rules 18, 20, 21: marker kept, one alert after 24 h, rate limit stops the job.
- [x] `tests/payment-link-lifecycle-ledger.unit.test.js` — rule 24 labels and `resend`.
- [x] `tests/payment-link-lifecycle-pass.unit.test.js` — rules 1, 2, 13, 16, 22: withdrawn first, one transaction, only `open` rows move, the poll opens with the pass.
- [x] `plugins/online-payment/tests/payment-link-lifecycle-job.unit.test.js` — rules 16, 22, 23: 15-min job, shared in-progress flag, nothing while Qonto is not connected; SDK 2.18 contract.
- [x] `tests/public-payment-status-expired.unit.test.js` — rule 30: `expired` answer, paid lapsed link booked → `confirmed`, once per 5 min, no read past 24 h unless a last look is pending, stay-started lapse, an open link or a withdrawn latest link stays `pending`, a pending last look or owed deactivation answers `pending` (11). Rule 28 is cited by the token suite (the e-mail states the end).
- [x] `tests/payment-link-request-preview.unit.test.js` — rule 26: reusable link shown with its end, placeholder below 24 h / no known end / no link, the reminder's link branch, installment requests, no provider → no placeholder, a request sent from the dialog mints (8).
- [x] `tests/public-payment-pay-after-expiry.unit.test.js` — rule 29: « Payer » after the lapse mints a fresh 36 h link, the lapsed one stays lapsed, a second click reuses the fresh one (2).
- [x] `tests/payment-link-dialog-send.unit.test.js` — rule 26 (review of #897): preview → send with the preview as `overrides` for the five link templates, FR and EN, carries the minted link and its end; a stale preview's lapsed URL and end never leave; a text without a link refused before the mint; a placeholder left refuses the send; an operator edit survives (14).
- [x] `tests/payment-link-send-refusals.unit.test.js` — rule 26: the three requests refused without a link, a declared-unready provider's reusable link still sent, the reminder not refused, no address / invalid address / no SMTP refused before any mint (8).
- [x] `tests/payment-link-concurrent-types.unit.test.js` — rule 8: an acompte and a full request at the same moment end with one open link, with or without an older full link to retire (20 h and 30 h left), across 60 interleavings each (4).
- [x] `tests/wordpress-payment-expired.unit.test.js` — rule 30: the key, the `.po` / `.mo` English string, plugin 1.19.0 everywhere (3).
- [x] Amended `direct-installments-emails` (the preview's placeholder before the mint), `emails-controller` and `plugin-removal-fixes` (a re-offered link has 24 h left).
- [x] Amend `payment-poll-fair-use.unit.test.js` (retireExpired now sets the marker) and `plugins-phase-0` uninstall guard (rule 23).

### Client
- [x] `client/src/__tests__/wordpress-booking-view.payment-expired.test.js` — rule 30: the return page stops on `expired` with its message, after a `pending` too; `confirmed` still wins (3).
- [ ] `client/src/components/reservation/__tests__/FinanceSection.link-lifecycle.test.jsx` — prints the new labels, offers « Renvoyer la demande » on expired, not on dates-taken; « Retirer le lien » asks for confirmation.
- [ ] `client/src/pages/__tests__/EstablishmentClosuresPage.conflicts.test.jsx` — warning list with links, 409 lists rendered.
- [ ] `client/src/components/__tests__/ConflictList.test.jsx`.

### Manual verification (fake provider in dev, never the production Qonto)
- [ ] Mint a link, move the clock 36 h (injected `now` / env), run the job: row « Lien expiré le … », « Renvoyer la demande » mints a new link.
- [ ] Devis with a link, then an iCal import on its dates (fake feed): « Lien retiré · dates prises », « Demander le paiement » refused.
- [ ] Two devis on the same nights, pay the first (fake provider): the second's link is withdrawn.
- [ ] Send an acompte reminder 2 days after the request: the e-mail carries a new link and its end of validity.
- [ ] Two devis on the same nights; pay the first; let the second's acompte reminder fall due: not proposed, guest notice in the e-mail history, push, dashboard card.
- [ ] Closure over a devis with an open link: warning with « Ouvrir », « Retirer le lien », closure saved; mobile 390 px.
- [x] Copy of prod: boot logs the 3 orphans; fake provider records 3 `cancelLink`. _(review of #890, 2026-10-30: #13, #14, #16 withdrawn; nothing else changed by this migration)_
- [ ] Mobile (390 px): ledger row wraps, button ≥ 44 px.
- [ ] WordPress return page with `status: 'expired'`.
- [ ] Sandbox only, by Adrien: what Qonto shows on a deactivated link, and whether a payment in flight completes after `deactivate` (§9 Q8).
- [ ] `npm run test:e2e` (payment flows).

## 8. Out of scope

- Audit finding N1 (stay-owned link paid after a `performUpdate` re-price gets no alert): its own fix.
- A configurable validity per property or per type (one constant).
- Re-sending automatically a lapsed link (no e-mail leaves without the operator, `no-automatic-dunning`).
- Deleting orphan rows or adding a foreign key (plugins-phase-3a rule 27 stands).
- The 5 orphan links already **paid** (counted by the boot `[integrity]` line): unchanged.
- Translating or styling the provider's own inactive-link page.
- Reconciliation page changes (an unmatched credit already shows there).
- Cancelling a stay automatically on an over-booking (rule 39 alerts only).
- Any other automatic guest e-mail: rule 44's exception covers `dates_unavailable_notice` only.

## 9. Open questions

### Resolved

- **Q1 — 36 h from creation or from the last send?**
  - A (2026-10-30, Adrien): from the creation. When an e-mail is sent, the current link is reused only if
    at least 24 h remain; otherwise a new one is minted. → rules 6, 8.
- **Q2 — Links already open at the upgrade.**
  - A (2026-10-30): 36 h of grace from the install. → rule 34.
- **Q3 — « Séjour passé ».**
  - A (2026-10-30): 00:00 Paris on the arrival day; a link created that same day keeps its 36 h. → rule 9.
- **Q4 — Dates taken: devis only, or reservations too?**
  - A (2026-10-30, against the devis-only recommendation): every **unpaid** reservation or devis with an
    open link loses it as soon as another reservation overlaps its dates — iCal import over a direct
    devis, the first of two overlapping devis paid. → rules 10, 11, 31, 32.
- **Q5 — A `dates-taken` link found paid (payment in flight during the deactivation).**
  - A (2026-10-30): recorded on the fiche, which goes into date conflict; an alert asks the operator to
    move the stay or refund. → rule 33.
- **Q6 — The acompte reminder.**
  - A (2026-10-30): it mints a new link when it is sent, if the dates are still free. → rule 35.
- **Q7 — The end of validity in the e-mail.**
  - A (2026-10-30): yes, a `{{paymentLinkValidUntil}}` variable in the payment-request templates. → rule 36.

- **Q9 — « Unpaid » with only an acompte paid.**
  - A (2026-10-30): not unpaid; it keeps its solde link. Further: once an acompte is paid the dates are
    held, no new reservation can be taken on them even with the solde unpaid, and only cancelling the
    stay frees them; a platform booking arriving by iCal on them is an over-booking alert. → rules 31,
    37-39.
- **Q10 — Establishment closures.**
  - A (2026-10-30): a closure cannot be saved over a reservation; over an open payment request (devis or
    fiche with an open link) it warns with a link to each, and the request must be withdrawn by hand
    before the closure saves. → rules 40-42.
- **Q11 — Two unpaid rows on the same nights.**
  - A (2026-10-30): the first paid wins; both keep their links until then, and the first payment
    withdraws the other's. → rules 10, 11.
- **Q12 — Acompte reminder on taken dates.**
  - A (2026-10-30): refused; GuestFlow then e-mails the guest that the dates were booked, pushes the
    operators and raises a dashboard alert — an explicit exception to the no-unvalidated-guest-e-mail
    rule. → rules 35, 43-45.

- **Q13 — A devis written on held dates.**
  - A (2026-10-30): refused — creating a devis or moving it onto held dates. → rules 38, 46.
- **Q14 — When the guest is told.**
  - A (2026-10-30): as soon as the link is withdrawn because the dates were taken, once per stay; the
    refused reminder joins the same trigger. Not for expiry, a started stay or « Retirer le lien ». → rules 43, 47.
- **Q15 — The devis after the notice.**
  - A (2026-10-30): kept as it is, marked « Dates prises »; the operator decides. → rule 48.
- **Q16 — A closure over a devis without a link.**
  - A (2026-10-30): same warning line with « Ouvrir », save allowed (nothing to withdraw). → rule 49.

### Open

- **Q8 — Qonto behaviour to confirm in sandbox** (a check, not a decision; still open 2026-10-30): the
  page a guest sees on a deactivated link, and whether a 3-D Secure payment in flight completes after
  `deactivate`. Rules 14, 19 and 33 hold either way.

## 10. Implementation progress

Six sequential PRs into `inte/plugins` (plan validated 2026-10-30).

- [x] **PR1 — orphan links** (rules 3, 4, 5; rule 2 for the `orphan` reason).
  `constants/paymentLinks.js` (new: durations of rules 6, 8, 19, 20 and the reason names);
  `paymentPollRunner` — `no-reservation` on the live path and an up-front « stay row missing » check
  before every branch of `retryPendingCancellationsOnce` (settled, amount-changed, installment, plain
  cancelled, orphan), plus the stay vanishing during an amount-changed claim, all ending on
  `notifyPaidAfterCancel(link, { orphan: true, … })`; `notificationService` orphan e-mail / push with no
  URL; `utils/orphanPaymentLinksMigration.js` called from `database.js`
  (`orphan_payment_links_withdrawn_v1`). Tests: `payment-link-orphan-alert` (14), `payment-link-orphan-migration` (4).
- [x] **PR2 — 36 h validity, lifecycle pass, deactivate-then-read** (rules 1, 6-9, 13, 14, 16-24, 34).
  `utils/paymentLinkLifecycle.js` (new: `validityEnd`, `validityOf`, `retireLapsedAndWithdrawn` — cancelled
  or missing stay, validity, arrival —, `listLastLookDue`); `paymentRequestService` stores
  `createdAt` / `expiresAt = createdAt + 36 h` and reuses only with ≥ 24 h left (the old link lapses for
  `validity`); `paymentPollRunner.runLinkLifecycle` (lifecycle pass, deactivate-then-read of expired
  rows, last look, stuck alert) at the start of `runPaymentPoll`; `paymentLinkDeactivation` keeps an
  expired row expired; `markPaid` clears the marker and `lastLookAt`; ledger labels of rule 24 (the
  `dates-taken`, `superseded` labels and the « no resend on dates taken » ready for PR5);
  `notifyDeactivationStuck`; columns `lastLookAt`, `deactivationAlertedAt`; migration
  `payment_link_validity_backfill_v1`; plugin job `payment-link-lifecycle` (online-payment 1.5.0, SDK
  2.18.0). The poll's open orphans are now withdrawn by the pass (rule 13) before they are read: the
  PR1 « poll » test reads its payment on the retry path. Tests: `payment-link-validity` (10),
  `payment-link-stay-started` (9), `payment-link-lifecycle-pass` (10), `payment-link-deadline-race` (10),
  `payment-link-deactivation-stuck` (6), `payment-link-validity-backfill` (6), `payment-link-lifecycle-ledger`
  (8), `payment-link-lifecycle-job` (6); review of #894: a refused deactivation still reads the payment,
  a lapse ends `expiresAt` now, the poll waits for a running lifecycle pass, uninstall refusal reworded
  (+5 tests: `payment-link-deadline-race` 13, `payment-link-validity` 11, `payment-link-lifecycle-job` 7);
  re-review: a lapsed link found paid on the mint path is booked at once, and a re-click reads the owed
  lapsed link first (`payment-link-validity` 14); amended `payment-poll-fair-use`, `plugins-phase-0`,
  `plugins-phase-1-sdk`, `payment-link-orphan-alert`, `payment-request-service`,
  `payment-links-converted-devis-double-payment`, `payment-links-model`.
- [x] **PR3 — validity in request e-mails, acompte reminder mints at send, public `expired` status**
  (rules 26-30, 35 mint part, 36). `emailsController` resolves the link of `deposit_reminder` and of the
  request templates at send (`SEND_TIME_LINKS`, `utils/paymentRequests.js` →
  `paymentsController.ensurePaymentLinkFor`) and previews « (lien de paiement créé à l'envoi) » when no
  open link has 24 h left; token `paymentLinkValidUntil` (`templateTokens`, `emailContextBuilder`,
  `dateFr.formatMomentLong`, `extraContext.dates` in `reservationEmailSender`, `expiresAt` through both
  request paths); the sentence in the five default templates FR / EN and migration
  `payment_link_valid_until_sentence_v1` on untouched sides (any shipped version, by SHA-256); `paymentRequestDraft` treats the token like
  the link; public `status` reads the latest lapsed link and answers `expired`; WordPress plugin 1.19.0
  (`paymentExpired`). Tests: `payment-link-valid-until-token` (15), `deposit-reminder-mints-link` (9),
  `payment-link-request-preview` (8), `public-payment-status-expired` (11), `public-payment-pay-after-expiry`
  (2), `wordpress-payment-expired` (3), `payment-link-dialog-send` (14), `payment-link-send-refusals` (8),
  `payment-link-concurrent-types` (4) — review of #897 (and one per-stay mint lock at the re-review): the dialog's rendered preview is filled at the
  send, placeholder guard, requests refused without a link, refusals before the mint, `pending` while a
  look is owed; client `wordpress-booking-view.payment-expired` (3); amended `direct-installments-emails`,
  `emails-controller`, `plugin-removal-fixes`, `emails-controller-sequence-ledger` (its payment e-mail is now
  the reminder: a request without a provider is refused).
- [ ] PR4 — closures refused over open payment requests, « Retirer le lien » (rules 40-42, 49).
- [ ] PR5 — held dates and dates-taken withdrawal (rules 10-12, 16, 24, 25, 31-33, 37-39, 46, 48).
- [ ] PR6 — dates-taken guest notice (rules 35, 43-45, 47); status → Implemented.
