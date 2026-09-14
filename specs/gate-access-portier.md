# Gate access v2 — guestFlow's part: stays pushed to Portier, the SAS QR, the owner's pages

| Field | Value |
|---|---|
| **Status** | Implemented on guestFlow's side (2026-09-14) — the manual test plan (§7) waits for Portier. The HTML summary decided the UX (`specs/gate-access-portier.html`); owner's answers of 2026-09-14 recorded; deviations in §10 |
| **Branch** | `feature/guest-gate-access` — PR #547, not merged as it stands: this work lands in it |
| **Created** | 2026-09-14 · revised the same day with the owner's answers |
| **Author** | Adrien |
| **Supersedes** | the transport, activation and code model of [guest-gate-access.md](guest-gate-access.md); the rules of [gate-access-list-and-manual-accesses.md](gate-access-list-and-manual-accesses.md) move to Portier, its screens stay here (§3.4) |
| **Other parts of the feature** | Portier `specs/portier.md` · sowel-plugin-guest-access `specs/portier-channel.md` · homelab `specs/002-portier/spec.md` |

## 0. The feature at a glance

> This section is **identical in the four repositories** that carry a part of the feature. Each spec
> then details its own component only. The HTML summary next to each spec follows the same split.

**Goal.** A guest of the gîte or the lodge opens the gate from their phone, for their stay only
(check-in hour → check-out + 1 h). The owner keeps every access — stay or hand-made — in one list
where any of them can be edited, suspended or revoked.

| Component | Repository | Owns |
|---|---|---|
| **guestFlow** | `adn-dev-adrien/guestFlow` | the reservations; pushes each stay's access to Portier; the owner's list and settings pages, behind guestFlow's login; the SAS step with the code and its QR; the emails |
| **Portier** | `adn-dev-adrien/portier` (private) | the accesses, their keys, the journal, the guest web app, the server end of the house channel |
| **Sowel plugin** | `adn-dev-adrien/sowel-plugin-guest-access` | opens and holds the channel from the house; hands each command to the recipe |
| **Sowel recipe** | `adn-dev-adrien/sowel-recipe-guest-gate` | unchanged: pulses the gate, reports the outcome and the contact |
| **Hosting** | `homelab` (private) | where Portier runs, its ports, firewall rules and reverse proxies |

| Connection | Opened by | Carries |
|---|---|---|
| guestFlow → Portier | guestFlow, on the same machine | stay pushes (creation, date change, cancellation), invitation reads, the owner's actions, the logo |
| Portier → guestFlow | Portier, on the same machine | one kind of event: a notification for the owner |
| house → Portier | **the house**, held open | Portier pushes commands down it; the house pushes back results and the gate contact |
| phone → Portier | the phone | enrolment, a state check when the app comes to the foreground, signed commands |
| anything → the house | **nobody** | the house network accepts no incoming connection for this feature |

**No polling.** Nothing asks « anything new? » on a timer. Three things run on a clock and none of
them fetches data: the channel's keep-alive ping every **10 minutes**, guestFlow's retries — its
outbox and the emails waiting for Portier — *only while something is failing*, and the daily purge.

**Decided by Adrien on 2026-09-14:** the name Portier · guestFlow configures an access automatically
when a reservation exists, and afterwards only a date/time change in guestFlow or a manual change in
the list alters it · a cancellation revokes the access · the list is reachable from anywhere, behind
guestFlow's login · Portier runs on guestFlow's machine · the SAS keeps the code and shows a QR that
carries it · one key per access · the channel pings every 10 minutes · the J-7 email waits for Portier
and retries · PR guestFlow#547 is not merged as it stands: this work lands in it · Portier's repository
is private.
---

## 1. Context

PR #547 delivered gate access inside guestFlow: the `gate_*` tables, the guest routes, a long-poll
served to the house, and an access minted lazily by the first email or fiche read. On 2026-09-14 the
owner replaced that model (§0). guestFlow keeps the reservations and becomes Portier's front door: it
pushes each stay, reads the invitation where a guest needs it, and shows the owner the list. **It
stores no gate key, no code and no device.**

## 2. Goal

guestFlow tells Portier about every stay the moment it exists or changes, shows the guest's code and
QR wherever a guest may need them, and gives the owner the list of accesses behind guestFlow's
login — without holding a single key that opens the gate by itself.

## 3. Functional rules

> **Rules are bulleted, not numbered, while this spec is a draft.** In this repository numbering a
> rule commits a test that names it (`scripts/check-spec-coverage.mjs`). Numbers arrive with the
> tests. Refer to rules by section.

### 3.1 Pushing stays to Portier

- **When a reservation exists, guestFlow pushes its stay** — whether it came from the form, an
  accepted devis, an iCal import or a confirmed online payment. The push carries the window computed
  by `gateWindow.js` (check-in → check-out + 1 h, Europe/Paris, both DST transitions), the lodging,
  the guest's first name and the reservation number.
- **A change of dates, times or lodging pushes again.** Nothing else about a reservation is pushed:
  its price, its guests or its notes do not concern the gate.
- **A cancellation pushes a cancel** (confirmed 2026-09-14), and so do a deleted reservation and a
  reservation turned back into a devis. A reinstated reservation pushes its stay again, which lifts
  the cancellation in Portier.
- **guestFlow never asks for a removal at the end of a stay.** Portier ends the access by its own
  end date.
- **No push is lost.** Each is written to an outbox **in the same transaction** as the reservation
  change, then sent after the commit. A failure arms one retry timer with back-off (30 s, 1, 2, 5,
  15 min, then hourly); nothing runs while the outbox is empty. The outbox row id is the push's
  revision, so Portier can tell a late push from a new one.
- **A push failing for more than an hour is visible**: a banner on the « Accès portail » page and on
  the fiche of that reservation — « Portier n'a pas reçu la dernière modification ».
- **Deployment backfills** every reservation whose stay has not ended, once.

### 3.2 Reading the invitation

- **guestFlow reads the invitation from Portier when it needs it** — to compose the J-7 and J-2
  emails, to show the SAS step, to show the fiche — and never stores it. A new invitation made in the
  list therefore reaches the next email without any message back to guestFlow.
- The invitation is an address carrying the code in its fragment (`https://<guest host>/#i=<code>`)
  and the code itself. **The email paragraph of #547 stays**: the link and the code.
- **Portier unreachable when an email is composed → the email waits and retries** (decision
  2026-09-14). It never leaves without its gate paragraph. Instead of `failed`, its log row becomes
  `waiting_portier` with a next attempt — after 1, 2, 5 and 15 minutes, then every 15 minutes — until
  Portier answers. One retry timer is armed while such rows exist, none otherwise.
- **A wait longer than an hour notifies the admins**, once: « Email J-7 de Camille en attente : Portier
  ne répond pas depuis 08:00 ». The email history shows « En attente de Portier » and the next attempt.
- **A manual « Envoyer » while Portier is down** queues the email the same way and says so: « Portier
  ne répond pas : l'email partira dès qu'il répond. »
- A waiting email whose reservation is cancelled, or whose template is disabled meanwhile, is dropped
  and logged `skipped`.
- **The fiche** shows a compact card read from Portier: state, the window in force, the number of
  phones, the last use, and « Ouvrir dans la liste ».

### 3.3 The SAS step « Accès portail »

- **The SAS keeps the code and adds a QR** that carries the same address as the email (decision
  2026-09-14). **Flashing the QR sets the guest's app up**: the phone opens the address and enrols,
  with nothing to type.
- The code stays readable and dictable beside the QR, for a guest who prefers to type it or reads it
  over the phone.
- The step is shown to **admin and reception** — reception runs the SAS.
- **The SAS activates nothing.** « Ouvrir l'accès maintenant » leaves the SAS; early opening is
  « Ouvrir dès » in the list.
- Portier unreachable → the step says « Accès portail indisponible », offers « Réessayer », and keeps
  the gate's physical fallback code as #547 does.
- **The QR is shown on screen only**: never printed on a PDF, never attached to an email, never
  logged. It is a key while the stay lasts.

### 3.4 The « Accès portail » page

- **One page in guestFlow**: Réglages → « Accès portail », route `/portail`. The list lives in Portier
  and is shown here (decision 2026-09-14: reachable from anywhere, behind guestFlow's login).
- **Admin only.** Accountant and reception get `403` on `/api/portier/*`, and the menu entry is hidden
  from them.
- **The list is the one validated on 2026-09-14** (`specs/guest-gate-access-maquettes.html`): active,
  suspended, then finished stays under their own filter; the « guestFlow » and « créé par moi » tags;
  the validity in words, the hours, the phones, the last use; editing, creation and their refusals
  shown while typing.
- **Two changes follow from one key per access:**
  - there is no « Révoquer ce téléphone » any more;
  - two actions replace « Régénérer »: **« Nouvelle invitation »** (the code and QR change, phones
    already set up keep working) and **« Régénérer l'accès »** (every phone of that access stops and
    must be set up again — the way to cut off a lost phone). Each says so before confirming.
- **A header line shows the house channel**: « Maison connectée depuis 06:12 », or « Maison
  injoignable depuis 14:03 » in brick, and the gate contact.
- **The page reads Portier when it is displayed and when it comes back to the foreground.** No timer.
- Portier unreachable → the page says so; nothing cached is shown as current.

### 3.5 The logo

- **guestFlow pushes its company logo to Portier** when it is uploaded in the settings, and once at
  deployment (through the outbox).
- The tab « Application des clients » of the « Accès portail » page sets the source: « Logo de
  guestFlow (synchronisé) » or « Logo personnalisé » (PNG, SVG or JPEG, 2 MB at most, 512 × 512 px at
  least for bitmaps). The choice is stored in Portier.
- The tab warns that an icon already installed on an iPhone does not change.

### 3.6 Events from Portier

- guestFlow accepts `POST /internal/portier/v1/events` **only from the loopback socket and with a valid
  signature**; the edge proxy never forwards `/internal/`.
- `devices_over_six` → a push notification to the admins through `pushService`: « 7 téléphones sur
  l'accès de Camille (Gîte · 202609042) ». This closes the gap found in #547, where the rule promised
  a push and the code only showed a banner.

**Edge cases:**
- A reservation created then cancelled before its first push left → both rows drain in order; Portier
  ends with a cancelled access that never worked.
- Dates changed while Portier is down → the push waits; the SAS and fiche say Portier is unreachable
  rather than show a window that may be stale.
- Portier down at 08:00 and back at 08:40 → the waiting J-7 emails leave at the next attempt of the
  back-off above (08:53 — attempts fall at 08:01, 08:03, 08:08, 08:23, 08:38, 08:53), in their original
  order.
- An access deleted in the list, then the reservation's dates change → Portier acknowledges and
  ignores the push; the fiche shows « Accès supprimé dans la liste » with « Recréer ».
- A guest calls with the old code after « Nouvelle invitation » → the SAS and the fiche show the new
  one; the old QR answers « Code incorrect ou expiré ».

---

## 4. Architecture

### 4.1 Files (`server/src/`, `client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `portierClient.js` | C | signed calls to Portier's service API; the event signature check; « not configured » without `PORTIER_SVC_URL` / `PORTIER_KEY_GF` |
| `utils/` | `portierSchema.js` | C | the DDL of `portier_outbox`, shared by database.js and the tests |
| `utils/` | `portierSync.js` | C | `pushStay`, `cancelStay`, `pushBranding` write outbox rows in the caller's transaction; `drain()` sends them after commit; the one-time `backfill`; the « failing for more than an hour » status |
| `models/` | `portierOutboxModel.js` | C | the outbox rows (factory only — reached from models database.js loads) |
| `controllers/` | `reservationsController.js` | T | create, update (dates, times or lodging only), remove: the model write and the push in one transaction |
| `models/` | `devisModel.js` | T | `convertToReservation` pushes the new stay inside its transaction — the path of an accepted devis and of a confirmed online payment (`paymentPollRunner.js` needs no change) |
| `utils/` | `cancelReservation.js` | T | the cancellation transaction writes the cancel |
| `models/` | `propertyIcalModel.js` | T | pushes the stays an import created or moved, inside the sync's transaction |
| `models/` | `icalDateDriftModel.js`, `icalCancellationModel.js` | T | an approved date drift pushes the stay; an approved platform cancellation (reservation deleted) pushes a cancel |
| `utils/` | `portierInvitation.js` | C | replaces `gateAccessCard.js`: reads the invitation, shapes it for the email (or « wait »), the SAS (QR as SVG, `qrcode`) and the fiche card |
| `utils/` | `portierAccessView.js` | C | the operator's wording on the Paris wall clock (validity, hours, last use, house line, confirmations, journal) and the editor's wall-clock values back to instants |
| `utils/` | `emailContextBuilder.js`, `emailAutoSendRunner.js`, `reservationEmailSender.js` | T | `gateAccessCode`, `gateAccessUrl` from Portier; a Portier failure defers the email (`waiting_portier`) instead of failing it |
| `controllers/` | `emailsController.js` | T | `composeForSend` reads the gate paragraph; « Envoyer » queues when it must wait; the history says « prochain essai à HH:MM » |
| `models/` | `emailLogModel.js` | T | the waiting rows; `waiting_portier` counts as handled in the pending queue |
| `utils/` | `emailLogPortierMigration.js` | C | the one-time rebuild of `email_log` (new statuses and columns) |
| `utils/` | `portierEmailRetry.js` | C | the retry timer of waiting emails, armed only while some exist; the one-hour notification; the `skipped` drops |
| `utils/` | `adminPush.js`, `models/usersModel.js` | C / T | a push to every active admin (`listActiveAdminIds`) |
| `controllers/` | `sasController.js` | T | `GET /api/reservations/:id/sas/gate-access`: the step's own read; the SAS payload carries `gateAccess.configured` |
| `routes/` | `portier.js` + `controllers/portierController.js` | C | `/api/portier/*`: an allowlist of Portier's owner routes, signed, with the acting user; `GET /api/reservations/:id/gate-access` (fiche card); the events receiver |
| `middleware/` | `enforceRoleAccess.js` | T | `/api/portier/*` admin only (default deny); the SAS invitation read added to reception's allowlist |
| `routes/` | `portierEvents.js` | C | `/internal/portier/v1/events`, loopback and signature, mounted outside `/api` |
| `controllers/` | `settingsController.js` | T | logo upload → `pushBranding`, in the upload's transaction |
| `scheduledTasks.js`, `index.js` | — | T | one outbox drain at boot, the waiting-email timer re-armed; the routes mounted; #547's guest tree, poller and secrets removed |
| `utils/` | `gateWindow.js` | kept | the window pushed to Portier (its SAS early-opening and `windowState` removed with their only caller) |
| client | `pages/GateAccessPage.jsx` | C | the list, the house line, creation and editing, the « Application des clients » tab |
| client | `utils/gateAccessValidation.js` | C | the refusals shown while typing |
| client | `components/sas/SasGateAccessStep.jsx`, `components/sas/ReservationSasDialog.jsx` | C / T | code + QR, and the fallback code |
| client | `components/GateAccessCard.jsx` | C | the compact fiche card (replaces `components/reservation/GateAccessSection.jsx`) |
| client | `pages/EmailHistoryPage.jsx`, `components/EmailManualSendDialog.jsx` | T | « En attente de Portier », and the sentence of a queued « Envoyer » |
| client | `App.jsx`, `constants/roles.js`, `api.js` | T | the `/portail` route and menu entry (admin only), the API calls |

Hooks mirror `googleCalendarSync` with one difference: Google Calendar is fire-and-forget corrected by
a periodic reconcile; a gate access cannot wait for a reconcile, so pushes go through the outbox.

### 4.2 Configuration

`PORTIER_SVC_URL` (Portier's service listener on the loopback) and `PORTIER_KEY_GF` (shared with
Portier, in `server/.env.local` like the other secrets). Without them guestFlow runs normally, the
SAS step and the page say Portier is not configured, and the outbox keeps its rows.

Checking an event needs `PORTIER_KEY_GF` only. Portier posts its events to `GUESTFLOW_EVENTS_URL`
(default `http://127.0.0.1:4000/internal/portier/v1/events`), which is right in production: guestFlow
runs with `HTTPS_ENABLED=false` behind Caddy and serves plain HTTP on the loopback (§9).

### 4.3 What leaves guestFlow from #547

| Leaves | Moves to Portier | Stays |
|---|---|---|
| `gate_*` tables (never created in production), `routes/guest.js`, `guestGateController.js`, `routes/gatePoller.js`, `gatePollerController.js`, `requireGateApiKey.js`, `requireGuestHost.js`, `gateSession.js`, `gateAccessModel.js`, `GATE_API_KEY`, `GATE_SIGNING_SECRET`, `GUEST_HOST`, `GUEST_BASE_URL` | `gateCode.js`, `server/src/guest-page/`, the throttles | `gateWindow.js` and its DST tests, the `__Host-` admin cookie (the guest host is still a sibling domain), the SAS step renamed « Accès portail », the email paragraph migration `gate_access_paragraph_v1` |

---

## 5. Data model

One new table, one existing table extended:

| Table | Columns |
|---|---|
| `portier_outbox` | `id, reservationId NULL, type (stay\|cancel\|branding), payload JSON, attempts, nextAttemptAt, lastError, createdAt, sentAt` |
| the email log (existing) | new statuses `waiting_portier` and `skipped`; new columns `nextAttemptAt`, `waitingSince`, `adminNotifiedAt` |

- `portier_outbox.id` is `AUTOINCREMENT`: it is the revision, and a purged row must never lend its id to
  a later push. Timestamps are ISO strings. `sentAt` means Portier answered; `lastError` then holds a
  refusal (`refused 422 endsAt window_too_long`). Answered rows are purged after 30 days, by the drain.
- A branding row stores the logo's path, and the bytes are read when it is sent.
- `email_log`'s CHECK constraint forces a rebuild (utils/emailLogPortierMigration.js), in one
  transaction at boot, every row carried over with its id. A waiting row has an empty body: the email
  is composed only when Portier answers; `sentAt` becomes the moment the wait ended.

## 6. UI / UX

Shown interactively in `specs/gate-access-portier.html`. Strings in French.

| Surface | Content |
|---|---|
| **SAS, step « Accès portail »** | « Flashez pour installer l'accès au portail », the QR, the code `4K7M-9QT2` under it, the window in force; the fallback code when Portier is unreachable |
| **Réglages → Accès portail** | the house line, the list of 2026-09-14, « Nouvelle invitation » and « Régénérer l'accès » with their confirmations, the tab « Application des clients » |
| **Fiche** | the compact card and « Ouvrir dans la liste » |
| **Historique des emails** | « En attente de Portier · prochain essai à 08:15 » on a waiting email |
| **Push notification** | « 7 téléphones sur l'accès de Camille (Gîte · 202609042) » |

Responsive: the list follows guestFlow's table → cards swap; the SAS QR stays at least 180 px wide.

## 7. Test plan

### Unit
- [x] every hook (create, dates changed, lodging changed, devis accepted, iCal import, payment, cancellation, deletion) writes one outbox row in the same transaction, and a rolled-back transaction writes none — `portier-outbox-hooks.unit.test.js` (13). « Back to devis » and « reinstatement » have no write path to hook in guestFlow today (§10).
- [x] a price or notes change writes no row — same file
- [x] the drain sends in order per reservation, backs off on failure, arms no timer when empty — `portier-outbox-drain.unit.test.js` (8)
- [x] `/api/portier/*`: admin passes and names the actor; accountant and reception get `403` — `portier-owner-proxy.unit.test.js` (13)
- [x] `/internal/portier/v1/events`: refused from a non-loopback socket, refused unsigned, accepted signed; `devices_over_six` sends one push — `portier-events.unit.test.js` (4)
- [x] the SAS step returns the QR of the invitation's address and never writes it to a log — `portier-sas-step.unit.test.js` (4)
- [x] Portier down: the J-7 email is not sent, becomes `waiting_portier`, is retried on the back-off, leaves once Portier answers, notifies the admins once after an hour; no timer is armed when nothing waits — `portier-email-wait.unit.test.js` (8)
- [x] a waiting email is dropped as `skipped` when its reservation is cancelled — same file
- [x] the contract vectors `svc`, `svc_owner_get` (produced) and `evt` (verified) — `portier-contract-vectors.unit.test.js` (6); the client over a fake Portier — `portier-client.unit.test.js` (5)
- [x] the `email_log` rebuild — `email-log-portier-migration.unit.test.js` (3)
- [x] client: `GateAccessPage.list` (9), `GateAccessPage.editing` (5), `GateAccessPage.branding` (3), `GateAccessCard` (4), `SasGateAccessStep` (4), `EmailHistoryPage.portier-wait` (1), `EmailManualSendDialog.portier-wait` (1), `gateAccessValidation` (7)

### Manual
- [ ] Create a reservation: it appears in the list within seconds, tagged « guestFlow »
- [ ] Move its dates: the list shows the new window; a prolongation set by hand survives
- [ ] Cancel it: the access is revoked; reinstate it: the same code works again
- [ ] Flash the SAS QR with a phone: the app is set up without typing
- [ ] Log in as reception: the SAS shows the QR, `/portail` is not reachable
- [ ] Stop Portier at 07:55: the 08:00 J-7 email waits; start it again: the email leaves at the next attempt

## 8. Out of scope

- A second factor on guestFlow's login. Recommended on its own, since the login now leads to the
  gate (§3.4), but it is guestFlow-wide and deserves its own spec.
- Sending the link by SMS from guestFlow.
- Portier's internals, the house channel and the hosting: see the other parts (§0).

## 9. Decisions and open question

**Answered by Adrien on 2026-09-14:** cancellation revokes · the list behind guestFlow's login · the
SAS keeps the code and its QR carries it · PR #547 is not merged as it stands; this work lands in it.

- Q: Portier unreachable at 08:00 when the J-7 email is composed — wait, or leave without the gate
  paragraph?
  - A (2026-09-14, Adrien): **wait and retry.** « Oui on attend et on ré-essaye. » (§3.2)

- Q (found during the implementation): does guestFlow serve HTTPS itself on `:4000`, which would need
  `GUESTFLOW_EVENTS_URL` in `https://`?
  - A (2026-09-14, hosting): **no.** In production guestFlow runs with `HTTPS_ENABLED=false` behind
    Caddy (homelab `vm104-guestflow/ecosystem.config.js`): it serves plain HTTP on `127.0.0.1:4000`, so
    Portier's default `GUESTFLOW_EVENTS_URL=http://127.0.0.1:4000/internal/portier/v1/events` is the
    right address. The README's HTTPS-on-`:4000` setup describes the former Raspberry Pi.

## 10. Implementation notes (2026-09-14)

Where the code differs from — or had to decide beyond — the text above:

- **Hooks sit where the transaction is.** A model that owns its transaction writes the push inside it
  (`devisModel.convertToReservation`, `cancelReservation`, the iCal sync and the two iCal approvals);
  the reservation form's controller wraps its model write and the push in one transaction. The online
  payment converts through `devisModel`, so `paymentPollRunner.js` is unchanged.
- **Two hooks of §7 have nothing to hook.** « Repasser en devis » (`POST /devis/from-reservation/:id`)
  copies the reservation into a new devis and leaves the reservation live — no cancel is pushed, so the
  contract's `devis` reason has no caller today. guestFlow has no way to reinstate a cancelled
  reservation (`kind = 'cancelled'` is final). If either appears, it pushes like the others.
- **Two more doors than listed** push too: an approved iCal date drift (a stay) and an approved iCal
  cancellation, which deletes the reservation (a cancel, reason `deleted`).
- **A refusal is not an outage.** A 4xx from Portier (a 422 `window_too_long`, say) closes the row with
  its reason instead of retrying it forever and holding the reservation's next, valid push back. The
  fiche's banner then reads « Portier a refusé la dernière modification : séjour de plus de 60 jours. »
- **One knock per outage.** When Portier does not answer, the drain stops calling and gives every due
  row its back-off, so each counts as failing and none is hammered.
- **Which emails wait.** Only a template carrying the gate tokens reads Portier. It waits when Portier
  does not answer **or answers 404** (the stay's push has not arrived yet); it leaves without the
  paragraph when Portier is not configured, or when the access is revoked, deleted or finished. The
  retry follows the back-off as stated (1, 2, 5, 15 min, then every 15 — the §3.2 edge case was
  corrected accordingly, as the HTML mock already computed).
- **A queued « Envoyer » is recomposed from the template** at retry: edits made in the send dialog
  while Portier was down are not kept (the preview could not show the paragraph anyway). The preview
  itself never waits — it renders without the paragraph. « Ignorer » never reads Portier; « Marquer
  envoyé » reads it and never waits. Skip reasons: `RESERVATION_CANCELLED`, `TEMPLATE_DISABLED`.
- **The SAS step reads Portier on its own** (`GET /api/reservations/:id/sas/gate-access`, in reception's
  allowlist), so a slow Portier never holds the SAS back; the SAS payload only says whether Portier is
  configured. Without Portier, the step still shows when a keypad code exists, and says Portier is not
  configured.
- **The page shapes nothing itself.** Filters (`view`, `kind`) and groups (« Actifs », « Suspendus »,
  « Révoqués », « Séjours terminés ») are server-side; a finished stay shows no action and the
  maquette's note; editors exchange Paris wall-clock values (`YYYY-MM-DDTHH:MM`) that the server turns
  into instants. Not reproduced, because each would need date wording on the client: the maquette's
  « Ce que portera la ligne » preview line, and the home-screen mock of the logo tab (only a preview of
  a chosen custom file is shown). The logo choice is saved with the page bar's « Enregistrer ».
- **Wording** follows guestFlow's « vous » where the mocks say « tu ».
- **Notifications** (`devices_over_six`, the one-hour email wait) go to every active admin, device by
  device, whatever their push preferences — reception and the accountant do not administer accesses.
- **At boot**, one outbox drain runs 20 s after start and the waiting-email timer is re-armed from the
  log; otherwise a timer exists only while something fails or waits.
- **Checked against the real Portier** (`feature/portier-v1`, local, scratch databases), not only a
  stand-in: stay pushes (create, date change, cancel → revoked), the SAS QR (byte-identical to a QR of
  Portier's invitation URL), enrolment counted on the list and the fiche, every owner action and every
  422 reason of contract §3.2 in French, the logo push and both logo sources, the house line up and
  down, `devices_over_six` over plain HTTP on the loopback, and a J-7 email that waited while Portier
  was stopped and left at its next attempt once it was back. Two things only the real Portier showed:
  its journal kinds and reasons (`stay_created`, `edited`, `stay_cancelled`, `open` with a press
  outcome…) and its `actor`, which it parses into `{ id, email }` — the journal now reads both in
  French and names the acting user's email. A received `devices_over_six` is logged with the access id
  and the number of devices pushed (never the guest's name).
- **guest-gate-access.md**: the rules whose code and tests left with #547 are declared « Sans test »
  under each rule, with where they went; rules 7-9 (the window) and 23 (the email paragraph) keep their
  tests.
