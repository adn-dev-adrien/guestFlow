# Guest app — demo mode: a fictitious stay the operator can show, switch and order from, with no effect

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/guest-app-demo-mode` |
| **Created** | 2026-11-27 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

Summary for review: `docs/specs/2026-11-27-guest-app-demo-mode.html` (interactive).

---

## 1. Context

The guest app (`guest-app.md`) opens only from a real stay: a stay link (`/s/<token>`, rule 1), the lodging
poster (`/l/<code>`, visitor mode only, rule 3) or the lookup (rule 6). The operator has no way to walk through the
full app on their own phone — to test a booklet change, or to show a prospective guest or a partner what the app
does — without borrowing a real reservation's link. Doing so has real effects:

- an order writes lines on that guest's fiche, may create a Qonto payment link, holds bath slots in the planning
  (and so schedules the heating, `guest-app-bath-home-scheduling.md`), and notifies the staff;
- the « Portail » tile hands the stay's real gate key (`gate.js`, rule 13);
- the « Domotique » page switches real lights in the lodging (`guest-app-home-automation.md` rules 17-22);
- the screen shows the guest's first name and dates.

The poster's visitor mode avoids all of that but shows almost nothing (no shop, no gate, no orders).

## 2. Goal

From the Studio, the operator gets one demo link. Opened on any phone, it shows the guest app exactly as a guest
sees it, on a fictitious stay, in any enabled lodging and at any moment of the stay (before arrival, during,
after departure), switchable in one tap. Everything can be tried — cart, bath slot, order, payment choice, gate,
lights — and nothing leaves the screen: no fiche, no payment, no planning, no house, no notification.

## 3. Functional rules

### 3.A The demo link

1. **One demo link per GuestFlow.** A `demoToken` (128 random bits, base64url) stored encrypted with its SHA-256,
   like a stay link (`guest-app.md` rule 1). It is created the first time the Studio shows it; « Régénérer le lien »
   replaces it and every session opened from the old one dies at once. The link is `https://<guest host>/d/<demoToken>`.
   An unknown or revoked demo token answers like any unknown code (« Ce code n'est pas reconnu. », no oracle).
2. **Where it is given.** Studio → Réglages → card « Lien de démo »: the QR, « Copier le lien », « Ouvrir »,
   « Régénérer le lien », and one line: « Un séjour fictif, sans paiement ni effet réel. À montrer, pas à envoyer à
   un voyageur. » Admin only, like the rest of the Studio (rule 47).
3. **No lifetime.** The link stays valid until regenerated. A demo session lasts 24 h; the app keeps the demo link on
   the device and exchanges it again on `SESSION_EXPIRED`, like a stay link (rule 9), so the phone keeps working
   without being re-scanned.
4. **No lodging enabled** → the demo link opens « Aucun logement n'est ouvert dans l'application. » (no session).

### 3.B The fictitious stay

5. **The stay is built by the server, never stored.** `demoStay(lodging, moment, now)` returns the same shape as
   `staysModel.byId` with `id: null`, `demo: true`: first name « Camille », 2 adults, the guest language of the
   phone (rule 52 language detection), the lodging's own check-in / check-out times, and dates set from `moment`
   (Europe/Paris):
   - `preArrival` — arrival in 5 days, 3 nights;
   - `stay` — arrived yesterday, leaves in 2 days (3 nights, the second under way);
   - `ended` — left yesterday after 3 nights.
   No reservation row, no client row, no stay link is created. The window and the mode come from the real
   `stayWindow` / `currentStay` helpers applied to those dates, so the demo shows what a real stay would show at
   that moment (pre-arrival = shop read-only, no gate; ended = visitor mode + « Votre séjour est terminé »).
6. **Demo session.** `guest_sessions` row with `origin = 'demo'`, `reservationId` NULL, `propertyId` the lodging
   shown, `demoMoment` the moment, `stayLinkId` NULL and `demoLinkId` the demo link. The middleware recognises it
   and attaches `req.guest = { …, stay: demoStay(…), demo: true }`. A demo session never reads a reservation.
7. **Switching.** `POST /public/v1/guest/sessions/demo/switch { propertyId, moment }` on a demo session updates the
   row (lodging must be enabled, moment one of the three) and answers like `/me`. Any other session → 403. The app
   then reloads `/me`, `/lodging`, the booklet and the shop for the new lodging; the cart is emptied.
8. **What `/me` adds.** For a demo session only: `demo: { moment, lodgings: [{ propertyId, name }] }` — the enabled
   lodgings in the Studio's order. Absent for every other session.

### 3.C Nothing leaves the screen

9. **Reads are real.** Booklet, « Pratique », Soliomap, wifi, contacts, shop catalogue, prices (the real quote
   engine on the fictitious party), stock shown, bath slots and their availability, service hours, the Domotique
   readings: all read the live configuration, so the demo is the app as it is today.
10. **Orders are simulated.** On a demo session, `POST /orders` validates exactly like a real order (same quote, same
    refusals: past slot, closed hours, sold out, over `maxOrderTotal`…) and then, instead of committing, answers a
    confirmed order marked `demo: true`. It writes no `guest_orders` row, no fiche line, no resource session, no
    payment link, no stock count, no hold, no push, no e-mail. Both payment choices (« Payer maintenant » /
    « Ajouter à la note ») end on the confirmation; the card choice never reaches Qonto.
11. **The demo's orders live in memory.** The simulated orders are kept server-side in a bounded in-memory store
    keyed by the session (at most 20 per session, the oldest goes first; dropped when the session is found expired or revoked, when « Régénérer le lien » ends it, or at a server restart; the number of sessions held is bounded too, the least recently used going first), so « Mes commandes » and the
    order detail show them during the demonstration. `abandon` on one removes it. They never appear on the staff
    « Commandes clients » page, the planning or any statistic.
12. **The gate is fictitious.** On a demo `stay` session the « Portail » tile is active and opens an in-app sheet
    (« Ici, le voyageur ouvre le portail. Code du clavier : 1234 » + « Démo : aucun portail n'est ouvert. ») instead
    of the gate app. `gate.keyUrlOf` is never called for a demo session.
13. **Lights are simulated.** On a demo session, `POST /home/lights/:id` answers an accepted command, and
    `GET /home/commands/:id` reports it done after ~1 s with the switched state; the house is never called. The
    readings stay real (rule 9).
14. **Guest push.** A demo session cannot subscribe to push (403 `DEMO_SESSION`); the app hides the offer.
15. **The guard is on the server.** Every write path of the guest API checks `req.guest.demo` before any side
    effect; the app's « Démo » marks are information, never the protection.

### 3.D What the operator sees

16. **The demo bar.** On every screen of a demo session, a thin bar under the app bar: « Démo · La Granja · Pendant
    le séjour » with a chevron. Tapping it opens a bottom sheet: « Logement » (one row per enabled lodging, the
    current one checked) and « Moment » (Avant l'arrivée / Pendant le séjour / Après le départ). A choice applies at
    once (rule 7) and closes the sheet. The bar does not scroll away.
17. **Order confirmation.** The usual confirmation screen, with one line under the title: « Démo : rien n'a été
    commandé ni payé. » The order chip reads « Démo ».
18. **Language.** The demo bar and sheet follow the app's FR / EN switch like every other string.

**Edge cases:**
- A lodging disabled while shown → the next request falls back to the first enabled lodging; none left → rule 4.
- The demo link regenerated while a phone is on it → `SESSION_EXPIRED`, the stored old link answers
  `CODE_NOT_FOUND`, the app shows « Ce code n'est pas reconnu ».
- Two phones on the same demo link → two sessions, each with its own lodging, moment and simulated orders.
- A bath slot taken for real while it sits in a demo cart → the demo order is refused like a real one would be.
- `preArrival` / `ended` moment → the shop, orders and gate behave as the real rules say for that moment (no gate,
  shop read-only before arrival, visitor mode after).

---

## 4. Architecture

### 4.1 Server side (`server/src/plugins/guest-app/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `demoLinkModel.js` | C | The demo link: create on first need, read back for the Studio, regenerate (revoke + new), `isLive`, find by token hash |
| `models/` | `lodgingsModel.js` | T | `listEnabled` (the Studio's order), `checkTimes` (the lodging's own check-in / check-out) |
| `models/` | `sessionsModel.js` | T | `create` accepts `origin: 'demo'`, `demoLinkId`, `demoMoment`; `switchDemo(id, { propertyId, moment })`; `endDemoSessions(linkId)` |
| — | `demoStay.js` | C | Pure: `demoStay(lodging, moment, now, lang)` → the fictitious stay (rule 5) |
| — | `demoOrders.js` | C | Bounded in-memory store of simulated orders per session (rule 11) |
| — | `demoCommands.js` | C | Bounded in-memory store of the simulated light commands per session (rule 13) |
| — | `demoPricing.js` | C | Prices a demo cart with the core's own sale service: the fictitious stay is written inside a transaction that is always rolled back, the quote (or `collectionOf`) is asked of it there (rules 9, 10) |
| `middleware/` | `guestSession.js` | T | `load` recognises a demo session (live demo link, enabled lodging, else fallback), attaches `demo: true` and the fictitious stay |
| `controllers/` | `sessionController.js` | T | `createDemoSession`, `switchDemo`, `/me` `demo` block (rule 8) |
| `controllers/` | `ordersController.js` | T | Demo branch after validation: answer from `demoOrders`, never commit (rule 10); `list` / `read` / `abandon` from the store |
| `controllers/` | `shopController.js` | T | Reads keep working with a stay of `id: null`: no stored lines, no own orders, the collection moment read on the transient stay |
| — | `gate.js` | T | `gateState` returns `{ state: 'demo', code }` for a demo stay session (rule 12) |
| `controllers/` | home controller (`homeView.js` caller) | T | Simulated light commands for a demo session (rule 13) |
| `controllers/` | `studioSettingsController.js` | T | `GET /studio/demo-link`, `POST /studio/demo-link/regenerate` |
| `routes/` | `public.js`, `admin.js` | T | The new routes; push subscription refuses a demo session (rule 14) |
| — | `refusals.js` | T | `NO_LODGING`, `NOT_A_DEMO`, `INVALID_INPUT` (`invalidDemoChoice`) copies FR / EN |
| — | `rateLimiters.js` | T | The per-stay budgets key a demo session on its own session id (`stay.id` is null) |
| — | `qrPoster.js` | T | `demoLinkUrl(host, token)` |
| — | `migrations.js` | T | Table `guest_demo_links`; columns `guest_sessions.demoLinkId`, `guest_sessions.demoMoment` |

No core file is touched. No new dependency.

### 4.2 Client side

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| guest `src/App.jsx` | — | T | Route `/d/:token` → `EntryPage kind="demo"` |
| guest `pages/EntryPage.jsx` | — | T | Exchanges a demo token, stores it like a stay link |
| guest `components/DemoBar.jsx` | — | C | The bar + its sheet (rule 16), reusing `BottomSheet` |
| guest `components/AppShell.jsx` | — | T | Renders `DemoBar` when `me.demo` is set |
| guest `pages/OrdersPages.jsx`, `components/OrderCard.jsx` | — | T | « Démo » chip and confirmation line (rule 17) |
| guest `pages/HomePage.jsx` | — | T | Gate tile `state: 'demo'` opens the fictitious gate sheet (rule 12) |
| guest `i18n` | — | T | FR / EN strings |
| guest `hooks/useSession.jsx`, `services/api.js`, `pages/GateScreens.jsx` | — | T | `openDemo` / `switchDemo`, the demo link kept on the device and exchanged again, the « Aucun logement… » screen |
| studio `components/DemoLinkSection.jsx` | — | C | « Lien de démo » card: QR, copy, open, regenerate (rule 2); used once by `pages/SettingsPage` |

**Component reuse:** `DemoBar` is specific to the demo (one use). It reuses the guest app's `BottomSheet`,
`StatusChip` and the Studio's existing link/QR card pattern (the lodging poster card).

### 4.3 API contract

| Method | Path | Auth | Body | Answer |
|---|---|---|---|---|
| POST | `/public/v1/guest/sessions/demo` | — | `{ demoToken }` | like `POST /sessions` (cookie + mode, lodging); 404 `CODE_NOT_FOUND` |
| POST | `/public/v1/guest/sessions/demo/switch` | demo session | `{ propertyId, moment }` | the `/me` payload; 403 `NOT_A_DEMO`; 400 on an unknown lodging / moment |
| GET | `/public/v1/guest/me` | session | — | + `demo: { moment, lodgings[] }` on a demo session |
| GET | `/public/v1/guest/gate` | session | — | + `{ state: 'demo', code: '1234' }` on a demo stay session (the gate tile of `/me` carries the same `state` and `code`) |
| GET | `/api/guest-app/studio/demo-link` | admin | — | `{ url, qrDataUri, createdAt }` (created on first call; 409 while the app has no address) |
| POST | `/api/guest-app/studio/demo-link/regenerate` | admin | — | `{ url, qrDataUri, createdAt }` |

Orders, quote, slots, home: unchanged contracts; demo answers carry `demo: true` (an order's `orderId` / `status: 'confirmed'`, the simulated orders of « Mes commandes »). `/me` of a demo session in the « ended » moment also carries `ended: true` (a real visitor session learns it from the exchange of its link). A demo light command answers `202` with an `id` of the form `demo-<n>`.

## 5. Data model

- `guest_demo_links(id, tokenEncrypted, tokenHash UNIQUE, createdAt, revokedAt)` — one live row at a time.
- `guest_sessions.demoLinkId INTEGER NULL`, `guest_sessions.demoMoment TEXT NULL` — set only when `origin = 'demo'`.

Plugin tables only; existing rows untouched (NULL). Changelog `Migration` note. The origin CHECK of `guest_sessions` has to allow `demo` and SQLite cannot alter a CHECK in place: migration `guest_app_demo_mode_v7` rebuilds the table inside its transaction with every row copied (the pattern of `guest_orders_v3`), and is idempotent.

## 6. UI / UX

See the interactive summary. Domaine Solio identity (`guest-app.md` §6.1). The demo bar uses `chip` background,
`inkSoft` text, the ocre dot; 44 px tall touch target; on `xs` the lodging and moment truncate with an ellipsis
before the chevron. The sheet is the app's standard bottom sheet (full width on `xs`, centred 420 px from 900 px).

## 7. Test plan

Implemented: **44 server tests**, **16 guest app tests**, **4 studio tests** (below).

### Server unit tests — `server/src/plugins/guest-app/tests/guest-app-demo-mode.unit.test.js`

- rule 1: unknown / revoked demo token → `CODE_NOT_FOUND`; regenerate kills the sessions of the old link.
- rule 5: `demoStay` dates for each moment around midnight and a DST change; mode derived = expected.
- rule 7: switch to another lodging / moment; switch from a stay session → 403; disabled lodging → 400.
- rule 10: a demo order leaves `guest_orders`, reservation lines, resource sessions, payment links, stock and push
  untouched (counted before / after); a refused order is refused with the real reason.
- rule 11: list / read / abandon from the store; cap at 20; another session sees none.
- rule 12: `keyUrlOf` never called for a demo session.
- rule 13: a light command never reaches the house channel.
- rule 14: the guest API holds no push subscription route (see « As built »); a demo order pushes nothing (rule 10).
- rule 15: the census of the write routes of the guest API, so a new one has to decide what a demo session does.
- §5: the migration keeps the session rows, accepts `demo`, runs twice without harm.

### Client tests — `apps/guest/src/__tests__/DemoBar.demo-mode.test.jsx`

- bar shown only with `me.demo`; sheet switches lodging and moment and calls the switch endpoint; confirmation line; the gate sheet; the demo link kept on the device and exchanged again.

### Studio tests — `apps/studio/src/__tests__/DemoLinkSection.demo-mode.test.jsx`

- the card, « Copier le lien », « Ouvrir », « Régénérer le lien » after a confirmation, the missing address.

### Manual UI verification

- Studio: card, copy, open, regenerate (old link → « Ce code n'est pas reconnu »).
- Phone (390 px) and desktop: switch both lodgings × three moments; order an option with each payment choice and a
  bath slot; check in GuestFlow that no fiche, planning, payment link or staff order moved; gate sheet; a light.

## 8. Out of scope

- A demo of the GuestFlow back-office itself (`vitrine-guestflow-et-demo`).
- Choosing the fictitious party, name or dates by hand.
- Several demo links (one per person showing the app).
- Sending the demo link to guests or prospects by e-mail.

## As built — deviations and additions

- **Rule 14 has nothing to refuse today.** The guest API exposes no push subscription (the only push of the plugin is the staff's `guest-orders` channel, sent through the core). No route was invented to refuse; the census test of rule 15 fails the day one is added without a decision. A demo order pushes nothing (rule 10, tested).
- **The quote needs a stored stay.** The core sale service plays its quote on a reservation row; the fictitious stay has none. `demoPricing.js` writes it for the length of one call inside a transaction that is rolled back (a client, the reservation, its nights): the guest app's real quote engine prices the demo, nothing stays. The lodging's tariff recipe is therefore consulted for the fictitious dates; a lodging the engine cannot price for them would refuse the demo order like a real stay.
- **A demo stay the window helpers cannot build** (an unreadable check-in time) opens no session: the row is taken back and the answer is `404 NO_LODGING`.
- **« Après le départ » always lands after the window closes**: it leaves yesterday, or the day before when a late check-out (window = check-out + 2 h) would still be open at that hour.
- **A lookup by name and number replaces the demo link on the device**, like a stay link or a poster does.
- **The invariant `demoPricing.js` rests on** (the quote and `collectionOf` publish no event and confirm or release no fulfilment hold; the rollback only undoes SQLite) is pinned by a test that spies on the event bus and the fulfilment adapters.
- **The default lodging** a demo link opens is the first the Studio lists (its order is by name), the default moment is « Pendant le séjour ».
- **A demo session in the « Après le départ » moment is a visitor session** (no stay, no shop, no orders), like a real ended stay; `/me` carries `ended: true` for it.
- **The Studio card** also shows the QR (`qrDataUri` in the answer); the Studio's `SettingsPage` is unchanged but for the one component it renders.
- **The demo bar sends the app home** after a switch and empties the cart; the screens remount so every read starts again for the new lodging.
- **A demo light** shows its simulated state on the Domotique page for the session (the readings of the other sensors stay the house's).

## 9. Open questions

None open.

### Resolved (2026-11-27, Adrien)

- Fictitious guest: « Camille », 2 adults (rule 5).
- Domotique in demo: real readings, simulated lights (rules 9, 13).
- Simulated orders: listed in « Mes commandes » for the session's life (rule 11).
- Demo link: in Studio → Réglages only (rule 2).

- Shop: the full journey is simulated (cart, slot, order, both payment choices), nothing written.
- Lodging switch: a demo bar inside the app, one link only.
- Moment switch: yes, in the same bar (before arrival / during / after departure).
- Gate: tile shown, fictitious code, no real key ever.
