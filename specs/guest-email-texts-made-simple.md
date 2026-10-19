# Guest email texts made simple — one page in send order, live preview, arrival facts, one file

| Field | Value |
|---|---|
| **Status** | Implemented (2026-10-08) |
| **Branch** | `feature/email-texts-made-simple` (from `inte/plugins`) |
| **Created** | 2026-10-08 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Parent** | [`specs/plugins-phase-p-productisation.md`](plugins-phase-p-productisation.md) — texts as data (stay texts, mentions) |
| **Summary for review** | [`docs/specs/2026-10-08-guest-email-texts-made-simple.html`](../docs/specs/2026-10-08-guest-email-texts-made-simple.html) |

---

## 1. Context

Phase P made every sentence of the guest emails data. Writing them is still hard for a new customer.
Measured on `inte/plugins` at 4a5a66ae:

- **Text is typed in five places.**
  - Email templates (`EmailTemplatesPage.jsx`, raw textarea).
  - Stay texts (`settings/EmailTextsSettingsPage.jsx`, 30 keys × FR/EN).
  - Per-property overrides (`PropertyStayTexts.jsx`).
  - The per-property hook, reachable only from inside the J-7 template dialog (`PropertyHooksEditor.jsx`).
  - Mentions (`MentionEditor.jsx`).
- **The variable chips are a client constant.** `VARIABLE_BUTTONS` has about 30 tokens. The sequence
  templates use about 40 more that have no chip.
- **The two editors disagree on bad tokens.** An unknown token is dropped silently in a template but
  refused with a 422 in a stay text.
- **A full email is previewed only in the manual send dialog**, and only as saved. No preview while
  editing, no test send.
- **The neutral J-2 has no address, no way in, no Wi-Fi.** No property field holds them. A new
  customer's arrival email says nothing practical.
- **Empty settings leak into sentences.** An empty company phone renders « appelez-nous au . ».

**Competitors (research 2026-10-08):**

| Product | What they do | What GuestFlow takes from it |
|---|---|---|
| Smoobu, Superhote, Hostfully, Amenitiz | Working default messages on day one | Same |
| Lodgify | Filled once per property: arrival, door, Wi-Fi, rules | Same |
| Elloha | No variable syntax; split screen with a live preview | Same |
| Hospitable | Preview on a real reservation | Same |
| Guesty | Per-add-on sentences through conditions | GuestFlow's mentions already do more |

No competitor documents a file import/export of its texts, a test send or an automatic translation of
templates.

## 2. Goal

A new owner fills a few facts per property and gets complete, correct emails without writing anything.
Changing a sentence happens on one page, in the order the guest receives the emails, with the real
email shown beside the text. The whole wording can also go out and come back as one spreadsheet file.

## 3. Functional rules

### 3.A Arrival facts per property

1. Each property has arrival facts:
   - address (one line);
   - map link (optional; built from the address when empty);
   - how to get in, as free text FR/EN;
   - the key-box or door code (optional);
   - Wi-Fi network and Wi-Fi password (optional).
2. The code and the Wi-Fi password are secrets. They are stored encrypted (`ENCRYPTED_COLUMNS` rule of
   CLAUDE.md §8) and never logged. They are shown masked in the property form (`MaskedTextField`).
3. The server composes three paragraphs from these facts: `addressParagraph`, `accessParagraph`,
   `wifiParagraph`. Each is FR/EN, from new stay-text keys with neutral defaults. A paragraph whose
   facts are empty is omitted.
4. The neutral J-2 places these paragraphs. **A database migrated by phase P (Solio) keeps its J-2
   unchanged.** Its stay texts already say all this, and its properties have no arrival facts, so the
   paragraphs are empty.
5. When a property declares a gate code through the `gate-access` plugin, the access paragraph does not
   repeat it.

   *2026-10-08:* the stay-text keys are those named in rule 3; in the templates the paragraphs are the
   variables `addressParagraph`, `accessParagraph` and `arrivalWifiParagraph` (with `has…` flags), because
   `wifiParagraph` already means « pas de wifi » in Solio's stored J-7. The map link, when not typed, is a
   Google Maps search on the address. A gate code is « declared » when the stay's `hasGateAccess` flag is
   true (the plugin is live and the stay has a key): the access paragraph then drops the key-box code and
   keeps the free text. An empty English « accès » sends the French (rule 14).

   *2026-10-17:* a property without an address of its own takes the company's (Paramètres ›
   Établissement): in `addressParagraph`, and in `{{propertyAddress}}`, which until now always rendered
   empty. No stored template of Solio uses either, so its emails do not move.

### 3.B Missing facts are computed, not guessed

6. `GET /api/email-readiness` lists what would render badly, per email and per property, with a link
   target for each item. It checks:
   - company name, company phone, sender name;
   - the property's article (never confirmed);
   - address and access missing on a property that has a future stay;
   - a mention or a stay text with FR but no EN;
   - an unknown token in a stored template.
7. The page « Textes des emails » opens on this list when it is not empty. The onboarding wizard shows
   it on its last step. The dashboard shows one alert « Emails incomplets » while an item concerns a
   stay in the next 14 days.
   > **2026-10-18 (code review m6):** the alert reads `GET /api/email-readiness`, an admin route: the
   > dashboard loads it for an admin only, so an accountant's dashboard no longer gets a 403.
8. A sentence that depends on an empty setting is omitted, never printed with a hole. This covers the
   company phone, the Google review link and Instagram.

   *2026-10-08:* « never confirmed » is the new column `properties.nameArticleConfirmed`. Every property
   that exists when the column is added counts as confirmed (it was saved through its form); afterwards a
   property is confirmed when a form sends its `nameArticle` — so only a property created by the
   assistant without a choice is listed. « Sender name » is missing when neither the sender name nor the
   company name is set. Each item carries a router target (`path`, `search`, `hash`). For the phone, the
   neutral templates (fresh databases only) wrap the sentence in the new flag `hasCompanyPhone`; the
   review and Instagram sentences were already conditional.

   *2026-10-17 (rule 6, review of PR #693):* ask the least configuration possible. A fact is listed only
   when a stored, enabled template uses it: the address when one uses `addressParagraph`,
   `hasAddressParagraph` or `propertyAddress` (and the company has no address either); the access when
   one uses `accessParagraph` / `hasAccessParagraph`; the Wi-Fi (new check) when one uses
   `arrivalWifiParagraph` / `hasArrivalWifiParagraph` and the property has Wi-Fi; the phone only when a
   template prints `{{companyPhone}}` outside a `{{#if hasCompanyPhone}}` block; the company name and the
   sender name only when a template names them. Solio's J-2 writes its address by hand, so Solio gets no
   item and no dashboard alert; a new instance's neutral J-2 keeps every check. A French without English
   is listed only for a sentence a template places (rule 25), and counts for the dashboard only when a
   stay within 14 days is written to in English.

   *2026-10-17 bis:* when a template places the address and a property has none of its own while the
   company has one, the list says so once, never as urgent and never on the dashboard: « Adresse —
   <logement> : celle de l'entreprise est utilisée », linked to the property, so a company domiciled
   elsewhere notices. Solio's templates never place the address, so its list stays empty.

### 3.C One page, in send order

9. Paramètres › « Textes des emails » becomes the single editing page. It shows one section per email,
   in send order:
   1. Confirmation;
   2. Demande d'acompte / de solde;
   3. J-7;
   4. J-2;
   5. Lendemain du départ;
   6. Relances novembre / janvier;
   7. Annulation.

   Each section shows only the sentences of that email: stay texts, mentions, the per-property hook,
   and the subject. The raw template body is behind « Modifier le modèle complet ».
10. Variables are inserted by clicking chips. The chip list comes from the server per template
    (`GET /api/email-templates/:id/variables`), with a French label for each token, so every token used
    by a template has a chip. The text shows a chip as its label (« Prénom du voyageur »), not as
    `{{firstName}}`.
11. Templates, stay texts and mentions share one validation. An unknown token is refused with the same
    422 and the same message everywhere.

    *2026-10-17:* a subject line offers only the variables of every email (guest, property, company)
    and those it already uses — no paragraph, no condition; the full list made the field unreadable.

    *2026-10-08:* the validator also refuses a `{{…}}` whose name is not a plain identifier (a space, an
    accent): the renderer would have left it as literal braces. A template validates against the whole
    catalogue plus every registered plugin's names; the chips are scoped to its email.

    *2026-10-17:* a known variable used where it means nothing is refused by its label (« Variable non
    disponible ici : Prix »); only a name nobody knows is shown raw. A subject line offers only the
    variables of every email and those it already uses.
12. The former entry points stay as links to the right section of the page: the template list, the J-7
    property-hook dialog and the property's « Textes » block.

    *2026-10-08:* the template list answers each row's `textsSection`; a shipped template's dialog links to
    it (the J-7's « Accroche par logement » editor is replaced by that link). The property's Séjour tab
    keeps a « Textes » card linking to `?propertyId=<id>#j7`, and its « Arrivée » block links to `#j2`. The
    hook endpoints `/api/properties/email-hooks` stay (specs/settings-rationalization.md rule 17c); the
    page writes hooks through `PUT /api/email-texts`.

### 3.D Live preview and test send

13. Beside the text (below it on mobile), the full email is rendered by the server, debounced, from the
    draft being typed: `POST /api/emails/preview` with `{ templateId, draft, reservationId?, language }`.
    The default reservation is the next upcoming stay that receives this email. A selector picks another
    one, or « Exemple » (a sample stay).
14. Language FR/EN is a toggle on the preview. An empty EN text falls back to the FR text, and the
    preview says so (« Texte anglais manquant : le français sera envoyé »).
15. « M'envoyer un test » sends the previewed email to the company address. The subject is prefixed
    « [Test] ». Nothing is recorded in the email history or on the reservation.

    *2026-10-08:* the draft is written inside a database transaction that is always rolled back, so the
    preview runs the real send path on the data as it would be saved, and nothing persists; « Exemple » is
    a sample stay (Camille Exemple, 2 adults, 3 nights from today + 9) inserted the same way. The stays
    offered are those that receive the email: upcoming for the stay emails, ending from yesterday for the
    J+1, past for the season emails, cancelled for the cancellation notice. The email is shown as the
    plain text it is sent as, not in an iframe. Rule 14's fallback cannot change how stored texts render:
    Solio's golden fixture holds a French hook without English, which has always been left out of the
    English email. So an empty English template or « accès » sends the French (« le français sera
    envoyé »), and any other sentence without its English is absent from the English email, which the
    preview says (« Texte anglais manquant : phrase absente de l'email anglais ») and the readiness list
    reports. The company address is `companyEmail`, else the sender address; without either the test is
    refused, naming Paramètres › Établissement.

    *2026-10-17:* the test goes through the account mailer of specs/hosting-h2-account-security.md, so a
    development instance with `GUESTFLOW_MAIL_OUTBOX` writes it to the mail catcher instead of SMTP. The
    preview renders again after every save or import.

### 3.E One file out, one file in

16. « Exporter les textes » downloads one CSV (UTF-8 with BOM, `;` separator, opens directly in Excel and
    LibreOffice). There is one row per text. Columns: `email`, `clé`, `description`, `français`,
    `english`, `texte par défaut (FR)`. The file covers subjects, stay texts, mentions (offer and
    confirmation), property hooks and arrival free texts. Secrets are never exported.
17. « Importer » reads the same file back. It applies in one transaction and shows the changes before
    they are saved: « 12 textes modifiés, 0 refusé ». A row whose key is unknown, or whose text holds an
    unknown token, is refused with its line number, and nothing is saved until the owner confirms. An
    empty cell means « garder le texte actuel ». The literal `-` means « vider ».
18. The parser and the one-transaction import reuse the translation catalogue's mechanism
    (`utils/translationCsv.js`, `specs/translation-catalogue.md`).

    *2026-10-08:* the `clé` column holds one key space, shared with the page and the preview draft:
    `subject:<stableKey>`, `text:<key>`, `text:<key>@<propertyId>`, `mention:<id>:offer|booked`,
    `hook:<propertyId>`, `access:<propertyId>`. The line number is the spreadsheet row (header = 1), not
    the text line a multi-line cell would shift. At confirmation the accepted rows are written in one
    transaction and the refused ones are ignored (summary: « N textes modifiés, M refusés »). A key listed
    twice is refused on its second row; a subject cannot be emptied.

    *2026-10-17 (rule 17):* the summary shows both languages of each changed row as they will read once
    saved, the changed one in bold.

### 3.F English without retyping

19. « Traduire les textes manquants » fills every empty EN field from its FR text through the
    translation service. Tokens are protected from translation. Each filled field is marked « traduit
    automatiquement, à relire » until it is edited or confirmed.
20. The service key is the platform's (`GUESTFLOW_TRANSLATE_API_KEY`, set by the operator), never the
    owner's. Without it, the button is not shown and nothing else changes.

    *2026-10-08:* the service is the Anthropic Messages API (`claude-sonnet-5-5`), called with plain
    `fetch`, structured output, 40 texts per request. Every `{{…}}` becomes a numbered marker before
    sending; a marker missing, repeated or invented fails the whole run, and nothing is written until every
    text came back. The marks live in `stay_text_flags`, keyed by the text key; « Relu » clears one.

    *2026-10-17:* each request gives up after 30 seconds. A text whose variables did not all come back
    is skipped and counted (« N à traduire à la main »), never written; a failed call still writes
    nothing. « Accès » is never sent to the service: it may hold a code.

### 3.G Onboarding

21. The wizard gains a step « Vos emails », before « C'est prêt ». It asks for:
    - the company phone and the sender name, pre-filled from step 1 when known;
    - the property's article, shown as a choice: « au gîte », « à la maison », « dans le chalet »…;
    - the property's address, how to get in, and the Wi-Fi.

    Then it shows the J-2 preview of a sample stay. Every field can be skipped.

    *2026-10-08:* the article choices are the five articles a property accepts (« au », « à la »,
    « à l' », « aux », « à »), each shown with the property's name by the server; « dans le » is not one of
    them. The assistant now has five steps, and « C'est prêt » shows the readiness list.

    *2026-10-17:* every property gets its block, not only the first; a property without Wi-Fi is not
    asked for one. The address is offered from the company address typed at step 1; left as offered it
    is not copied onto the property, so it keeps following the company's.

**Edge cases:**
- Import with a different column order, or Excel's `,` separator → detected from the header row.
- Import of a file exported before a key was renamed → that row is refused, with its line number.
- A test send while SMTP is not configured → a refusal naming Paramètres › Emails, nothing queued.
- No upcoming stay → the preview uses « Exemple ».
- The translation service fails → the fields stay empty and one message is shown. No partial
  half-marked state.

### 3.H Review of 2026-10-17 (PR #693)

22. **A text never turns into a formula.** A cell starting with `=`, `+`, `-` or `@` is exported behind an
    apostrophe, which Excel and LibreOffice read as « text », and the import takes the apostrophe off. A
    cell Excel already turned into an error value (`#NAME?`, `#NOM?`, `#VALUE!`, `#VALEUR!`, `#REF!`,
    `#DIV/0!`, `#N/A`, `#NUM!`, `#NULL!`…) is refused: « Excel a transformé ce texte en formule — ligne
    N. Remettre le texte avec une apostrophe devant, puis réimporter le fichier. » The translation
    catalogue's file follows the same rule (`utils/translationCsv.js`).

    *Known edges (2026-10-17):* a text that really starts with `'=`, `'+`, `'-` or `'@` loses its
    apostrophe on import, and a French text that is exactly `-` cannot be stored through the file
    (`-` means « vider », rule 17). Both are typed on the page instead.
23. **Accents survive Excel's « CSV (point-virgule) ».** The browser reads a picked file as UTF-8 if it
    is valid UTF-8, else as Windows-1252; a file that then still holds C1 control characters
    (U+0080–U+009F, e.g. MacRoman) is refused in the browser. The server refuses a file that still holds
    « � » (U+FFFD). Both say « Fichier mal encodé : l'enregistrer en « CSV UTF-8 ». », nothing read.
    Same for the translation catalogue. The shared uploader (`FileUploadButton`) is for text files only.
24. **Every sentence an automatic email sends is in the key space.** A resource's sentence once booked
    is the key `resource:<id>` (section J-2): on the page, in the file, in the English check and in the
    translation. Option and resource names stay in the translation catalogue (Paramètres › Système),
    which the page links to: one source per text.
25. **The page shows what the stored template sends.** A sentence whose variable no stored template of
    its email places goes under a folded « Phrases non utilisées par le modèle »; the readiness list
    ignores it. A property without Wi-Fi is not asked for its network. On a phone each sentence is one
    line (its name and the start of its French, with « EN manquant » or « À relire » when due) until
    tapped, and the opened editor takes the focus: Solio's J-2 section went from about 7,000 px to
    3,400 px at 390 px. Only an enabled template counts as placing a sentence.
26. **A « recette » never emails a guest** (added 2026-10-18, code review m3). With
    `GUESTFLOW_MAIL_OUTBOX=<dir>` set and `NODE_ENV` not `production`, every email the instance would
    send — guest emails, account emails, notifications, the SMTP test — is written as one JSON file in
    `<dir>` (`to`, `subject`, `text`, `from`, `replyTo`, `at`) and no SMTP connection is opened. Nothing
    else changes: an instance without SMTP still refuses to send, and a send is still logged as sent. In
    production the variable is ignored. The safe way to try a copy of the production database is
    therefore `GUESTFLOW_MAIL_OUTBOX=/tmp/outbox npm run dev:server` (README › Recette).

### 3.I Review of 2026-10-18 (emails, start assistant)

27. **A broken variable or condition is refused at save.** The renderer passes a piece it cannot read
    through as literal text, so the guest would read it. The shared validation (rule 11) refuses, before
    any unknown name: a `{{` or `}}` without its other half, a label bracket `⟦` / `⟧` left from the
    page, a `{{#if …}}` without its `{{/if}}`, a `{{/if}}` or a `{{else}}` outside a condition, a
    condition inside a condition. Messages: « Variable incomplète : la remettre depuis les boutons. »,
    « Condition sans fin : ajouter « fin si ». », « « fin si » sans condition : le retirer. », « « sinon »
    hors d'une condition : le retirer. », « Condition dans une condition : une seule à la fois. » A text
    or a template already stored that way is listed in « À compléter » (« Texte à corriger — … »,
    « Modèle à corriger — … »). On the page a variable is one unit: the caret never stops inside
    `⟦…⟧` (it selects all of it), Backspace after it or Delete before it removes all of it, and a refusal
    is shown with `⟦ ⟧`, never with the stored braces.
    *2026-10-18 bis (review of PR #705):* a known variable in one pair of braces (« {clientFirstName} »,
    « { propertyName } ») is refused too, with « Variable incomplète : la remettre depuis les boutons. »:
    the renderer would send it as it is. Braces around any other text stay prose (« {à bientôt} »).
28. **A fresh instance asserts nothing nobody said.** A property created by the start assistant has no
    deposit (0 €) and three facts left unsaid (`properties.pendingFacts`): the deposit, whether the
    end-of-stay cleaning is included, whether bath towels are provided. While a fact is unsaid, every
    sentence built on it is left out of the emails (no « caution de 500 € », no « ménage non compris »,
    no « vos serviettes de toilette »), and « À compléter » lists it (« Caution — X », « Ménage compris ou
    non — X », « Linge de toilette fourni ou non — X ») when a template would say it. « Vos emails » asks
    the three with no answer chosen; the property page shows them empty (« Vide : rien n'est dit aux
    voyageurs. »). An answer, on either page, brings the sentences back: « Ménage de fin de séjour » and
    « Linge de toilette » take « Compris / Non compris » (« Fourni / À apporter ») or « Selon les
    options », which leaves it to the property's options as before. A property that existed before this
    rule has nothing pending: no Solio email moves. A property created from the Logements page starts at
    a 0 € deposit.
    *2026-10-18 bis (review of PR #705):* the bed linen is the fourth fact (`linen`): the option created
    at install no longer makes a fresh instance say « Le linge de lit n'étant pas compris, pensez à
    prendre draps et taies d'oreiller ». While unsaid, the J-7 has no beds paragraph (unless the guest
    booked the linen) and the legacy flags `bedLinenProvidedByDefault` / `bedLinenBringYourOwn` are
    false; « À compléter » lists « Linge de lit fourni ou non — X » (J-7). « Linge de lit » is answered
    like the towels (« Fourni / À apporter / Selon les options ») on the Séjour tab and in « Vos
    emails » (`properties.bedLinenProvided`). Saving the property page never resets what it does not
    send: an empty deposit is not sent and keeps the stored amount (« Vide : rien n'est changé. 0 : pas
    de caution. ») — before, the server put 500 € back and an emptied 400 € became 500 €. The
    reservation page no longer falls back to 500 € either.
29. **The start assistant never creates a property twice.** It remembers the property it created
    (`app_settings.onboardingPropertyId`): « Précédent » then « Suivant », a reload or the assistant
    opened again from Réglages › Système edits that property and its price. An instance that already
    has properties it did not create gets none from it: step 2 reads « Logements : N » with « Modifier
    dans Logements », and the server answers `409 PROPERTIES_EXIST` to a direct call.
    *2026-10-18 bis (review of PR #705):* « its price » is the price of the rule the assistant created
    (the property's first pricing rule), shown at step 2 and written only when it changed. A season the
    owner added since is never touched: reopening the assistant and clicking « Suivant » used to set
    every rule of the property to the step's price.
30. **The article comes from the name.** « Le X » takes « au X », « La X » « à la X », « Les X » « aux X »,
    « L'X » « à l'X »: such a name says its article, so it is confirmed at once and the chip offers
    that one only; the leading article contracts (« au Fournil », never « au Le Fournil »). Any other
    name is offered « au / à la / aux / à » (« à l' » too when it starts with a vowel or an h), with
    nothing chosen until the owner clicks: the article is saved and confirmed only then, so the
    readiness check of rule 8 still fires. No « à l'Gite ».
    *2026-10-18 bis (review of PR #705):* « y » and « h » are no vowels here: « la Yourte », « le Hameau »
    (h aspiré) but « l'Hôtel ». A name starting with one is not guessed « à l' »; it is offered the five
    articles. On the property page, an article nobody confirmed shows empty (« À choisir pour les emails
    clients. ») and is not sent by a save of another field, so it stays unconfirmed and listed; the
    choices and the preview are the labels the server writes (`GET /api/properties/article-labels`:
    « au Fournil », never « au Le Fournil »), no longer composed in the page.
31. **The sample stay arrives and leaves at the property's own times.** The preview's « Exemple » stay
    (rule 13) takes the property's check-in and check-out times, as a real stay would: the assistant's
    J-2 says « à partir de 16 h » for a property saved at 16:00.
32. **A key-box code is never in the file.** « Vos emails » has its own « Code de la boîte à clés » field,
    stored encrypted like the property page's (rule 1). The « Accès » texts are not exported in the CSV
    (rule 16), since an owner may still type a code there by hand; an imported row naming one is refused
    (« « Accès » se modifie sur la page, pas dans le fichier »). A text emptied by `-` reads « (vidé) » in
    the import summary.
33. **The J-7 subject names the stay with its article.** The neutral J-7 subject reads « Plus qu'une
    semaine avant votre séjour au Fournil » (« One week to go before your stay at Le Fournil »), not
    « avant Le Fournil ». A stored subject is not rewritten: Solio's keeps its own.
34. **The pool season belongs to the property.** « Piscine » (on/off) and its two dates, picked as a day
    and a month, sit on the property's Séjour tab; Réglages › Emails no longer holds them. Off, or no
    dates: no pool sentence. Both dates or none (« Les deux dates, ou aucune. »). The upgrade copies the
    season the instance had onto every property once, so no email moves.
35. **Typed text is never lost.** « Textes des emails » and the property page ask before leaving with
    unsaved changes — through the menu, « Retour », a link inside the page, the browser's back or a
    reload. The property's « Arrivée » block is saved by the page's own Enregistrer / Annuler (no button
    of its own) and lights the Séjour tab. A property's own text left empty reads « Texte commun utilisé :
    … » with the shared text (mobile) and « Vide : texte commun utilisé » under the field (desktop),
    never « Vide ». On a phone the page's title is « Textes » and its buttons stay on one row.
36. **The CGV sentence is never printed with a hole.** A stored template printing `{{cgvUrl}}` outside
    `{{#if hasCgvUrl}}` (a sentence rewritten by hand) gets that paragraph wrapped in the condition by a
    one-shot upgrade (`cgv_link_condition_v1`): unchanged while the link exists, left out while it does
    not. « À compléter » lists a template still printing the link while there is none (« Lien des
    conditions générales vide — … »). Whether a platform guest accepted the CGV is out of this rule.


### 3.J Guest emails in HTML (UI/UX review 2026-10-18, proposal 25, decision 15)

The « text only » rule is lifted (decision 15, 2026-10-19; it was `specs/email-automation.md` §8).

37. **A guest email leaves as text and HTML.** Every email sent to a guest — the sequence (automatic
    or « Envoyer »), the manual send, the confirmation, the automatic pass of the other templates, and
    the « M'envoyer un test » of rule 15 — leaves as `multipart/alternative`: the `text/plain` part is
    the rendered text, unchanged byte for byte (what the history records), and a `text/html` part is
    derived by the server from that same rendered text (`utils/guestEmailHtml.js`). The text stays the
    one thing the operator writes; there is no second template, so the two parts cannot say different
    things. The account emails (reset link, login codes) and the internal notifications stay plain
    text. The preview answers both parts and shows either one (« Texte | HTML », text first; the HTML
    in a sandboxed frame). The dev mail catcher (rule 26) keeps the HTML part and the raw message
    (`mime`), so the multipart can be read without sending anything.
38. **The HTML says what the text says, and nothing more.** A blank line is a paragraph, a line break
    stays a line break; a run of « - » / « • » lines is a list, and a two-column recap when every line
    of it reads « Libellé : valeur » (« Votre séjour : » and its lines). A web address, an email address
    and a French phone number are plain links showing their own text (`https://…`, `mailto:`, `tel:`);
    no other scheme is ever linked, no link is rewritten. An amount keeps its « € » on the same line, a
    phone number is not cut. Everything else is escaped: a `<`, `&` or quote in a name or a text is
    printed, never interpreted. *Departs from the review's mock (decision 15):* no « Payer
    l'acompte » button — the payment link is a plain link, like every other.
39. **The HTML is sober and self-contained.** The sender's name (as the email signs, rule 12 of
    settings-rationalization) heads it in the Maison serif; the body is the system sans at 16 px,
    1.55 line height, in a column of 600 px at most. Nothing is loaded: no image, no remote stylesheet
    or font, no tracking pixel, no script. The colours are Maison's (ink on paper, fir-green links), with
    a dark variant (`prefers-color-scheme: dark`, `color-scheme: light dark`); a client that ignores both
    (Outlook desktop) shows the light version at full width.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `database.js` / schema | `property_arrival_facts` table | C | Rule 1, encrypted columns for code and Wi-Fi password |
| `models/` | `propertyArrivalFactsModel.js` | C | CRUD, encryption |
| `utils/` | `stayTextCatalogue.js` | T | Keys `addressParagraph`, `accessParagraph`, `wifiParagraph`, test-send labels |
| `utils/` | `stayContentContext.js` | T | Compose the three paragraphs (rules 3–5) |
| `utils/` | `emailContextBuilder.js` | T | Omit sentences built on empty settings (rule 8) |
| `utils/` | `templateTokens.js` | C | One token catalogue per template with French labels; the shared validator (rules 10–11) |
| `utils/` | `emailTemplateRenderer.js` | T | `structureError`: what the renderer cannot read, refused by the shared validator (rule 27, 2026-10-18) |
| `utils/` | `propertyFacts.js` | C | The facts left unsaid by the assistant and their answers (rule 28, 2026-10-18) |
| `utils/` | `propertyArticle.js` | C | The article derived from the name, its contraction, the chips worth offering (rule 30, 2026-10-18) |
| `utils/` | `migrateCgvLinkCondition.js` | C | One-shot wrap of a hand-written CGV sentence in its condition (rule 36, 2026-10-18) |
| `utils/` | `guestEmailHtml.js` | C | The HTML part derived from the rendered text, `guestEmailMessage` (rules 37–39, 2026-10-19) |
| `utils/` | `emailService.js` | T | Sends `html` beside `text` when given (rule 37) |
| `utils/` | `mailOutbox.js`, `accountMailer.js` | T | The catcher keeps `html` and the raw `mime`; the test send carries the HTML (rule 37) |
| `utils/` | `guestEmailSequenceRunner.js`, `reservationEmailSender.js`, `emailAutoSendRunner.js` | T | Send through `guestEmailMessage` (rule 37) |
| `controllers/` | `emailsController.js`, `utils/emailDraftPreview.js` | T | Preview answers `html`; manual and test sends carry it (rule 37) |
| `controllers/` | `onboardingController.js` | T | Step 2 edits its own property; « Vos emails » saves the deposit, cleaning, towels and code (rules 28–32, 2026-10-18) |
| `controllers/` | `emailReadinessController.js` | T | Lists broken texts, unsaid facts and an empty CGV link (rules 27, 28, 36, 2026-10-18) |
| `utils/` | `emailTextsCsv.js` | C | Export/import on top of `translationCsv.js` (rules 16–18) |
| `utils/` | `textTranslator.js` | C | Token-safe translation through the platform key (rules 19–20) |
| `controllers/` | `emailReadinessController.js` | C | Rule 6 |
| `controllers/` | `emailTextsController.js` | C | Sectioned payload in send order (rule 9), export/import, translate |
| `controllers/` | `emailsController.js` | T | Draft preview, default reservation, test send (rules 13–15) |
| `routes/` | `emailTexts.js`, `emails.js`, `properties.js` | C/T | Thin endpoints |
| `utils/` | `guestEmailSequenceTemplates.js` | T | The neutral J-2 places the paragraphs (fresh databases only) |
| `utils/` | `defaultEmailTemplatesRegistry.js` | T | Phone sentences under `hasCompanyPhone` (rule 8, fresh databases only) |
| `utils/` | `guestEmailSequenceSchema.js` | T | `property_arrival_facts`, `stay_text_flags`, `properties.nameArticleConfirmed` |
| `utils/` | `emailTemplateRenderer.js` | T | `unknownToken` refuses malformed `{{…}}` too (rule 11) |
| `utils/` | `emailDraftPreview.js` | C | The draft written in a rolled-back transaction, the candidate stays, « Exemple » (rules 13–15) |
| `utils/` | `translationCsv.js` | T | Exposes `cell`, `splitRows`, `detectSeparator` (rule 18); formula-safe cells, encoding check (rules 22–23) |
| `controllers/` | `translationsController.js` | T | Refuses a badly encoded file (rule 23) |
| `models/` | `emailTextsModel.js` | C | The one key space of every editable sentence: list, validate, apply in one transaction, marks |
| `models/` | `stayFactsModel.js`, `propertiesModel.js` | T | Arrival facts in the email context; an article sent by a form is confirmed |
| `controllers/` | `propertyArrivalFactsController.js` | C | `GET/PUT /api/properties/:id/arrival-facts` |
| `controllers/` | `emailTemplatesController.js` | T | Shared validation (rule 11), `GET /:id/variables`, `textsSection` (rule 12) |
| `controllers/` | `onboardingController.js` | T | `emails` block and `PUT /api/onboarding/emails` (rule 21) |
| `routes/` | `emailReadiness.js`, `onboarding.js`, `emailTemplates.js` | C/T | Thin |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/settings/` | `EmailTextsSettingsPage.jsx` | T | The single page: readiness list, sections, preview pane, file and translate actions |
| `components/` | `TokenTextField.jsx` | T | Chips from the server, labels shown instead of raw tokens |
| `components/` | `EmailPreviewPane.jsx` | C | Generic rendered-email viewer (iframe, language toggle, reservation selector, test send) |
| `components/` | `ReadinessList.jsx` | C | Generic « à compléter » list with links |
| `components/property/` | `PropertyArrivalFacts.jsx` | C | Arrival facts block of the property form |
| `pages/` | `OnboardingPage.jsx` | T | Step « Vos emails » |
| `pages/` | `EmailTemplatesPage.jsx` | T | Links to the sections (rule 12); chips from the server |
| `components/` | `EmailMentionsPanel.jsx` | C | Specific: « Options citées », moved out of the page |
| `components/` | `OnboardingEmailsStep.jsx` | C | Specific: the step « Vos emails » |
| `components/` | `EmailReadinessAlert.jsx` | C | Dashboard « Emails incomplets » (rule 7) |
| `components/property/` | `PropertyStayTab.jsx` | T | « Arrivée » block and the « Textes » link; `PropertyStayTexts.jsx` deleted |
| `components/` | `PropertyHooksEditor.jsx` | D | Replaced by the link of rule 12 |
| `utils/` | `tokenDisplay.js` | C | `{{token}}` ⇄ « ⟦label⟧ » with the server's labels (rule 10) |
| `utils/` | `readTextFile.js` | C | A picked file as UTF-8, else Windows-1252 (rule 23) |
| `components/` | `FileUploadButton.jsx` | T | Reads through `readTextFile` (rule 23) |
| `components/` | `MentionEditor.jsx`, `pages/ResourcesPage.jsx` | T | Labelled chips |
| `components/` | `TokenTextField.jsx` | T | A variable is one unit for the caret, Backspace and Delete; refusals in `⟦ ⟧`; `emptyHint` (rules 27, 35, 2026-10-18) |
| `pages/settings/` | `EmailTextsSettingsPage.jsx` | T | Unsaved-changes guard on the menu, « Retour » and in-page links; « Texte commun utilisé »; « Textes » on a phone (rule 35) |
| `pages/` | `PropertyDetail.jsx` | T | Holds the « Arrivée » draft and saves it with the page; sends a pending fact only once answered (rules 28, 35) |
| `components/property/` | `PropertyArrivalFacts.jsx` | T | Controlled by the page, no save button of its own (rule 35) |
| `components/property/` | `PropertyStayTab.jsx` | T | Cleaning, towels, « Piscine » and its two dates (rules 28, 34) |
| `components/` | `MonthDayField.jsx` | C | Generic: a day and a month without a year, `MM-DD` (rule 34) |
| `components/` | `OnboardingEmailsStep.jsx` | T | Deposit, cleaning and towels with no answer chosen; key-box code field (rules 28, 30, 32) |
| `pages/` | `OnboardingPage.jsx` | T | Step 2 resumes its property or lists the existing ones (rule 29) |
| `components/` | `EmailMentionsPanel.jsx` | T | A proposal reads « ⟦Prix⟧ », as in its editor |
| `components/` | `EmailPreviewPane.jsx` | T | Optional `html` prop: « Texte \| HTML » switch, the HTML in a sandboxed frame (rule 37) |
| `pages/settings/` | `EmailTextsSettingsPage.jsx` | T | Passes the preview's `html` to the pane (rule 37) |

**Component reuse:**
- Reused: `MaskedTextField`, `HelpedTextField`, `PageActionBar`, `StatusBadge`, `EmptyState`,
  `ErrorAlert`, `FormDialog`.
- Generic and new: `EmailPreviewPane` (the manual send dialog can use it) and `ReadinessList`.

### 4.3 API contract

| Method | Path | Body / answer |
|---|---|---|
| GET | `/api/email-texts?propertyId=` | `{ sections: [{ id, title, templates, items: [{ key, kind, label, fr, en, defaultFr, defaultEn, placeholderFr, placeholderEn, chips, autoTranslated }] }], properties, propertyId, canTranslate }` |
| PUT | `/api/email-texts` | `{ changes: { [key]: { fr?, en? } } }` → `{ applied }` or 422 `{ key, field, message }` |
| POST | `/api/email-texts/confirm` | `{ key }` — « Relu » |
| GET | `/api/email-texts/export` | the CSV |
| POST | `/api/email-texts/import[?confirm=true]` | raw CSV → `{ changed, refused, unchanged, applied }` |
| POST | `/api/email-texts/translate` | `{ translated }`; 404 without the key, 502 on failure |
| GET | `/api/email-readiness` | `{ items: [{ id, check, label, section, propertyId, target, soon }], soonCount }` |
| POST | `/api/emails/preview` | `{ templateId \| stableKey, draft, reservationId? \| 'sample', language, propertyId? }` → `{ subject, body, html, lang, reservationId, sample, reservations, englishNotice }` (`html` since 2026-10-19, rule 37; `GET /api/emails/preview` answers it too) |
| POST | `/api/emails/test` | same body → `{ ok, to }`; 409 `EMAIL_NOT_CONFIGURED` |
| GET | `/api/email-templates/:id/variables` | `{ variables: [{ name, label }], conditions }`; `new` for a template not created yet |
| GET / PUT | `/api/properties/:id/arrival-facts` | the facts, secrets as `hasAccessCode` / `hasWifiPassword` |
| PUT | `/api/onboarding/emails` | `{ phone, senderName, properties: [{ id, nameArticle?, address, access, accessCode?, wifiName, wifiPassword?, caution?, cleaningIncluded?, towelsProvided? }] }` — an absent field is left unanswered (rules 28, 30, 32, 2026-10-18) |
| GET | `/api/onboarding` | adds `property: { id, existing, draft }` — the property the assistant created, to edit (rule 29, 2026-10-18) |
| PUT | `/api/onboarding/property` | edits the assistant's own property; 409 `PROPERTIES_EXIST` on an instance it did not equip (rule 29, 2026-10-18) |
| GET | `/api/properties/article-labels?name=` | `{ labels: [{ value, label }] }` — the five articles as the emails write them (rule 30, 2026-10-18 bis) |

*2026-10-18 bis:* `PUT /api/onboarding/emails` and `PUT /api/properties/:id` also take
`bedLinenProvided`; `PUT /api/properties/:id` keeps the stored `nameArticle` and `defaultCautionAmount`
when they are absent or empty (rules 28, 30).

## 5. Data model

The new table `property_arrival_facts` holds:
- `propertyId` (PK, FK cascade);
- `address`, `mapUrl`;
- `accessFr`, `accessEn`;
- `accessCodeEncrypted`;
- `wifiName`, `wifiPasswordEncrypted`;
- `updatedAt`.

The new table `stay_text_flags` holds `key`, `language`, `autoTranslated`.

Migration is idempotent and needs no backfill. An empty table means no paragraph.

*2026-10-08:* `stay_text_flags.key` is the text key of §4.3 (`text:house`, `hook:1`…), with
`language` always `en` today. `properties.nameArticleConfirmed INTEGER NOT NULL DEFAULT 0` is added, and
set to 1 for every property that exists when it is added (rule 8 note).

*2026-10-18 (rules 28, 29, 34, 36):* `properties.pendingFacts TEXT NOT NULL DEFAULT ''` (comma-separated
`caution`, `cleaning`, `towels`; empty on every property that exists when it is added),
`properties.cleaningIncluded INTEGER` and `properties.towelsProvided INTEGER` (1 / 0, NULL: the options
decide), `properties.poolSeasonStart` / `poolSeasonEnd TEXT NOT NULL DEFAULT ''` (copied once from
`app_settings`, whose two columns stay in the table, unread), `app_settings.onboardingPropertyId INTEGER`.
One-shot content migration `cgv_link_condition_v1` (rule 36).

*2026-10-18 bis (rule 28):* `properties.bedLinenProvided INTEGER` (1 / 0, NULL: the options decide);
`pendingFacts` may also hold `linen`, set on a property the start assistant creates. Existing rows keep
NULL and nothing pending: no email moves.

## 6. UI / UX

See the summary page.
- **Desktop:** the sections sit on the left and the preview stays pinned on the right.
- **Mobile:** one column, and the preview opens under the section being edited (« Voir l'email »).
- *2026-10-18:* the bar reads « Textes » on a phone; leaving with unsaved texts asks first (rule 35);
  a property's empty text reads « Texte commun utilisé : … » (rule 35). The property's Séjour tab adds
  « Ménage de fin de séjour », « Linge de toilette » and « Piscine » (rules 28, 34); « Vos emails » adds
  « Code de la boîte à clés », « Caution (€) », and the two yes/no chip pairs (rules 28, 32).
- *2026-10-18 bis:* « Linge de lit » joins the Séjour tab and « Vos emails » (rule 28); the property
  page's article menu lists « au Fournil »… from the server and shows empty while unconfirmed (rule 30).
- *2026-10-19 (rules 37–39):* the preview pane of « Textes des emails » gains « Texte | HTML » beside
  FR | EN (text first). On a phone the switch wraps under the language toggle; the HTML frame is
  520 px high (640 px from `md`), and the email itself, 600 px at most, fills the 390 px width with a
  20 px margin. The start assistant's preview stays text only. Interactive mock (the real renderer,
  editable text, 390 / 1280, light / dark):
  [`docs/specs/2026-10-19-otp-field-and-guest-email-html.html`](../docs/specs/2026-10-19-otp-field-and-guest-email-html.html).

## 7. Test plan

**Server unit tests:**
- paragraph composition and omission;
- encryption of the two secrets;
- the readiness checks, one test per check;
- token validation shared by the three editors;
- CSV round trip (export → import = no change), refusals with line numbers, `-` empties a text,
  separator detection;
- draft preview with the default reservation;
- test send not recorded;
- the translator protects tokens and fails without a partial state;
- **golden test: Solio's J-7/J-2 renderings are unchanged** (`productisation-golden`).

**Client unit tests:** sections in send order, chips shown as labels, preview pane states, import
summary, onboarding step.

**E2E:** fill the arrival facts, see them in the J-2 preview, export then re-import the file, run a test
send against the dev mail catcher.

**Manual check on mobile:** the page at 390px.

*2026-10-18 review:* server `email-texts-structure` (5, rule 27), `onboarding-facts-and-article` (12,
rules 28–33), `email-texts-csv-secrets` (3, rule 32), `property-pool-season` (4, rule 34),
`email-texts-cgv-link` (3, rule 36); client `TokenTextField.atomic-token` (4, rule 27),
`EmailTextsSettingsPage.unsaved-and-inherited` (4, rule 35), `PropertyDetail.arrival-and-facts` (4,
rules 28, 34, 35), `OnboardingPage.facts-and-resume` (4, rules 28–30, 32), `PropertyArrivalFacts` (4,
rewritten for the controlled block).

*2026-10-19 (rules 37–39):* server `guest-email-html` (10: escaping, links and only them, paragraphs /
lists / recap, a self-contained document, **golden: Solio's six sequence emails FR/EN keep their text
byte for byte and print no variable in HTML**, the heading, the sequence sending both parts with the
recorded text, the transport, the mail catcher's `multipart/alternative`, preview and test send);
client `EmailPreviewPane.html-part` (2); E2E `email-texts` reads the HTML part and the multipart from
the catcher and switches the preview to HTML.

*2026-10-18 bis (review of PR #705):* server `onboarding-reopen-keeps-seasons` (3, rule 29),
`property-update-keeps-unsent-facts` (4, rules 28, 30), `property-article-ambiguous-initial` (3,
rule 30), `bed-linen-pending-fact` (4, rule 28), `template-single-brace` (3, rule 27); client
`PropertyDetail.article-and-deposit` (4, rules 28, 30), `OnboardingPage.facts-and-resume` (+1, rule 28).
The `previewWithArticle` helper tests are gone with the helper.

## 8. Out of scope

- A rich-text (WYSIWYG) editor. The HTML part (rule 37) is derived, never edited.
- A payment button or any other markup in the HTML part (decision 15: plain links).
- HTML for the account emails and the internal notifications.
- A library of alternative tones.
- `.docx` import (formatting runs split tokens; research 2026-10-08).
- Per-channel templates.

## 9. Open questions

None. The choices are those recommended by the research of 2026-10-08, taken under the owner's
instruction to run the plan through.

## 10. Implementation progress

Implemented 2026-10-08 on `feature/email-texts-made-simple`.

**Server (50 tests, 8 files, one per subject):** `email-texts-arrival-facts` (6, rules 1–5),
`email-texts-readiness` (11, rules 6–8), `email-texts-tokens` (5, rules 10–11), `email-texts-page` (4,
rules 9, 24–25), `email-texts-csv` (8, rules 16–18, 22–23), `email-texts-preview` (7, rules 13–15),
`email-texts-translator` (5, rules 19–20), `email-texts-onboarding` (4, rule 21).
`email-mentions` now expects the labelled refusal (rule 11 note). The golden test
`productisation-golden` is unchanged and green. Server suite after merging `inte/plugins` (H2, #683):
5,038 tests after the review of 2026-10-17.

**Client (Vitest):** `EmailTextsSettingsPage` (8), `EmailTextsSettingsPage.preview` (4),
`EmailTextsSettingsPage.file` (4), `TokenTextField` (3), `ReadinessList` (3), `EmailPreviewPane` (3),
`PropertyArrivalFacts` (3), `EmailTemplatesPage.texts-link` (2), `OnboardingPage.emails-step` (2),
`readTextFile` (2);
`PropertyStayTexts` (1) and `EmailTemplatesPage.property-hooks` deleted with their components.

**E2E:** `e2e/specs/emails/email-texts.spec.js` (2): the arrival facts in the J-2 preview and a test send
read back from the dev mail catcher; export, then re-import with one changed and one refused row.
`onboarding.spec.js` follows the fifth step.

**Manual check:** the page, typing with the live preview, FR/EN, export then import with a refused row,
the property « Arrivée » block and the assistant's « Vos emails » at 390, 900 and 1280 px, on a copy of
the dev database: no console error, no horizontal scroll.

**Solio, measured on a copy of the dev database (65 reservations, 12 templates):** every template ×
every reservation × FR/EN rendered before and after through the real preview path: 1,560 renderings
(780 of the six sequence emails), 0 differences — measured again after the review of 2026-10-17, with
the readiness list empty and no dashboard alert on that copy (70 texts, 7 folded as unused).

**UI/UX review, 2026-10-19 (`feature/ui-otp-html-emails`, target `inte/plugins`), rules 37–39:** every
guest send goes through `guestEmailMessage` (text unchanged, HTML derived); the preview answers `html`
and shows « Texte | HTML »; the dev mail catcher keeps `html` and `mime`. Server `guest-email-html` (10),
client `EmailPreviewPane.html-part` (2), E2E `email-texts` extended. Checked in a browser: the preview at
390 and 1280 px, the HTML part alone at 390 and 1280 px in light and dark, no horizontal scroll.
