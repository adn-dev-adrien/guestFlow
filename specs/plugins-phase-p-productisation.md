# Plugins — phase P: productisation (a new customer starts from zero)

| Field | Value |
|---|---|
| **Status** | Implemented (2026-10-07; rule 30's repository move 2026-10-19) |
| **Branch** | `feature/plugins-phase-p-productisation` (from `inte/plugins` at 252edfbb) |
| **Created** | 2026-10-06 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Parent study** | [`specs/plugins-inventory.md`](plugins-inventory.md) — §7 « Specific to Solio, but not a plugin », §12 phase P, §13 Q2 |
| **Previous phase** | [`specs/plugins-phase-3c-hourly-resources.md`](plugins-phase-3c-hourly-resources.md) (PR #661) |
| **Feature specs** | [`specs/guest-email-sequence.md`](guest-email-sequence.md), [`specs/accountant-accounting-export.md`](accountant-accounting-export.md), [`specs/control-plane-plans-and-access.md`](control-plane-plans-and-access.md) — their rules hold, except where §3 below corrects them |
| **Summary for review** | [`docs/specs/2026-10-06-plugins-phase-p-productisation.html`](../docs/specs/2026-10-06-plugins-phase-p-productisation.html) |

---

## 1. Context

Phases 0–3 moved the optional features into plugins. What is left in the core still speaks for one
customer, Domaine Solio. An audit of the tree on 2026-10-06, after phase 3c, found the following.

**A brand-new database gets Solio content:**
- the 6 emails of the guest sequence, seeded `enabled` with Solio copy: the address of the domain,
  « 13 hectares », the nordic bath, the shared pool, `map.domainesolio.com`;
- 14 catering options with Solio's price list (Brasserie du Pilat, Pressoir du Pilat, Terroir
  Ardèche), re-seeded at every boot;
- a pool season (15 June – 31 August) that every install is assumed to have;
- two extinguisher repair rows, and an extinguisher check that every departure SAS asks for;
- a « Lit bébé » supplement at Solio's price (5 €).

**The code writes Solio sentences at render time.** `utils/stayContentContext.js` composes about 25
paragraphs of the sequence emails in French and English. Among them:
- the packing list « pour le bain nordique » and « les sentiers du domaine »;
- the Pilat producers;
- the trappers' dinner and the animals;
- the Nespresso machine;
- breakfast « au bâtiment d'accueil ».

`emailContextBuilder.js` also adds a nordic-bath reminder to any resource whose name contains
« nordique ». The unsubscribe page is titled « Vos nouvelles du Domaine Solio ».

**Other leftovers:**
- Lodgify is hard-coded as a direct channel (`DIRECT_CHANNELS`);
- the VAPID subject falls back to `contact@domainesolio.com`;
- the account plan is a constants file: an accountant cannot change a number without a release;
- the public repository carries Solio's WordPress site: 43 files, with LAN addresses and an SSH user;
- the README carries Solio's DNS records, and there is a configuration script for Aventura Lodge.

**There is no first run.** A hosted instance gets its first admin from the console
(`create-first-admin.js`). That admin then lands on an empty dashboard: no company, no property, no
plugin active. Nothing says where to start.

Decisions taken on 2026-10-06:

- **One spec for the whole of phase P** (answer to the split question).
- **Solio keeps its texts through a migration on existing databases** (P18). This revisits
  inventory §13 Q2, where an external content pack had been decided on 2026-09-28. A database that
  already holds properties or reservations receives today's texts as data, automatically: the same
  principle as the built-in plugins activated on existing databases (phase 0). There is no manual
  step at Solio's upgrade. The Solio copy stays in the repository, frozen inside that one migration.
- **The email phrases tied to options and properties live on those options and properties** (P19).
  Prices follow the options; the engine assembles the sentences without knowing Solio.

## 2. Goal

- **A new instance starts neutral.** No Solio name, place, product or price reaches it, and an
  assistant walks the first admin from the company to the first property and the plugins.
- **Solio sees no difference.** Every guest email, in French and English, renders byte for byte as
  before the upgrade. A golden test proves it.
- **The texts the code wrote become data** the operator edits in Réglages, with neutral defaults.
- **The account plan becomes settings** of the accounting plugin.
- **Solio's private material leaves the product repository.**

## 3. Functional rules

### 3.A Stay texts — the sentences of the sequence emails become data

1. **Every sentence that `stayContentContext.js` composes is a stay text.** A stay text has a
   stable key, a French text and an English text. The code still decides *whether* a text appears
   and fills its tokens. It no longer holds any wording, except the neutral default of each key
   (`utils/stayTextCatalogue.js`).
2. **The keys** are the following. Tokens are written `{{token}}`; a text may also use the flags
   listed, as `{{#if flag}}…{{else}}…{{/if}}` at one level, which is the email renderer's grammar.

   | Key | Email | Appears when | Tokens and flags |
   |---|---|---|---|
   | `beds.made` | J-7 | beds made (included or booked) | `bedConfig` |
   | `beds.linenNotIncluded` | J-7 | beds not made | `bedConfig`, `price`, flag `linenOffered` |
   | `baby.booked` | J-7 | baby cot booked | — |
   | `baby.offer` | J-7 | babies, cot proposable | `price` |
   | `bag.items` | J-7 | always (empty = no line) | flag `stayOverlapsPool` |
   | `bag.towels` / `bag.towelsOffer` | J-7 | towels not covered | `price` (offer only) |
   | `travelLight` | J-7 | parking distance > 0 | `distance`, `propertyFrom`, `propertyName` |
   | `noWifi` | J-7 | property without wifi | `PropertyWith`, `propertyName` |
   | `offers.localIntro` | J-7 | a « local » mention is proposable | `list` |
   | `offers.extrasIntro` / `offers.extrasAfterLocal` | J-7 | an « extras » mention is proposable | `list` |
   | `offers.deadline` | J-7 | a mention is proposable | `date` |
   | `parkingLine` | J-2 | parking distance > 0 | `distance`, `propertyFrom`, `propertyName` |
   | `house` | J-2 | always (empty = no paragraph) | — |
   | `cleaning.included` / `cleaning.booked` / `cleaning.notBooked` | J-2 | per cleaning state | — |
   | `complement.atArrival` / `complement.atDeparture` | J-2 | a balance is due on site | `amount` |
   | `review.direct` | J+1 | direct channel and a Google link | `link` |
   | `review.platform` | J+1 | platform channel | `platform`, `link`, flag `hasGoogleReview` |
   | `instagram` | J+1 | an Instagram link | `link` |
   | `quietSinceDeparture` | J+1 | always | `PropertyWith`, `propertyWith`, `propertyName` |
   | `gift.list` | November | a property has a price | `list` (the `gift.offer` items) |
   | `gift.offer` / `gift.fallback` | November | per property with a price / none | `propertyWith`, `propertyName`, `price` |
   | `booked.babyBed` / `booked.towels` | J-2 | the option was booked | — |

   Every price-bearing text also gets the flag `hasPrice` (the amount is above zero), so a neutral
   default never shows « (0 €) ». Any token may also be read as a flag (`{{#if slots}}`).

3. **A property may override `house`, `travelLight`, `parkingLine` and `noWifi`.** An empty override
   falls back to the global text.
4. **An unknown token or flag is refused at save** (422, message « Variable inconnue : {{x}} »),
   never rendered as literal braces. An empty text is allowed and means « no paragraph ».
5. **« Rétablir le texte par défaut »** puts the catalogue's neutral text back for one key and one
   language.
6. **The stored templates of the sequence keep their variables.** For example,
   `{{bedsParagraph}}`, `{{bagList}}`, `{{coffeeParagraph}}` and `{{quietSinceDeparture}}` keep
   their names and flags; only their source changes. A template an operator already edited keeps
   working unchanged. The neutral templates of rule 13 use four new flags, offered to any template:
   `hasBagList`, `hasCoffeeParagraph`, `hasCleaningParagraph` and `hasQuietSinceDeparture`.

### 3.B Option mentions — what the J-7 proposes and the J-2 confirms

7. **A mention is a sentence about one or more options.** It has:
   - a section: « Produits locaux », « À prévoir » or « Enfants »;
   - a proposal text, French and English, with `{{price}}`;
   - a confirmation text, French and English, used once one of its options is booked;
   - the price to quote: either the lowest price among its available options, or the price of one
     chosen option — falling back to the lowest when that option is not available for the property;
   - its options;
   - an order.

   *Mention* refines the answer « phrases on each option »: Solio quotes its 4 juices in one line, at
   the price of the litre, and a per-option phrase could not say that.
8. **A mention is proposed** under three conditions:
   - one of its options is visible and available for the property;
   - none of them is offered by default (included);
   - none is already booked on the stay.

   This is the rule 20 of `guest-email-sequence.md`, unchanged. A « Produits locaux » mention lands in
   `offers.localIntro`, and an « À prévoir » mention in `offers.extrasIntro`. An « Enfants » mention
   is a paragraph of its own and replaces `kidsParagraph`: it is shown when the stay has children
   and one of its options is available, booked or not, as today.
9. **The confirmations have an order of their own** (« Ordre des confirmations », Options citées
   tab). It is independent of the proposal order, because Solio's J-7 proposes the juices first while
   its J-2 confirms breakfast first. The baby cot (`booked.babyBed`) and the towels (`booked.towels`)
   take a place in it like the mentions. `bookedOptionsParagraph` follows it. The migration writes
   today's order: breakfast, baby cot, towels, board, juice, beer, trappers' dinner, animals.
10. **The engine knows no option by name or seed key any more.** `BEER_SEED_KEYS`, the
    `drink_jus_*` / `board_*` prefixes and the « trappeur » / « animation » matches are deleted from
    the core. They exist only in the migration of §3.E, which reads them once.
11. **A resource carries a sentence for once it is booked** (French and English, token `{{slots}}`:
    the slots placed when hourly resources are a live plugin, else empty). It replaces the
    nordic-bath reminder matched on the name. `hasNordicBath` / `nordicBathReminder` stay as
    variables, now true and filled for any booked resource with a sentence, so stored templates
    keep rendering.

### 3.C Neutral seeds for a new database

12. **The catering seed leaves the core.** `cateringSeed.js` is deleted and no boot inserts or
    re-inserts its 14 rows. Existing rows are data and stay.
13. **The guest sequence is seeded with neutral copy** (`guestEmailSequenceTemplates.js` rewritten).
    It contains no place, no product and no facility the product cannot know of. The seed still
    only inserts a missing `stableKey`, so a stored template is never overwritten.
14. **No pool by default.** `poolSeasonStart` / `poolSeasonEnd` default to empty; empty means no
    pool and `stayOverlapsPool` is false. The `06-15` / `08-31` fallback in the code is removed.
15. **The baby-bed supplement is seeded at 0 €.** The other core options (linen, breakfast, cleaning
    tagging, insurance) are product features and stay seeded. Breakfast is seeded with a neutral
    « À prévoir » mention.
16. **The extinguisher check belongs to the SAS plugin and is off by default.**
    - The plugin gains the setting « Contrôle de l'extincteur ». It governs the departure step (the
      only one the dialog has) and the seal fields the server accepts.
    - Its two repair rows are inserted by the plugin when the setting is turned on, never by the core.
    - With the setting off, the SAS shows no extinguisher step and the audit records none.
17. **The unsubscribe page speaks for the company.**
    - The title is « Vos nouvelles de {companyName} » (English « News from {companyName} »), and
      « GuestFlow » when the name is empty.
    - The copy describes the seasonal emails without naming gift vouchers or greetings.
    - The colours come from the product's neutral palette.
18. **The VAPID subject is resolved** in this order: `VAPID_SUBJECT` → the setting `vapidSubject` →
    `mailto:<companyEmail>` → `mailto:<smtpFromEmail>`. If none is set, push stays off and Réglages
    says so in the existing push card. There is no domainesolio fallback.
19. **A platform counts as direct by an attribute, not by its name.**
    - `platforms.countsAsDirect` is always true for `direct`, and editable for the others under
      Paramètres › Plateformes (« Compté comme vente directe »), a core page: the accounting
      plugin's page could not hold it, since a core rule depends on it.
    - `isDirectChannel(name)` keeps its signature and reads a cached set, refreshed on every platform
      save.
    - The « moteur Lodgify » label becomes the platform's name.

### 3.D The start assistant

20. **An admin is sent to the assistant** when `app_settings.onboardingCompletedAt` is empty. This
    happens after the forced password change. Other roles never see it.
21. **Four steps.** Each step saves when « Suivant » is pressed; the server validates every step,
    and an error keeps the step open.
    1. **Entreprise**:
       - name (required);
       - email (required, valid);
       - phone;
       - address;
       - SIRET (14 digits when filled).
    2. **Premier logement**:
       - name (required);
       - double beds and single beds;
       - capacity (1–50), pre-filled with the sleeping places (two per double bed, one per single
         bed); the existing property rule holds: the sleeping places must cover the capacity
         (decided 2026-10-07). _Since 2026-10-23 the server owns that proposal_
         (`utils/defaultCapacity.js`): the field asks `GET /api/onboarding/default-capacity` once the
         beds stop changing for 250 ms, shows the answer while it is the latest one asked, and stops
         following as soon as the capacity is typed by hand. A bed count that is not a whole number
         ≥ 0 counts as no bed; the proposal stays within 1–50. A failed request leaves the field as
         it is, and a property saved without a capacity takes the proposed one;
       - check-in and check-out times;
       - base price per night (≥ 0).

       This creates the property, its standard pricing rule at that price and its arrival/departure
       options, through the existing property creation.
    3. **Plugins**:
       - every plugin the licence allows, with its one-line description;
       - a hosted instance shows the others greyed, with the plan that includes them;
       - « Réservation depuis le site » (`website-booking`) and « Arrivée et départ guidés » (`sas`)
         are ticked by default; labels and descriptions are the catalogue's (`constants/plugins.js`);
       - the ticked ones are installed and activated through the existing plugin endpoints;
       - a failure names the plugin and lets the others go through.

       _Since 2026-10-19 the step asks three questions instead of listing plugins (rule 43)._
    4. **C'est prêt**: three links (Réglages › Emails, Tarifs, Plugins), and « Ouvrir le tableau de
       bord », which records `onboardingCompletedAt`.
22. **« Plus tard »**, on every step, records `onboardingCompletedAt` and leaves; what was saved stays
    (P21). The assistant can be reopened from Réglages › Système (« Assistant de démarrage »).
23. **Mobile:** the assistant is a full-screen page with one step at a time. The step counter sits
    on top, and « Suivant » is full width.

### 3.E Existing databases — Solio sees no difference

24. **A one-shot migration `productisation_v1`** runs on boot, and only on a database that already
    holds properties or reservations, before the sequence emails are rendered. Data written:
    - `onboardingCompletedAt`, set to now;
    - every stay text whose rendering today differs from the neutral default, written with today's
      wording, globally;
    - `house` per property: the Nespresso sentence, plus the « cafetière familiale » variant for
      properties where `hasFilterCoffeeMaker = 1`;
    - one mention per role found among today's options:
      - juice, at the price of `drink_jus_pomme_1l`;
      - beer, at the lowest price;
      - board, « à partir de » the lowest price;
      - trappers' dinner;
      - breakfast;
      - animation, in the « Enfants » section.

      Each mention gets today's proposal and confirmation sentences, in today's order;
    - the nordic-bath sentence on every resource whose name contains « nordique »;
    - `countsAsDirect = 1` on a `lodgify` platform row;
    - `vapidSubject = 'mailto:contact@domainesolio.com'`, unless the environment sets `VAPID_SUBJECT`;
    - the SAS extinguisher setting turned on when the SAS plugin is active.

    The pool season and the stored templates are already data and are left alone.
25. **The migration is idempotent and conservative.** It records itself and never runs twice. It
    writes a text or a mention only where none exists, and never overwrites an operator's value.
26. **Golden test.** The 6 sequence emails, in both languages, are rendered for a Solio-shaped
    fixture across 6 stays: children or not, pool season or not, every option state, direct and
    platform, wifi or not, parking or not. They are rendered once on the current code; the outputs
    are committed as fixtures before the refactor. After the refactor, on the same fixture, the
    migration runs and the outputs must be identical.

### 3.F Account plan as data (accounting plugin)

27. **The account numbers become plugin settings**, with today's values as defaults:
    - the 3 revenue accounts;
    - the 2 output VAT accounts;
    - tourist tax;
    - deductible VAT on commissions;
    - discount;
    - cancellation compensation and tips;
    - the journal code (`VT`).

    `accountPlan.js` keeps the mapping logic and reads the numbers from the settings. The
    per-platform commission accounts already live on `/comptabilite/plateformes` and stay there.
28. **Validation:** an account is 3 to 12 digits, except the client auxiliary prefix, which stays as
    it is; a journal code is 1 to 4 uppercase letters or digits. Two different roles may share an
    account; tips and compensation already do.
29. **The exported CSV is unchanged** for the default values. The layout is named « Format standard
    (CSV) » in the code and the UI, instead of « SOLIO ». Another format, FEC for instance, is out of
    scope.

### 3.G Repository

30. **Solio's private material leaves the product repository** (P20):
    - `integrations/wordpress/solio-site/` moves to a private repository `adn-dev-adrien/solio-site`,
      created by Adrien;
    - `scripts/configure-aventura-lodge-2026.mjs` moves with it;
    - the Solio section of `integrations/wordpress/INSTALL.md` moves with it;
    - the server tests that read `solio-site/mu-plugins` (cited by `site-english-version.md` and
      `site-booking-drawer.md`) move with it;
    - the README's DNS section is rewritten for `example.com`.

    The history keeps the old files: the purge is the separate `refs/pull` item of the inventory.

    *Resolved 2026-10-19:* the private repository exists and the move is done. The folder left with its
    history (`git subtree split`), and the private repository also took the configure script (it now
    loads the server from a GuestFlow checkout named by `GUESTFLOW_ROOT`), the INSTALL section as its
    README's deployment notes, and the tests — seven server files, not six. Four read only the
    mu-plugins and moved whole (`solio-booking-drawer-review`, `solio-english-page-structure`,
    `solio-hero-under-header`, `solio-language-preference`). Three also read the public plugin and were
    split: their site assertions moved, their plugin assertions stayed here —
    `wordpress-plugin-english-strings` and `wordpress-plugin-proxy-language` keep their names, and the
    calendar assertion of `solio-facts-bilingual` became `wordpress-plugin-calendar-locale`. The
    private repository runs them with `node --test`, without dependencies. The site rules whose only
    test left are marked « Sans test » in their specs, pointing at
    the deployment's own repository.

31. **The WordPress plugin** names « GuestFlow » as its author, and its settings placeholder is
    `https://guestflow.example.com`.

32. **A fresh install lists only the platforms it uses** (review of 2026-10-18). The fold of the
    Gîtes de France spellings (`utils/platformMerge.js`) creates its « GitesDeFrance » target only when
    the instance already holds a variant, a reservation on that name or an iCal source of that brand: a
    new instance shows « direct » alone in Paramètres › Plateformes. Solio's rows are folded as before.

33. **After the forced first password change, the login says so** (review of 2026-10-18). The server
    closes the session on that change; the page then opens the login with « Mot de passe modifié.
    Connexion avec le nouveau mot de passe. », the account's email already filled in and the focus on
    the password, instead of an empty login with no message.

34. **The closures page reads on a phone** (review of 2026-10-18). At `xs` its bar keeps a short title
    (« Fermetures ») and a short « Ajouter », and with no closure « Aucune fermeture configurée. » is
    shown as an empty state outside the table, not cut inside its horizontal scroll.

35. **Below 1200 px, Plateformes and Utilisateurs are cards** (review of 2026-10-18). With the side menu
    open, a 900 px screen left « Taxe de séjour », « Virement », « Vente directe », « Dernière
    connexion » and the actions hidden in an unmarked inner scroll; both pages now switch to their card
    layout below `lg` instead of below `md`.

36. **Step « Plugins » shows what matters first** (review of 2026-10-18). The recommended plugins and
    those already active are listed; every other one (Neat, Sowel, the platform intake…) is folded
    under « Pour aller plus loin (N) », closed at first. The server marks them (`more` on each plugin
    of `GET /api/onboarding`); nothing is ticked or unticked by the fold.
    > **Sans test** — superseded on 2026-10-19 by rule 43: the step no longer lists plugins, so there
    > is nothing left to fold; the `more` flag is gone.

37. **Step « Plugins » activates the ticked plugins one after the other** (final display sweep of
    2026-10-18, N-1). On a fresh install the two recommended plugins failed on the first click: the
    second install found the plugin lock still held by the first, whose answer had been sent before
    the lock was released, and the step read « Non activé : Arrivée et départ guidés » with no
    reason. The server now waits for each install to finish — answer sent and lock released —
    before starting the next, and stops trying once an install asks for a restart. Each plugin left
    out comes back with its reason in words (`reason`: « non inclus dans la formule », « activation en
    cours, réessayer dans un instant », or the install's own message), and the step prints
    « Non activé : <nom> (<raison>) ».

38. **The assistant's words are exact** (final display sweep of 2026-10-18, N-2). Step 2 marks « Prix
    par nuit (€) » as required, and the server answers « Prix obligatoire » for an empty price
    (« Prix positif ou nul » stays for a negative one); the fields of step 2 keep a row of space
    between them on a phone. Step 4 is titled « Emails ». The last step's Plugins line is the
    server's count, as a real plural: « Aucun plugin actif », « 1 plugin actif », « 2 plugins
    actifs » (`pluginsSummary`); its links are 44 px tall and their text starts at the top left.

39. **Touch targets and sentence case** (final display sweep of 2026-10-18, n-7 and R-1). On a
    finger-driven screen, the small controls that must stay small on screen — « Détail » and « +
    compl. » in the pricing summary, « Fiche » in the SAS header, a client's name in Planning, À
    venir and the emails list — get an invisible hit area of at least 44 × 44, centred on them,
    without moving the layout. Toggle buttons are in sentence case, like every button, and 44 px
    on both sides under a finger. The « second code » banner puts « Activer » and « Plus tard » on
    one line, under the sentence when the phone is too narrow, instead of breaking « Plus tard ».

40. **A page whose plugin is off says so** (final display sweep of 2026-10-18, n-7). On an instance
    where a plugin is not active, its address (`/comptabilite`, `/resource-planning`,
    `/school-holidays`, `/parametres/paiements`…) showed « Page introuvable ». For an administrator
    it now shows « Plugin inactif » — « Cette page dépend du plugin « <nom> », qui n'est pas
    activé. » — and « Ouvrir Plugins ». The server knows which plugin owns which page
    (`GET /api/plugins/page?path=`), because a release does not ship the pages of a plugin that is
    not installed. Any other address, and every other role, keeps « Page introuvable ».
    _2026-10-18: only while the plugin is off, and on the pages of an installed, disabled plugin
    too — see rule 42._

41. **Settings texts are impersonal and plain** (final display sweep of 2026-10-18, R-3). The
    settings, account and accounting texts lose their « vous / votre / nous » (« Informations sur
    l'activité », « Plateforme → établissement », « Des modifications ne sont pas enregistrées.
    Quitter sans enregistrer ? »…). Technical words leave the main text: « Serveur d'envoi »,
    « Identifiant du serveur » and « Mot de passe du serveur » replace the SMTP labels, and the
    security mode (STARTTLS, TLS) is folded under « Avancé », closed at first; the Qonto help names
    « le portail développeur de Qonto », not a menu path or a header name (its health hints too);
    « Clé Météo-France » drops « API ». « URL de l'API
    GuestFlow » and « Clé d'API » stay, because they are the names of the WordPress fields they
    are pasted into. The guest-facing emails keep their « vous ».
    _Owner action, not code (n-5):_ Solio's stored J-7 subject reads « Plus qu'une semaine avant
    {{propertyName}} », which renders « avant Gite ». The code default is right; the stored subject
    is edited by hand in Réglages › Emails, and no migration rewrites an owner's own text.

42. **« Plugin inactif » is said only of a plugin that is off, on every page it owns** (review of the
    final display sweep, 2026-10-18). Rule 40 had three gaps: the server wrote « n'est pas activé »
    without looking at the plugin's state, so an unknown address under an active plugin's page
    (`/comptabilite/zzz`) read « Plugin inactif »; the page of a plugin installed then disabled is in
    the bundle, so the shell's plugin guard sent the administrator home before the 404 could answer;
    and `/settings/integrations`, a core route behind that same guard, rendered nothing. Now:
    - `GET /api/plugins/page` answers `{ plugins: [], message: null }` as soon as one of the page's
      plugins is active — a page shows while any of its plugins is active — and otherwise names
      every one of them, whether never installed, disabled or failed;
    - for an administrator, a page whose plugin is off renders the 404 in place of the page (the page
      itself is still never mounted, phase 0 rule 18) and the address stays: « Plugin inactif », or
      « Plugins inactifs » for Intégrations with its seven plugins. Every other role keeps phase 0
      rule 19 (home page, or « Mon compte »);
    - step « Plugins » of the assistant passes on the `reload` an install from a package asks for
      (`PUT /api/onboarding/plugins` → `reload: true`), and leaving the assistant then loads the app
      again at the chosen page, so the new plugin's pages are in the bundle.

43. **Step « Plugins » asks three yes/no questions** (UI/UX review 2026-10-18, proposal 13; replaces
    the list of rule 21 step 3 and the fold of rule 36). The owner says what the business does; the
    server maps each « oui » to plugins (`constants/onboardingQuestions.js`):

    | Question | « Oui » turns on | On a fresh instance |
    |---|---|---|
    | « Des options payantes à l'arrivée : repas, linge, sauna ou spa ? » (neutral examples since the 2026-10-27 audit, specs/platform-settings-relay-and-review.md rule 10) | Ressources à l'heure, Linge et blanchisserie, Arrivée et départ guidés (the SAS is where options are sold and paid) | oui |
    | « Un site internet qui prend des réservations ? » | Réservation depuis le site | oui |
    | « Encaisser en ligne, par lien de paiement ? » | Paiement en ligne (Qonto) | non |

    Each question is a switch with one line naming what « oui » turns on (« Active : … », from the
    server), answered as in the table. **A question one of whose plugins is already active is
    settled**: shown on and disabled, with « Déjà actif ; se désactive dans Paramètres › Plugins. »
    (all active) or « Déjà en partie actif ; le reste se règle dans Paramètres › Plugins. » — its
    « oui » would otherwise turn on the others (a SAS-only instance would silently get the hourly
    resources and the linen). A question none of whose plugins the plan includes is off and
    disabled, with the plan chip; the plugins of a partly included question go through for those
    included. The step sends only the questions still open (allowed, not settled):
    `PUT /api/onboarding/plugins { answers: { options?, website?, payment? } }` installs or activates
    the plugins of every `true` to a question that is not settled — the server checks it again and
    ignores the others —, one after the other (rule 37), and a failure is still named (rule 37);
    **a « non » never switches a plugin off** and anything but `true` counts as « non ». A body
    without an `answers` object is refused: 400 `ONBOARDING_ANSWERS_REQUIRED`. Under the questions:
    « Le reste se règle plus tard dans Paramètres › Plugins. » The other plugins (Neat, Google Agenda, Sowel, the intakes,
    the export…) are left to the Plugins page.

44. **On a phone the assistant's primary action sits at the bottom, under the thumb** (integrated review
    of inte/plugins, 2026-10-19, L4 — the SAS rule of UI/UX review 2026-10-18, decision 5, now a
    shared rule: specs/design-system-reference.md §9). Under `sm` the actions of `StepperPage` stack in
    a bar kept at the bottom of the screen (safe area included): « Plus tard » and « Précédent » first,
    neutral, then « Suivant » (or « Ouvrir le tableau de bord ») last, filled and full width. From `sm`
    they stay on one row, right-aligned, the primary one last. *Review of PR #728 (M3):* `sticky`
    alone left a short step's actions mid-screen; under `sm` the card fills the screen (`100dvh`, a
    flex column) and the actions are pushed to its bottom (`margin-top: auto`), still `sticky` for a
    long step, inside the card's 16 px padding.

### 3.H Fixed at the 2026-10-27 audit

45. **A platform counted as direct is a direct sale in every money path.** Rule 19 made
    `countsAsDirect` an attribute; the pricing engine still tested the name `direct` by hand, so such
    a stay was half direct (welcome pack, plan, headline) and half platform (acompte zeroed, extras
    defaulted to the complement, a brut not covering the extras the operator ticked). One helper,
    `utils/saleChannel.js`, now answers for every money path:
    - `ownChannel` (`direct` or counts-as-direct) — a NEW stay takes the acompte and solde on the
      property's schedule like `direct`; no default extras-to-complement; the ledger shows its
      acompte row;
    - `platformSale` (the opposite) — single payout unless the platform takes an acompte, extras
      default to the complement, « Versement » rows;
    - `namedChannel` (anything but `direct`) — a platform amount (brut) and commissions can be
      entered, and the tourist-tax mode is read from the `platforms` row: in mode « owner » the tax
      is collected on arrival, on a counts-as-direct channel too. The engine, the accounting export
      (`collectedOnArrival`) and the arrival SAS recap (`touristTaxInComplementAmount`) all read it
      this way (review of PR #803, 2026-10-27: the engine had moved it to the solde alone).
    **An existing stay keeps its stored schedule** (review of PR #803, 2026-10-27): a saved
    reservation on a counts-as-direct channel whose acompte is neither paid nor disabled nor set by
    hand keeps the acompte it was stored with — 0 for a stay sold as a single payment, paid or not,
    so no acompte (and no overdue acompte deadline) appears on the next recompute, the net stays the
    same, and a past fiche can still be saved under the past-reservation lock; a stored acompte stays,
    even inside the last-minute window. Only a new stay follows the direct rule.
    A counts-as-direct stay whose platform amount is entered settles like a platform one once paid:
    the paid solde follows that amount (reservation-refunds.md rule 40) and no arrival complement is
    asked for the difference. A stay whose single payment is already in (no acompte, solde paid)
    stays a single payment on every later recompute, on every channel. The fiche reads the server's `platformSale` answer instead of
    the platform's name. The bank reconciliation is deliberately left on `namedChannel`
    (qonto-bank-reconciliation.md rule 43: a counts-as-direct engine stay is still paid out by its
    platform, Stripe batch and commission), and so is the ledger's « Versement » row.
46. **Once done, `/demarrage` goes home** (audit 2026-10-27). After `POST /api/onboarding/done` the
    address stayed reachable — typed, bookmarked or reached with « Précédent » — and restarted the
    assistant at step 1. Now `App.jsx` asks `utils/onboardingRoute.js`: the assistant opens while
    onboarding is open (rule 20) or when it was reopened on purpose from Réglages › Système, which
    navigates with the router state `{ reopen: true }` (rule 22); any other visit of `/demarrage` is
    redirected to `/`. Step 1 no longer changes the login implicitly
    (`specs/hosting-h2-account-security.md` rule 37).

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `utils/` | `stayTextCatalogue.js` | C | The keys of rule 2, their tokens and flags, and their neutral defaults in French and English |
| `utils/` | `stayContentContext.js` | T | Chooses the texts and fills the tokens; no wording. Classification by mention instead of role |
| `utils/` | `emailTemplateRenderer.js` | T | Exposes `validateTokens(text, allowed)` for rule 4 |
| `utils/` | `emailContextBuilder.js` | T | Resource sentences instead of the « nordique » match (rule 11) |
| `utils/` | `guestEmailSequenceTemplates.js` | T | Neutral copy (rule 13) |
| `utils/` | `cateringSeed.js` | D | Rule 12 |
| `utils/` | `babyBedSupplementSeed.js` | T | 0 € (rule 15) |
| `utils/` | `platformNameFormat.js` | T | `isDirectChannel` reads the cached `countsAsDirect` set (rule 19) |
| `utils/` | `vapid.js` | T | Rule 18 |
| `utils/` | `productisationMigration.js` | C | Rule 24: the only place that knows Solio's wording, seed keys and option names |
| `models/` | `stayTextsModel.js` | C | `stay_texts`, global and per property |
| `models/` | `emailMentionsModel.js` | C | `email_mentions` + `email_mention_options` |
| `models/` | `stayFactsModel.js` | T | Loads texts, mentions and resource sentences for the context |
| `models/` | `onboardingModel.js` | C | `onboardingCompletedAt`: open or completed |
| `models/` | `resourcesModel.js`, `platformsModel.js`, `settingsModel.js`, `propertiesModel.js` | T | The resource sentence; `countsAsDirect`; `vapidSubject` and `onboardingCompletedAt`; the standard rule at the assistant's price |
| `controllers/` | `resourcesController.js`, `platformsController.js`, `settingsController.js`, `authController.js` | T | `{{slots}}` validation; `countsAsDirect` and the refresh; the VAPID subject after a company save; `onboardingOpen` on `/me` |
| `controllers/` | `pluginsController.js` + `plugins/sdk/createContext.js` | T | A declared setting may carry `afterSave(value)` (rule 16) |
| `scripts/` | `seed-e2e.js` | T | Closes the assistant on the E2E database |
| `controllers/` | `stayTextsController.js` | C | List, save with token validation, reset to default |
| `controllers/` | `emailMentionsController.js` | C | CRUD, both orders, preview |
| `utils/` | `defaultCapacity.js` | C | Rule 21 (2026-10-23) — the capacity the beds propose, within 1–`MAX_CAPACITY` (50) |
| `controllers/` | `onboardingController.js` (`defaultCapacity`, `saveProperty`) | T | Rule 21 (2026-10-23) — answers the proposal; fills a missing capacity on save |
| `controllers/` | `onboardingController.js` | C | State, the 4 steps, « Plus tard »; the plugins one after the other with their reason and the active count (rules 37–38) |
| `constants/` | `plugins.js` | T | `PLUGIN_PAGES` / `pluginsOfPage(path)`: which plugin owns which page (rule 40) |
| `controllers/` | `pluginsController.js` (`pageOwner`), `routes/plugins.js` | T | `GET /api/plugins/page` (rule 40); names nobody once one of the page's plugins is active (rule 42) |
| `controllers/` | `onboardingController.js` (`savePlugins`) | T | Installs one after the other (rule 37); passes on an install's `reload` (rule 42) |
| `constants/` | `onboardingQuestions.js` | C | Rule 43 — the three questions, the plugins each « oui » turns on, the fresh-instance answer |
| `controllers/` | `onboardingController.js` | T | Rule 43 — `questions` in `GET /api/onboarding`; `savePlugins` maps the answers to plugins; the `more` flag of rule 36 removed |
| `controllers/public/` | `emailPreferencesController.js` | T | Company name, neutral copy (rule 17) |
| `routes/` | `stayTexts.js`, `emailMentions.js`, `onboarding.js` | C | Thin |
| `database.js`, `schema.sql` | — | T | New tables and columns; empty pool defaults; the migration call; catering seed and extinguisher rows removed |
| `plugins/sas/` | `index.js`, `settings.js` (C), `controller.js`, `billablesController.js` | T | Extinguisher setting, its repair rows, the seal fields refused while off (rule 16) |
| `plugins/accounting-export/` | `accountPlan.js`, `settings.js`, `accountingExport.js`, `accountingModel.js`, `platformAccountsModel.js`, `controller.js` | T | Rules 27–29: `planMapper` turns the engine's default numbers into the plan's when the rows are produced |
| `middleware/` | `enforceRoleAccess.js` | T | The new routes are admin-only |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `OnboardingPage.jsx` | C | The 4 steps; full screen on `xs` |
| `pages/` | `OnboardingPage.jsx` | T | Rule 21 (2026-10-23) — the capacity comes from the server, debounced, a late answer dropped; no formula in React |
| `pages/settings/` | `EmailTextsSettingsPage.jsx` | C | Réglages › Emails › « Textes des mails »: stay texts by email, mentions, live preview |
| `components/` | `TokenTextField.jsx` | C | **Generic**: a FR/EN text field with its token chips, insertion at the cursor, the server's refusal shown inline. The email template editor can adopt it later |
| `components/` | `MentionEditor.jsx` | C | Specific: one mention, its options and its price source |
| `components/` | `StepperPage.jsx` | C | **Generic**: a page-level stepper with the counter, « Plus tard », « Précédent » / « Suivant ». Reusable for any guided flow |
| `components/property/` | `PropertyStayTexts.jsx` | C | Specific: « Textes propres à ce logement », saved text by text. _Superseded by #693 (`specs/guest-email-texts-made-simple.md`): the file was deleted; the per-property facts live in `PropertyArrivalFacts.jsx`._ |
| `pages/settings/` | `SystemSettingsPage.jsx` | T | « Assistant de démarrage » reopens `/demarrage` (with the router state `{ reopen: true }` since rule 46) |
| `components/` | `SettingsPushNotificationsSection.jsx` | T | Says when no address can sign push (rule 18) |
| `plugins/sas/` | `ExtinguisherCheckCard.jsx` | C | The switch, in the « Facturables au SAS » tab |
| `plugins/accounting-export/` | `PlatformAccountsPage.jsx` | T | The « Comptes » section |
| `components/` | `SettingsEmailContentSection.jsx` | T | Pool season may be empty; a link to « Textes des mails » |
| `components/property/` | `PropertyStayTab.jsx` | T | « Cafetière familiale » replaced by `PropertyStayTexts` (rule 3) — itself replaced by `PropertyArrivalFacts` in #693 |
| `components/` | `PlatformPriceCard.jsx` | T | Rule 19 label |
| `pages/` | Resource form (`ResourcesPage`) | T | « Phrase dans les mails une fois réservée » (rule 11) |
| `pages/settings/` | `PlatformsSettingsPage.jsx` | T | « Compté comme vente directe » |
| `plugins/accounting-export/` | settings section | T | « Plan comptable » (rules 27–28) |
| `plugins/sas/` | settings + `ReservationSasDialog.jsx` | T | Rule 16 |
| `App.jsx` | — | T | Redirects an admin to `/demarrage` while onboarding is open (rule 20), and `/demarrage` home once it is done unless reopened on purpose (rule 46, `utils/onboardingRoute.js`); a page whose plugin is off renders `NotFoundPage` for an administrator instead of sending home (rule 42) |
| `pages/` | `OnboardingPage.jsx` | T | Leaving after an install that asked for `reload` loads the app again (rule 42) |
| `pages/` | `OnboardingPage.jsx` | T | Rule 43 — step 3 is three switches (MUI `Switch` rows in one bordered list) with their « Active : … » line |
| `components/` | `NotFoundPage.jsx` | C | **Generic**: the app's 404, or « Plugin inactif » for a plugin's page (rule 40) |
| `components/` | `AdvancedDetails.jsx` | C | **Generic**: a folded « Avancé » block for the technical names a setting needs (rule 41) |
| `utils/` | `touchHitArea.js` + `theme.js` | C/T | The 44 px hit area of a small control; link-buttons and toggles in the theme (rule 39) |
| `components/` | `TwoFactorNudgeCard.jsx`, `PricingSummary.jsx`, `ReadinessList.jsx` | T | Rule 39 |
| settings, account, accounting, linen, Google Agenda, Qonto, Météo-France texts | — | T | Rule 41 |

Reused: `PageActionBar`, `FormDialog`, `ConfirmDialog`, `HelpedTextField`, `StatusBadge`, `ErrorAlert`,
`LoadingState`.

### 4.3 API contract

| Method | Path | Body / answer |
|---|---|---|
| GET | `/api/stay-texts?propertyId=` | `[{ key, email, tokens, flags, fr, en, defaultFr, defaultEn, isDefault, overridable }]` |
| PUT | `/api/stay-texts/:key` | `{ fr, en, propertyId? }` → 200 or 422 `{ field, message }` |
| DELETE | `/api/stay-texts/:key?propertyId=&lang=` | back to default, or to the global text for a property |
| GET / POST / PUT / DELETE | `/api/email-mentions[/:id]` | `{ section, offerFr, offerEn, bookedFr, bookedEn, priceSource, priceOptionId, optionIds }`; GET answers `{ mentions, confirmationOrder }` |
| PUT | `/api/email-mentions/order` | `{ ids }`, every mention: the proposal order |
| PUT | `/api/email-mentions/confirmation-order` | `{ items }` of `mention:<id>`, `babyBed`, `towels` (rule 9) |
| POST | `/api/email-mentions/preview` | `{ propertyId, children, startDate }` → `{ fr, en }`: the J-7 offers paragraph and the J-2 confirmations, rendered by the server |
| GET | `/api/onboarding` | `{ open, company, plugins: [{ id, label, description, allowed, plan, state, recommended }] }` |
| GET | `/api/onboarding/default-capacity?doubleBeds=&singleBeds=` | `{ maxGuests }` — rule 21 (2026-10-23); never refuses, any count it cannot read counts as no bed |
| PUT | `/api/onboarding/company`, `/api/onboarding/property` | Validated writes; 422 `{ errors }` per field; 402 when the plan's unit quota is reached; a property without `maxGuests` takes the proposed capacity (rule 21, 2026-10-23) |
| PUT | `/api/onboarding/plugins` | `{ answers: { options?, website?, payment? } }` (rule 43; was `{ ids }`; 400 `ONBOARDING_ANSWERS_REQUIRED` without it; `GET` questions carry `settled`) → `{ results: [{ id, ok, error, reason }], pluginsSummary, reload }` (`reload`: rule 42), each through the existing install or activate handler, one after the other (rule 37); `GET /api/onboarding` gains `pluginsSummary` (rule 38) |
| GET | `/api/plugins/page?path=` | `{ plugins: [{ id, name, state }], message }`; `{ plugins: [], message: null }` for a core or unknown page, or once one of the page's plugins is active (rules 40, 42) |
| GET | `/api/auth/me` | gains `onboardingOpen` (admins only) |
| GET / PUT | `/api/platforms/settings` | each row gains `countsAsDirect` |
| GET / PUT | `/api/accounting/platform-accounts` | gains `plan: [{ key, value, default }]`; PUT takes `plan: { key: value }` |
| POST | `/api/onboarding/done` | Records `onboardingCompletedAt` |

**Integrated review of inte/plugins (2026-10-19)** — rule 44: `components/StepperPage.jsx` — the action stack
is a bottom-sticky bar under `sm`, primary last.

**Audit 2026-10-27 (rule 45).** New `utils/saleChannel.js` (`saleChannel`, `isNamedChannel`) —
the one reading of a channel for money. Consumers: `utils/pricing.js` (extras routing, brut pin,
tax on arrival, acompte branch, commissions, paid-solde rule, `platformSale` in the quote),
`utils/reservationLedger.js` (acompte « Sans objet » only on a platform sale; the « Versement »
row and the commissions stay on `namedChannel`), `models/reservationsModel.js`
(`touristTaxInComplementAmount` via `isNamedChannel`). Client: `ReservationPage.jsx` exposes `isPlatformSale` (the quote's answer) in
the form context; `PricingSummary`, `FinanceSection`, `ExtrasSection` and `OptionRow` read it.

## 5. Data model

- **`stay_texts`** `(key TEXT, propertyId INTEGER NOT NULL DEFAULT 0, fr TEXT, en TEXT, updatedAt)`,
  primary key `(key, propertyId)`; `propertyId` 0 is the global text. No row means the catalogue
  default; a NULL language means « never edited » for that language, '' means « no paragraph ».
  Created with the sequence schema (`utils/guestEmailSequenceSchema.js`), so test databases get it.
- **`email_mentions`** `(id, section TEXT CHECK IN ('local','extras','kids'), offerFr, offerEn,
  bookedFr, bookedEn, priceSource TEXT CHECK IN ('min','option'), priceOptionId NULL, sortOrder)`.
- **`email_mention_options`** `(mentionId, optionId)`, primary key on both, with cascade.
- **`app_settings.bookedConfirmationOrder`**: a JSON array of `mention:<id>`, `babyBed` and `towels`
  (rule 9). A mention missing from it goes last, in mention order.
- **New columns:**
  - `resources.emailBookedText`, `resources.emailBookedTextEn`;
  - `platforms.countsAsDirect INTEGER DEFAULT 0`;
  - `app_settings.onboardingCompletedAt`, `app_settings.vapidSubject`;
  - the `productisation_v1` marker is a row in `migrations`, like every one-shot migration.
- **Changed defaults:**
  - `app_settings.poolSeasonStart` / `poolSeasonEnd`: the schema default becomes empty for new
    rows. The existing row keeps its value.
  - `properties.hasFilterCoffeeMaker` is no longer read. The column stays, because SQLite cannot drop
    it safely on old versions.
- **No data is lost.** Catering rows, stored templates, repair rows and the pool season stay. The
  migration only adds rows.

## 6. UI / UX

- **Assistant, step « Plugins » (rule 43)** — the validated rendering is mock 5 of the UI/UX review
  (`docs/rapports/2026-10-18-ui-ux-review.html#settings-m5`, the « Ce qui sera proposé » card): three
  rows in one bordered list, question in bold, « Active : … » below in caption, the switch at the
  right (whole row is the label, ≥ 56 px tall). Same on mobile, the question wrapping on two lines.
- **Réglages › Emails & notifications** gains « Textes des mails », with three tabs:
  - **Par mail**: the stay texts grouped by email, French and English side by side on `md+` and
    stacked on `xs`, with token chips and « Rétablir »;
  - **Options citées**: the mentions by section, reorderable, each with its options, its price
    source and its two texts, then the confirmation order (rule 9);
  - **Aperçu**: a sample stay (property, children, date) and the paragraphs as the guest will read
    them.

  Every text is impersonal on the admin side; the guest copy keeps the « vous » of the emails.
- **Review of 2026-10-18:** the forced password change ends on the login with its notice and the
  email filled in (rule 33); « Fermetures » keeps a short title and an empty state on a phone (rule 34);
  Plateformes and Utilisateurs are cards below 1200 px (rule 35); step « Plugins » folds the extra
  plugins under « Pour aller plus loin (N) » (rule 36).
- **Final display sweep of 2026-10-18:** the recommended plugins activate on the first click, and a
  plugin left out is named with its reason (rule 37); « Prix par nuit » is required, step 4 is
  « Emails », the last step reads « 2 plugins actifs » (rule 38); 44 px hit areas, sentence-case
  toggles and the « second code » banner on one line (rule 39); « Plugin inactif » instead of « Page
  introuvable » (rule 40); impersonal settings texts, protocol names under « Avancé » (rule 41).
  On a phone (390 px) the price helper keeps its own row and « Plus tard » stays on one line.
- **Review of the sweep, 2026-10-18:** « Plugin inactif » only while the plugin is off, also for an
  installed, disabled plugin and for Intégrations; the administrator stays on the address (rule 42).
- **Logement › Séjour:** « Textes propres à ce logement » holds the overridable keys, each empty by
  default with the global text shown as placeholder.
- **Ressource:** « Phrase dans les mails une fois réservée » (FR/EN, `{{slots}}` chip).
- **Assistant:** `/demarrage`, outside the side menu, with the GuestFlow wordmark, one step per
  screen and the counter « Étape 2 sur 4 ».
- **SAS plugin settings:** a switch « Contrôle de l'extincteur ».
- **Paramètres › Plateformes:** a switch « Compté comme vente directe » per platform; it is
  locked on for `direct`.
- **Comptabilité › Plan comptable** (plugin settings): one field per account, with its role as the
  label and the default as the helper text.

## 7. Test plan

### Server unit tests

| File | Tests | Rules |
|---|---|---|
| `productisation-golden.unit.test.js` | 1 (72 renderings) | 26 — 6 emails × 2 languages × 6 stays, byte-identical; captured before the refactor, with the option-metadata fix of #671 |
| `stay-texts.unit.test.js` | 7 | 1–6 |
| `email-mentions.unit.test.js` | 8 | 7–11 |
| `neutral-seeds.unit.test.js` | 5 | 12–17, on a new database booted by `database.js` |
| `vapid-subject.unit.test.js` | 2 | 18 |
| `platform-counts-as-direct.unit.test.js` | 4 | 19 |
| `onboarding.unit.test.js` | 5 | 20–22 |
| `productisation-migration.unit.test.js` | 6 | 24–25 |
| `plugins/accounting-export/tests/account-plan-settings.unit.test.js` | 5 | 27–29 |
| `plugins/sas/tests/sas-extinguisher-setting.unit.test.js` | 3 | 16 |
| `repository-no-deployment-material.unit.test.js` | 3 | 30 — the folder, the script and the INSTALL section are absent, and no server test reads `solio-site` |
| `wordpress-plugin-neutral.unit.test.js` | 2 | 31 |

Suites that checked Solio's wording read it from `tests/solioWordingFixture.js`, built from the same
constants as the migration; the tests that assume Lodgify is a direct channel set it as the migration
does.

### Client (Vitest)

`TokenTextField` (2), `MentionEditor` (2), `EmailTextsSettingsPage` (3), `OnboardingPage` (4),
`PropertyStayTexts` (1), `ReservationSasDialog.extinguisher-off` (1),
`PlatformsSettingsPage.counts-as-direct` (1), `PlatformAccountsPage.account-plan` (2).

Review of 2026-10-18 (rules 32–36): server `platform-seed-neutral` (rule 32),
`onboarding-plugins-fold` (1, rule 36); client `ForcedPasswordChangePage.login-notice` (1, rule 33),
`EstablishmentClosuresPage.mobile-empty` (1, rule 34), `PlatformsSettingsPage.tablet-cards` (1) and
`UserManagementPage.tablet-cards` (2, rule 35), `OnboardingPage.plugins-fold` (1, rule 36).

Final display sweep of 2026-10-18 (rules 37–41): server `onboarding-plugins-sequential` (5, rules
37–38), `plugin-page-owner` (3, rule 40), `onboarding` (2 updated); client
`OnboardingPage.plugins-reason` (3, rules 37–38), `NotFoundPage.plugin-inactive` (3, rule 40),
`touchHitArea.theme` (2, rule 39), `SettingsSmtpSection.plain-words` (1, rule 41), and the
suites whose texts changed (rule 41).

Review of the sweep, 2026-10-18 (rule 42): server `plugin-page-owner` (+2) and
`onboarding-plugins-sequential` (+1); client `OnboardingPage.plugins-reload` (2); E2E
`plugins/online-payment.spec.js` (« Plugin inactif » at `/parametres/paiements` once switched off)
and `auth/not-found.spec.js` (+1, `/comptabilite/zzz` with the plugin active).

UI/UX review 2026-10-19 (rule 43): server `onboarding-questions` (6: settled questions, a « oui »
to a settled one installs nothing, 400 without answers), `onboarding` and
`onboarding-plugins-sequential` updated to the answers; `onboarding-plugins-fold` removed (rule 36
superseded); client `OnboardingPage.questions` (3, a settled question disabled and not sent), `OnboardingPage` updated, `OnboardingPage.plugins-fold`
removed.

Capacity proposed by the server, 2026-10-23 (rule 21): server `onboarding-default-capacity` (6:
the formula on numbers and strings, empty/negative/decimal/text/array counts, the 1–50 bounds, the
endpoint, a missing capacity filled on save, a typed one kept and validated); client
`OnboardingPage.default-capacity` (4: the server value shown after the debounce, a late answer
dropped, a failure leaves the field editable, typed by hand stops following) with
`onboardingCapacityFixtures.jsx`; `OnboardingPage` updated to the server value.

Audit 2026-10-27 (rule 46): client `onboardingRoute.done-redirect` (4: open → assistant, done →
home, reopened from Réglages › Système → assistant, other pages untouched). `PropertyStayTexts` (1)
above was deleted with its component in #693.

### E2E

`e2e/specs/onboarding/onboarding.spec.js` (2): the four steps with a refused step, ending on the
dashboard with the property at its price; the mobile layout and « Plus tard ». The E2E database is
shared by every spec, so the spec reopens the assistant instead of starting from an empty database;
the forced password change is covered by the auth specs. `seed-e2e.js` closes the assistant for the
rest of the suite, and `option-categories.spec.js` seeds the catering catalogue it needs.

### Manual UI verification

- A copy of the production database: the six emails previewed for a real reservation of each
  property, identical to their preview before the upgrade.
- An empty database: the assistant end to end at 375 px and 1280 px, and a J-7 preview with neutral
  texts.
- « Textes des mails »: an unknown token is refused, and an override shows up in the preview.

**Integrated review of inte/plugins (2026-10-19)** — rule 44: `components/__tests__/StepperPage.phone-actions.test.jsx` (1: order and variants);
the onboarding suites keep passing unchanged.

**Audit 2026-10-27:** `tests/sale-channel-counts-as-direct.unit.test.js` (6, rule 45);
`tests/counts-as-direct-keeps-stored-schedule.unit.test.js` (5, rule 45: single payment kept, net
kept, stored acompte kept, new stay direct, past fiche saved);
`tests/counts-as-direct-tourist-tax-routing.unit.test.js` (3, rule 45: engine = export = SAS);
`client/src/components/__tests__/PricingSummary.counts-as-direct.test.jsx` (2, rule 45).

## 8. Out of scope

- **The platform list and colours, read from the `platforms` table** (inventory §7). The built-in
  list is the French market's and contains nothing of Solio.
- **One source for `Europe/Paris`**: the French market only was decided on 2026-09-28.
- **Another accounting export format** (FEC).
- **Comments in the code that mention Solio or Adrien**: they ship no content.
- The demo instance, the help centre, and the purge of `refs/pull/*`.

## 9. Open questions (put to Adrien in the summary)

All resolved; the recommended option was taken each time.

- **P18** — Solio's texts by migration on existing databases: **decided 2026-10-06**.
- **P19** — Email phrases on the options: **decided 2026-10-06**. **P19 bis, decided 2026-10-07**: a
  mention may cover several options (rule 7), as Solio's single line for the four juices needs.
- **P20** — **Decided 2026-10-07**: Solio's WordPress site moves to a private repository
  `solio-site`, which Adrien creates. **Done 2026-10-19** (rule 30).
- **P21** — **Decided 2026-10-07**: « Plus tard » is allowed at every step of the assistant.
- **P22** — **Decided 2026-10-07**: neutral seeds keep linen, breakfast, cleaning, insurance and
  baby bed.
