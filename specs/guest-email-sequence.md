# Guest email sequence — from confirmation to the new-year greetings

| Field | Value |
|---|---|
| **Status** | Implemented (2026-09-18) |
| **Branch** | `feature/guest-email-sequence` _(Claude-managed)_ |
| **Created** | 2026-09-18 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Decision record** | `docs/specs/2026-09-18-guest-email-sequence.html` — the interactive review (rendered mails on real cases, the decisions below) |
| **Related** | `specs/email-automation.md`, `specs/no-automatic-email-without-approval.md`, `specs/email-history-rolling-window.md`, `specs/guest-gate-access.md` (PR #547, see rule 34) |

---

## 1. Context

GuestFlow mails guests through templates stored in `email_templates`, seeded once from
`utils/defaultEmailTemplatesRegistry.js`, rendered by the in-house engine of
`utils/emailTemplateRenderer.js` (`{{var}}` + single-level `{{#if}}…{{else}}…{{/if}}` — **not**
Handlebars: no nesting, no loops, plain-text output) against the context built by
`utils/emailContextBuilder.js`.

Nine guest templates exist today. Six ask for money (deposit/balance requests and reminders,
full-payment request, unpaid-balance cancellation notice) and are **no longer used in practice**:
every property is now paid in full at booking. The three others are the confirmation (sent when an
online payment confirms a stay), the J-7 and the J-2 reminders. Nothing is sent after the stay.

Since August 2026 (`specs/no-automatic-email-without-approval.md`) the master switch
`emailAutoSendEnabled` is OFF in production: the 08:00 pass is not even scheduled, and every due
email waits in « Emails à envoyer » for a click. That switch was the answer to a version that mailed
duplicate dunning emails to guests who had already paid.

Two properties of the current email log make it unfit to guard a post-stay sequence:

1. **`email_log` is purged 3 days after arrival** (`emailLogModel.purgeRealizedStays`,
   `specs/email-history-rolling-window.md`). A J+1 logged there would be deleted a few days later,
   and the queue's 7-day lookback would propose it again — the very mechanism of the August
   duplicates.
2. **Nothing makes a (template, reservation) pair unique.** Every path checks the log, sends, then
   writes: two concurrent paths (Qonto webhook + poll, two clicks) can both send. The « Envoyer »
   button checks nothing at all.

The copy of the sequence was written by Adrien (document of 17/09/2026) and reworked with him on
18/09/2026 in the decision record. It depends on what each property includes: **La Granja** (GuestFlow
« Gite ») includes the bed linen only; **L'Estiva** (« Aventura lodge ») includes bed linen, bath
linen and end-of-stay cleaning. Today only the bed linen is resolved from the property defaults, so a
platform booking imported from iCal at L'Estiva (no option lines) is told « le ménage n'a pas été
réservé, il reste à votre charge » — false.

## 2. Goal

Every guest receives, automatically and exactly once, a warm sequence of six emails — confirmation,
J-7, J-2, J+1, the November gift-voucher email and the January greetings — whose content matches
what their property includes and what they booked, and the operator can see in advance, without
sending anything, what will leave, to whom and when.

## 3. Functional rules

### 3.1 The sequence

| # | Key (`stableKey`) | When | Who |
|---|---|---|---|
| 1 | `reservation_confirmation` (existing, rewritten) | The day the reservation is created (payment is taken at booking) | **Direct channels only** (`isDirectChannel`) |
| 2 | `arrival_reminder_7d` (existing, rewritten) | `startDate − 7 days` | Every channel |
| 3 | `arrival_reminder_1d` (existing, rewritten — still J-2) | `startDate − 2 days` | Every channel |
| 4 | `guest_thanks_j1` (new) | `endDate + 1 day` | Every channel |
| 5 | `season_gift_vouchers` (new) | 15 November | Past guests, except Airbnb / Booking |
| 6 | `season_new_year` (new) | 6 January | Past guests, except Airbnb / Booking |

The former J+7 satisfaction survey and the « season reminder, 8 weeks before the anniversary » are
**dropped** (decision 2026-09-18).

### 3.2 Eligibility

1. Only `kind = 'reservation'` rows are considered. A cancelled stay (`kind = 'cancelled'`) or a
   deleted one (iCal cancellation) receives nothing more from the moment it is cancelled.
2. **Confirmation** — direct channels only; due on `date(createdAt)`. An online payment confirming
   the stay sends it immediately through the same ledger (rule 13), so the daily pass finds it
   already claimed.
3. **J-7** — not sent when `startDate − 7 ≤ date(createdAt)` (booked less than 7 days before arrival).
4. **J-2** — not sent when `startDate − 2 ≤ date(createdAt)`. The confirmation of a stay booked two
   days or less before arrival then carries the arrival essentials (rule 20).
5. **J+1** — due on `endDate + 1`, read at send time: a shortened stay (edited `endDate`) moves it.
6. **November** — one per **client** per year (`seasonKey = 'YYYY-11'`), sent on 15 November to clients
   having at least one past stay, excluding: a stay that ended less than 30 days before; a
   reservation in progress or upcoming; an unsubscribed client; a client flagged « pas de mails
   après séjour »; a client whose only stays are Airbnb or Booking (relay address).
7. **January** — one per client per year (`seasonKey = 'YYYY-01'`), sent on 6 January to the same
   population minus the 30-day rule: past stay, no reservation in progress or upcoming, not
   unsubscribed, not flagged, not Airbnb/Booking-only.
8. **Three post-stay contacts per client at most over any rolling 365 days**, new bookings excluded.
   Counted: J+1, November, January actually sent. Checked at send time, chronologically: a mail that
   would be the 4th is not sent (possible only with two stays in the same year). Verifiable in code
   through the ledger (rule 11).
9. **Unsubscribe** blocks mails 5 and 6 only. It never blocks mails 1 to 4, which serve the stay.
10. **Client flag « Ne pas envoyer les mails après séjour »** (set by the operator on the client
    form) blocks mails 4, 5 and 6 for that client. Mails 1–3 still leave.

### 3.3 Idempotence — one send per key, ever

11. A new ledger table `guest_email_sends` holds one row per **dedup key**:
    - mails 1–4 → `"<stableKey>:r<reservationId>"`;
    - mails 5–6 → `"<stableKey>:c<clientId>:<seasonKey>"`.
    `dedupKey` is `UNIQUE`. The ledger is **never purged** (it is not `email_log`, whose rolling window
    stays as is for the history page).
12. **Claim before send.** Every path inserts the row with `status = 'claimed'` **before** opening
    SMTP (`INSERT … ON CONFLICT(dedupKey) DO NOTHING`); if no row was inserted, nothing is sent and
    the path reports `already-sent`. After the send the row becomes `sent` (with `sentAt`,
    `recipientEmail`, `emailLogId`) or `failed` (with the error). A `failed` row may be re-claimed by a
    later attempt; a `claimed`, `sent` or `skipped` row never.
12bis. **Operator closes a key.** « Ignorer » in the pending queue records the key as `skipped`, and
    « Marquer comme envoyé » records it as `sent`: in both cases the sequence never sends that email
    afterwards. A `skipped` row does not count toward the yearly cap.
13. The claim applies to **every** path that can send a sequence mail: the daily pass, the online
    payment confirmation (`reservationEmailSender`), the queue « Envoyer » button and the manual
    compose dialog. There is no path around it.
13bis. **Deliberate resend.** The history « Renvoyer » action on a sequence mail already `sent` is
    the one exception, and it is explicit: the server refuses it (409 `ALREADY_SENT`) unless the
    request carries `confirmResend: true`, which the client only sends after a confirmation dialog
    (« Ce mail a déjà été envoyé le … Le renvoyer ? »). A resend never touches the original ledger
    row; it adds one with `dedupKey = "<original>:resend:<n>"` and `status` as usual, so the ledger
    keeps every copy that left. No automatic path can set `confirmResend`.
14. A `claimed` row older than 1 hour (process crashed between claim and send) is reported by the
    simulation as « à vérifier » and is **never** re-sent automatically — a possible duplicate is worse
    than a missing email.

### 3.4 Automatic sending — upcoming stays only

15. The sequence sends automatically once the operator turns `emailAutoSendEnabled` ON (after
    validating the simulation). It keeps consulting `utils/autoSendPolicy.autoSendAllowed` — the single
    answer to « may GuestFlow mail a guest with nobody in the loop ».
16. The first time the switch goes ON, `guestSequenceStartDate` is set to that day and shown in
    Réglages. **No mail whose send date is before `guestSequenceStartDate` is ever sent**, and a
    reservation whose stay ended before that date is out of the sequence entirely (no J+1, no
    November, no January). Past stays are never mailed retroactively.
17. The daily 08:00 pass sends the mails due **today**, plus those due in the last 2 days that are
    still unclaimed (server down at 08:00) — never earlier than `guestSequenceStartDate`.
18. While the switch is OFF, J-7 and J-2 keep today's behaviour (proposed in « Emails à envoyer »),
    the confirmation keeps being queued on payment, and mails 4–6 are neither sent nor proposed.
19. The legacy pass (`emailAutoSendRunner`) and the pending queue ignore the sequence keys when the
    switch is ON, so a sequence mail has exactly one scheduler.

### 3.5 Content rules

20. Content is resolved **per reservation, on the server**, from the property configuration — never
    hard-coded per property:
    - *included* = the property's default options with `offered = 1`, applied **even when the
      reservation carries no option line** (iCal imports) — same rule the laundry and breakfast
      models already use;
    - *booked* = the reservation's paid option lines;
    - *proposable* = options available for the property (`property_options`), client-visible, minus
      included, minus booked; priced at the property's unit price (`property_option_prices`).
21. An option already booked or included is **never** proposed again, in any mail.
22. Prices are always **unit prices** (« 8 € par personne », « à partir de 17 € »). The stay amount
    (`finalPrice`) appears in the confirmation only.
23. The nordic bath is mentioned without heating, slot or price: included duration in the
    confirmation (« 1 h 30 de bain nordique privatif » at La Granja, « 1 h » at L'Estiva — from the
    property's `freeMinutes` on the bath resource), and « maillots de bain et serviettes » in the J-7.
24. Options are proposed only in the J-7, and worded as a way to travel lighter, never as a sale.
    None in the confirmation (the guest has just paid), none after the stay.
25. Review solicitation happens **once per stay**, in the J+1, never against any consideration:
    direct → Google only; Gîtes de France / Airbnb / Booking → the platform « si ce n'est pas déjà
    fait », then Google as an optional extra.
26. The unsubscribe link is present on mails 5 and 6 only.
27. The November mail quotes « à partir de » prices per property = the lowest `pricePerNight` of the
    property's `pricing_rules`, read at send time (today 319 € at La Granja, 179 € at L'Estiva).
28. **Seasonal gifts** (decision 2026-09-18), stated in the mail with a deadline:
    - November: for any gift voucher ordered before **15 December**, a *planche du terroir* offered to
      the beneficiary for their first apéritif at the domain;
    - January: for any stay booked before **the last day of February**, the *petit-déjeuner du premier
      matin* offered to the whole family.
    GuestFlow does not apply them automatically: the operator adds the option as offered on the
    reservation (Out of scope).
29. The complement to collect on site, when any, is one sentence with the amount (« Un complément
    de 45 € reste à régler sur place à votre arrivée ») — no itemised list, no total line.
30. The emails are rendered in the client's language (FR/EN), as today. The EN copy is a translation
    of the FR copy of §6, reviewed by Adrien in the PR.

### 3.6 Operator tools

31. **Simulation** — a page tab and a CLI show, for a date range, every sequence mail that *would*
    leave: date, mail, client, reservation, status (`part` / `ne part pas` / `déjà envoyé` / `à
    vérifier`) and the reason. Same eligibility code as the real pass, no SMTP, no ledger write.
32. The CLI (`scripts/simulate-guest-email-sequence.mjs`) runs against any database given in
    `SIMULATION_DB_PATH`, opened **read-only**, so it can be pointed at a copy of production before
    the switch is turned on. It forces GuestFlow's own `DB_PATH` to an in-memory database first, so no
    module can open the target read-write or run migrations on it (verified by checksum).
33. **Lost items** — a free-text field « Objets oubliés » on the reservation. When filled, the J+1
    says what was found and offers to send it back; otherwise it says we set everything aside.
34. **Gate access** — when PR #547 (`specs/guest-gate-access.md` rule 23) lands, the J-2 « Pour
    venir » block carries the gate code and link. Whichever branch merges second wires it.

**Edge cases:**
- One-night stay booked the day before → confirmation carries the arrival block; J-7 and J-2 not
  sent (rules 3–4); J+1 on departure + 1.
- Booked exactly 7 days before → J-7 not sent (same day as the confirmation); J-2 sent.
- Booked exactly 2 days before → J-2 not sent; the confirmation carries the arrival block.
- Stay shortened after the J-7 → J+1 follows the new `endDate`; nothing already sent is re-sent.
- Stay cancelled between J-7 and J-2 → J-2, J+1 and the season mails for that stay are not sent.
- Two stays in the same year → one J+1 each; November and January once per client; a 4th post-stay
  contact within 365 days is not sent (rule 8).
- Client with no email → nothing is claimed; the simulation says « pas d'adresse ».
- Two concurrent paths on the same key → one claim wins, the other sends nothing (rule 12).
- The `email_log` purge runs → no effect on the ledger, nothing is proposed again.
- Switch turned ON on 1 October → a stay that ended on 28 September gets no J+1, no November, no
  January (rule 16).

---

## 4. Architecture

> Fat backend, thin frontend: eligibility, dates, option classification, composed paragraphs and
> the simulation are all computed on the server. The client renders the simulation rows and edits
> three new fields.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | Applies the sequence schema; one-shot `guest_email_sequence_v1` |
| `utils/` | `guestEmailSequenceSchema.js` | C | The ledger table + the new columns (clients, reservations, properties, app_settings) — shared by boot and test fixtures |
| `utils/` | `migrateGuestEmailSequence.js` | C | One-shot: force-sync mails 1–3, copy past sends from `email_log` into the ledger, start the sequence today if automatic sending is already on |
| `models/` | `guestEmailSendsModel.js` | C | Ledger: `claim`, `markSent`, `markFailed`, `recordOutsideSend`, `findByKey(s)`, `nextResendKey`, `countPostStayContacts`, `listStaleClaims` |
| `models/` | `emailPreferencesModel.js` | C | Unsubscribe token (minted lazily), `findByToken`, `unsubscribe`, `unsubscribeUrl` |
| `models/` | `stayFactsModel.js` | C | Read-only property facts: default options, available options at the property price, bath `freeMinutes`, lowest nightly price per property |
| `models/` | `clientsModel.js` | T | Writes `postStayEmailsDisabled` when the payload carries it |
| `models/` | `propertiesModel.js` | T | Email facts (`emailHook(En)`, `parkingDistanceMeters`, `hasWifi`, `hasFilterCoffeeMaker`); names kept as typed (no sentence-casing); article « à » |
| `models/` | `reservationsModel.js` | T | `updateLostItems` |
| `utils/` | `guestEmailSequence.js` | C | **Pure** calendar: every date and exclusion of §3.2/§3.4, dedup keys, gift deadlines, French reasons |
| `utils/` | `guestEmailSequenceRunner.js` | C | `planWindow` (single eligibility path + ledger + cap), `sendSequenceMail` (claim → render → send → mark), `runSequencePass`, `simulate` |
| `utils/` | `stayContentContext.js` | C | **Pure**: included / booked / proposable per reservation (rule 20) and every composed FR/EN paragraph |
| `utils/` | `sequenceRenderContext.js` | C | Last-minute flag, season send date, gift deadline, unsubscribe link |
| `utils/` | `reservationEmailGraph.js` | C | The reservation graph every guest email renders from (moved out of `emailsController`, + stay facts) |
| `utils/` | `guestEmailSequenceTemplates.js` | C | The six templates, FR + EN |
| `utils/` | `defaultEmailTemplatesRegistry.js` | T | Mails 1–3 rewired on the new copy, mails 4–6 added, anchors `created` / `start` / `end` / `season` |
| `utils/` | `emailContextBuilder.js` | T | Merges the stay content into `{ vars, flags }` |
| `utils/` | `reservationEmailSender.js` | T | The payment confirmation goes through the sequence plan and the ledger |
| `utils/` | `emailAutoSendScheduler.js` / `emailAutoSendRunner.js` | T | The 08:00 pass also runs the sequence; the legacy pass skips the sequence keys (rule 19) |
| `utils/` | `settingsValidation.js` | T | `validateMonthDay` (pool season) |
| `controllers/` | `emailsController.js` | T | Preview renders the stay content; « Envoyer » / « Ignorer » / « Marquer envoyé » go through the ledger; `confirmResend` |
| `controllers/` | `emailSequenceController.js` | C | `GET /api/email-sequence/simulation` |
| `controllers/public/` | `emailPreferencesController.js` | C | The unsubscribe page (GET shows, POST confirms) |
| `controllers/` | `settingsController.js` | T | New email fields; sets `guestSequenceStartDate` on the first activation |
| `controllers/` | `reservationsController.js` | T | `PATCH /api/reservations/:id/lost-items` |
| `routes/` | `emailSequence.js`, `emailPreferences.js`, `emails.js`, `reservations.js`, `index.js` | C/T | Mounting; `/preferences` lives outside `/api` and `/public/v1`, with its own rate limiter |
| scripts | `scripts/simulate-guest-email-sequence.mjs` | C | Read-only CLI simulation |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `EmailHistoryPage.jsx` | T | « Historique / Simulation » tabs |
| `pages/` | `ReservationPage.jsx` | T | Mounts the lost-items card on an existing reservation |
| `pages/` | `PropertyDetail.jsx` | T | « Dans les mails clients » card; article « à » |
| `pages/` | `SettingsPage.jsx` | T | Emails group: new fields + error mapping |
| `pages/` | `ClientsPage.jsx` | T | Empty form carries `postStayEmailsDisabled` |
| `components/` | `EmailSequenceSimulation.jsx` | C | The simulation view (table on `md+`, cards on `xs`) |
| `components/` | `ReservationLostItemsCard.jsx` | C | « Objets oubliés », saved on its own PATCH (the fiche is locked after departure) |
| `components/` | `ClientFormFields.jsx` | T | « Ne pas envoyer les mails après séjour » switch; « Désinscrit des nouvelles le … » badge |
| `components/` | `SettingsEmailAutomationSection.jsx` | T | Start date, Google review URL, Instagram URL, pool season |
| `components/` | `EmailManualSendDialog.jsx` | T | 409 `ALREADY_SENT` → confirmation → resend with `confirmResend` |
| `api.js` | `api.js` | T | `getEmailSequenceSimulation`, `updateReservationLostItems`, `sendEmail({ confirmResend })` |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| Consumed | `DataPageScaffold` (mobile-cards mode), `PageActionBar`, `StatusBadge`, `HelpedTextField`, `ConfirmDialog`, `EmptyState`, `LoadingState`, `ErrorAlert` | Existing. |
| Created (generic) | — | None. |
| Specific | `EmailSequenceSimulation`, `ReservationLostItemsCard` | Tied to the sequence's statuses and to one reservation field; both are compositions of the generics above. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/email-sequence/simulation?from=YYYY-MM-DD&to=YYYY-MM-DD` | — | `{ rows: [{ date, mailKey, mailLabel, reservationId, reservationNumber, clientId, clientName, propertyName, status, reason }], counts: { send, blocked, alreadySent, toCheck }, startDate, assumedStartDate, autoSendEnabled }` | Auth; range ≤ 400 days; 400 `INVALID_RANGE`; `status` ∈ `send`, `blocked`, `already-sent`, `to-check` |
| GET | `/preferences/emails?t=<token>` | — | HTML page with a confirm button | No session, no API key (outside `/public/v1`, which requires the plugin key); own rate limiter; unknown token → neutral page |
| POST | `/preferences/emails` | form `t=<token>` | HTML confirmation | Sets `marketingUnsubscribedAt` once; idempotent |
| PATCH | `/api/reservations/:id/lost-items` | `{ lostItems }` (≤ 500 chars) | `{ lostItems }` | 400 `LOST_ITEMS_TOO_LONG`; admin roles |
| POST | `/api/emails/send` | + optional `confirmResend: boolean` | + 409 `ALREADY_SENT` (with `sentAt`) for a sequence key already sent and no `confirmResend` | Rule 13bis |
| PUT | `/api/clients/:id`, `/api/reservations/:id`, `/api/properties/:id`, `/api/settings` | + new fields | unchanged | Validated at the boundary |

---

## 5. Data model

```sql
CREATE TABLE IF NOT EXISTS guest_email_sends (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupKey      TEXT    NOT NULL UNIQUE,
  stableKey     TEXT    NOT NULL,
  reservationId INTEGER,
  clientId      INTEGER,
  seasonKey     TEXT,
  status        TEXT    NOT NULL CHECK (status IN ('claimed','sent','failed','skipped')),
  claimedAt     TEXT    NOT NULL DEFAULT (datetime('now')),
  sentAt        TEXT,
  recipientEmail TEXT   NOT NULL DEFAULT '',
  errorMessage  TEXT    NOT NULL DEFAULT '',
  emailLogId    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_guest_email_sends_client ON guest_email_sends(clientId, sentAt);
```

New columns, all with safe defaults: `clients.postStayEmailsDisabled INTEGER NOT NULL DEFAULT 0`,
`clients.marketingUnsubscribedAt TEXT`, `clients.emailPreferencesToken TEXT` (minted lazily),
`reservations.lostItems TEXT NOT NULL DEFAULT ''`, `properties.emailHook TEXT DEFAULT ''`,
`properties.emailHookEn TEXT DEFAULT ''`, `properties.parkingDistanceMeters INTEGER`,
`properties.hasWifi INTEGER NOT NULL DEFAULT 1`, `properties.hasFilterCoffeeMaker INTEGER NOT NULL
DEFAULT 0`, `app_settings.guestSequenceStartDate TEXT`, `app_settings.googleReviewUrl TEXT DEFAULT ''`,
`app_settings.instagramUrl TEXT DEFAULT ''`, `app_settings.poolSeasonStart TEXT DEFAULT '06-15'`,
`app_settings.poolSeasonEnd TEXT DEFAULT '08-31'`.

**Backfill of the ledger.** The migration seeds `guest_email_sends` with a `sent` row for every
`email_log` row still present with `status = 'sent'` on mails 1–3, so a confirmation or reminder sent
before the deploy is never sent again.

**Templates.** One-shot `guest_email_sequence_v1`: force-syncs name/subject/body (FR + EN) and
`sendMode = 'auto'` of mails 1–3 — **overwriting any in-app edit of those three templates**, as
`migrateArrivalReminderJ2` did — and inserts mails 4–6. The six money templates are left untouched.

The same one-shot sets `guestSequenceStartDate` to the day of the upgrade when automatic sending is
already on (never earlier), so an installation that had it on never mails past stays.

**Data impact.** No existing row is modified except the three templates above. The property renames
(« Gite » → « La Granja », « Aventura lodge » → « L'Estiva », article « à ») are a data change the
operator makes in Logements after deploy; no server code keys on property names (verified: the
WordPress plugin uses its own keys). Property names are no longer sentence-cased on save (they are
proper names: « La Granja » stayed « La granja » before), and « à » joins the allowed articles
(decision 2026-09-18). Existing names are untouched.

## 6. UI / UX

### 6.1 The emails (FR copy — source of truth for the registry)

Rendered examples; `[…]` marks a server-composed, conditional paragraph. The exact rendering on real
cases is in the decision record.

**1. Confirmation** — Objet : « Votre séjour à La Granja est confirmé »
```
Bonjour Camille,

Merci pour votre confiance. Votre séjour à La Granja est confirmé : nous vous attendons le samedi 10 juillet 2027, et nous nous réjouissons déjà de vous accueillir au domaine.

[Réservé 2 jours ou moins avant l'arrivée : Vous arrivez très bientôt, alors voici dès maintenant l'essentiel : GPS + plan d'accès https://domainesolio.com/contact/, accueil au bâtiment d'accueil à partir de 16 h, maillots et serviettes pour le bain nordique.]

Votre séjour :
- N° de réservation : …
- Logement : La Granja
- Voyageurs : 2 adultes et 2 enfants
- Arrivée : le samedi 10 juillet 2027 à partir de 16 h
- Départ : le samedi 17 juillet 2027 avant 10 h
[- Option(s) réservée(s) : Petit-déjeuner]
- Montant du séjour : 1 240,00 €

Ce qui vous attend sur place :
- Les lits faits à votre arrivée
[- Le linge de toilette]                       ← L'Estiva
- 1 h 30 de bain nordique privatif             ← 1 h à L'Estiva
- Les 13 hectares du domaine, le sentier de balade et les animaux, en toute liberté
[- La piscine, partagée avec l'autre hébergement du domaine]   ← stay overlaps the pool season

Une question d'ici là ? Répondez simplement à ce mail, ou appelez-nous au {{companyPhone}}.

À très bientôt,
Adrien et Sophie
```

**2. J-7** — Objet : « Plus qu'une semaine avant La Granja »
```
Bonjour Camille,

Plus qu'une semaine, et vous serez à La Granja. [property hook: Chaque matin, le soleil s'y lève sur la vallée : c'est sans doute le plus beau moment de la journée. / L'Estiva : Le soir, les journées s'y terminent face au soleil couchant, quand la prairie devient dorée.]

Voici quelques mots pour vous aider à préparer vos valises tranquillement.

Nous préparerons les lits ainsi : 1 lit double et 2 lits simples. Si une autre installation vous convient mieux, dites-le nous simplement : l'essentiel est que chacun dorme bien.
[Bébé + lit bébé réservé : Le lit bébé sera installé avant votre arrivée, avec son linge : vous n'aurez rien à apporter pour lui.]
[Bébé sans lit bébé : Pour le plus petit, nous pouvons installer un lit bébé avec son linge (5 € pour le séjour) : de quoi laisser le lit parapluie à la maison et gagner un peu de place dans le coffre.]

Dans vos bagages :
- Maillots de bain et serviettes pour le bain nordique[, et pour la piscine]
- Des chaussures fermées pour les sentiers du domaine
[- Vos serviettes de toilette. Si vous préférez voyager plus léger, et ne pas rentrer avec une machine à lancer, nous pouvons aussi les préparer pour vous (8 € par personne).]   ← towels neither included nor booked

[Parking > 0 : Un conseil pour les valises : voyagez léger. Le parking se trouve à 300 mètres de L'Estiva, et le dernier bout se fait à pied, à travers la prairie. Un sac souple se porte bien mieux qu'une grosse valise à roulettes.]
[Pas de wifi : À L'Estiva, pas de wifi : c'est un choix, pour mieux profiter du reste. Le réseau mobile est en revanche disponible sur l'ensemble du domaine.]

[Proposables : Pour alléger les courses, nous travaillons avec des producteurs locaux : les jus du Pressoir du Pilat (5 € le litre) et les bières de la Brasserie du Pilat (6,50 € la bouteille). Nous vous les proposons à leur prix de vente en magasin, et ils peuvent vous attendre au frais à votre arrivée. De la même façon, nous pouvons prévoir une planche du terroir pour le premier apéritif (à partir de 17 €)[, le repas des trappeurs (25 € par personne)][ et le petit-déjeuner, à retirer chaque matin au bâtiment d'accueil (8 € par personne et par jour)]. Il suffit de nous le dire d'ici le mercredi 7 juillet 2027.]

Vous fêtez un événement, vous aimeriez un coup de main pour les préparatifs, ou simplement vous alléger de l'intendance ? N'hésitez pas à nous en parler : nous avons plusieurs formules à vous proposer.

Pour commencer à rêver votre séjour, nous avons rassemblé nos adresses préférées autour du domaine : balades, baignades, marchés, villages, visites. Tout est sur https://map.domainesolio.com
[Enfants : Et si vos enfants aiment les animaux, il y a aussi quelques beaux moments à partager avec ceux du domaine : nous vous en parlerons sur place.]

Nous préparons tout pour vous accueillir. Une question ? Répondez simplement à ce mail, ou appelez-nous au {{companyPhone}}.

À la semaine prochaine,
Adrien et Sophie
```

**3. J-2** — Objet : « À samedi, à La Granja »
```
Bonjour Camille,

Dans deux jours, vous poserez vos valises à La Granja. De notre côté, nous finissons de tout préparer pour vous accueillir. Voici simplement l'essentiel pour venir jusqu'à nous, le reste se découvrira sur place.

Pour venir
- Tapez « Domaine Solio » dans votre GPS (215 côte de Japperenard, 07290 Satillieu), ou retrouvez le plan d'accès sur notre site : https://domainesolio.com/contact/
- Les 400 derniers mètres suivent le chemin du domaine : roulez doucement, il arrive qu'un animal traverse.
[- Garez-vous au parking, à 300 mètres de L'Estiva : le reste du chemin se fait à pied.]
[- Accès portail : code + lien — once PR #547 lands (rule 34)]

Votre arrivée
- Le samedi 10 juillet 2027, à partir de 16 h. Nous vous accueillons au bâtiment d'accueil, près de la piscine.
- Pouvez-vous nous dire vers quelle heure vous pensez arriver ? Un simple mot en réponse à ce mail, et nous serons là pour vous recevoir.
[- Pensez à prendre le chèque de caution de 500 €, que nous vous demanderons à l'arrivée.]
[- Un complément de 45 € reste à régler sur place à votre arrivée.]

[One warm sentence per booked option, e.g. « Le petit-déjeuner vous attendra chaque matin au bâtiment d'accueil. » / « Le lit bébé sera installé avant votre arrivée, avec son linge. » / « Les bières de la Brasserie du Pilat vous attendront au frais. »]

[Filter coffee maker : Dans la maison, vous trouverez une machine Nespresso à capsules, et aussi une grande cafetière familiale pour le café moulu. / else : Dans le logement, une machine Nespresso à capsules vous attend pour le café du matin.]
[La piscine vous attend aussi pour les après-midi ensoleillés.]

Le jour du départ, le samedi 17 juillet 2027, nous vous retrouverons à l'accueil avant 10 h pour récupérer les clés et vous dire au revoir.
[Ménage compris : Le ménage de fin de séjour est pour nous : profitez de votre dernière matinée sans y penser.]
[Ménage réservé : Vous avez choisi l'option ménage : profitez de votre dernière matinée, nous nous occupons du reste.]
[Ni l'un ni l'autre : Pour rappel, vous n'avez pas choisi l'option ménage : nous vous demanderons donc de rendre le logement comme vous l'avez trouvé. Rien de compliqué, un petit panneau dans le logement vous indique ce qui est attendu. Et si, une fois sur place, vous préférez garder votre dernière matinée pour vous, l'option reste possible : il suffit de nous le dire.]

Un imprévu ou un retard sur la route ? Appelez-nous au {{companyPhone}}.

Bonne route, nous avons hâte de vous accueillir,
Adrien et Sophie
```

**4. J+1** — Objet : « Merci pour ces jours au Domaine Solio »
```
Bonjour Camille,

Merci d'avoir choisi le Domaine Solio pour ces quelques jours. À La Granja, tout semble bien silencieux depuis votre départ, et les animaux ont l'air de se demander où sont passés leurs visiteurs.
                                                    ← built on the article: « Au Gite, … » reads right too

Nous espérons que vous êtes bien rentrés, avec un peu du calme d'ici dans vos bagages.

[Direct : Si vous en avez envie, quelques mots sur notre page Google nous aideraient beaucoup : {{googleReviewUrl}}. C'est souvent grâce à ces avis que d'autres familles osent venir jusqu'ici.]
[Plateforme : Si ce n'est pas déjà fait, quelques mots sur Airbnb / Booking / votre espace Gîtes de France nous aideraient beaucoup : c'est souvent grâce à ces avis que d'autres familles osent venir jusqu'ici. Et si vous avez envie d'en dire un peu plus, votre message est aussi le bienvenu sur notre page Google : {{googleReviewUrl}}]

Et si quelque chose a manqué à votre séjour, même un détail, nous aimerions vraiment le savoir : il suffit de répondre à ce mail. C'est ainsi que le domaine s'améliore, un séjour après l'autre.

[Objets oubliés : Nous avons retrouvé {{lostItems}} après votre départ : dites-nous si nous vous le renvoyons. / sinon : Un objet oublié ? Dites-le nous, nous mettons tout de côté.]

Si vous êtes nostalgiques de votre séjour, n'hésitez pas à nous suivre sur les réseaux sociaux : https://www.instagram.com/domainesolio

Le domaine change de visage à chaque saison : les agneaux au printemps, les longues soirées d'été, les couleurs de l'automne, le bain nordique qui fume dans l'air froid de l'hiver. Si l'envie vous prend d'en découvrir une autre, vous serez toujours les bienvenus.

Avec toute notre amitié,
Adrien et Sophie
```

**5. Bons cadeau (15 novembre)** — Objet : « Offrir un peu du Domaine Solio »
```
Bonjour Camille,

Ici, l'automne a pris ses quartiers. Les arbres ont changé de couleur, les premiers feux crépitent à La Granja, et les animaux ont sorti leur manteau d'hiver.

C'est aussi le moment où l'on commence à chercher ce qui fera plaisir à ceux qu'on aime. Alors, une fois par an et sans insister, voici notre idée : offrir quelques jours de calme, ici.

Nos bons cadeau sont valables un an : une ou plusieurs nuits à La Granja, à partir de 319 € la nuit, ou à L'Estiva, à partir de 179 € la nuit, ou simplement un montant, que la personne utilise comme elle le souhaite. Nous les préparons par mail ou imprimés, prêts à glisser sous le sapin.

Et pour tout bon cadeau commandé avant le mercredi 15 décembre 2027, nous offrirons à la personne qui le reçoit une planche du terroir pour son premier apéritif au domaine.

Belle fin d'automne,
Adrien et Sophie

Ne plus recevoir nos nouvelles : {{unsubscribeUrl}}
```

**6. Vœux (6 janvier)** — Objet : « Belle année 2028, depuis le Domaine Solio »
```
Bonjour Camille,

Nous vous souhaitons une très belle année 2028, douce, lumineuse, et pleine de moments partagés.

Ici, l'hiver a posé son silence sur les 13 hectares : le feu crépite à La Granja, le bain nordique fume dans l'air froid, et chaque matin les animaux attendent leur foin.

Le calendrier 2028 est ouvert, ponts de printemps compris. Vous étiez venus à La Granja en juillet 2027 : si une période vous fait envie, écrivez-nous simplement. Les week-ends prolongés partent vite, et nous serions tellement heureux de vous retrouver.

Et pour vous remercier de votre fidélité : si vous réservez avant le mardi 29 février 2028, le petit-déjeuner du premier matin vous sera offert, pour toute la famille.

À très bientôt, peut-être,
Adrien et Sophie

Ne plus recevoir nos nouvelles : {{unsubscribeUrl}}
```

### 6.2 Screens

- **Emails › Historique › Simulation** — tabs « Historique / Simulation » at the top of the filter card
  (visible on `xs` too). `PageActionBar` title « Historique des emails », no Save/Cancel. Two date
  fields (default: today → today + 60 days) and « Actualiser »; the result through `DataPageScaffold`
  in mobile-cards mode: table on `md+` (Date · Mail · Client · Logement · Statut · Raison), cards on
  `xs`. Badges: « Part » (success), « Ne part pas » (neutral), « Déjà envoyé » (info), « À vérifier »
  (warning). Banner: « Envoi automatique désactivé : rien ne part tant qu'il n'est pas activé dans
  Réglages. La simulation suppose une activation aujourd'hui. » or « Envoi automatique actif depuis
  le … ». Summary line from the server's counts. Empty state « Aucun mail prévu sur cette période ».
- **Client form** — switch « Ne pas envoyer les mails après séjour » with helper text « Remerciement, bons cadeau et vœux ne lui seront pas envoyés ». When unsubscribed: `StatusBadge` « Désinscrit des nouvelles le … » (read-only).
- **Reservation page** — card « Objets oubliés » under the notes, on an existing reservation only: a
  text field and its own « Mettre à jour les objets » button (the fiche is locked after departure,
  when lost items are found; the label avoids a second « Enregistrer » next to the page's Save).
  Full width on `xs`.
- **Property detail** — card « Dans les mails clients »: accroche FR / EN (`HelpedTextField`, multiline), distance du parking (m), switches « Wifi » and « Cafetière filtre familiale ».
- **Réglages › Emails automatiques** — line « Séquence active depuis le … » (or « pas encore activée »), URL avis Google, URL Instagram, saison piscine (début / fin, JJ/MM).
- **Public page** — « Vos préférences Domaine Solio »: one sentence and a button « Ne plus recevoir les nouvelles du domaine »; after POST, « C'est noté. Vous continuerez à recevoir les informations liées à vos séjours. » Mobile-first, no external asset.

Responsive: every new field stacks full width on `xs`; the simulation swaps table → cards under `md`.

## 7. Test plan

### Server unit tests (one file per subject — 73 new tests)
- [x] `tests/guest-email-sequence-dates.unit.test.js` (9) — send dates; booked the day before / exactly 7 / exactly 2 / 3 days before; one-night stay; shortened stay (same key, new date); dedup keys; season dates; 29 February deadline.
- [x] `tests/guest-email-sequence-exclusions.unit.test.js` (13) — cancelled; channel rules; no email; before activation / stay ended before activation; client flag; unsubscribe (season only); non-candidates; relay addresses; upcoming stay; 30-day rule; latest stay; cap.
- [x] `tests/guest-email-ledger.unit.test.js` (8) — claim once; failed re-claimable, sent/skipped never; resend keys; cap count; stale claims; `email_log` purge without effect; upgrade backfill + force-sync; start date on upgrade.
- [x] `tests/guest-email-sequence-runner.unit.test.js` (11) — switch OFF; never activated; once per day; catch-up window; no retroactive send; SMTP failure then retry; two racing paths → one email; webhook + poll + pass → one confirmation; no confirmation for a platform; cap; simulation writes nothing.
- [x] `tests/stay-content-context.unit.test.js` (15) — roles; included on an iCal booking; never re-propose; unit prices; per-property offers; baby cot; beds + bath duration; pool season; parking / wifi / coffee; cleaning; booked options; review by channel; lost items + Instagram; season prices + deadline; English.
- [x] `tests/guest-email-templates-render.unit.test.js` (6) — the six templates FR + EN, no token left, no stray blank line, unsubscribe on 5–6 only, content rules.
- [x] `tests/email-preferences-public.unit.test.js` (6) — token; GET changes nothing; POST idempotent; unknown token neutral; language; link.
- [x] `tests/emails-controller-sequence-ledger.unit.test.js` (5) — 409 `ALREADY_SENT`; confirmed resend; skip / mark-sent close the key; payment emails untouched; preview.
- [x] Touched: `email-template-renderer` (J-7/J-2 body section rewritten for the new copy), `default-email-templates-registry`, `default-email-templates-seed`, `confirmation-email-gate`, `reservation-email-sender`.

Full server suite: 4 189 tests, all green.

### Client
- [x] Vitest (11 new): `EmailSequenceSimulation.render.test.jsx` (5), `EmailManualSendDialog.already-sent.test.jsx` (2), `ClientFormFields.post-stay-emails.test.jsx` (3), `ReservationLostItemsCard.test.jsx` (1). Full suite green.
- [x] Playwright: `emails-page.spec.js` and `email-language-fr-en.spec.js` updated for the new names and copy; full suite 68 passed, 1 skipped (unchanged).

### Before production
- [ ] `SIMULATION_DB_PATH=<copy> node scripts/simulate-guest-email-sequence.mjs --from … --to … --start …`
  against a copy of production, output reviewed with Adrien — only then the switch is turned on.

### Manual UI verification (done on the dev database, 2026-09-18)
- [x] Simulation tab at 1280 px and 390 px (no horizontal scroll); settings card; property card; lost-items card.
- [x] Lost items saved from the fiche → quoted by the J+1 preview → cleared.
- [x] Previews of the confirmation, J-7, J-2 and J+1 on a Gite and an Aventura lodge stay: no missing variable; the iCal booking at the lodge gets « Le ménage de fin de séjour est pour nous ».
- [x] Public unsubscribe page on a phone.

## 7bis. Operator setup after deploy

Nothing leaves before the switch is turned on. Before turning it on:

1. **Logements** — rename « Gite » → « La Granja » and « Aventura lodge » → « L'Estiva », article « à ».
2. **Logements › Dans les mails clients** — accroche FR/EN of each property; L'Estiva: parking
   300 m, wifi off; La Granja: family coffee maker on.
3. **Ressources › Bain nordique** — included minutes per property: 90 at La Granja, 60 at L'Estiva
   (the confirmation reads them; on the dev copy they are 60 and none).
4. **Réglages › Emails automatiques** — Google review link, Instagram link
   (`https://www.instagram.com/domainesolio`), pool season; « Nom expéditeur » = « Adrien et Sophie »
   if the signature should read so (today « Domaine Solio »).
5. Run the simulation on a copy of production, review it, then turn automatic sending on — that day
   becomes the start date.

## 8. Out of scope

- Automatically adding the seasonal gifts (planche, petit-déjeuner) to a reservation — the operator
  adds them as offered options.
- A gift-voucher product in GuestFlow (vouchers stay handled by hand).
- Click tracking, HTML emails, a satisfaction survey (J+7 dropped).
- The six money templates (unused, left as is).
- The gate access block of the J-2 until PR #547 lands (rule 34).

## 9. Open questions

- Q1: Does the client switch block the J+1 only, or the season mails too?
  - A (2026-09-18): J+1, November and January (rule 10).
- Q2: Keep the pool mention?
  - A (2026-09-18): yes, without opening hours, only when the stay overlaps the season set in
    Réglages (`poolSeasonStart` / `poolSeasonEnd`, default 06-15 → 08-31).
- Q3: History « Renvoyer » on a sequence mail already sent?
  - A (2026-09-18): allowed after an explicit confirmation, recorded as a resend (rule 13bis).

- Q4 (raised during implementation): property names were sentence-cased on save (« La Granja » →
  « La granja ») and the article « à » did not exist.
  - A (2026-09-18): names are kept as typed; « à » joins the articles (§5).

**Resolved on 2026-09-18** (decision record): confirmation to direct channels only; no season mails
to Airbnb/Booking; complement as one sentence; J+7 dropped (and with it the cap arbitration); fully
automatic once the simulation is validated, upcoming stays only (rules 15–17); properties renamed La
Granja / L'Estiva; J-7 hooks kept; local product prices confirmed (shop prices); November gift =
planche du terroir; January gift = first-morning breakfast; « à partir de » prices confirmed; lost
items kept for v1 (gate code awaits PR #547; EV charging, weather, yearly news dropped).
