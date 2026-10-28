# Settings input guards — bounded day and percent fields, pool all year, social links, account plan grouping

| Field | Value |
|---|---|
| **Status** | Implemented _(2026-10-28 — arbitrations A1–A4 resolved, §9; see §10)_ |
| **Branch** | `feature/settings-input-guards` _(Claude-managed, cut from `inte/plugins`)_ |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary for decision** | [docs/specs/2026-10-28-settings-input-guards.html](../docs/specs/2026-10-28-settings-input-guards.html) |
| **Amends** | [property-deposit-switch.md](property-deposit-switch.md), [payment-schedule-and-cancellation.md](payment-schedule-and-cancellation.md) §3.1–§3.3, [deposit-blocks-the-dates.md](deposit-blocks-the-dates.md), [guest-email-texts-made-simple.md](guest-email-texts-made-simple.md) rule 34, [settings-rationalization.md](settings-rationalization.md) (Plateformes page), [plugins-phase-p-productisation.md](plugins-phase-p-productisation.md) rule 27 + [accounting-platform-commission-and-no-deposit.md](accounting-platform-commission-and-no-deposit.md) rule 17 (Plan comptable layout), [guest-email-sequence.md](guest-email-sequence.md) §6.2 (Instagram link) |

> **Why one umbrella spec.** Adrien's feedback of 2026-10-28 on the `inte/plugins` shadow lists six
> settings defects that share one cause — a field accepts what the business cannot mean — and one cure,
> a shared input contract enforced by the server. The rules live here, numbered once, so the tests cite
> one place; each owning spec carries an **Amended 2026-10-28** note under the rule it changes, pointing
> back here (the convention of `ui-review-2026-10-19-operations.md`).

---

## 1. Context

Adrien's feedback (verbatim excerpts, French):

> « si j'active l'acompte je peux mettre un nombre de jour négatif […] il faut aussi limiter le maximum
> de jours pour l'acompte à 30 jours, et si c'est 0 il faut considérer que l'acompte doit être réglé pour
> prendre en compte la réservation. Pareil pour le champ Solde et Annulation dans Solde & caution, il ne
> peut pas être négatif et le max doit être de 60 jours. Pour l'ouverture de la Piscine, c'est soit toute
> l'année, soit une date […] la date de fermeture ne doit pas être avant celle d'ouverture. […] Les
> commissions ne peuvent pas être négatives […] si c'est autre qu'un chiffre, lorsqu'on clique ailleurs ou
> sur Entrée, il faut re-saisir l'ancien montant. […] Plan comptable : pourquoi le compte par défaut et
> indemnités d'annulation ne se trouvent pas regroupés dans Comptes comme les autres ? […] Lien
> Instagram : proposer les liens vers les réseaux sociaux, et pouvoir en mettre plusieurs. »

What the code does today (`origin/inte/plugins` 714ed5e4):

### 1.1 Payment delays — a negative is *silently replaced*, not refused

- [PropertyPaymentTab.jsx:13-26](../client/src/components/property/PropertyPaymentTab.jsx#L13) renders
  the four numbers as raw `<TextField type="number">` with no `min`/`max` — the native field lets the
  operator type `-3`.
- [propertyValidation.js](../server/src/utils/propertyValidation.js) checks `depositPercent`, the tourist
  tax and the caution, but **none of the three day counts**.
- [propertiesModel.js:79-91](../server/src/models/propertiesModel.js#L79) `dayCountOr()` turns a negative
  or non-numeric value into the policy default (7 / 30 / 7). So `-3` is *saved as 7* with a success
  toast: the operator believes he stored something he did not. There is no upper bound at all — `400`
  days is stored as is.
- [paymentSchedule.js:34-38](../server/src/utils/paymentSchedule.js#L34) `positiveDays()` repeats the
  same silent fallback when the schedule is derived.
- Shadow data (2026-10-22): both properties hold `depositDueDays 7`, `balanceDaysBefore 30`,
  `cancelAfterBalanceDueDays 7` — inside the new bounds.

### 1.2 `depositDueDays = 0` — what it means today

`resolveDepositDueDate` ([paymentSchedule.js:58-80](../server/src/utils/paymentSchedule.js#L58)) gives
`bookingDate + 0` = **the booking day**. Everything downstream already copes:

| Path | Effect of 0 today |
|---|---|
| Devis (quote, website request) | No effect: a devis's acompte is due on its validity date (payment-schedule rule 5), and a devis **never holds the dates** — the paid link converts it ([paymentPollRunner.js:58-72](../server/src/utils/paymentPollRunner.js#L58)). The website's « Envoyer une demande sans payer » is a devis too. |
| Website « Payer » | Pays the acompte → converts → dates held. Already « paid to count ». |
| Reservation created by the operator (fiche « Nouvelle réservation ») | **Holds the dates at once**, acompte due the same day, unpaid. |
| Devis accepted by the operator (status « Accepté », [devisController.js:114](../server/src/controllers/devisController.js#L114)) | Converts **without payment**: dates held, acompte unpaid. |
| Acompte request e-mail (`deposit_request`, anchor `depositDueDate`, [emailLogModel.js:265](../server/src/models/emailLogModel.js#L265)) | Proposed on the booking day (manual send mode). |
| Dashboard deadlines ([paymentDeadlines.js:194-196](../server/src/utils/paymentDeadlines.js#L194)) | Acompte late from the next day. |
| Rule 47 cap (acompte never after the solde) | Unchanged — a same-day acompte cannot fall after the solde. |
| Platform reservations | Never concerned: `depositDueDate` is NULL off the own channels (rule 6). |

So « 0 = the acompte must be paid for the reservation to count » is **already true on every path the
guest drives** and **false on the two paths the operator drives** (direct creation, manual acceptance).
Adrien decided on 2026-10-28 (A1 = label only) that this gap stays open on purpose: 0 means « due on
the booking day », with no blocking. §3.3 keeps only the label and the website check.

### 1.3 Pool season — no « all year », no order check

[PropertyStayTab.jsx:52-116](../client/src/components/property/PropertyStayTab.jsx#L52): a « Piscine »
switch and two `MonthDayField`s. The server ([propertyValidation.js:77-86](../server/src/utils/propertyValidation.js#L77))
checks each bound's format and « both or none », **never the order**. The J-7 overlap test
([stayContentContext.js:255-262](../server/src/utils/stayContentContext.js#L255)) assumes `start ≤ end`
within one year, so `10-01 → 05-31` silently matches nothing. Also: switching « Piscine » on without
dates saves *no pool* and the switch is off again after reload (`poolOpen` is client-only state).

### 1.4 Plateformes — the server refuses, the field does not say so

[PlatformsSettingsPage.jsx:133-144](../client/src/pages/settings/PlatformsSettingsPage.jsx#L133): a free
text field. The bulk save ([platformsController.js:101-105](../server/src/controllers/platformsController.js#L101))
**does** refuse `< 0` (« Entre 0 et 99,99 %. »), but only after Enregistrer, and the typed text stays.
The legacy `PUT /api/platforms/:id/commission` ([platformsModel.js:215-218](../server/src/models/platformsModel.js#L215))
*clamps* silently (`-5` → `0`); no client calls it any more. The page's slowness is handled by the
`inte-performance` spec, not here.

### 1.5 Plan comptable — two generations of settings, two cards

[PlatformAccountsPage.jsx:293-377](../client/src/plugins/accounting-export/PlatformAccountsPage.jsx#L293):
« Comptes » renders the rows of the account plan made into plugin settings by
`plugins-phase-p-productisation.md` rule 27 (2026-10). « Compte par défaut » and « Indemnités
d'annulation » are **older** settings (`accounting-platform-commission-and-no-deposit.md` rule 17,
2026-06; `cancellation-compensation.md` rule 16) that were already on the page with their own cards;
rule 27 added the new card above them instead of absorbing them. Same endpoint, same save
(`PUT /api/accounting/platform-accounts`) — the split is purely historical.

### 1.6 Instagram link — one URL, one e-mail

`app_settings.instagramUrl` (validated by `validatePublicUrl`, [settingsController.js:89](../server/src/controllers/settingsController.js#L89))
is read in **one place**: the J+1 thank-you e-mail, paragraph `instagram` of the stay-text catalogue
([stayTextCatalogue.js:92](../server/src/utils/stayTextCatalogue.js#L92)) — `{{#if hasInstagram}}{{instagramParagraph}}`
in the J+1 template, `{{link}}` inside the sentence. The website does not read it (the WordPress footer
has its own links; the public API does not expose it).

## 2. Goal

Every number of the settings accepts only what the business can mean, says so the moment the field is
left, and the server refuses the rest with the same French message; a deposit due « at booking » truly
conditions the booking; a pool can be open all year; several social links can be listed; the account
plan reads as one list of accounts.

## 3. Functional rules

### 3.1 The shared input contract — `BoundedNumberField`

1. **One generic field for every bounded number of the settings.** `BoundedNumberField` renders a text
   input (`inputMode="numeric"` or `"decimal"`, never `type="number"`, so no native spinner and no
   browser-specific parsing) and is driven by a **limits descriptor** the server sends:
   `{ min, max, integer, decimals, unit }`. The client never hardcodes a bound (fat backend).
2. **A minus sign never reaches the field when `min ≥ 0`.** It is removed as it is typed or pasted
   (`-5` → `5`, caret kept in place); the helper reads « Positif uniquement. » for 2 s. No other
   character is filtered while typing — the operator's text stays as typed until he leaves the field.
3. **Commit on blur or Enter, never per keystroke.** The parent form receives the value only then.
4. **Not a number → the previous value comes back.** On commit, a text that is not a number (`abc`,
   `1,2,3`, `—`) or is empty on a required field restores the last committed value, and the helper reads
   « Nombre attendu. » for 2 s. Escape restores the last committed value too. French and English decimal
   separators are both read (`12,5` = `12.5`).
5. **A number outside the bounds is refused, never clamped.** `45` in a 0–30 field stays `45`, the
   field turns red, `aria-invalid="true"`, and the helper reads the limit (« Entre 0 et 30 jours. »). The
   value is committed as typed, so Enregistrer sends it and the server answers the same message (rule 8)
   — the page cannot save it. *Why refuse rather than clamp:* a clamped value is a value nobody chose; on
   a payment delay it silently moves a deadline the guest will be told. Adrien's two explicit asks (strip
   the minus, restore a non-number) are both « the typed text has no meaning »; an out-of-range number has
   a meaning, just a forbidden one, and the operator must see it (arbitration A2, resolved 2026-10-28: refuse).
6. **A decimal in a whole-number field is refused** (« Nombre entier de jours. »), same treatment as rule 5.
7. **Keyboard.** ArrowUp / ArrowDown step by 1 (or `10^-decimals` in decimal mode) and stop at the
   bounds. Focus selects the content (the existing `onZeroFocus` behaviour). The field keeps ≥ 44 px of
   touch height.
8. **The server is authoritative and speaks first.** Every bound below is enforced by the server with a
   **400** and a French message per field, in the error shape the endpoint already uses
   (`{ error: 'PROPERTY_INVALID', errors }`, `{ code: 'PLATFORMS_INVALID', errors: { [id]: {...} } }`).
   The message the field shows (rule 5) is built from the same descriptor, so both read identically.
   The limits descriptors live in one server module and are sent with the payload that fills the form (the
    property's through `GET /api/properties/limits`, which also serves a property not created yet).
    A descriptor may carry its own `message`, shown as is (`depositPercent`, `payoutDueDays`).

### 3.2 Payment delays of a property (« Paiement & caution » tab)

9. **`depositDueDays` is a whole number from 0 to 30** (« Entre 0 et 30 jours. »). Checked when the
   acompte is on (`depositEnabled`), like `depositPercent`.
10. **`balanceDaysBefore` and `cancelAfterBalanceDueDays` are whole numbers from 0 to 60**
    (« Entre 0 et 60 jours. »), whatever the acompte switch (they apply to the single payment too —
    `property-deposit-switch.md` rule 11).
11. **A stored out-of-range value stays savable until touched.** The three checks run only when the
    field is present **and differs from the stored value** (or on creation) — the pattern of the
    capacity check (`settings-rationalization.md` rule 23a). An instance sold with `balanceDaysBefore =
    90` keeps working; the operator is told the day he edits that field. No migration rewrites a delay.
12. **No more silent fallback on write.** A negative, non-numeric or out-of-range day count in a
    property payload is refused by rule 9–10; `dayCountOr()` keeps its fallback only for an *absent*
    field (null / undefined / ''), which is what its comment says it is for.
13. **`depositPercent` uses the same field** (decimal, 1–99, message unchanged: « Entre 1 et 99 %. Pour
    tout encaisser à la réservation, désactivez l'acompte. »). Its server rule is unchanged.
14. **Helpers.** `depositDueDays`: « 0 : à régler à la réservation. » `balanceDaysBefore`: unchanged
    (« Échéance du solde — ou du paiement unique quand l'acompte est désactivé. »). The value 0 of
    `balanceDaysBefore` means « due on the arrival day », 0 of `cancelAfterBalanceDueDays` « cancellable
    from the solde deadline » — no special copy.

### 3.3 An acompte due at booking (`depositDueDays = 0`)

_Arbitration A1 resolved 2026-10-28: **label only**. Rules 16–20 (a 409 guard on the operator's paths)
were written then withdrawn the same day; their numbers stay reserved._

15. **0 means « due at booking ».** The acompte deadline is the booking day (unchanged arithmetic), the
    rule 47 cap still applies, and the property page, the fiche and the PDF read « à la réservation »
    where they print a delay of 0 days. Nothing is blocked: an operator-created reservation or an
    accepted devis holds its dates as with any other delay; the existing deadline alert flags the unpaid
    acompte from the next day. _(Implementation note: no screen prints a delay in days — the fiche and the
    PDF print the deadline as a date — so the label lives where the delay is typed, the helper of rule 14;
    no `depositDueLabel` helper was needed.)_
16. _Withdrawn 2026-10-28 (A1 = label only)._ Was: an operator-created direct reservation refused (409
    `DEPOSIT_DUE_AT_BOOKING`) without its acompte.
    > **Sans test** — withdrawn rule, nothing to prove.
17. _Withdrawn 2026-10-28 (A1 = label only)._ Was: the « Enregistrer en devis / Acompte reçu / Annuler »
    dialog.
    > **Sans test** — withdrawn rule, nothing to prove.
18. _Withdrawn 2026-10-28 (A1 = label only)._ Was: the same guard on devis acceptance.
    > **Sans test** — withdrawn rule, nothing to prove.
19. _Withdrawn 2026-10-28 (A1 = label only)._ Was: the payment-link conversion left below the guard.
    > **Sans test** — withdrawn rule, nothing to prove.
20. _Withdrawn 2026-10-28 (A1 = label only)._ Was: the guard's exemptions (A4, moot).
    > **Sans test** — withdrawn rule, nothing to prove.
21. **The website needs nothing new.** « Payer » already converts on payment; « Envoyer une demande sans
    payer » is already a devis. Covered by a test, not by code (`deposit-blocks-the-dates.md` rule 16).

### 3.4 Pool season — off, all year, or a season

22. **Three states.** « Piscine » off → no pool. On → a segmented choice **Toute l'année** (default when
    switched on) | **Saison**; Saison reveals « Ouverte du » / « Au » (`MonthDayField`).
23. **All year is stored as `01-01` → `12-31`.** No new column: the J-7 overlap test is true for every
    stay with these bounds, including one that crosses the New Year. Read back, `01-01`/`12-31` shows
    « Toute l'année ».
24. **The server owns the mapping.** The property payload accepts `poolSeasonMode: 'none' | 'allYear' |
    'season'`; `none` empties both bounds, `allYear` writes `01-01`/`12-31`, `season` requires both bounds.
    A payload with only the two dates (older client, CSV, plugin) keeps today's meaning. `GET` returns
    `poolSeasonMode`, derived.
25. **The closing day is never before the opening day.** In `season`, `poolSeasonEnd < poolSeasonStart`
    (as `MM-DD`) is refused on `poolSeasonEnd`: « La fermeture suit l'ouverture. » Equal bounds (a one-day
    season) are accepted. A season crossing the New Year is therefore not expressible — out of scope.
26. **Saison with a missing bound** is refused on the missing one: « Les deux dates. » (replaces « Les deux
    dates, ou aucune. », which described the switch the old payload could not send).
27. **The switch is persisted.** Switching « Piscine » on and saving keeps it on after reload (it saves
    `allYear`), which fixes the client-only `poolOpen` of §1.3.

### 3.5 Platform commissions (Paramètres › Plateformes)

28. **`commissionPercent` is a decimal from 0 to 99.99, two decimals** (« Entre 0 et 99,99 %. », message
    unchanged), rendered by `BoundedNumberField` (rules 1–7): the minus is stripped as typed, a non-number
    restores the previous rate on blur / Enter, `120` is refused in red.
29. **`payoutDueDays` on the same page uses the same field** (whole, 0–365, message unchanged « Un nombre
    entier de jours (0 à 365). »), so one page never mixes two input behaviours.
30. **The legacy `PUT /api/platforms/:id/commission` refuses instead of clamping**: 400
    `{ error: 'Entre 0 et 99,99 %.' }` for a negative, a non-number or a value above 99.99. Nothing in the
    client calls it; the change removes the only silent clamp left on commissions.
31. **`GET /api/platforms/settings` sends the limits** (`limits.commissionPercent`, `limits.payoutDueDays`).

### 3.6 Plan comptable — one « Comptes » card

32. **Every account number sits in « Comptes »**, in three labelled groups, then the journal code:
    - **Ventes** — Hébergement, Prestations complémentaires, Activités, Rabais accordés;
    - **Taxes** — TVA collectée 20 %, TVA collectée 10 %, Taxe de séjour, TVA déductible (commissions);
    - **Commissions et produits divers** — Commission par défaut, Indemnités d'annulation (with its « TVA
      sur indemnités (%) » right under it), Pourboires;
    - **Journal** — Code journal des ventes.
    The « Compte par défaut » and « Indemnités d'annulation » cards disappear; « Par plateforme » stays as
    it is (its « TVA déductible sur commissions (%) » rate included).
33. **Nothing moves on the server.** Same endpoint, same payload, same validation, same storage; the page
    only regroups. A plan row the client does not know (a future account) goes at the end of « Ventes »
    with its key as label, as today.
34. **Helpers keep their substance, shorter.** Commission par défaut: « Pour les plateformes sans compte
    propre. » Indemnités d'annulation: « Crédité quand une plateforme indemnise une annulation. »

### 3.7 Social links (Emails & notifications › Contenu des mails)

35. **« Lien Instagram » becomes « Réseaux sociaux »**: an ordered list of `{ network, url }`, up to 8
    entries, empty allowed.
36. **The networks are a server catalogue**: Instagram, Facebook, TikTok, YouTube, Pinterest, LinkedIn, X.
    Each has a label and the hosts it accepts (`instagram.com`; `facebook.com`, `fb.com`, `fb.me`;
    `tiktok.com`; `youtube.com`, `youtu.be`; `pinterest.com`, `pinterest.fr`, `pin.it`; `linkedin.com`;
    `x.com`, `twitter.com` — any subdomain, e.g. `www.`, `m.`). The catalogue is sent with the settings.
37. **Validated by the server, per entry**, 400 with the existing settings error shape, keyed
    `socialLinks.<index>.<field>`: unknown network « Réseau inconnu. »; not `http(s)` / unparsable
    « Doit commencer par http:// ou https:// » / « URL invalide. » (existing `validatePublicUrl`); host not
    of that network « Lien d'un autre réseau. »; the same network twice « Déjà dans la liste. »; more than
    8 « 8 liens au plus. ». Whitespace is trimmed; an entry whose URL is empty is dropped, not refused.
38. **The order is the operator's** — up / down on each row; the e-mail lists the links in that order.
39. **The J+1 e-mail renders byte-identically for existing data.** One link → `{{link}}` is that URL,
    exactly what `instagramUrl` produced. Zero link → no paragraph (`hasInstagram` false). Two or more →
    `{{link}}` expands to one line per link, « Instagram : https://… », in the operator's order (A3,
    resolved 2026-10-28).
40. **Template identities are kept.** The paragraph key `instagram`, the tokens `instagramParagraph` and
    `hasInstagram` keep their names — stored templates and translation-catalogue overrides reference them.
    Only their labels change (« Paragraphe réseaux sociaux », « Si réseaux sociaux » — already so).
41. **Migration, once and idempotent.** A new `app_settings.socialLinks` (JSON) is filled from a non-empty
    `instagramUrl` as `[{ network: 'instagram', url }]` the first time it is empty; an empty
    `instagramUrl` writes `[]`. A URL that would fail rule 37's host check (an old free value) is still
    migrated, so no e-mail changes; it is flagged the first time the list is saved.
42. **`instagramUrl` stays written for rollback.** Every save keeps `instagramUrl` equal to the
    Instagram entry's URL (or `''`), so installing the previous release renders the same J+1 e-mail.
43. **The old input still works.** A `PUT /api/settings` carrying `emails.instagramUrl` (an older client,
    a script) replaces the Instagram entry of the list (or removes it when empty) and keeps the others.
44. **Nowhere else, yet.** The links feed the J+1 e-mail only. Exposing them to the website footer through
    the public API is out of scope (§8).

**Edge cases:**
- Deposit days `0` on a property whose acompte is **off** → hidden field, not validated (rule 9), no guard
  (A1 = label only).
- `depositDueDays` changed from 7 to 0 while reservations exist → nothing moves (rule 20); new ones only.
- Paste `-12,5` into a whole-number days field → minus stripped → `12,5` → refused on blur « Nombre entier
  de jours. ».
- Paste `-12,5` into a commission → `12,5` → committed `12.5`.
- `  ` (spaces) on blur in a required field → previous value restored (rule 4).
- Pool mode `season` with `06-15 → 06-15` → accepted, one-day season.
- Pool previously `01-01 → 12-31` typed by hand → reads « Toute l'année » (same meaning).
- Social link `https://instagram.com/x?igsh=…` → accepted, kept verbatim (query string included).
- Social link `instagram.com/x` (no scheme) → refused « Doit commencer par http:// ou https:// ».
- A plan comptable with no plan rows (`planRows` empty) → « Comptes » still shows the commission and
  indemnity accounts (they no longer depend on the plan rows' card).

---

## 4. Architecture

> **Fat backend, thin frontend.** Bounds, messages, the pool mode mapping, the network catalogue, the host
> check, the deposit-at-booking guard and the `{{link}}` expansion are server-side. The client strips a
> minus and restores a non-number — pure input ergonomics, mirrored from a descriptor the server sends —
> and regroups the account plan, which is presentation.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `inputLimits.js` | C | The limits descriptors (`PROPERTY_LIMITS`, `PLATFORM_LIMITS`), `parseBoundedNumber(value, limits)` → `{ value }` or `{ error }`, and `limitMessage(limits)` (rules 1, 5, 6, 8). Pure. |
| `utils/` | `propertyValidation.js` | T | Rules 9–11 (day counts, changed-only), 24–26 (pool mode, order, missing bound). |
| `utils/` | `poolSeason.js` | C | `resolvePoolSeason(body)` → stored bounds; `poolSeasonModeOf(start, end)` (rules 23–24). Pure. |
| `models/` | `propertiesModel.js` | T | Writes the bounds from `resolvePoolSeason`; `dayCountOr` falls back only for an absent field (rule 12); exposes `poolSeasonMode` + `limits` on read. |
| `controllers/` | `propertiesController.js` | T | New `limits` handler behind `GET /properties/limits` (rule 8). |
| `routes/` | `properties.js` | T | One line: `GET /limits`. |
| `controllers/` | `platformsController.js` | T | Legacy `setCommission` refuses (rule 30); `planRow` reads `PLATFORM_LIMITS` (rules 28–29); `listSettings` adds `limits` (rule 31). |
| `models/` | `platformsModel.js` | T | `setCommissionPercent` no longer clamps; it trusts the validated value. |
| `utils/` | `socialLinks.js` | C | `SOCIAL_NETWORKS` catalogue, `validateSocialLinks(list)` (rules 36–37), `instagramUrlOf(list)` (rule 42), `mergeLegacyInstagram(list, url)` (rule 43), `renderSocialLinks(list, lang)` (rule 39). Pure. |
| `controllers/` | `settingsController.js` | T | `EMAILS_FIELDS` gains `socialLinks` (JSON, validated); keeps writing `instagramUrl` (rule 42); legacy `instagramUrl` input mapped (rule 43). |
| `models/` | `settingsModel.js` | T | `socialLinks` in the readable/writable columns. |
| `utils/` | `settingsResponse.js` | T | Returns `emails.socialLinks` (parsed) and `emails.socialNetworks` (catalogue). |
| `utils/` | `stayContentContext.js` | T | `instagramParagraph` built from `socialLinks` via `renderSocialLinks` (rule 39); falls back to `instagramUrl` when the column is absent (minimal test DB). |
| `utils/` | `socialLinksMigration.js` | C | Rule 41, idempotent, guarded by a `migrations` row (`social_links_from_instagram_v1`), the pattern of `balance_days_before_30_v1`; called from `database.js` after `applyGuestEmailSequenceSchema`. |
| `utils/` | `guestEmailSequenceSchema.js` + `database.js` | T | `app_settings.socialLinks TEXT NOT NULL DEFAULT '[]'` is added next to `instagramUrl` (same idempotent `addColumns`); `database.js` calls the migration. |
| `middleware/` | — | — | (none) |
| `scheduledTasks.js` | — | — | (none) |
| `plugins/accounting-export/` | — | — | (none — rule 33) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `components/` | `BoundedNumberField.jsx` | C | Rules 1–7. Generic, JSDoc'd. |
| `utils/` | `numberInput.js` | C | `stripMinus`, `parseLocaleNumber`, `limitMessage(limits)` (mirrors the server text from the descriptor). Shared with `BoundedNumberField`; `QuantityField` may adopt `parseLocaleNumber` later. |
| `components/property/` | `PropertyPaymentTab.jsx` | T | The four numbers → `BoundedNumberField` with `limits` from the payload; helper of rule 14. |
| `components/property/` | `PropertyStayTab.jsx` | T | Pool: switch + `SegmentedSelect` (Toute l'année / Saison) + the two `MonthDayField`s; sends `poolSeasonMode` (rules 22–27). |
| `pages/` | `PropertyDetail.jsx` | T | Loads the limits (`api.getPropertyLimits`), carries `poolSeasonMode` in the form; drops `poolOpen`. |
| `pages/settings/` | `PlatformsSettingsPage.jsx` | T | Commission and payout cells → `BoundedNumberField` (rules 28–29). |
| `components/` | `SocialLinksField.jsx` | C | Specific to the e-mail settings: rows of network `Select` + `HelpedTextField` URL + up/down/remove, « Ajouter un réseau » (rules 35, 38). A network already used is disabled in the other rows' pickers. |
| `components/` | `SettingsEmailContentSection.jsx` | T | Replaces « Lien Instagram » by `SocialLinksField`. |
| `hooks/` | `useSettingsForm.js` | T | Carries `socialLinks` (array) and its indexed errors; `instagramUrl` and `socialNetworks` are read-only for the page. |
| `plugins/accounting-export/` | `PlatformAccountsPage.jsx` | T | One « Comptes » card, groups of rule 32. |
| `plugins/accounting-export/` | `accountGroups.js` | C | The presentational group map (key → group, order). |
| `api.js` | — | T | `getPropertyLimits`. |
| `constants/` | — | — | (none — bounds and networks come from the server) |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `HelpedTextField`, `MonthDayField`, `SegmentedSelect`, `FormDialog`/`ConfirmDialog`, `ErrorAlert`, `useToast` | Unchanged contracts. |
| **Created (new generic)** | `BoundedNumberField` | Not `QuantityField`: that one *clamps* by design (a quantity of 0 would drop a fiche line) and carries steppers; this one *refuses* and mirrors a server descriptor. Next consumers already visible: the property tariff numbers, payout days, tourist-tax rates, the hourly resource minutes, the linen stock. |
| **Specific (kept feature-local)** | `SocialLinksField`, `accountGroups.js` | One settings list / one plugin page's layout. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/properties/limits` | — | `{ depositDueDays: { min: 0, max: 30, integer: true, unit: 'jours' }, balanceDaysBefore: {…max 60}, cancelAfterBalanceDueDays: {…max 60}, depositPercent: { min: 1, max: 99, decimals: 2, unit: '%', message } }` | New (read-only, any user): serves a new property's form too. |
| GET | `/api/properties/:id` | — | `{ …, poolSeasonMode }` | Added field only. |
| PUT/POST | `/api/properties[/:id]` | `{ …, depositDueDays, balanceDaysBefore, cancelAfterBalanceDueDays, poolSeasonMode?, poolSeasonStart?, poolSeasonEnd? }` | 400 `{ error: 'PROPERTY_INVALID', errors: { depositDueDays: 'Entre 0 et 30 jours.', poolSeasonEnd: 'La fermeture suit l\'ouverture.' } }` | Multipart strings parsed. |
| GET | `/api/platforms/settings` | — | `{ platforms, limits: { commissionPercent: { min: 0, max: 99.99, decimals: 2, unit: '%' }, payoutDueDays: { min: 0, max: 365, integer: true, unit: 'jours' } } }` | Rule 31. |
| PUT | `/api/platforms/:id/commission` | `{ commissionPercent }` | 400 `{ error: 'Entre 0 et 99,99 %.' }` | Rule 30 (legacy, refuses). |
| GET | `/api/settings` | — | `{ emails: { googleReviewUrl, instagramUrl, socialLinks: [{ network, url }], socialNetworks: [{ value, label }] } }` | `instagramUrl` kept (read-only meaning). |
| PUT | `/api/settings` | `{ emails: { socialLinks: [{ network, url }] } }` (or legacy `instagramUrl`) | 400 `{ errors: { 'socialLinks.1.url': 'Lien d\'un autre réseau.' } }` | Rules 37, 43. |

All endpoints keep their existing auth (admin; Plan comptable admin + accountant).

---

## 5. Data model

| Change | Detail |
|---|---|
| `app_settings.socialLinks TEXT NOT NULL DEFAULT '[]'` | JSON array `[{ network, url }]`. Added by an idempotent `ALTER TABLE` guarded on `PRAGMA table_info`. |
| Migration `social_links_from_instagram_v1` | Rule 41: once, when `socialLinks = '[]'` and `instagramUrl <> ''`. Re-running is a no-op. |
| `properties.*` | **No change.** Pool « all year » is `01-01`/`12-31` in the existing columns; day counts keep their columns and values. |

**Data impact:** no value is rewritten. The only write is the social-links copy, which preserves the URL
verbatim and keeps `instagramUrl` (rule 42) — a rollback renders the same e-mail. Stored out-of-range day
counts are left alone (rule 11).

---

## 6. UI / UX

Interactive mockups: [docs/specs/2026-10-28-settings-input-guards.html](../docs/specs/2026-10-28-settings-input-guards.html)
(desktop and 390 px, every refusal state reachable by typing).

### 6.1 `BoundedNumberField` states

| State | Look | Helper |
|---|---|---|
| Idle | MUI outlined, unit as end adornment (« jours », « % ») | the field's own helper |
| Minus typed | sign removed, border honey 2 s | « Positif uniquement. » (2 s) |
| Non-number on blur / Enter | previous value back, short honey pulse | « Nombre attendu. » (2 s) |
| Out of range / decimal in whole field | red border, `aria-invalid` | « Entre 0 et 30 jours. » / « Nombre entier de jours. » (until fixed) |
| Server 400 after Enregistrer | same red state | the server's message |

Motion: the pulse is a 160 ms border-colour transition; `prefers-reduced-motion` keeps the colour, drops
the transition. No shake.

### 6.2 Screens

- **Logement › Paiement & caution.** Same two cards. Acompte on: « % acompte » and « Acompte (jours après
  réservation) » side by side (`sm+`), stacked on `xs`. Solde & caution: Solde, Annulation, Caution.
- **Logement › Séjour › Piscine.** Switch; on → `SegmentedSelect` « Toute l'année | Saison »; Saison →
  « Ouverte du » / « Au » side by side (`sm+`), stacked on `xs`.
- **Paramètres › Plateformes.** Unchanged table (`lg`) / cards (`xs`); the commission and payout fields
  behave per §6.1.
- **Paramètres › Emails & notifications › Contenu des mails.** « Lien d'avis Google » then « Réseaux
  sociaux »: one row per link — network select (120 px), URL field (flex), ↑ ↓ ✕ icon buttons (44 px).
  « Ajouter un réseau » text button; disabled at 8 or when every network is used. Empty list: the button
  alone, helper « Proposés dans le mail de remerciement (J+1). » On `xs` each row stacks: select + icons on
  one line, URL full width below.
- **Plan comptable.** « Comptes » card: three groups with a small uppercase-free sub-heading
  (`subtitle2`, `text.secondary`), two-column grid on `sm+`, one on `xs`; then « Par plateforme ».

`PageActionBar` actions are unchanged on every touched page (Save / Cancel as today).

---

## 7. Test plan

Every new rule is cited by at least one test (`check-spec-coverage`).

### Server unit tests (`server/src/tests/`)

| File | Cases | Rules |
|---|---|---|
| `settings-input-guards-limits.unit.test.js` | 7 — descriptors, bounds inclusive, comma/dot, non-numbers, integer vs decimal, message per descriptor | 1, 5, 6, 8 |
| `settings-input-guards-property-days.unit.test.js` | 9 — each field in and out of bounds; deposit off skips; stored 90 untouched passes, edited to 91 refused; absent field keeps the default; one message per field | 9–13 |
| `settings-input-guards-deposit-at-booking.unit.test.js` | 6 — 0 days = booking day; rule 47 cap; nothing blocked; platform never concerned; devis ignores the delay; website payment converts | 15, 21 |
| `settings-input-guards-pool-season.unit.test.js` | 9 — allYear / none / legacy dates / mode derived; order, equal, missing bound, unknown mode; J-7 overlap all year incl. New Year | 22–27 |
| `settings-input-guards-platform-commission.unit.test.js` | 5 — bulk refusals write nothing, comma accepted, payout message, legacy PUT refuses, limits in GET | 28–31 |
| `settings-input-guards-social-links.unit.test.js` | 21 — migration (copy / empty / idempotent / odd URL / no column), catalogue, hosts, each message, 8 max, trim and drop, order, instagramUrl sync, legacy merge, J+1 golden FR/EN, no link, several links, template identities, nowhere else | 35–44 |

### Client unit tests (Vitest)

| File | Cases | Rules |
|---|---|---|
| `components/__tests__/BoundedNumberField.input-guards.test.jsx` | 16 | 1–7 |
| `components/property/__tests__/PropertyPaymentTab.day-bounds.test.jsx` | 5 | 9–14 |
| `components/property/__tests__/PropertyStayTab.pool-mode.test.jsx` | 6 | 22–27 |
| `pages/settings/__tests__/PlatformsSettingsPage.commission-guard.test.jsx` | 4 | 28–29 |
| `components/__tests__/SocialLinksField.test.jsx` | 8 | 35–38 |
| `pages/settings/__tests__/EmailSettingsPage.social-links.test.jsx` | 2 | 35, 37, 42 |
| `plugins/accounting-export/__tests__/PlatformAccountsPage.account-groups.test.jsx` | 5 | 32–34 |

### E2E (Playwright)

`e2e/specs/settings/settings-input-guards.spec.js` — 2 flows: property days `-5` → `5`, `45` → red → the
server refuses the save; Plateformes commission `abc` → blur → previous rate back.

### Manual UI verification

At 390 / 900 / 1280 px: each §6.1 state on the payment tab; a 0-day acompte reads « à la réservation » on the fiche; pool Toute l'année → reload keeps it; three social links reordered, J+1
preview reflects the order; Plan comptable reads as one list.

---

## 8. Out of scope

- The Plateformes page slowness (`inte-performance` spec).
- Any blocking tied to a 0-day acompte (409, dialog, « option » state) — A1 decided label only.
- A pool season crossing the New Year.
- Social links on the website footer / public API, link icons in the e-mail.
- Bounding other numeric settings (tariffs, linen, resources): they adopt `BoundedNumberField` when touched.
- Rewriting stored out-of-range delays.

## 9. Open questions

None open.

**Resolved 2026-10-28 (Adrien):**
- **A1 — 0 deposit days on the operator's paths → label only.** « Due on the booking day », no 409, no
  dialog; rules 16–20 withdrawn, lot 5 reduced to the label.
- **A2 — Out-of-range number → refuse** (rule 5), never clamp.
- **A3 — Two or more social links → one line per link** « Instagram : https://… » (rule 39).
- **A4 — Last-minute stay at 0 days → moot** (no guard exists after A1).

---

## 10. Implementation progress

Implemented 2026-10-28 on `feature/settings-input-guards`, one commit per lot.

| Lot | Content | State |
|---|---|---|
| 1 | Shared contract (`inputLimits`, `BoundedNumberField`) + property delays 0–30 / 0–60 | Done |
| 2 | Pool: off / « Toute l'année » / « Saison », order check, persisted switch | Done |
| 3 | Plateformes: commission and payout fields, legacy PUT refuses | Done |
| 4 | Plan comptable: one grouped « Comptes » card (`accountGroups.js`, data-driven) | Done |
| 5 | Social links: list, catalogue, migration, J+1 expansion, golden test | Done |

Deviations from the first draft, recorded where they apply: the limits of a property come from
`GET /api/properties/limits` (a new property has no payload to carry them); `socialNetworks` rides in the
`emails` group of `GET /api/settings`; no `depositDueLabel` helper (rule 15 note). `GET /platforms/settings`
carries a `message` on `payoutDueDays` so the field reads the sentence the server always used.
