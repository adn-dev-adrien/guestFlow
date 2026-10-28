# Airbnb — fill the reservation fiche from the booking e-mail

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/airbnb-mail-intake` → `master` |
| **Plugin id** | `airbnb-intake` — installed inactive, like the other intake plugins |
| **Created** | 2026-10-24 |
| **Author** | Adrien |
| **Related PR** | — |
| **Decision page** | [docs/specs/2026-10-24-airbnb-mail-intake.html](../docs/specs/2026-10-24-airbnb-mail-intake.html) |

---

## 1. Context

An Airbnb booking reaches GuestFlow through the Airbnb iCal feed. The feed only carries dates: the import
creates a placeholder fiche (client « Reserved Ical », 1 adult, no booking number, empty « Paiement
plateforme »). Everything else is copied by hand from Airbnb. Booking and Gîtes de France already have an
intake plugin (`booking-intake`, `gites-de-france-intake`); Airbnb has none, and the
`/platform-booking-intake` skill has no Airbnb reference.

For every new booking Airbnb sends to `contact@domainesolio.com` — the mailbox the Gîtes de France plugin
already reads — a mail from `Airbnb <automated@airbnb.com>`, subject « Réservation confirmée : <Prénom Nom>
arrive le <date> ». Measured on the raw message of réservation 202610003 (fiche 22326), saved as `.eml` on
2026-10-25: `multipart/alternative` with a **text/plain** part (6,8 kB) and an HTML part (80 kB). The plain
part, condensed (guest replaced by a fictitious one in the test fixture, tracking parameters dropped):

```
NOUVELLE RÉSERVATION CONFIRMÉE ! LOUIS ARRIVERA LE 26 DÉC.
https://www.airbnb.fr/hosting/reservations/details/HMN2HQHJAQ?isPending=true&…   Louis Toussaint
Identité vérifiée · 1 commentaire
Sur Airbnb depuis 2024
<guest's message, free text, several lines>
Envoyer un message à Louis [https://www.airbnb.fr/hosting/thread/2709230398?…]
https://www.airbnb.fr/rooms/1398287456607254737?…
GÎTE 3* 10 PERS., VUE, BAIN NORDIQUE, ÂNE, CHÈVRE
Arrivée        Départ
sam. 26 déc.   mer. 30 déc.
16:00          10:00
VOYAGEURS
5 adultes, 6 enfants, 2 bébés
CODE DE CONFIRMATION
HMN2HQHJAQ
LE VOYAGEUR A PAYÉ
288,65 € x 4 nuits   1 154,60 €
Frais de service voyageur   0,00 €
Taxes   81,66 €
TOTAL (EUR)   1 236,26 €
VERSEMENT DE L'HÔTE
Taxes   52,80 €
Frais de chambre pour 4 nuits   1 598,00 €
Ajustement du tarif par nuit   -443,40 €
Frais de service hôte (15,5 %)   -178,96 €
VOUS GAGNEZ   1 028,44 €
```

It carries the guest's name, the party, the confirmation code, the **listing id** (`/rooms/<id>`), the
links to the reservation and to the message thread, the dates and the whole money breakdown. It does
**not** carry the guest's phone, e-mail or language, nor the year of the dates.

### 1.1 What the two « Taxes » lines are — measured, not yet explained

Measured on two bookings on 2026-10-24 (the mail of 202610003 and the « Revenus » panel of 202609003):

| | 202610003 | 202609003 |
|---|---|---|
| Guest paid (« Total ») | 1 236,26 | 868,87 |
| Taxes paid by the guest | 81,66 | 63,87 |
| Taxes handed to the host (« Versement de l'hôte ») | 52,80 | 24,00 |
| Taxes kept by Airbnb (difference) | 28,86 | 39,87 |
| « Vous gagnez » | 1 028,44 | 704,22 |
| « Frais de service hôte (15,5 %) » | 178,96 | 124,78 |
| Total − Vous gagnez − taxes kept by Airbnb | **178,96** | **124,78** |

- The taxes handed to the host are exactly **1,20 € × guests other than babies × nights** (52,80 =
  1,20 × 11 × 4 ; 24,00 = 1,20 × 10 × 2) — La Granja's tourist-tax tariff, children included, whereas
  GuestFlow taxes adults only.
- With « taxe retenue » = taxes kept by Airbnb, the fiche's commission lands **exactly** on Airbnb's own
  host service fee, on both bookings.
- So the guest appears to pay two taxes: one Airbnb collects and remits itself, and 1,20 €/person/night
  that Airbnb collects for the host and pays out to him. This looks like a tax configured on the Airbnb
  listing on top of Airbnb's automatic collection. Whether to keep that listing setting is the operator's
  call, outside this plugin (§8).
- Fiche 202609003 was entered by hand with taxe retenue 24,00 and commission 140,65, i.e. the
  opposite reading of the two lines.

## 2. Goal

When an Airbnb booking arrives, the operator opens a fiche that is already complete — guest name, party,
confirmation code, guest message, and « Paiement plateforme » reconciled to the payout — and only has to
add the phone and e-mail from Airbnb. When the mail cannot be applied, the fiche says why.

---

## 3. Functional rules

### 3.1 Reading the mailbox

0. **Everything below ships as the plugin `airbnb-intake`**: a base installation has none of it. It is
   seeded installed but **inactive**, in a new `PLUGIN_SEED_BATCHES` ledger, like Gîtes de France and
   Booking.
   > *On `inte/plugins` (master sync of 2026-10-26):* the plugin engine there has no seed batches; like
   > the other intakes, `airbnb-intake` is a new opt-in that waits, not installed, on the Plugins page
   > (`plugins-phase-0-foundation.md` rule 10), and a database coming from v3.16.0 keeps the row it
   > already has. It ships a `manifest.json` (1.0.0, `sdk ^2.3.0`), declares its dashboard line with
   > `ctx.attention({ key: 'airbnb-intake' })` (« Mails Airbnb à vérifier », drawn by `AttentionCard`,
   > `shell-and-home-day-first.md` rules 6, 9), and has its own « Airbnb » tab in Intégrations
   > (`integrations-tab-per-plugin.md`). `sdk.mailbox` and the client `IntakeBanner` export make SDK
   > **2.3.0** (a new entry point is a minor bump); the reader keeps inte's fix that logs out even when
   > the INBOX lock is refused, and its injectable `ImapClient`.
1. The plugin reads the mailbox GuestFlow sends from (`ctx.core.settings.mailbox()`, i.e.
   `contact@domainesolio.com`), **read-only**: it never deletes, moves or flags a message.
2. A pass runs **every 3 hours** (setting `pollEveryHours`, 1–24, default 3), plus « Relever maintenant »
   in the settings. It looks at the last 30 days of mail whose sender is the configured address (setting
   `senderAddress`, default `automated@airbnb.com`) whose subject starts with « Réservation confirmée : »
   and whose text carries « NOUVELLE RÉSERVATION CONFIRMÉE », « CODE DE CONFIRMATION » and « VOUS GAGNEZ ». Any other Airbnb mail (messages, reminders, payouts, reviews) is
   ignored and never stored.
3. Each matching message is recorded once (`Message-ID` unique), with the parsed fields — never the raw
   mail. A matching message that fails to parse is recorded `error` with the reason.
4. **The IMAP reader moves to the SDK.** The Gîtes de France plugin's `mailboxReader.js` becomes the SDK
   helper `sdk.mailbox.readMailsFrom({ host, port, user, password, sender, sinceDays })` and both plugins
   call it; no IMAP code is duplicated. It also returns the subject and the `Date` header, which rule 6
   needs. **The IMAP server is deduced from the sending one** when the plugin's « Serveur IMAP » is
   empty: `smtp.<domain>` → `imap.<domain>` (`sdk.mailbox.imapHostFor`). *Found at implementation,
   2026-10-25:* GuestFlow sends through `smtp.gmail.com`, and the Gîtes de France plugin read the mailbox
   on that SMTP host — a pass could never have connected; it went unnoticed because no gîte is mapped in
   production yet. Both plugins now read on `imap.gmail.com` by default.

### 3.2 Parsing (pure, unit-tested)

5. The **text/plain** part is parsed (the HTML is ignored; a mail without a plain part is an `error`).
   Extracted fields: confirmation code; guest full name (subject « Réservation confirmée : <nom> arrive
   le … », cross-checked with the name after the reservation link); listing id (`/rooms/<id>`) and listing
   title; the reservation URL (`/hosting/reservations/details/<code>`) and the message-thread URL
   (`/hosting/thread/<id>`), tracking parameters stripped; arrival and departure dates and times; adults /
   children / babies; the guest's message (the lines between « Sur Airbnb depuis … » and « Envoyer un
   message à … »); and the money lines of both columns: nights × nightly price, cleaning fee,
   guest service fee, guest taxes, guest total; host taxes, room fees, nightly adjustment, host service
   fee and its percentage, « Vous gagnez ».
6. **The year is not in the mail.** Arrival = the first date on or after the mail's `Date` header
   whose weekday matches the one printed (« sam. 26 déc. » sent 2026-10-24 → 2026-12-26). Departure
   = the first matching date after arrival. No date satisfies the weekday → `error`.
7. **Internal consistency before anything else, to the cent:**
   - guest column: nights × nightly price + cleaning fee + guest service fee + guest taxes = total;
   - host column: room fees + adjustment + cleaning fee + host taxes − host service fee = Vous gagnez;
   - host service fee = percentage × (room fees + adjustment + cleaning fee), rounded to the cent;
   - room fees + adjustment = nights × nightly price.
   Any mismatch → `error`, nothing applied.
8. Every space — inside amounts **and inside labels** — may be normal, non-breaking (U+00A0) or narrow
   non-breaking (U+202F): the raw mail writes « 4 nuits », « 15,5 % », « 5 adultes » with them. Amounts
   have a comma decimal. Verified 2026-10-25 on the real plain part: every field of rule 5 is read and
   the three checks of rule 7 hold to the cent (commission 178,96 = Airbnb's fee). Names in title case (the listing title too, printed in capitals in the plain part); « enfants » → GuestFlow « Enfants 2–12 », « bébés » → « Bébés », Airbnb having no
   teenager category.

### 3.3 The « Paiement plateforme » block

9. The plugin writes (reading A, decided 2026-10-24, §9):
   - Brut = guest « Total (EUR) »;
   - Virement reçu = « Vous gagnez »;
   - Taxe de séjour retenue = guest taxes − host taxes (the part Airbnb keeps);
   - Commission = `ctx.core.platformCommission({ gross, payout, touristTax })`, which must equal Airbnb's
     « Frais de service hôte » — otherwise `error`.
   This is the reading under which both measured bookings reconcile exactly (§1.1).
10. The withheld box is written only when Airbnb's tax mode is `platform`
    (`ctx.core.platformWithholdsTouristTax(propertyId, 'airbnb')`), as Booking does; in another mode it is
    left empty and the banner says so.

### 3.4 Matching and applying

11. A message is matched to **one** reservation: platform Airbnb, property of the mail's **listing id**,
    same arrival and departure, not cancelled. *Amended 2026-10-25 (operator: « facilement extensible et
    générique »):* **nothing is typed for a property.** Each active Airbnb iCal feed's address carries the
    listing id (`airbnb.fr/calendar/ical/<id>.ics`), so the property ↔ listing map is read from
    `ical_sources` on every pass — a new property, or a new listing, is covered the day its feed is added,
    and Estiva needs no more setup than La Granja. The plugin setting `listings` is only an **override**:
    a property's own value (the id or a pasted `airbnb.fr/rooms/<id>` link) replaces what was detected for
    that property, and covers one that has no Airbnb feed. A property may carry several listings.
    Measured on production the same day: Granja → `1398287456607254737` (the id of the real mail),
    Estiva → `1576845044615216441`. No match yet →
    `pending`, retried at each pass (the iCal import may come later); still unmatched after 24 h → shown
    on the dashboard.
12. **Auto-apply** only onto an untouched iCal placeholder (`sourceType = 'ical'`, `icalSyncLocked = 0`,
    brut empty — the Gîtes de France test). Applying = through `ctx.core.reservations.update` with history
    line « Origine : Mail Airbnb du <date> »:
    - a **new** client with the guest's first and last name (never the shared « Reserved Ical » client),
      no e-mail, no phone, language left at its default;
    - adults / children / babies, beds suggested as « Suggérer les lits » does, one cot per baby;
    - booking number = confirmation code;
    - the guest's message appended to the notes under « Airbnb, dd/mm : »;
    - the cleaning fee ticked on the property's cleaning option when it has the same price, otherwise a
      custom line with Airbnb's label (Gîtes de France rule 13);
    - the « Paiement plateforme » block of §3.3.
13. A fiche already edited by hand is **never overwritten**: the intake becomes a proposal on the fiche
    with « Appliquer » / « Ignorer ».
14. The fiche shows a banner while an intake is open: applied (closable, ends with « Téléphone et e-mail à
    reprendre sur Airbnb. »), proposal, or error. Every state carries a « Voir sur Airbnb » link to the
    reservation URL of rule 5, where the operator finds the phone.
15. Dashboard: one line per intake in `error` or unmatched for more than 24 h.
16. Applying never sends an e-mail to the guest.
17. Nothing is read while no property has an Airbnb listing (no feed, no override); a started or past stay is refused by
    `ctx.core.reservations.update` (`PAST_RESERVATION`).
18. *(Fixed at the 2026-10-27 audit.)* A started or past stay is refused **before** anything is written:
    the intake becomes `error` « Séjour commencé : fiche à saisir à la main » and no client record is
    created (rule 12 created the guest's client first, then the core refused the fiche, leaving an orphan
    client). Same order as Gîtes de France and Booking.
19. *(Fixed at the 2026-10-27 audit.)* One intake that throws during a pass is recorded as `error`
    « Erreur inattendue : … » and the pass goes on with the next one; before, the exception aborted the
    pass and the intake, still `pending` and first in line, blocked every later intake at every pass.
20. *(Fixed at the 2026-10-27 audit.)* The tax mode of rule 10 is read from **the fiche's own platform**
    row (`reservations.platform`, e.g. a renamed or second Airbnb channel), not from a hard-coded
    `airbnb` key. (The Booking intake keeps its `booking` key on purpose: it rewrites the fiche's channel to
    « Booking », so the fiche's platform before the write is not the one that will hold the tax.)
21. *(Fixed at the 2026-10-27 spec review.)* The guest's client is created **in the same transaction as the
    fiche's update**: the plugin hands its find-or-create payload to `ctx.core.reservations.update(id, patch,
    { label, client })` (SDK 2.7.0) instead of calling `ctx.core.clients.findOrCreate` first. A fiche the core
    refuses for any reason (capacity, validation, a race with the start of the stay) rolls the client back:
    no orphan client holds the guest's personal data. Test: `tests/plugin-intake-client-in-update-transaction.unit.test.js`.
22. *(Added 2026-10-28, audit finding F2.)* **The sender is proven, not read.** IMAP `SEARCH FROM` is a substring
    match over the whole From field, display name included; the SDK reader (`mailAuthentication.js`) therefore
    keeps a mail only when its envelope's first From address **equals** the configured sender
    (case-insensitive), and flags it `authenticated` only when the `Authentication-Results` header written by the
    mailbox's own server reports `dkim=pass` with a signing domain (`header.d`, or the domain of `header.i`) equal
    to the sender's domain or listed in the `senderDomains` setting. Only one such header is trusted: the one
    whose `authserv-id` is the `trustedAuthservId` setting, or, when empty, the first (topmost) one. A mail that
    fails is stored (`senderVerified = 0`) and, once matched, becomes a **proposal** whose banner is
    « Expéditeur non vérifié » — it is never auto-applied, whatever `autoApply` says; the operator can still
    apply it by hand. A forged proposal never counts as « already handled » for rule 8's dedup, so it cannot
    shadow the genuine mail, and an unauthenticated mail that does not parse leaves no row. Tests:
    `server/src/tests/mail-sender-authentication.unit.test.js`, `airbnb-intake/tests/sender-verification.unit.test.js`,
    `IntakeBanner.sender-verification.test.jsx`.
23. *(Added 2026-10-28, audit finding H1 of authz.)* **The mailbox password has one destination.** The reader
    connects over implicit TLS on 993 and requires STARTTLS on any other port (never plaintext); the IMAP host
    is the SMTP server's own derived host (`smtp.x` → `imap.x`) or a host of the same domain
    (`ctx` `sdk.mailbox.resolveImapHost`), a configured host elsewhere being refused at save and ignored at use.
    `imapHost`, `imapPort`, `senderAddress`, `senderDomains` and `trustedAuthservId` are declared `supportLocked`:
    refused to a support session like a secret setting (`specs/hosting-h2-account-security.md` rule 18). Test:
    `server/src/tests/mail-intake-credential-destination.unit.test.js`.

**Edge cases:**
- Same mail twice → `Message-ID` dedup; a second mail with the same confirmation code → ignored once the
  first is applied.
- The guest's message announces more people than the party (« peut-être un 6ème ») → only the « Voyageurs »
  line counts; the message lands in the notes.
- Modification or cancellation mails → not parsed (Out of scope); the iCal flow handles cancellations.
- A listing that no property is mapped to (no iCal feed carries its id) → `pending` then dashboard line
  « Annonce inconnue : <titre> (<id>) », so the id can be pasted as an override.
- IMAP down → logged, retried at the next pass; the iCal flow is unaffected.

---

## 4. Architecture

Model: `gites-de-france-intake` (same mailbox, same banner states, same placeholder test).

### 4.1 Core — generic additions

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `plugins/sdk/` | `mailboxReader.js` | C (moved) | Moved from the Gîtes de France plugin: read-only IMAP, recent mails of one sender → `[{ messageId, receivedAt, sentAt, subject, text }]` (plain part, or the HTML reduced to text when there is none); `testConnection`; `imapHostFor(smtpHost)` (rule 4). |
| `plugins/sdk/` | `index.js` | T | `sdk.mailbox.{ readMailsFrom, testConnection, imapHostFor }`, lazily required. |
| `plugins/gites-de-france-intake/` | `index.js` | T | Reads through `sdk.mailbox`; IMAP host deduced (rule 4); `/mailbox` also returns `defaultHost`. |
| `client/src/components/` | `IntakeBanner.jsx` | C | Generic, presentational banner: `severity, title?, children, details?, notes?, choices?, actions?, link?, onClose?, busy?, error?`. Exported from `client/src/plugins/sdk`. The Booking spec planned this extraction « when a third intake plugin appears »: this is it. The Gîtes de France and Booking banners render it, copy unchanged. |

### 4.2 The plugin — server (`server/src/plugins/airbnb-intake/`)

| File | T/C | Responsibility |
|---|---|---|
| `index.js` | C | `register(ctx)`: migration, settings, the 15-min job, `/api/airbnb-intake` router, data; reads the listings off `ical_sources`. |
| `listings.js` | C | Pure: listing id from a link, ids detected from the iCal feed addresses, the effective `[propertyId, listingId]` pairs with overrides (rule 11). |
| `mailParser.js` | C | Pure: mail text → booking or typed parse error (rules 5–8). |
| `paymentBlock.js` | C | Pure: parsed money → the four « Paiement plateforme » fields + check (rules 9–10). |
| `intakesModel.js` | C | CRUD on `airbnb_intakes`. |
| `intakeService.js` | C | Pass: read → parse → match → apply or propose; apply / ignore. |
| `tests/*.unit.test.js` | C | §7. |
| `gites-de-france-intake/index.js` | T | Calls `ctx.core.mailbox.readFrom` instead of its own reader (deleted). |
| `constants/plugins.js`, `plugins/index.js` | T | Catalogue, seed ledger v3, registration. |

### 4.3 The plugin — client (`client/src/plugins/airbnb-intake/`)

| File / slot | Responsibility |
|---|---|
| `IntakeBannerSlot.jsx` → `reservation.banners` | Fetches the banner payload, renders `IntakeBanner`. |
| `IntakeAlert.jsx` → `dashboard.alerts` | « Mails Airbnb à vérifier ». |
| `SettingsSection.jsx` → `settings.integrations` | Sender, frequency, listing of each property, « Relever maintenant », last pass. |
| `plugins/index.js`, `constants/plugins.js`, `api.js` | Registration and the calls of §4.4. |

**Component reuse:** consumes `IntakeBanner` (new generic, above), MUI `Card` as the other plugin settings
sections. The Gîtes de France and Booking banners move onto `IntakeBanner` in the same change, their tests
kept green.

### 4.4 API contract (behind auth, 404 `PLUGIN_INACTIVE` when inactive)

| Method | Endpoint | Body | Response |
|---|---|---|---|
| GET | `/api/airbnb-intake/reservation/:reservationId` | — | `{ intake: { id, status, error, receivedLabel, code, airbnbUrl, details[] } \| null }` |
| POST | `/api/airbnb-intake/:intakeId/apply` | — | `{ status }` or 400 `{ error }` |
| POST | `/api/airbnb-intake/:intakeId/dismiss` | — | `{ ok }` |
| GET | `/api/airbnb-intake` | — | `{ items }` (dashboard) |
| POST | `/api/airbnb-intake/run` | — | `{ read, applied, proposed, pending, error, ignored }` or `{ skipped }` |

---

## 5. Data model

Plugin table, created at install only:

```sql
CREATE TABLE IF NOT EXISTS airbnb_intakes (
  id INTEGER PRIMARY KEY,
  messageId TEXT NOT NULL UNIQUE,
  receivedAt TEXT NOT NULL,
  confirmationCode TEXT,
  parsed TEXT,              -- JSON of rule 5 fields, never the raw mail
  status TEXT NOT NULL,     -- pending | applied | proposed | ignored | error
  error TEXT,
  reservationId INTEGER,
  appliedAt TEXT,
  dismissedAt TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Settings: `senderAddress`, `imapHost`, `imapPort`, `pollEveryHours`, `listings` (JSON `{ propertyId: "<id or
rooms link>" }`, optional override, rule 11), `autoApply` (1), `lastRunAt`. No core column, no core table. No existing record changes.

## 6. UI / UX

See the decision page. Copy, short and impersonal:

- Applied (green, closable): « Rempli depuis le mail Airbnb du 24/10. Téléphone et e-mail à reprendre sur
  Airbnb. » + link « Voir sur Airbnb » (every state carries it).
- Proposal (blue): « Le mail Airbnb du 24/10 (HMN2HQHJAQ) concerne cette fiche, déjà modifiée à la main. »
  [Appliquer] [Ignorer]
- Error (red, closable): « Le mail Airbnb du 24/10 n’a pas pu être appliqué : <raison> ».
- Dashboard: « Mails Airbnb à vérifier », one line per intake, « Ouvrir la fiche ».
- Settings « Saisie Airbnb »: sender, frequency, « Annonce Airbnb de chaque logement » — « Reconnue d’après
  le flux iCal Airbnb du logement : rien à saisir. Ce champ ne sert qu’à la corriger. », each field showing
  « Reconnue : <id> » as its placeholder (id or pasted `airbnb.fr/rooms/…` link to override), « Remplir seul une
  fiche iCal encore intacte », « Relever maintenant », last pass.

Responsive: the banner buttons stack full width on `xs`, 44 px targets; settings rows stack on `xs`; no
horizontal scroll at 390 px. No page added, so no new `PageActionBar`.

## 7. Test plan

- [x] `airbnb-intake/tests/mailParser.unit.test.js` (8) — the plain part of the 202610003 `.eml`
  (2026-10-25) as fixture, with a fictitious guest, code, listing and thread ids and no tracking
  parameters (public repository), non-breaking spaces kept; the 202609003 figures (cleaning fee); year
  inference across New Year and into the next year; each consistency refusal; other Airbnb mails.
- [x] `airbnb-intake/tests/paymentBlock.unit.test.js` (4) — rule 9 on both measured bookings
  (commission = host fee), refusals, rule 10 non-`platform` mode.
- [x] `airbnb-intake/tests/intakeService.unit.test.js` (18) — auto-apply on a placeholder (own client,
  party, code, notes, payment block, no times), notes appended, cleaning option, rule 10, proposal +
  apply from the banner, pending → applied, unmapped listing on the dashboard, nothing read without a
  listing, refused save, dedup, other mails skipped, unreadable booking mail, listing id or URL, IMAP
  host deduction (rule 4), listings detected from the iCal feeds, override per property, two listings
  on one property (rule 11).
- [x] `airbnb-intake/tests/intake-audit-2026-10-27.unit.test.js` (3) — rules 18, 19, 20: no client for a
  started stay, a throwing intake does not stop the pass, the fiche's platform row is asked for the tax mode.
- [x] `airbnb-intake/tests/isolation.unit.test.js` (1) — no core file names the plugin outside registration.
- [x] Gîtes de France suite unchanged (29) on the SDK reader.
- [x] Client: `components/__tests__/IntakeBanner.test.jsx` (2), `airbnb-intake/__tests__/IntakeBanner.states.test.jsx`
  (4); the Gîtes de France and Booking banner tests unchanged except their SDK mock (21).
- [x] Rule 11 amendment, on the same production copy: no setting typed, the mapping read from `ical_sources`
  gives Granja → …254737 and Estiva → …216441, and the real mail fills fiche 22326 as before.
- [x] 2026-10-28 audit fix (rules 22–23): `server/src/tests/mail-sender-authentication.unit.test.js` (11), `mail-intake-credential-destination.unit.test.js` (5), `airbnb-intake/tests/sender-verification.unit.test.js` (8), client `IntakeBanner.sender-verification` (2). Plugin 1.1.0, SDK 2.12.0.
- [x] Suites on 2026-10-25: server 4 943 ✓, client 1 467 ✓ (one flaky `TariffRecipeCard` timing test on
  a first run, green alone twice and on the rerun), build ✓, E2E 89 ✓ (+1 skipped).
- [x] Manual, on a copy of production of 2026-10-25 with the real mail injected in place of IMAP: fiche
  22326 filled — Louis Toussaint (own client; « Reserved Ical » untouched), 5/6/2, beds 4 doubles +
  5 simples + 2 cots, HMN2HQHJAQ, message in the notes, brut 1 236,26, taxe 28,86, virement 1 028,44,
  commission 178,96, « Net perçu 1 028,44 € ✓ cohérent avec le virement »; a second pass writes nothing;
  green banner with « Voir sur Airbnb » (desktop and 390 px, no horizontal scroll); settings card at
  390 px; a Booking banner (22324) unchanged; plugin deactivated → `404 PLUGIN_INACTIVE`; `/mailbox`
  answers `imap.gmail.com` for both plugins.

## 8. Out of scope

- Phone, e-mail and language of the guest (not in the mail; Airbnb relays messages).
- Modification and cancellation mails.
- Reading Airbnb's host pages (would need a userscript, as Booking does — rejected 2026-10-24 in favour of
  the mail).
- Changing the Airbnb listing's tax settings, or the tourist-tax model of GuestFlow (operator's call, §1.1).
- Repairing fiche 202609003 or other past Airbnb fiches.

## 9. Open questions

None.

**Resolved (2026-10-25, measured on the raw mail):**
- ~~Listing → property~~ → by **listing id**, which every booking mail links (`airbnb.fr/rooms/<id>`), read
  against the listing id of each property's Airbnb iCal feed — nothing to type (rule 11).
- ~~Sender address~~ → `Airbnb <automated@airbnb.com>`, subject « Réservation confirmée : … » (rule 2).

**Resolved (2026-10-24, operator):**
- ~~What are the « Taxes » handed to the host?~~ → **reading A**: « Taxe de séjour retenue » = guest taxes −
  host taxes, so the commission equals Airbnb's host service fee (rule 9). Fiche 202609003, entered the
  other way, is left as it is (§8).
- ~~Source~~ → the booking e-mail, not the Airbnb host pages.
- ~~Mailbox~~ → `contact@domainesolio.com`, the one Gîtes de France already reads.
