# Booking.com — fill the reservation fiche while the operator opens the extranet page

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/plugin-booking-intake` → **`master`** |
| **Plugin id** | `booking-intake` — not active by default |
| **Created** | 2026-10-15 |
| **Author** | Adrien |
| **Related PR** | — |
| **Depends on** | the plugin engine (`specs/plugins-phase-1-sdk.md`, packages `specs/plugins-phase-4-registry.md`; first shipped on `master` on the superseded `specs/plugin-engine-backport.md`), `specs/gites-de-france-mail-intake.md` (update service, `reservation.banners` slot) |
| **Decision page** | [docs/specs/2026-10-15-booking-extranet-intake.html](../docs/specs/2026-10-15-booking-extranet-intake.html) |

---

## 1. Context

A Booking.com stay reaches GuestFlow through an iCal feed — Booking's own, or Lodgify's while the
Lodgify exit is in progress (2026-10-15: a Booking stay arrived with canal « Lodgify »). The feed only
carries dates: the import creates a placeholder fiche (client initials, 1 adult, an auto-generated
booking number, empty « Paiement plateforme »).

Everything else is copied by hand from the reservation page of the extranet (`admin.booking.com`).
Since 2026-10-06 the `/platform-booking-intake` skill does that copy from Claude's browser, with the
money rule measured on the payouts (`.claude/skills/platform-booking-intake/references/booking.md`):

```
Payout                  = « Montant total » − « Commission et frais »
Brut to type            = « Montant total »                (tourist tax included)
Tourist tax withheld    = the « Taxe de séjour » line       (Booking's figure, not GuestFlow's)
Commission (GuestFlow)  = brut − payout − tourist tax       (accepted gap, option « B »)
```

The Gîtes de France plugin (`gites-de-france-intake`) automates the same work because the centrale
e-mails a full recap. **Booking does not**:

- its e-mails are no recap: the one received for 6392081711 on 2026-10-15 notified a guest message
  (number, name, dates, headcount — no contact, ages or amount), and is sent only when the guest
  writes;
- its API is reserved to certified channel managers;
- the reservation list of the extranet (and its JSON, measured 2026-10-15) gives name, dates, adults,
  children's ages, Sous-total and « Commission et frais », but **not** the tourist tax — so neither the
  brut nor the payout — nor the e-mail, phone or language.

The only place holding every figure is the reservation page itself, behind the operator's password and
2FA. GuestFlow must never hold those credentials, nor log in on the operator's behalf (Booking's terms
and bot detection forbid it, and the host holds the guest database).

Measured on 2026-10-15 on that page: no enforced Content-Security-Policy (report-only), ~5.5 kB of
visible text, the extranet adds its own session parameter to a link that lacks it. A script running in
the operator's **own logged-in browser** can read the page the operator opens and hand it to GuestFlow.

## 2. Goal

The operator opens a Booking reservation from the dashboard; by the time the page is on screen the
fiche is filled — guest, party, booking number, arrival time, requests and « Paiement plateforme »
reconciled to the payout (✓). The operator only checks the fiche.

---

## 3. Functional rules

### 3.1 The carrier: a userscript in the operator's browser

1. **Everything below ships as the plugin `booking-intake`**: a base installation has no table, no
   route, no setting, no alert of it; an inactive plugin answers 404 on every route.
2. The plugin generates a **userscript** (`booking-intake.user.js`, for Tampermonkey, Violentmonkey or
   Safari Userscripts) from its settings card: `GET /api/booking-intake/userscript.user.js` (admin
   session) returns it with the instance's public URL and the plugin's **secret** embedded. The card
   shows « Installer le script » and « Régénérer le secret ». Regenerating invalidates every installed
   copy; the card says so.
   > **2026-10-18 (code review):** before any secret exists the card shows « Créer le secret » only
   > (rule 25); the two buttons above come once it is created.
3. The script runs on `https://admin.booking.com/hotel/hoteladmin/extranet_ng/manage/booking.html*`
   only. Once the page shows « Numéro de réservation », it clicks « Afficher le numéro de téléphone »
   when present, waits for the number (≤ 2 s), reads `document.body.innerText` and the `hotel_id` /
   `res_id` parameters, and sends **one** request per page view (guard in `sessionStorage` on
   `res_id` + text hash).
4. The request is `POST <publicUrl>/public/booking-intake/page` with the secret in the header
   `X-Booking-Intake-Key`, sent with `GM_xmlhttpRequest` (no CORS, no page CSP involved). Body
   `{ v: 1, hotelId, resId, text }`, 128 kB max.
5. The script parses **nothing**: when Booking renames a label, a GuestFlow release fixes the server
   parser and no script is reinstalled. `v` exists for the day the carrier itself must change.
6. The script shows the server's answer as a small toast on the Booking page (bottom-right, 8 s;
   errors stay until clicked): « GuestFlow : fiche 22309 remplie ✓ », « Déjà à jour », « Fiche
   déjà remplie : 3 champs diffèrent, à valider dans GuestFlow », or the refusal reason.
7. **The public route authenticates itself.** It lives at `/public/booking-intake/page` (mounted with
   `ctx.mount(…, { public: true })`), compares the secret in constant time, answers `401` without
   detail on a mismatch, and is rate-limited (30 requests/min). It never reads or writes anything
   before the secret is verified. **The raw page text is never stored and never logged** (request
   logging excludes the body).

### 3.2 Parsing (server, pure, unit-tested)

8. The parser normalises ` `, ` `, `​` and reads, by label then next non-empty line:
   arrival / departure dates, « Durée de séjour », « Nombre de personnes » (adults + every child's
   age), « Montant total », guest name (« Identité vérifiée » stripped; Booking writes « Prénom Nom »),
   2-letter country, relay e-mail, phone, « Langue préférée », « Numéro de réservation », « Montant
   soumis à commission », « Commission et frais », the nightly lines, « Sous-total », « Taxe de
   séjour », « Heure d'arrivée approximative », and the guest messages of « Conversation avec le
   client » and « Demandes des clients ».
9. **Consistency gate** — the intake is refused (typed error, nothing written) unless all hold:
   - nights = departure − arrival;
   - « Numéro de réservation » = `res_id`;
   - Sous-total + Taxe de séjour = Montant total (± 0.01);
   - Sous-total = Montant soumis à commission (± 0.01);
   - adults + children = the headcount of « Nombre de personnes ».
   The error names the failing check and the figures, so a wording change at Booking shows up as
   « Taxe de séjour introuvable », never as a wrong amount.
10. Party by GuestFlow's age bands: Adultes ≥ 18, Ados 12–17, Enfants 2–11, Bébés 0–1.
11. E-mail language: `fr` when « Langue préférée » is French, otherwise `en` (operator decision
    2026-10-06).

### 3.3 Matching

12. Property = the one mapped to `hotelId` (plugin setting: property → Booking establishment id; La
    Granja = 14407976). Unmapped id → refused « Établissement Booking 14407976 non relié à un
    logement ».
13. Fiche = the non-cancelled reservation of that property with the **same arrival and departure**,
    whatever its canal (Booking, Lodgify, or a placeholder). One property cannot hold two, so there is
    at most one. None → refused « Aucune fiche du 06/11 au 08/11 : la synchro iCal ne l'a pas encore
    importée » (the toast says to retry after the next import; the plugin never creates a
    reservation).

### 3.4 Applying

14. **Auto-apply only onto an untouched fiche**: « Paiement plateforme » empty **and** the client has
    neither e-mail nor phone (the iCal placeholder). Anything else is never overwritten silently.
15. Applying makes, through `ctx.core.reservations.update` and `ctx.core.clients.update`, the writes
    the operator would make:
    - client: first name, last name, relay e-mail, phone, e-mail language (rule 11);
    - reservation: canal `Booking`, booking number = `res_id`, party (rule 10), beds as « Suggérer les
      lits » computes them (`suggestBeds`), arrival time = start of « Heure d'arrivée approximative »
      when given;
    - « Paiement plateforme »: `platformGrossAmount` = Montant total, `platformTouristTaxAmount` =
      Taxe de séjour, `platformPayoutAmount` = Montant total − Commission et frais,
      `platformCommissionAmount` = brut − payout − tourist tax, rounded to the cent (server formula,
      same figure the fiche's « Calculer la commission » gives);
    - notes: the guest's requests **appended** under a line « Booking, 15/10 : », never replacing the
      operator's text, and not repeated when the same block is already there;
    - history entry « Rempli depuis l'extranet Booking (réservation <res_id>) ».
16. **A stay that has started or passed is refused** (the update service answers 409
    `PAST_RESERVATION`): « Séjour commencé : fiche à saisir à la main ».
17. **Fiche already filled**: identical to the page → `same` (« Déjà à jour », nothing written); it
    differs → a **proposal** is stored (parsed fields only) and nothing is written. The fiche shows
    it in the `reservation.banners` slot with the differing fields old → new and « Appliquer » /
    « Ignorer ».
18. The banner of an applied intake reads « Rempli depuis l'extranet Booking le 15/10 à 15:52. »
    [Masquer], plus « Message client sans réponse sur Booking » when the conversation ends on a
    guest message.
19. Applying never sends an e-mail to the guest (the per-template `sendMode` stays as configured).
20. Every intake is logged (§5): applied, same, proposed, refused with its typed error. Only the
    parsed fields of an applied or proposed intake are kept.

### 3.5 The trigger: the iCal import

Booking's e-mails are no trigger (§1). The iCal import happens for every Booking stay, and GuestFlow
already has it.

21. **« À compléter »** = a non-cancelled reservation whose arrival is today or later, imported by an
    iCal source counted as Booking (plugin setting `sourceKeys`, default `booking` and, while the
    Lodgify exit lasts, `lodgify`), on a property mapped to a Booking establishment (rule 12), with
    « Paiement plateforme » still empty and not dismissed. Computed by the server on read.
22. Dashboard (`dashboard.alerts`): one line per fiche à compléter — « Réservation Booking à
    compléter · La Granja 06/11 → 08/11 » — with « Ouvrir dans Booking » and « Ouvrir la fiche ». The
    iCal carries no booking number, so « Ouvrir dans Booking » opens the extranet list filtered on
    that arrival date; the operator opens the reservation and the script does the rest.
23. The line disappears as soon as the fiche is filled. « Pas une réservation Booking » dismisses it
    (a Lodgify-feed stay can be a direct or another platform's booking).
24. Arrival within 7 days and still à compléter → the line moves to `dashboard.alerts.urgent`.
25. **The secret is created by an explicit action, never by a read** (added 2026-10-18, code review
    m4/m5). Paramètres › Intégrations shows « Créer le secret » while the plugin has none
    (`POST /api/booking-intake/secret`, idempotent: a second call keeps the existing secret). Until then
    `GET /api/booking-intake/userscript.user.js` answers `409` « Secret non créé. » and writes nothing;
    once it exists the card offers « Installer le script » and « Régénérer le secret ».
26. **A support session never reaches the secret** (added 2026-10-18, code review M2). The script
    carries the secret in clear, so `GET /api/booking-intake/userscript.user.js`,
    `POST /api/booking-intake/secret` and `POST /api/booking-intake/secret/regenerate` are declared with
    `ctx.secretRoutes` and refused to a support session (`specs/hosting-h2-account-security.md` rule 23),
    whatever the case or a trailing slash.

**Edge cases:**
- Script runs on a page already filled → `same`, toast « Déjà à jour ».
- Reservation cancelled on Booking (page says « Annulée ») → refused: « Réservation annulée sur
  Booking — l'annulation passe par la synchro iCal ».
- Children's ages missing (« 2 enfants » without ages) → refused by rule 9 rather than guessed.
- Two rooms on one reservation → refused (one listing per property).
- Phone never revealed → applied without phone, the toast says so.
- Secret wrong or regenerated → `401`, the toast says « Script obsolète : le réinstaller depuis
  GuestFlow ».
- GuestFlow unreachable → the toast says so; nothing is queued.
- The plugin is inactive → `404`, the toast says « Module inactif ».

---

## 4. Architecture

Targets **`master`**, on top of `specs/plugin-engine-backport.md`.
> **2026-10-18 (merge into `inte/plugins`):** the plugin now runs on the full engine — see §10.

### 4.1 Core — generic pieces

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `platformCommission.js` | C | Pure: `(gross, payout, touristTax, acompteCommission)` → commission, rounded to the cent (rule 15). |
| `controllers/` | `reservationsController.js` | T | `POST /api/reservations/platform-commission` → the util; « Calculer la commission » calls it. |
| `plugins/sdk/` | `coreServices.js` | T | `ctx.core.clients.update(id, patch)` (through `clientsModel`, same normalisation as the client dialog); `ctx.core.reservations.platformCommission(...)`. **Also cherry-picked identically onto `inte/plugins`**, so the same file does not diverge. |
| `client/src/components/reservation/` | `FinanceSection.jsx` | T | « Calculer la commission » calls the endpoint; `computeCommissionFromPayout` is deleted (CLAUDE.md §6.0). |
| `client/src/` | `api.js` | T | `computePlatformCommission`. |

### 4.2 The plugin — server (`server/src/plugins/booking-intake/`)

| File | T/C | Responsibility |
|---|---|---|
| `index.js` | C | `register(ctx)`: migrations, settings (`hotelIds`, `sourceKeys`, secret `key`), routes, data. |
| `pageParser.js` | C | Pure: page text → structured booking or typed error (rules 8–11). |
| `userscript.js` | C | Pure: `(publicUrl, secret)` → the `.user.js` source (rules 2–6). |
| `intakeService.js` | C | Rules 12–20: match, plan the writes, apply or propose. |
| `pendingFiches.js` | C | Rules 21–24: read-only query through `ctx.db`. |
| `intakesModel.js` | C | CRUD on the plugin tables through `ctx.db`. |
| `routes.js` | C | `/api/booking-intake` (admin) and `/public/booking-intake` (secret). |
| `tests/*.unit.test.js` | C | §7. |
| `server/src/constants/plugins.js`, `server/src/plugins/index.js` | T | Catalogue and registration. |

### 4.3 The plugin — client (`client/src/plugins/booking-intake/`)

| File / slot | Responsibility |
|---|---|
| `IntakeBanner.jsx` → `reservation.banners` | Rules 17–18: applied / proposal with « Appliquer » / « Ignorer ». |
| `PendingAlert.jsx` → `dashboard.alerts` / `dashboard.alerts.urgent` | Rules 22–24. |
| `SettingsSection.jsx` → `settings.integrations` | Install link, « Régénérer le secret », property → Booking establishment id map, counted iCal sources, last 10 intakes with status. |
| `client/src/plugins/index.js`, `constants/plugins.js` | Registration. |

No page and no route: the operator never leaves the fiche. **Component reuse:** `StatusCard`,
`SummaryItem`, `ErrorAlert`, `HelpedTextField`; the banner stays plugin-local (its states differ from
the Gîtes de France one); a shared `IntakeBanner` is extracted into `components/` when a third intake
plugin appears.

### 4.4 API contract

| Method | Endpoint | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/public/booking-intake/page` | secret header | `{ v, hotelId, resId, text }` | `{ status: 'applied'\|'same'\|'proposed'\|'refused', message, reservationId? }` |
| GET | `/api/booking-intake/userscript.user.js` | admin | — | the script |
| POST | `/api/booking-intake/secret` | admin | — | `{ ok, created }` — creates the secret once (rule 25) |
| POST | `/api/booking-intake/secret/regenerate` | admin | — | `{ ok }` |
| POST | `/api/reservations/platform-commission` | admin (core) | `{ gross, payout, touristTax, acompteCommission }` | `{ commission }` · 400 without gross and payout |
| GET | `/api/booking-intake/pending` | admin | — | `[{ reservationId, propertyName, startDate, endDate, extranetUrl, urgent }]` |
| POST | `/api/booking-intake/pending/:reservationId/dismiss` | admin | — | `{ ok }` |
| POST | `/api/booking-intake/:id/apply` · `/ignore` · `/hide` | admin | — | `{ status }` · `{ ok }` (proposals) · `{ ok }` (Masquer on an applied banner) |
| GET | `/api/booking-intake/intakes?limit=10` | admin | — | the log |
| GET | `/api/booking-intake/reservation/:reservationId` | admin | — | `{ intake: { id, status, resId, appliedLabel, differences[{ field, label, from, to }], guestMessagePending } \| null }` — the banner, ready to render (same pattern as the Gîtes de France plugin) |

---

## 5. Data model

Plugin tables, created by `ctx.migrations` at install, declared in `ctx.data`:

```sql
CREATE TABLE IF NOT EXISTS booking_intakes (
  id INTEGER PRIMARY KEY,
  resId TEXT NOT NULL,
  hotelId TEXT NOT NULL,
  reservationId INTEGER,
  status TEXT NOT NULL,        -- applied | same | proposed | refused | ignored
  error TEXT,                  -- the reason shown to the operator when refused
  parsed TEXT,                 -- JSON of the fields written / proposed (never the raw text)
  guestMessagePending INTEGER NOT NULL DEFAULT 0,   -- the guest wrote and nobody answered (rule 18)
  dismissedAt TEXT,            -- « Masquer » on the applied banner
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_booking_intakes_resId ON booking_intakes(resId);

CREATE TABLE IF NOT EXISTS booking_dismissals (
  reservationId INTEGER PRIMARY KEY,   -- « Pas une réservation Booking » (rule 23)
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Plugin settings: `hotelIds` (JSON `{ propertyId: "14407976" }`), `sourceKeys` (JSON, default
`["booking","lodgify"]`), `key` (**secret**, created by « Créer le secret » (rule 25), encrypted at rest, never
returned). **No core column, no core table.**

## 6. UI / UX

See the decision page for the interactive flow. Copy (short, impersonal):

- Toasts (rule 6): « GuestFlow : fiche 22309 remplie ✓ » · « Déjà à jour » · « Fiche déjà remplie : 3
  champs diffèrent, à valider dans GuestFlow » · « Montants incohérents : Sous-total 701,80 + taxe
  20,02 ≠ total 731,82. Rien n'a été écrit. » · « Aucune fiche du 06/11 au 08/11 » · « Séjour commencé :
  fiche à saisir à la main » · « Script obsolète : le réinstaller depuis GuestFlow ».
- Applied banner: « Rempli depuis l'extranet Booking le 15/10 à 15:52. » [Masquer]; « Message client
  sans réponse sur Booking. »
- Proposal banner: « La page Booking propose 3 valeurs différentes de la fiche. » with the three
  old → new lines, [Appliquer] [Ignorer].
- Dashboard: « Réservation Booking à compléter · La Granja 06/11 → 08/11 » [Ouvrir dans Booking]
  [Ouvrir la fiche] [Pas une réservation Booking]; urgent variant « Arrivée dans 3 jours : … ».

**Mobile.** The script is a desktop-browser tool (the extranet is used there). Dashboard buttons stack
full-width on `xs`; banner buttons likewise; settings card follows `StatusCard`.

## 7. Test plan

- Server, `server/src/plugins/booking-intake/tests/`:
  - `page-parser.unit.test.js` (rules 8–11): the 2026-10-15 page (anonymised fixture), the 2026-10-06
    page (4 adults + 6 children with ages), phone hidden, no message, guest message pending,
    cancelled, missing tax line, ages missing, two rooms, `res_id` mismatch.
  - `booking-intake-service.unit.test.js` (rules 12–20): match none / one, unmapped hotel, untouched →
    applied, filled identical → same, filled different → proposed (nothing written), started stay →
    refused, notes appended once, no e-mail sent, raw text never stored, refused intake logged.
  - `public-route.unit.test.js` (rules 1, 7): wrong / missing secret → 401 before any read, valid →
    handled, rate limit, inactive plugin → 404, body > 128 kB refused, nothing of the body in logs.
  - `userscript.unit.test.js` (rules 2–5): embeds URL and secret, `@match` limited to the extranet
    reservation page, one request per view guard, no parsing in the script.
  - `pending-fiches.unit.test.js` (rules 21–24): Booking and Lodgify sources counted, others ignored,
    filled / cancelled / past / dismissed / unmapped excluded, extranet URL on the arrival date,
    urgent within 7 days.
  - `secret-lifecycle.unit.test.js` (rules 25–26): the script GET writes nothing and answers 409
    without a secret, `POST /secret` creates it once, a support session is refused the three routes.
- Core: `platform-commission.unit.test.js` — the 22304 example (2042.21 / 28.03 / 1711.49 → 302.69)
  and 22309 (721.82 / 20.02 / 606.44 → 95.36), acompte commission subtracted, never negative; the
  `FinanceSection` button calls the API.
- Client: `IntakeBanner.<state>.test.jsx` (applied, proposal, guest message pending),
  `PendingAlert.test.jsx`, `SettingsSection.test.jsx`, `SettingsSection.secret-create.test.jsx`
  (rule 25).
- Plugin inactive: no route (404), no banner, no alert, no card.
- Manual: install the script in Chrome and Safari, open the 22309 page → toast + fiche filled with ✓;
  reopen → « Déjà à jour »; regenerate the secret → old script gets « obsolète »; dashboard alert at
  390 px.

## 8. Out of scope

- Creating a reservation that the iCal has not imported yet.
- Modifications and cancellations made on Booking after the intake.
- Fetching Booking pages by GuestFlow itself, or any stored Booking credential.
- Reading Booking's e-mails.
- Other platforms' extranets (Airbnb…): a sibling script would reuse the public-route pattern.
- Merging `inte/plugins`.

## 9. Open questions

None.

**Implementation notes (2026-10-16):**

- The fiche's banner reads `GET /api/booking-intake/reservation/:id` (same pattern as the Gîtes de France
  plugin) instead of a `ctx.reservationBlock`.
- A refusal is logged with its reason (`error`), not a code; the HTTP answer also carries `code`.
- Plugin seeding: a second seed batch (`plugin-engine-backport.md` rule 3) installs the plugin inactive on
  databases that already ran the first one. _(Superseded 2026-10-18, §10: the seed batches are gone.)_ The secret is created the first time the script is asked for. _(Superseded 2026-10-18, rule 25: created by « Créer le secret », a GET never writes.)_
- The end-to-end test uses a valid base64 `GUESTFLOW_ENCRYPTION_KEY` (the former one could not encrypt a
  plugin secret).

**Resolved (2026-10-15, operator):**

- ~~Fully automatic, like Gîtes de France?~~ → GuestFlow cannot fetch the page itself (§1); a script in
  the operator's own browser sends it, and GuestFlow fills the fiche on its own (rules 3, 14).
- ~~Write after one click or on open?~~ → **on open**, protected by a per-instance secret and limited
  to untouched fiches (rules 7, 14); everything else is a proposal (rule 17).
- ~~Trigger: Booking e-mail or iCal?~~ → **iCal** (§3.5).
- ~~No fiche found~~ → refused with a clear toast; the plugin never creates a reservation.
- ~~Notes lose their capitals~~ → fixed on `master` (#684), merged.
- ~~Plugin or core feature?~~ → plugin, on a **minimal engine back-ported to `master`**
  (`plugin-engine-backport.md`); the plugins branch is not synchronised.

## 10. Implementation progress

- 2026-10-16 — shipped on `master` (#688, v3.10.0), on the minimal engine.
- 2026-10-18 — `master` merged into `inte/plugins`; the plugin moves onto the full engine:
  - `server/src/plugins/booking-intake/manifest.json` (`1.0.0`, French changelog lines, `guestflow >=3.10.0`,
    `sdk ^1.1.0`): the catalogue entry is read from it (`constants/plugins.js`), the release builds its
    package like every other plugin (`scripts/build-plugin-packages.mjs`), icon `bookmark` on the Plugins
    page.
  - The SDK entries of §4.1 (`ctx.core.clients.update`, `ctx.core.reservations.platformCommission`) raise
    the SDK to `1.1.0` (`specs/plugins-phase-4-registry.md` rule 3, a minor bump).
  - Activation goes through the Plugins page (Paramètres › Plugins), not the « Modules » card; a fresh
    database installs nothing, a database that ran v3.10.0 keeps the state its two intake rows had
    (`engine.unit.test.js`). The E2E spec activates and deactivates the plugin from the Plugins page.
  - The public door `/public/booking-intake/page` is a public mount of the engine's dispatcher; the
    `/api` writes keep the same-origin check of phase 4 rule 31, which the public door is outside of.
- 2026-10-18 — code review (`fix/review-code-security`): rules 25–26. The secret is created by
  « Créer le secret » (`POST /api/booking-intake/secret`), the script GET writes nothing, and a support
  session is refused the script and both secret routes (`ctx.secretRoutes`). Plugin `1.0.1`.
