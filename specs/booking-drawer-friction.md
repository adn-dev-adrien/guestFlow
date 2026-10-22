# Booking drawer — remove the three frictions of the récapitulatif

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/booking-drawer-friction` |
| **Created** | 2026-10-19 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Mock-up** | [`docs/specs/2026-10-19-booking-drawer-friction.html`](../docs/specs/2026-10-19-booking-drawer-friction.html) — interactive, real prices and rules of 2026-10-19 |

---

## 1. Context

The audience report of 2026-10-19 (Umami, 29/09 → 18/10, robots and internal visits removed) measured
the booking funnel of domainesolio.com:

| Step | Visits |
|---|---|
| Opens the drawer (`booking-open`) | 24 |
| Picks dates (`booking-dates`) | 18 |
| Gets a price (`booking-quote`) | 16 |
| Reaches the récapitulatif (`booking-step2`) | 16 |
| Sends anything (`booking-requested`) | **0** |

15 of the 16 who reached the récapitulatif were on a phone. A replay of the funnel on an iPhone
viewport showed three causes, all visible in the live drawer:

1. **The récapitulatif offers one action: pay the whole stay now** (« Payer en ligne », 642,80 € for
   two nights at La Granja). There is no way to ask a question or to book without paying, although the
   engine supports it (`payOnline = false` sends a request, `specs/public-online-payment.md`).
2. **The price is always quoted for 2 people.** The 21 quotes of the period were all at 2 guests: the
   travellers block sits *after* the calendar and the options, and nobody scrolls to it. La Granja's
   price does not depend on the party (319 € a night in November, from 2 to 12 people), so a group of
   10 reads « 319 € a night » without ever seeing that it is 32 € each.
3. **The minimum stay is discovered after the dates are chosen.** 4 visits picked a stay under the
   minimum (2 nights in low season, 4 in July-August) and got « Séjour trop court » — under the
   calendar, which on a phone is below the fold.

A fourth idea from the report, a selectable empty cell at the top of the calendar, was a false alarm
(the test script clicked the padding `div`); it is not part of this spec.

## 2. Goal

A visitor on a phone sees the price for their own party, knows the minimum stay before choosing, and
can either pay now or send a request without paying.

## 3. Functional rules

### Payment choice on the récapitulatif

1. The booking block gains a **« Proposer aussi une demande sans paiement »** setting, available only
   when « Paiement en ligne » is on. Default **off** for every existing block — nothing changes on a
   site until its operator ticks it. Domaine Solio ticks it on both lodging pages (decision 2026-10-19).
2. With both settings on, the récapitulatif shows **two actions**: the primary « Payer 642,80 € » (the
   amount is the one the guest pays now — the total, or the acompte when the property is in deposit
   mode, `specs/public-online-deposit.md`) and a secondary « Envoyer une demande sans payer ».
3. « Envoyer une demande sans payer » posts the **same** `POST /booking-requests` as a request-only
   block, and lands on the same confirmation (« Demande envoyée ! Référence : … Nous vous recontactons
   rapidement. »). No payment link is created.
> **Sans test** — JS du navigateur (plugin ou mu-plugin) qu'aucune suite de ce dépôt n'exécute ; vérifié de bout en bout, §10 (devis créé sans lien de paiement).
4. Above the two actions, one line sets the expectation: « Une question avant de vous engager ?
   Envoyez une demande : aucun paiement tant que nous n'avons pas répondu. »
5. Both actions run the **same validation** (required fields, e-mail shape, CGV). A refusal says which
   field and why; the CGV refusal stays the engine's own (`site-booking-drawer.md` rule 7).
> **Sans test** — JS du navigateur (plugin ou mu-plugin) qu'aucune suite de ce dépôt n'exécute ; vérifié de bout en bout, §10 (champs, e-mail, CGV).
6. Each action is tracked separately: `booking-requested` gains a `mode` property (`pay` | `request`),
   so the next report can tell the two apart. `booking-pay` keeps firing for the payment path only.

### Travellers first, and the price per person

7. **The travellers block moves above the calendar**, in every booking block (not only Solio's): the
   party decides the price and the capacity, so it is asked first.
8. Every public quote carries **`perPersonPerNight`**: the stay total including tourist tax
   (`totalStayPrice`), divided by the number of paying guests (adults + teens + children — babies
   excluded) and by the number of nights, rounded to the cent. Computed by GuestFlow, never by the
   widget. Absent (`null`) when the stay has no nights or no paying guest.
9. The récapitulatif shows it under the total, for **both lodgings** (decision 2026-10-19):
   « soit 40,78 € par personne et par nuit ». It is indicative and never replaces the total.

### Minimum stay visible before choosing

10. The public availability payload gains, for each **bookable arrival date** of the window, the
    effective minimum and the **earliest valid departure** — computed by GuestFlow with the same rule
    the quote enforces (`pricing-min-nights-per-range.md` rule 3: the maximum effective minimum over the
    nights the stay touches).
11. Once an arrival is picked, departures **before the earliest valid departure** are drawn hatched,
    labelled « min. 2 » under the day number, and refuse the tap: the day shakes once and the message
    « 2 nuits minimum : choisissez le 22 novembre ou plus tard. » appears where the visitor can see it
    (rule 14). They are not struck through like a booked night: they are reachable by extending the stay.
    Each refused tap is tracked as `booking-unavailable` with `reason: 'min-nights-tap'`.
12. Right after the arrival is picked, the hint says « Départ à partir du 22 novembre (2 nuits
    minimum). » — the refusal of rule 11 is the exception, not the way to learn the rule.
13. Each bookable day shows **the price of that night** under its number (« 319 »), from the same
    availability payload (GuestFlow's nightly accommodation price for the base occupancy). Booked and
    past days show nothing.

### The Solio drawer (`site-booking-drawer.md` amendments)

14. **Screen 1 gets a sticky bar again**, amending rules 4-5 of `site-booking-drawer.md`. It holds the
    calendar's current hint or refusal, the live total with its per-person line (« 652,40 € — soit
    40,78 € par personne et par nuit », both copied from the engine's récapitulatif, never computed by
    the drawer) and « Suivant ». Before any valid stay: « Dès 319 € la nuit — jusqu'à 12 voyageurs »,
    from the lodging's own facts on the site (`prix_min_nuit`, `capacite_max`).
    *Why it no longer breaks rule 4's reason:* the 2026-09-23 bug was a sticky button with two jobs
    (scroll, then advance). This one has one job — go to screen 2 — and never scrolls.
> **Sans test** — JS du navigateur (plugin ou mu-plugin) qu'aucune suite de ce dépôt n'exécute ; vérifié de bout en bout, §10 (barre avant et après les dates, groupe de 8).
15. « Suivant » stays disabled until the quote is valid, and the bar says why with the engine's own
    message (rule 6 of `site-booking-drawer.md`, unchanged in substance, moved into the bar).
> **Sans test** — JS du navigateur (plugin ou mu-plugin) qu'aucune suite de ce dépôt n'exécute ; vérifié de bout en bout, §10 (refus « 2 nuits minimum » dans la barre).
16. Screen 2's sticky bar holds « Retour » and the primary action on one row, the secondary action on
    a second full-width row (rule 2). With only one action configured, it is unchanged.
> **Sans test** — JS du navigateur (plugin ou mu-plugin) qu'aucune suite de ce dépôt n'exécute ; vérifié de bout en bout, §10 (deux actions ; bloc sans le réglage inchangé).
17. The step that is not shown is `inert`, so a keyboard or a screen reader cannot land in the
    off-screen screen.
> **Sans test** — le tiroir de Solio vit dans le dépôt privé `adn-dev-adrien/solio-site` depuis la fusion dans `inte/plugins` ; la règle y est tenue par `tests/booking-drawer-friction.test.js`.

### Search snippets (content, not code)

18. The SEO title and description of three pages are replaced by the versions validated on
    2026-10-19, within Google's display limits (60 / 155 characters):

    | Page | Title | Description |
    |---|---|---|
    | Accueil | Domaine Solio, Satillieu : gîte pour 10 et lodge en Ardèche | Un domaine de 13 ha rien que pour vous à Satillieu : gîte 3 étoiles pour 10, lodge safari, bain nordique offert, ânes et chèvres. Réservation en direct. |
    | Le Domaine | Bain nordique privatif en Ardèche, face aux prés \| Solio | Un bain nordique privatif face aux prés, une heure offerte à chaque séjour. Autour : 13 ha, ânes et chèvres, une boucle de 2 km à Satillieu. |
    | Autour de nous | Que faire en Ardèche verte ? Nos sorties autour de Satillieu | Safari de Peaugres à 25 min, lac de Devesset, Via Fluvia, Annonay à 15 km : nos sorties testées pour découvrir l'Ardèche verte depuis le Domaine Solio. |

    They live in the pages' `_gf_seo_title` / `_gf_seo_description` fields (WordPress content, not
    this repository). English pages are out of scope.
> **Sans test** — contenu WordPress posé par `seo-2026-10-19/deploy-snippets.sh`, que lance Adrien ; le script refuse d'écrire si la description en place a changé.

### Found while verifying (added 2026-10-20)

19. **After a request is sent, screen 2 shows only its confirmation**, and the sticky bar disappears.
    The engine writes « Demande envoyée ! » into its original container, which the drawer has emptied
    when it distributed the blocks: the confirmation landed below the still-filled form, with « Payer »
    and « Envoi… » still in the bar. The drawer now moves it into screen 2.
> **Sans test** — JS du navigateur (plugin ou mu-plugin) qu'aucune suite de ce dépôt n'exécute ; vérifié de bout en bout, §10 (confirmation seule à l'écran, barre masquée).
20. **The engine's sections lose the site theme's `.gf-section` padding inside the drawer.** The theme
    names its page sections `.gf-section` too (`gf-site-style.php`: 64 px on top, 22 px on the sides);
    with the travellers first, that gap opened screen 1 on an empty band.
> **Sans test** — le tiroir de Solio vit dans le dépôt privé `adn-dev-adrien/solio-site` depuis la fusion dans `inte/plugins` ; la règle y est tenue par `tests/booking-drawer-friction.test.js`.

**Edge cases:**
- Arrival whose minimum cannot be met before the next booked night (e.g. 2 free nights before a
  booking, minimum 4) → the arrival itself is not bookable: drawn like a booked day, no price.
- Party changed after a quote → the quote is recomputed (existing behaviour); `perPersonPerNight`
  follows.
- L'Estiva, whose price grows with the party (`extraGuestSurcharge`) → the per-person figure is
  computed on the real total, so it stays correct.
- Deposit mode with the request option → the primary reads « Payer l'acompte 191,40 € »; the secondary
  is unchanged.
- Payment provider down → the primary refuses as today; the secondary still works (it needs no
  provider).
- A request does **not** block the dates (unchanged GuestFlow rule): two requests on the same weekend
  are possible, the operator answers the second with a refusal.

---

## 4. Architecture

> **Fat backend, thin frontend.** Minimum-stay windows, the earliest valid departure, the nightly
> price and the price per person are computed by GuestFlow and served ready to draw. The widget only
> paints them and refuses taps on days the server marked.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `publicProjections.js` | T | `toPublicQuote` adds `perPersonPerNight` (rule 8); `toPublicAvailability` adds `arrivals` (rule 10) and `nightPrices` (rule 13) |
| `utils/` | `publicArrivalWindows.js` | C | Pure function: from blocked dates, the per-night effective minimums and the window, returns `{ date, minNights, earliestDeparture }` for each bookable arrival (rule 10 + first edge case) |
| `controllers/public/` | `publicCatalogController.js` | T | `getAvailability` gathers the per-night minimums and nightly prices from the pricing engine and passes them to the projection |
| `utils/` | `pricing.js` | T | `matchNightRule` + `effectiveMinNightsOf` extracted from `calculateBaseStayPrice` (one rule, used by both); exports `effectiveMinNightsForDate` and the existing `getRuleNightBaseForDate` |
| `models/` | `propertiesModel.js` | T | `listPricingRules(id)` — the rules in the order the engine reads them (read-only) |
| `routes/`, `database.js` | — | — | (none) |

`getAvailability` reads blocked nights 31 days past `to`, so an arrival near the end of the window
still gets its true earliest departure; only `[from, to)` is returned in `blockedDates`.

> **On `inte/plugins` (merge of 2026-10-22):** the public API lives in the `website-booking` plugin.
> `publicProjections.js` and `controllers/publicCatalogController.js` are under
> `server/src/plugins/website-booking/`, `publicArrivalWindows.js` moved there with them, and the pricing
> helpers are read through `sdk.coreModule('pricing')`. `toPublicAvailability` keeps the plugin's
> `nextAvailableDate` beside `arrivals` and `nightPrices`. The tests moved to
> `server/src/plugins/website-booking/tests/booking-drawer-friction.unit.test.js`.

### 4.2 WordPress plugin (`integrations/wordpress/guestflow-booking/`)

| File | T/C | Responsibility in this change |
|---|---|---|
| `blocks/booking/block.json` | T | New attribute `offerRequest` (boolean, default `false`) |
| `blocks/booking/editor.js` | T | Toggle « Proposer aussi une demande sans paiement », shown only when « Paiement en ligne » is on |
| `blocks/booking/render.php` | T | Passes `data-offer-request` to the container |
| `blocks/booking/view.js` | T | Travellers above the calendar (rule 7); hatched/priced days and tap refusal from `arrivals` / `nightPrices` (rules 11-13); per-person line (rule 9); second action and `mode` tracking (rules 2-6) |
| `includes/class-gf-blocks.php` | T | New strings: `sendRequestNoPay`, `requestNoPayHint`, `minNightsFrom`, `minNightsPick`, `perPersonPerNight`, `minShort` |
| `assets/style.css` | T | Hatched « trop court » day, price under the day, secondary action |
| `languages/guestflow-booking-en_GB.po` / `.mo` | T | The nine new strings in English (`.mo` rebuilt with `msgfmt`) |

The plugin version is **not** bumped here: the release chooses it (`guestflow-release` skill, step 4).
`inte/plugins` already uses 1.15.0 and 1.16.0, so the release must pick a number that does not collide.

### 4.3 Solio site (`integrations/wordpress/solio-site/mu-plugins/`)

| File | T/C | Responsibility in this change |
|---|---|---|
| `gf-seo-reservation.php` | T | Screen-1 sticky bar (rules 14-15), two-row screen-2 bar relaying both engine actions (rule 16), `inert` on the hidden step (rule 17), the confirmation brought into screen 2 (rule 19), the `.gf-section` reset (rule 20) |
| `gf-i18n.php` | T | `resa_barre_des`, `resa_barre_capacite` (FR + EN) |

The three SEO snippets (rule 18) are a content change, applied by
`solio-site/rapports/seo-2026-10-19/deploy-snippets.sh`, which Adrien runs — never from this
repository's CI. The script finds each page by its address and writes nothing when its current
description differs from the one read on 2026-10-19.

### 4.4 Client side (`client/src/`)

None. The setting lives in the WordPress block, not in GuestFlow's admin.

**Component reuse declaration:** no React component is involved.

### 4.5 API contract

| Method | Endpoint | Change |
|---|---|---|
| GET | `/public/v1/properties/:id/availability` | **Additive**: `arrivals: [{ date, minNights, earliestDeparture }]` (bookable arrivals only), `nightPrices: [{ date, price }]` |
| POST | `/public/v1/quote` | **Additive**: `perPersonPerNight: number \| null` |
| POST | `/public/v1/booking-requests` | Unchanged |

Both changes are additions: an older plugin ignores them, so `/public/v1/**` keeps its contract (no
major version, `self-update-and-releases.md` §3.A rule 2).

## 5. Data model

No schema change. The block attribute is stored by WordPress in the page content.

## 6. UI / UX

The mock-up is the reference: [`docs/specs/2026-10-19-booking-drawer-friction.html`](../docs/specs/2026-10-19-booking-drawer-friction.html).

- **Order of screen 1:** Voyageurs (with « le prix s'affiche pour votre groupe ») → calendar → options.
- **Day cell:** number, and under it the night's price in `.6rem` muted text; « min. 2 » on hatched
  days (135° stripes `#F6EEDF` / `#FBF6EC`, text `#a99a7f`). Booked days keep their strike-through.
- **Refusal:** one 320 ms horizontal shake of the tapped day (none under `prefers-reduced-motion`), and
  the message in the sticky bar on a `#F8EAE6` band.
- **Screen 1 sticky bar:** total (bold, tabular figures) on the left, « N nuits · N voyageurs — soit X € /
  pers. / nuit » on the right, hint line above, full-width « Suivant ».
- **Screen 2:** « soit X € par personne et par nuit » right-aligned under the total; the green hint of
  rule 4; bar row 1 = « Retour » + « Payer 642,80 € », row 2 = « Envoyer une demande sans payer »
  (white, 1.5 px forest border, full width).
- **Mobile:** the drawer is full width under 560 px (unchanged); every target is ≥ 44 px; the two
  actions never sit side by side on a phone. Desktop is the same drawer at 560 px wide.

## 7. Test plan

### Server unit tests — `server/src/tests/booking-drawer-friction.unit.test.js`

- `perPersonPerNight`: 2 adults × 2 nights; 6 adults + 2 children; babies excluded; zero paying guest
  → `null`; rounding to the cent.
- `publicArrivalWindows`: uniform minimum 2; a 4-night season crossed by the stay (max-over-nights
  rule); an arrival boxed in by a booking → excluded; arrival on the last free night before a
  booking; window edges.
- `toPublicAvailability` / `toPublicQuote`: the new fields are present and the old ones unchanged.

### Plugin

- `npm test` of the plugin if present; otherwise the manual checks below on the dev WordPress.

### Manual UI verification (iPhone viewport 390 px, then 1280 px)

1. Screen 1 opens on Voyageurs; « Un groupe de 8 » then dates → the bar shows the total and « soit … €
   / pers. / nuit ».
2. Arrival 20/11 → hint « Départ à partir du 22 novembre » ; 21/11 hatched, tap → shake + refusal in
   the bar; 22/11 accepted.
3. An arrival boxed in by a booking is not offered.
4. Screen 2, both actions: empty form → field errors; CGV unticked → the engine's refusal; « Envoyer
   une demande sans payer » → confirmation, a « Demande » appears in GuestFlow with its origin, no
   payment link.
5. « Payer » → Qonto as today. Deposit mode on a test property → « Payer l'acompte ».
6. A block without the new setting behaves exactly as before.
7. Umami receives `booking-requested` with `mode=request`.
8. E2E suite (`npm run test:e2e`) and client Vitest stay green.

## 8. Out of scope

- English SEO snippets.
- Any change to prices, minimum stays or seasons.
- Blocking dates on a request (`deposit-blocks-the-dates.md` keeps its rule).
- Offering the request as a fallback when the payment provider is unreachable (decided 2026-10-19).
- The Instagram / Facebook process changes of the report (tracked links, a post log): they need no code.
  A tracked-link builder ships in the mock-up page.
- The live site's ocre button contrast (white on `#B87B2A`, 3.6:1), noticed while building the
  mock-up: a separate design-system change.

## 9. Open questions

None open.

**Resolved 2026-10-19 (Adrien):**
- Payment choice → two actions, pay or request (rules 1-6), rather than a deposit, request-only, or the
  current full payment.
- Price per person → on both lodgings, La Granja and L'Estiva (rule 9).
- Search snippets → published as proposed (rule 18).
- Screen-1 sticky bar → yes, amending `site-booking-drawer.md` rules 4-5 (rule 14).
- Confirmation wording → keep « Nous vous recontactons rapidement », no promised delay (rule 3).
- Request as a fallback when the payment provider is down → out of this spec.

## 10. Implementation progress

**Implemented 2026-10-20** on `feature/booking-drawer-friction`.

- Server: `server/src/tests/booking-drawer-friction.unit.test.js`, **11 tests**. These include a
  parity test: every departure the calendar offers is accepted by the quote, and the night before it
  is refused. They are joined by `wordpress-plugin-booking-friction.unit.test.js`, **8 tests** on the
  shape of the plugin and the drawer (rules 1, 2, 4, 6, 7, 9, 11-12, 17, 20). On `inte/plugins` the two
  drawer tests (rules 17, 20) live in the private solio-site repository, which carries the drawer:
  6 tests here. Full suite
  **4 837 / 4 837**. The browser-only rules are marked « Sans test » and point to the verification
  below.
- Client Vitest **1 450 / 1 450**; Playwright E2E **88 passed, 1 skipped** (unchanged).
- §7 manual checks, run with Playwright on an isolated clone of the local WordPress (port 4931),
  wired to this branch's GuestFlow on seeded data, iPhone 13 then 1280 px:
  - travellers first;
  - 5/11 and 12/11 not offered (boxed in by bookings);
  - « Départ à partir du 22 novembre (2 nuits minimum). » after picking 20/11;
  - 21/11 hatched « min. 2 », and the tap refused in the bar;
  - a group of 6 adults and 2 children → « 652,40 € — soit 40,78 € par personne et par nuit »;
  - screen 2 shows « Payer 652,40 € » and « Envoyer une demande sans payer »;
  - the three refusals: missing fields, e-mail, CGV;
  - the request is created as a GuestFlow devis with no payment link, and `booking-requested` carries
    `mode: 'request'`;
  - « Payer » without Qonto refuses and gives the buttons back;
  - a block without the setting is unchanged.
- Rules 19 and 20 came out of that verification.

