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
| POST | `/api/emails/preview` | `{ templateId \| stableKey, draft, reservationId? \| 'sample', language, propertyId? }` → `{ subject, body, lang, reservationId, sample, reservations, englishNotice }` |
| POST | `/api/emails/test` | same body → `{ ok, to }`; 409 `EMAIL_NOT_CONFIGURED` |
| GET | `/api/email-templates/:id/variables` | `{ variables: [{ name, label }], conditions }`; `new` for a template not created yet |
| GET / PUT | `/api/properties/:id/arrival-facts` | the facts, secrets as `hasAccessCode` / `hasWifiPassword` |
| PUT | `/api/onboarding/emails` | `{ phone, senderName, nameArticle, address, access, wifiName, wifiPassword }` |

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

## 6. UI / UX

See the summary page.
- **Desktop:** the sections sit on the left and the preview stays pinned on the right.
- **Mobile:** one column, and the preview opens under the section being edited (« Voir l'email »).

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

## 8. Out of scope

- A rich-text (WYSIWYG) editor.
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
