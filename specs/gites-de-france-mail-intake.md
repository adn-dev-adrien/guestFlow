# Gîtes de France — fill the reservation fiche from the booking e-mail

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/plugin-gites-de-france-intake` → **`inte/plugins`** _(created once approved)_ |
| **Plugin id** | `gites-de-france-intake` — not installed by default |
| **Created** | 2026-10-15 |
| **Author** | Adrien |
| **Related PR** | — |
| **Decision page** | [docs/specs/2026-10-15-gites-de-france-mail-intake.html](../docs/specs/2026-10-15-gites-de-france-mail-intake.html) |

---

## 1. Context

A Gîtes de France booking reaches GuestFlow through the iCal feed of gîte 309700
(`reservation.itea.fr/iCal_…`). The feed only carries dates: the import creates a placeholder fiche
(client « Ical Booked », 1 adult, no booking number, empty « Paiement plateforme »). Everything else
has to be copied by hand from the ITEA owner portal (`prop.itea.fr`).

On 2026-10-15 the first fiche was completed this way with `/platform-booking-intake` (dossier 11773 →
réservation 22308), and the money rule was measured on 8 settled dossiers
(`.claude/skills/platform-booking-intake/references/gites-de-france.md`):

```
Montant net propriétaire = Prix location + Options − round(10 % × Prix location)
Brut to type             = Prix location + Options + Taxe de séjour        (frais de dossier excluded)
```

Copying by hand is where the errors come from: three past fiches (Lehmann, Vallée, Filizetti) hold
the guest's « Prix total client » as brut, so their commission silently absorbed the centrale's
booking fees — and the ✓ « cohérent avec le virement » still showed.

Two automatic sources exist:

**A — the booking e-mail.** For every new booking the centrale sends, to `contact@domainesolio.com`,
a mail « Une nouvelle réservation a été effectuée pour votre logement 309700 Domaine Solio ». Real
sample (dossier 11773):

```
Réservation n° 11773-2026            État : Réservation confirmée
Gîte 309700 | Domaine Solio
du 13/11/2026 à partir de 16h00      au 15/11/2026 avant 10h00 (2 nuits)
Réservation effectuée par : ROUX Lucie
8 adultes, 2 enfants et 2 bébés      Pas de chien, pas de chat
lucie.roux@example.com                 0743338633
Détail des suppléments    Forfait ménage ( 1 ) x 1    80.00 €
Montant net de la location 454.00 €  Total des options 80.00 €   Total net : 534.00 €
une taxe de séjour d'un montant de 19.20 € … Nous la reverserons directement à votre mairie
```

It carries everything **except** the guest's postal address and the **gross rent** (it gives the
rent *net of commission*: 454 = 504 − 50).

**B — the ITEA portal.** `prop.itea.fr` shows the full contract (gross rent, address, fees) and offers
a CSV export (« Recherche/Export »). Reading it automatically means GuestFlow storing Adrien's ITEA
password and logging in as him on a third-party portal whose HTML can change at any time. The
« Liste dossiers par mail » tab is not a per-booking feed (yearly recap only).

## 2. Goal

When a Gîtes de France booking arrives, the operator opens a fiche that is already complete — guest,
party, booking number, options and « Paiement plateforme » reconciled to the payout — and only has to
glance at it. When the e-mail cannot settle a figure, the fiche says exactly which one and offers the
choice in one click.

---

## 3. Functional rules

### 3.1 Reading the mailbox

0. **Everything below ships as the plugin `gites-de-france-intake`** (operator requirement,
   2026-10-15): a base installation has none of it — no table, no job, no banner, no setting. The
   core only gains the three generic SDK capabilities of §4.1, inert without a plugin using them.
1. The plugin reads one IMAP mailbox — the one GuestFlow already sends from (`contact@domainesolio.com`,
   same credentials as the SMTP settings) — **read-only**: it never deletes,
   moves or flags a message (it may only remember which `Message-ID`s it has processed).
2. A pass runs **every 3 hours** (`ctx.jobs.every`; plugin setting `pollEveryHours`, 1 to 24, default 3).
   No other trigger — not after each iCal import (operator, 2026-10-15: what matters is that it
   happens without anyone, not that it happens fast). The job ticks every 15 minutes and reads the
   mailbox once `pollEveryHours` has elapsed since the last pass, so a new frequency applies without a
   restart. « Relever maintenant » in the plugin settings runs one pass on demand. It looks at messages received in the
   last 30 days whose sender is exactly `resa@gdf07.com` (plugin setting, default that address) and whose
   subject/body matches the « nouvelle réservation » template. Anything else is ignored, never stored.
3. Each matching message is recorded once (`Message-ID` unique), with the parsed fields — not the raw
   mail. A message that matches the sender but fails to parse is recorded `status = error` with the
   reason, and shows on the dashboard (rule 14).

### 3.2 Parsing (pure, unit-tested)

4. Extracted fields: dossier number (`11773` from `11773-2026`), gîte number, arrival/departure date +
   time, guest « NOM Prénom » → last/first name, adults / children / babies, e-mail, phone, each
   supplement line (label, quantity, amount), « Montant net de la location », « Total des options »,
   « Total net », tourist tax.
5. **Internal consistency is checked before anything else:** net location + total options = total net,
   and the sum of supplement lines = total options, to the cent. A mismatch → `status = error`, nothing
   applied.
6. Phone normalised to the French spaced form (`0743338633` → `07 43 33 86 33`); name in title case
   (`ROUX Lucie` → Lucie Roux); e-mail language `fr`.

### 3.3 The gross rent — the one figure the mail does not give

7. The gross rent `L` is solved from the net rent `N` with the platform's commission rate `r` — the
   existing `platforms.commissionPercent` of Gîtes de France (10 %), the same setting that already
   grosses the tariff up per platform (decided 2026-10-15: a setting, not a constant). The candidates
   are the integers satisfying `L − round(r × L) = N` (round half up, to the euro). A rate of 0 →
   no candidate → the intake is not applied (`error` « Aucun loyer ne donne … net avec la commission de
   la plateforme : vérifier son taux »).
   - **One candidate** → it is used.
   - **Two candidates** (happens when `r × L` lands on ,5 — e.g. N = 454 → 504 or 505) → the fiche is
     filled with everything else and asks the operator to pick one (rule 12). The payout and the
     revenue are already right either way; only the 1 € split between rent and commission is open.
   - **No candidate** → `status = error` (the rate is not 10 % any more — §9 Q3).
8. Then: brut = `L` + total options + tourist tax; « Taxe de séjour retenue » = tourist tax; « Virement
   reçu » = total net; commission = `L` − net rent (= brut − tax − virement), so the fiche's ✓
   « cohérent avec le virement » holds by construction.

### 3.4 Matching and applying

9. A message is matched to **one** reservation: platform Gîtes de France, property mapped to the gîte
   number (plugin setting: a property → gîte-number map, La Granja = 309700), same arrival and departure, not
   cancelled. No match yet → `pending`, retried on every pass (the iCal import may come later). Still
   unmatched after 24 h → shown on the dashboard.
10. **Auto-apply** only onto an untouched placeholder: imported by iCal, never saved by hand (every
    manual save locks the iCal sync, `icalSyncLocked = 1`), brut empty. Applying = the same writes the operator would make: create the
    client (or reuse one with the same e-mail), party (children → « Enfants 2–12 » by default, decided
    2026-10-15), booking number = dossier, options ticked with « Forcer en complément » **off**, the
    « Paiement plateforme » block, then the usual save path (history line « Origine : Mail Gîtes de
    France du <date> »). Beds are suggested as the « Suggérer les lits » button does; one baby cot per
    baby (`babyBeds`), which brings the property's « Lit bébé » supplement as on a manual entry.
11. A fiche the operator already edited is **never overwritten**: the intake becomes a proposal shown on
    the fiche (rule 12) with « Appliquer » / « Ignorer ».
12. The fiche shows a banner while an intake is open: applied (dismissible), proposal, or rent choice
    (two buttons with the two candidate amounts, the resulting commission under each, and a link to the
    dossier on ITEA).
13. A supplement is put on a catalogue option only when it is the property's cleaning option
    (« Forfait ménage ») at the same price. Any other supplement is not guessed onto the catalogue: it
    becomes a custom line with the centrale's own label and amount, paid to the platform
    (« Forcer en complément » off), and the banner lists it as « Ajouté tel quel ». *(Amended
    2026-10-15 at implementation: the first draft left them out, which would have shifted the
    back-solved accommodation price by their amount.)*
14. Dashboard: one line per intake in `error` or unmatched for > 24 h, linking to the fiche or to the
    settings.
    > **Amended 2026-10-18 (review n5):** a fiche waiting for the operator to choose between two
    > possible rents (`needs_rent`) is listed too — « Dossier 11773 du 14/10/2026 — loyer à choisir sur
    > la fiche · Ouvrir la fiche ». The banner alone could be missed. Plugin `1.1.0`.
15. Applying never sends an e-mail to the guest (the per-template `sendMode` stays as configured;
    the intake does not call any sender).

**Edge cases:**
- The same booking mail arrives twice (forward, resend) → `Message-ID` dedup; a second distinct mail
  for the same dossier → ignored if the first was applied, logged.
- A cancellation or modification mail → not parsed in v1 (Out of scope); the iCal flow already handles
  cancellations.
- Two Gîtes de France fiches on the same dates (impossible on one property) → no auto-apply, error.
- IMAP down / wrong password → the failed pass is logged (`[plugin:gites-de-france-intake] mail
  intake failed`) and retried at the next period; « Tester la connexion » shows the server's answer;
  the iCal flow is unaffected. The mailbox is logged out whatever fails — the connect or the INBOX
  lock included (2026-10-23).
- One intake that throws while it is processed → recorded `error` (« Erreur inattendue : … ») and the
  pass carries on with the next ones. Before 2026-10-23 it stayed `pending`, first in the open list,
  and stopped every later pass there.
- A stay that has already started (start date ≤ today) → `error` « Séjour commencé : fiche à saisir à
  la main », refused **before** the guest's client record is created: the core would refuse the save
  (rule 17) and leave an orphan client otherwise.

16. **Nothing is read before a property is tied to a gîte number.** The first boot of the plugin
    system installs every catalogue plugin on an existing base (specs/plugins-phase-0-foundation.md
    rules 10–12), so Solio gets this one active at once; until « N° de gîte » is filled for a
    property, the pass stops at « Aucun logement relié à un numéro de gîte » without opening the
    mailbox. A new customer's fresh base installs no plugin at all.
17. `ctx.core.reservations.update` refuses a stay that has started or is past (`409 PAST_RESERVATION`):
    those stay the operator's, as the fiche's own lock already says.
18. *(Fixed at the 2026-10-27 audit.)* A mail for a gîte number **no property is tied to yet** waits
    `pending`, its reason kept (« Aucun logement n’est relié au gîte n°… »), and is retried at every pass
    like a mail whose iCal fiche has not arrived; once the operator fills « N° de gîte », the next pass
    applies it. After 24 h the dashboard line shows that reason instead of « aucune fiche sur ces dates ».
    It used to end in a final `error` that no later pass looked at again (the Airbnb intake already
    waited, `specs/airbnb-mail-intake.md` rule 11).
19. *(Fixed at the 2026-10-27 spec review.)* The guest's client is created **in the same transaction as the
    fiche's update**: the plugin hands its find-or-create payload to `ctx.core.reservations.update(id, patch,
    { label, client })` (SDK 2.7.0) instead of calling `ctx.core.clients.findOrCreate` first. A fiche the core
    refuses for any reason (capacity, validation, a race with the start of the stay) rolls the client back:
    no orphan client holds the guest's personal data. Test: `tests/plugin-intake-client-in-update-transaction.unit.test.js`.
20. *(Added 2026-10-28, audit findings F2 and injection #1.)* **The sender is proven, not read.** IMAP `SEARCH FROM` is a substring
    match over the whole From field, display name included; the SDK reader (`mailAuthentication.js`) therefore
    keeps a mail only when its header From address **equals** the configured sender
    (case-insensitive), and flags it `authenticated` only when the `Authentication-Results` header written by the
    mailbox's own server reports `dkim=pass` with a signing domain (`header.d`, or the domain of `header.i`) equal
    to the sender's domain or listed in the `senderDomains` setting. Only one such header is trusted: the one
    whose `authserv-id` is the `trustedAuthservId` setting (« Serveur de réception »), or, when empty, the provider's
    known name (`smtp.gmail.com` → `mx.google.com`); for any other provider with the setting empty, no mail is
    authenticated, so every one is a proposal. The header is read with an RFC 8601 tokenizer (quoted strings and
    nested comments never split a result) and only the `dkim` result's `header.d` / `header.i` count. A mail that
    fails is stored (`senderVerified = 0`) and, once matched, becomes a **proposal** — also listed on the dashboard
    (rule 15 / 14) so it never sits unseen — whose banner is
    « Expéditeur non vérifié » — it is never auto-applied, whatever `autoApply` says; the operator can still
    apply it by hand. A forged proposal never counts as « already handled » for rule 8's dossier dedup, so it cannot
    shadow the genuine mail, and an unauthenticated mail that does not parse leaves no row. Tests:
    `server/src/tests/mail-sender-authentication.unit.test.js`, `gites-de-france-intake/tests/sender-verification.unit.test.js`,
    `IntakeBanner.sender-verification.test.jsx`.
21. *(Added 2026-10-28, audit injection #1.)* **An authenticated mail never swaps contact details.** When the
    fiche's current client already has an e-mail or a phone (the iCal placeholder has none), the mail is not
    auto-applied: it becomes a proposal whose banner says « E-mail ou téléphone déjà renseigné sur la fiche »,
    since applying would replace the guest's address with the one in the mail (the later payment and portal mails
    go there). The operator can apply it by hand. Test: `gites-de-france-intake/tests/sender-verification.unit.test.js`.
22. *(Added 2026-10-28, audit finding H1 of authz.)* **The mailbox password has one destination.** The reader
    connects over implicit TLS on 993 and requires STARTTLS on any other port (never plaintext); **the SDK pins the
    host itself** (`sdk.mailbox.resolveImapHost`, applied inside `readMailsFrom` / `testConnection` against the core's
    SMTP host, whatever the caller passes — so it holds for any plugin version): the SMTP server's own host, its
    `imap.` counterpart, or a host one label away under the same parent (never two labels, a public suffix or an
    IP), a configured host elsewhere being refused at save and ignored at use. The card shows the host used.
    `imapHost`, `imapPort`, `senderAddress`, `senderDomains` and `trustedAuthservId` are declared `supportLocked`:
    refused to a support session when changed (`specs/hosting-h2-account-security.md` rule 18, which also refuses a
    plugin rollback). Test:
    `server/src/tests/mail-intake-credential-destination.unit.test.js`.

---

## 4. Architecture

The plugin system lives on the integration branch **`inte/plugins`** (phases 0 → P, not yet in
`master`). This feature targets that branch. Model plugin to copy: `weather-alerts` (one table, a
secret setting, a route, `ctx.data`, a settings section, tests).

### 4.1 Core — generic SDK additions (no Gîtes de France code in the core)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `controllers/` | `reservationsController.js` | T | `update(req, res)` becomes a 3-line adapter over `performUpdate(id, body, { unlockPast })` → `{ status, body }`: the same validation, pricing, history and `reservation.updated` event, callable without Express. Verified identical on the dev base: a fiche saved from the UI and through the service give the same figures (réservation 22270). |
| `utils/` | `resultRecorder.js` | C | The stand-in `res` that records `{ status, body }`. |
| `utils/` | `reservationUpdateBody.js` | C | `toUpdateBody(stored, autoEnabledIds)`: a stored reservation → the full PUT body the fiche sends (the PUT rewrites every column, so a partial update must carry the rest as it is). Mirrors `bookingFormHydration.js` + the fiche's save payload. |
| `plugins/sdk/` | `coreServices.js` | T | `ctx.core.reservations.update(id, patch, { label })` (stored body + patch → `performUpdate`; `label` adds a history line « Origine »; refused on a started stay, rule 17), `ctx.core.reservations.suggestBeds(propertyId, party)`, `ctx.core.clients.findOrCreate(fields)` (by e-mail), `ctx.core.settings.mailbox()` → `{ host, user, password }` of the sending mailbox. |
| `client/src/pages/` | `ReservationPage.jsx` | T | New slot **`reservation.banners`** at the top of the form column, with `onReservationChanged` to reload the fiche after a plugin wrote it (`reservation.cards` sits below the finance section — too late for a « vérifie ceci » banner). |
| `client/src/constants/` | `plugins.js` | T | `/settings/integrations` also exists when only this plugin is active. |
| `client/src/components/` | `PluginCard.jsx` | T | The `mail` icon. |

### 4.2 The plugin — server (`server/src/plugins/gites-de-france-intake/`)

| File | T/C | Responsibility |
|---|---|---|
| `index.js` | C | `register(ctx)`: migrations, settings, the 15-min job, the `/api/gdf-intake` router, data. |
| `mailParser.js` | C | Pure: mail text → structured booking or typed parse error (rules 4–6). |
| `rentFromNet.js` | C | Pure: `(net, ratePercent)` → candidate gross rents (rule 7). |
| `mailboxReader.js` | C | `imapflow` wrapper: recent messages from the sender, text body, read-only. |
| `intakesModel.js` | C | CRUD on the plugin table through `ctx.db`. |
| `intakeService.js` | C | Pass: fetch → parse → match → `ctx.core.reservations.update` or proposal; apply / ignore / choose-rent. |
| `tests/*.unit.test.js` | C | §7. |
| `server/src/constants/plugins.js` | T | `PLUGIN_CATALOG` entry. |
| `server/src/plugins/index.js` | T | Registration. |
| `server/package.json` | T | `imapflow` (single dependency file; plugins are built in). |

### 4.3 The plugin — client (`client/src/plugins/gites-de-france-intake/`)

| File / slot | Responsibility |
|---|---|
| `IntakeBanner.jsx` → `reservation.banners` | Applied / proposal / rent choice / unknown supplements. |
| `IntakeAlert.jsx` → `dashboard.alerts` | One line per intake in error or unmatched > 24 h. |
| `SettingsSection.jsx` → `settings.integrations` | Enabled, frequency (1–24 h), « Relever maintenant », sender address, IMAP host/port (pre-filled from the SMTP host), property → gîte-number map, « Tester la connexion ». |
| `client/src/plugins/index.js`, `constants/plugins.js` | Registration, `PLUGIN_IDS`. |
| `api.js` | The seven calls of §4.4. |

**Component reuse:** MUI `Alert` / `Card` like the other plugin sections (`SettingsWeatherSection`, `LinenShortageAlert`). The banner stays
plugin-local; if a second intake plugin appears, it moves to `components/` then.

### 4.4 API contract (plugin routes, behind auth, 404 `PLUGIN_INACTIVE` when the plugin is not live)

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/api/gdf-intake/reservation/:reservationId` | — | `{ intake: { id, status, error, receivedAt, receivedLabel, dossierNumber, netRent, rentCandidates: [{ rent, commission }], customLines: [{ label, amount }], iteaUrl } \| null }` — the banner, ready to render |
| POST | `/api/gdf-intake/:intakeId/apply` | `{ rent? }` | `{ status }` (`rent` chooses between two candidates; 400 + `{ error }` on refusal) |
| POST | `/api/gdf-intake/:intakeId/dismiss` | — | `{ ok }` |
| GET | `/api/gdf-intake` | — | `{ items }` — intakes in error, or pending > 24 h (dashboard) |
| POST | `/api/gdf-intake/run` | — | `{ read, applied?, needs_rent?, proposed?, pending?, error?, ignored? }` or `{ skipped }` (« Relever maintenant ») |
| POST | `/api/gdf-intake/test-mailbox` | — | `{ ok, error? }`, never echoes the password |
| GET | `/api/gdf-intake/mailbox` | — | `{ host, port, user, hasPassword, lastRunAt }` |

---

## 5. Data model

Plugin table, created by `ctx.migrations` at install (never on a base without the plugin), declared
in `ctx.data` so the Plugins page can show and erase it:

```sql
CREATE TABLE IF NOT EXISTS gdf_intakes (
  id INTEGER PRIMARY KEY,
  messageId TEXT NOT NULL UNIQUE,
  receivedAt TEXT NOT NULL,
  dossierNumber TEXT,
  parsed TEXT,                 -- JSON of rule 4 fields
  status TEXT NOT NULL,        -- pending | applied | proposed | needs_rent | ignored | error
  error TEXT,
  reservationId INTEGER,
  appliedAt TEXT,
  dismissedAt TEXT,            -- the banner was closed
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Plugin settings (`ctx.settings.declare`): `senderAddress` (default `resa@gdf07.com`), `imapHost`,
`imapPort` (993), `pollEveryHours` (3, validated 1–24), `giteNumbers` (JSON `{ propertyId: "309700" }`, validated), `autoApply` (`1`), `lastRunAt`. No secret of
its own: the password is the SMTP one, read through `ctx.core.settings.mailbox()`. **No core column,
no core table.** `platforms.commissionPercent` is read, never written. **Operator action before use:**
the dev copy of 2026-10-08 holds `GitesDeFrance` at 0 % — set 10 % in Comptabilité › plateformes, keeping
in mind that the same % grosses up the Gîtes de France column of the tariff grid.

## 6. UI / UX

Decision page: `docs/specs/2026-10-15-gites-de-france-mail-intake.html`. Shipped copy (short, impersonal):

- Applied (green, closable): « Rempli depuis le mail Gîtes de France du 14/10 à 18:32. » + « Ajouté tel quel :
  « Panier petit-déjeuner » 24 € » when rule 13 applies.
- Rent choice (amber): title « Prix de location : 504,00 € ou 505,00 € ? », « Le mail ne donne que le net
  (454,00 €). Le reste de la fiche est rempli. », one button per rent with « commission 50,00 € » under it,
  link « Voir le dossier sur ITEA ».
- Proposal (blue): « Le mail Gîtes de France du … (dossier 11773) concerne cette fiche, déjà modifiée à la
  main. » [Appliquer] [Ignorer].
- Error (red, closable): « Le mail Gîtes de France du … n’a pas pu être appliqué : <raison> ».
- Dashboard: « Mails Gîtes de France à vérifier », one line per intake, « Ouvrir la fiche ».
- Settings card « Saisie Gîtes de France » in Paramètres › Intégrations: sender, frequency, IMAP server
  (« Vide : le serveur d’envoi (…) »), port, « N° de gîte de chaque logement », « Remplir seul une fiche
  iCal encore intacte », « Tester la connexion », « Relever maintenant », last pass.

Responsive: on `xs` the rent buttons stack full width and every button keeps 44 px; verified at 390 px
(no horizontal scroll). The settings rows stack on `xs`.

## 7. Test plan

- [x] `server/src/plugins/gites-de-france-intake/tests/mailParser.unit.test.js` (11): the 11773 layout
  with a fictitious guest (public repository), flattened HTML, towels + compound names + thousands, no
  supplement, both consistency refusals, other mails, phone forms, the 6 measured dossiers, 504/505
  ambiguity, no rate.
- [x] `.../tests/intakeService.unit.test.js` (18): sender/mailbox, auto-fill patch, payment block,
  rent choice, proposal, auto-apply off, pending → applied, unmapped gîte (pending, rule 18), no mapping → no read,
  `Message-ID` and dossier dedup, unreadable vs other mails, rate 0, custom lines, refused save, no
  e-mail, dismiss, no mailbox.
- [x] `.../tests/unmapped-gite-pending.unit.test.js` (2, audit 2026-10-27): rule 18 — unmapped → pending
  with its reason → applied once mapped; mapped without a fiche → pending, reason cleared.
- [x] Client `IntakeAlert.unmapped-gite.test.jsx` (1, audit 2026-10-27): the dashboard line of rule 18 says
  the server's reason.
- [x] `.../tests/isolation.unit.test.js` (1): rule 0 — no core file names the plugin's table, routes or
  folder outside the two registration lists.
- [x] Core `server/src/tests/reservation-update-service.unit.test.js` (6): recorder, `performUpdate` =
  HTTP answer (success, refusal), `toUpdateBody`, `ctx.core.reservations.update` (patch + history line,
  started stay refused).
- [x] Guards updated: catalogue count (13), module lists, job intervals (`plugins-phase-0`,
  `plugins-phase-1-sdk`, client `registry.test.jsx`), E2E `plugins-page.spec.js` (Installés (13)).
- [x] Client `IntakeBanner.rent.test.jsx` (1) and `IntakeBanner.states.test.jsx` (4).
- [x] 2026-10-28 audit fix (rules 20–22): `server/src/tests/mail-sender-authentication.unit.test.js`, `mail-intake-credential-destination.unit.test.js`, `gites-de-france-intake/tests/sender-verification.unit.test.js` (9), client `IntakeBanner.sender-verification` (2). Plugin 1.4.0, SDK 2.12.0.
- [x] Suites on 2026-10-15: server 4945 ✓, client 1538 ✓, E2E 98 ✓ (+1 skipped),
  `check-spec-coverage` 0 missing.
- [x] Manual, real browser on a copy of the dev base (IMAP stubbed with the fixture mail): settings card →
  gîte 309700 → « Relever maintenant » → the real iCal fiche 22296 (13–15/11) filled: Claire Dupont,
  n° 11773, 8/0/2/2, 4 doubles + 2 simples + 2 lits bébé, ménage 80 € not in complement; banner « 504 ou
  505 » → 504 → brut 603,20, taxe 19,20, commission 50, virement 534, final 594 — **identical to the
  manual entry of prod fiche 22308 that morning**. Mobile 390 px: no horizontal scroll. Plugin
  deactivated: route 404, no banner, no settings card. A second GdF fiche on the same dates (test clone)
  → error « Plusieurs fiches », nothing written.

## 8. Out of scope

- Reading the ITEA portal (option B) — no ITEA credentials stored.
- Cancellation / modification mails.
- Postal address (not in the mail; not needed for the stay).
- Repairing the past fiches (operator decision 2026-10-15).
- Other platforms' mails (a sibling plugin would reuse the §4.1 SDK pieces).
- Merging `inte/plugins` into `master` (separate track).

## 9. Open questions

1. **IMAP host/port**: derived from the SMTP host by default, editable in the plugin settings —
   confirm on the first « Tester la connexion ». *Amended 2026-10-25 (specs/airbnb-mail-intake.md rule 4):*
   the default was the SMTP host itself (`smtp.gmail.com`), on which no IMAP pass can connect; it is now
   deduced as `imap.<domain>`. The reader moved to the SDK (`sdk.mailbox.readMailsFrom`), shared with the
   Airbnb intake plugin.

**Resolved (2026-10-15, operator):**

- ~~Frequency~~ → **every 3 hours** by default (setting 1–24 h), no trigger on iCal imports.
- ~~Banner placement~~ → new generic slot `reservation.banners` at the top of the fiche.

- ~~Sender address~~ → `resa@gdf07.com`.
- ~~IMAP account~~ → the same mailbox and credentials as the current SMTP.
- ~~Core or plugin?~~ → **plugin** `gites-de-france-intake`, not in the base installation; the core
  only gains the generic SDK pieces of §4.1.

- ~~Option A alone, or A + B?~~ → **A alone** (the booking mail). No ITEA credentials stored; the
  `/platform-booking-intake` skill stays the fallback.
- ~~Auto-apply or always propose?~~ → **auto-apply on an untouched iCal placeholder only**, proposal
  otherwise (rules 10–11).
- ~~Commission rate: setting or constant?~~ → **setting**: the existing `platforms.commissionPercent`
  (rule 7). The 2027 rate stays 10 % only if the membership was renewed before 30/09/2026.
