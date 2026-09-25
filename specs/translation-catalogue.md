# Translation catalogue — collected by GuestFlow, filled in outside it

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/translation-catalogue` |
| **Created** | 2026-09-25 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

English reached the site in September 2026 (`specs/site-english-version.md`). The translations it needs
were bolted onto each table as they were required: `options.titleEn`, `resources.nameEn`, and a field
beside the French one on every editing screen. Three things came out of that, measured on 2026-09-25.

**The screens carry a second field nobody fills.** 21 of the 32 options had an empty `titleEn` a year
in; they were filled in by hand, directly in production, because no one opens an option to translate it
— you translate when you sit down to translate, all of them at once.

**Some text has no English field at all, and it shows.** Option **descriptions** are displayed to the
guest: 16 of them in La Granja's drawer, behind the ⓘ button (« Saucisson 250g + pâté ardéchois… »,
« Bière blonde bio — Brasserie du Pilat »). There is no `descriptionEn`, so the English drawer shows a
sharing board at 78 € with nothing to say what is on it. **Categories** have no English twin either:
« Boissons » and « Restauration » appear as they are on the English page.

**Adding a third language would mean a third column on every table**, and a third field on every screen.

The choice made here: the translations leave the interface. GuestFlow collects, by itself, every short
label that needs translating; the operator downloads one file, fills it in, uploads it back.

## 2. Goal

Every short label the guest can read exists in one place. GuestFlow keeps that place up to date on its
own; the operator translates it in a spreadsheet, at their own pace, and adding a language costs one
column rather than a schema change.

## 3. Functional rules

### 3.1 What the catalogue holds

1. **GuestFlow collects its own entries.** Creating an option, a resource or a category — or changing
   the French text of one — puts an entry in the catalogue without anyone asking. Nothing is ever typed
   into the catalogue by hand from inside GuestFlow.
2. **The catalogue holds short labels, and only those**: option titles, option descriptions, resource
   names, option categories. ~60 entries today (29 + 26 + 2 + 3). E-mail templates, the CGV and the
   quote footer keep their own editors, where the layout, the variables and the version history are
   visible (decided 2026-09-25, §9).
3. **French is the source, and is never translated in the file.** It is read-only there: French text is
   changed where it has always been changed, on the option's own screen.
4. **An entry is identified by where it comes from**, not by its text — `option:12:title`,
   `resource:2:name`, `category:Boissons`. Renaming an option in French therefore keeps its English.
5. **An entry whose French changed since it was translated is flagged « à revérifier ».** Its
   translation is kept — nothing is ever lost to a typo fix — and the flag says a second look is owed
   (decided 2026-09-25, §9). The operator clears the flag by emptying that cell in the file.
6. **An entry is removed only when its source is deleted**, never when it is archived: an archived
   option keeps its translation, because archiving is reversible and retyping a translation is not.

### 3.2 The file

7. **The file is a CSV, one column per language**, and it opens in Numbers or Excel on a double click
   (decided 2026-09-25, §9). Columns, in order:
   `clé`, `où`, `français`, `english`, `deutsch`…, `à revérifier`.
8. **It is sorted so it can be read**: by `où` (Catégorie, Option · titre, Option · description,
   Ressource · nom), then alphabetically by the French text. The same catalogue always exports the same
   file, so two downloads can be diffed.
9. **The operator only ever types in a language column.** `clé`, `où` and `français` are there to be
   read; a change to them is ignored on upload, and the upload report says how many were ignored.
10. **A download is always the whole catalogue**, translated or not, so the file on the operator's disk
    is a complete and current picture.
11. **An upload is applied in one transaction, or not at all.** A malformed file changes nothing and
    the error names the line.
12. **An upload that would remove translations says so first.** A blank cell against a stored
    translation means "remove it" — which is legitimate, and is also what a mangled file looks like. The
    count is reported and confirmed before anything is written.
13. **An unknown key is ignored, never created.** The catalogue's contents are GuestFlow's to decide
    (rule 1); a typo in the `clé` column must not invent an entry. It is counted in the report.

### 3.3 What the guest gets

14. **An untranslated title falls back to French.** Never an empty label, never a key — the rule the
    public API has had since day one.
15. **An untranslated description is omitted**, as it is today (`specs/site-english-version.md` rule 7):
    a missing line reads better than a foreign paragraph. A *translated* one is now served, which is
    the whole point of adding descriptions to the catalogue.
16. **A category is translated as a label only.** Grouping keeps using the French text as its key, and
    the translation is applied when the group is projected — so the drawer groups identically in both
    languages and nothing downstream keys on a translated string.
17. **A third language costs a column, and nothing else.** There is no list to maintain: a language
    exists because a column bearing its name came back in an uploaded file. Adding German is
    literally adding a `deutsch` column, filling it, and sending the file — the catalogue stores it,
    the next export carries it, and `lang=de` starts answering with it. No schema change, no setting,
    no screen.
    > **Limite assumée** — les libellés que GuestFlow compose lui-même (« au séjour », « par
    > personne », les refus du tunnel) vivent dans `publicLabels.js`, qui est du CODE et connaît
    > `fr` et `en`. Une 3ᵉ langue les laisse en français tant que ce dictionnaire n'a pas sa carte.
    > Le catalogue, lui, est prêt : c'est la donnée de l'exploitant qui est déjà multilingue.
18. **`lang` stays additive and never fails** (`specs/site-english-version.md` rule 1): an unknown or
    absent language reads as French.

### 3.4 What leaves the interface

19. **Every field that asks for a translation is removed** from the options screen and the resources
    screen. That is the point of the change: the screens get shorter, and the one place to translate is
    the file.
20. **The Settings page gains a « Traductions » card**: how many entries, how many still untranslated
    per language, how many flagged « à revérifier », and the two buttons — download, upload.

**Edge cases:**

- Two options with the same French title (« Ménage » exists twice, one per property) → two entries, two
  keys, translated independently. They may be given the same English text; nothing forces it.
- An option created while a download is open on the operator's disk → the new entry is missing from
  their file; uploading it does not remove the new entry (rule 13 only ignores unknown keys; absent
  keys are left alone).
- A CSV saved by Excel with `;` separators and a BOM → both are accepted on import. Excel is the tool
  this file exists for; refusing its output would be refusing the feature.
- A translation identical to the French text → stored as given. It is a legitimate answer
  (« Champagne » is « Champagne »).
- An empty catalogue (fresh install, before the first collection pass) → the card says so and the
  download is still offered, with its header row.

---

## 4. Architecture

> **Fat backend, thin frontend.** The collection, the ordering, the CSV, the parsing, the flagging and
> the counts are all server work. The client renders a card with two buttons and a summary it is given.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `translations.js` | C | `GET /export`, `POST /import`, `GET /summary` |
| `routes/` | `index.js` (mount) | T | Mounts `/api/translations` behind the session guard |
| `controllers/` | `translationsController.js` | C | Orchestrates export / import / summary; maps errors to HTTP |
| `models/` | `translationsModel.js` | C | Reads and writes `translation_entries` + `translation_values` |
| `utils/` | `translationCollector.js` | C | Scans options / resources / categories → the entry set, and owns the key format |
| `utils/` | `translationCsv.js` | C | Serialise + parse. Pure. Owns the separator/BOM tolerance and the column order |
| `utils/` | `translationResolver.js` | C | `(kind, id, field, lang) → text` with the French fallback, plus `attachEnglishNames` — the one helper the e-mails and the devis share |
| `utils/` | `defaultTranslations.js` | C | The English GuestFlow ships with, matched on the French text — the seeds' own English, now that the column is gone |
| `utils/` | `translationCatalogueMigration.js` | C | The one-shot move, and `applyDefaultTranslations` which also runs on every boot |
| `utils/` | `publicProjections.js` | T | `toPublicOption` / `toPublicResource` take an optional resolver; descriptions and categories become translatable |
| `utils/` | `reservationEmailGraph.js`, `reservationEmailSender.js` | T | Their joins stop selecting the dropped columns; `attachEnglishNames` supplies them |
| `models/` | `optionsModel.js`, `resourcesModel.js`, `devisModel.js` | T | Attach `titleEn` / `nameEn` from the catalogue on read; the write paths for those columns are gone |
| `controllers/` | `public/publicCatalogController.js` | T | Builds the resolver, and translates the category label **after** grouping (rule 16) |
| `middleware/` | — | — | (none) |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | `database.js` | T | Creates the two tables, runs the one-shot migration, and collects on every boot |
| — | `schema.sql` | T | Declares the two tables; `options.titleEn` and `resources.nameEn` are removed from the baseline |

**Notes:**
- `translationCsv.js` is the piece most likely to meet a hostile file; it is pure and gets the widest
  test surface.
- `translationCollector.js` runs on startup and after any write to an option or a resource. It is
  idempotent: running it twice changes nothing.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `OptionsPage.jsx` | T | **Removes** the English title field |
| `pages/` | `ResourcesPage.jsx` | T | **Removes** the English name field |
| `pages/` | `SettingsPage.jsx` | T | Hosts the « Traductions » card |
| `components/` | `EnglishTitleField` | **D** | Deleted. It lived inline in `OptionsPage.jsx`, not in its own file |
| `components/` | `TranslationCatalogueCard.jsx` | C | The summary + download + upload, with the removal confirmation |
| `components/` | `FileUploadButton.jsx` | C | Pick a file, show its name, hand it to a caller |
| `api.js` | `api.js` | T | `getTranslationSummary`, `importTranslations`; the export is a plain download link |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `StatusCard`, `SummaryItem`, `ConfirmDialog`, `ErrorAlert` | The card, its `label : value` lines, the removal confirmation, the import error. |
| **Created (new generic)** | `FileUploadButton` | Generic on purpose: restoring a backup and importing an iCal file are the same gesture, and both are done today with a bare `<input type="file">`. |
| **Specific (kept feature-local)** | `TranslationCatalogueCard` | Composition of the generics above; its content is this feature's reading. |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/translations/summary` | — | `{ languages: ['fr','en'], total, untranslated: { en: 12 }, needsReview: 3 }` | Feeds the card. |
| GET | `/api/translations/export` | — | `text/csv` + `Content-Disposition: attachment; filename="traductions-YYYY-MM-DD.csv"` | The whole catalogue (rule 10). |
| POST | `/api/translations/import` | `text/csv` raw body; `?confirmRemovals=true` | `{ updated, cleared, reviewCleared, ignoredUnknown, unchanged }` | A raw text body rather than a multipart upload: it is one text file, the browser already holds it as a string, and nothing has to be written to disk and cleaned up. `409 REMOVALS_NOT_CONFIRMED` with the counts when it would remove and `confirmRemovals` is absent (rule 12); `400 MALFORMED_CSV` names the line (rule 11). |

---

## 5. Data model

Two tables, so a new language never means a schema change (rule 17):

```sql
CREATE TABLE IF NOT EXISTS translation_entries (
  entryKey   TEXT PRIMARY KEY,          -- 'option:12:title', 'category:Boissons'
  kind       TEXT NOT NULL,             -- 'option.title' | 'option.description' | 'resource.name' | 'category'
  sourceId   INTEGER,                   -- NULL for a category
  sourceText TEXT NOT NULL,             -- the French, as it is today
  seenAt     TEXT NOT NULL              -- last collection pass that saw this source
);
CREATE TABLE IF NOT EXISTS translation_values (
  entryKey        TEXT NOT NULL,
  lang            TEXT NOT NULL,        -- 'en', 'de', …  never 'fr'
  text            TEXT NOT NULL,
  sourceAtTime    TEXT NOT NULL,        -- the French when this translation was written (rule 5)
  PRIMARY KEY (entryKey, lang),
  FOREIGN KEY (entryKey) REFERENCES translation_entries(entryKey) ON DELETE CASCADE
);
```

« À revérifier » is not stored: it is `sourceAtTime <> sourceText`, computed. A flag that can be
computed must not be stored — the two would drift.

**Migration, in `database.js`, idempotent:**
1. Create both tables.
2. Run a first collection pass.
3. Copy each non-empty `options.titleEn` into `translation_values` as `en`, with
   `sourceAtTime = options.title`; same for `resources.nameEn`.
4. `ALTER TABLE options DROP COLUMN titleEn` and `ALTER TABLE resources DROP COLUMN nameEn`
   (SQLite 3.53 in `better-sqlite3`, well past the 3.35 that added `DROP COLUMN`).

**Data impact.** Step 4 is irreversible and destroys a column that holds real work — 32 English titles.
It runs *after* step 3 has copied them, in the same transaction, so a failure anywhere rolls the whole
thing back and leaves the columns in place. The release's own pre-install backup is the second net. The
counts before and after are logged, and the migration refuses to drop if they disagree.

## 6. UI / UX

### The « Traductions » card (Réglages)

```
┌─ Traductions ──────────────────────────────────────────────┐
│ ● 60 textes · 12 sans anglais · 3 à revérifier             │
│                                                            │
│ Les traductions se font dans un fichier : télécharge-le,   │
│ remplis les colonnes de langue, renvoie-le.                │
│                                                            │
│        [ Télécharger le fichier ]  [ Envoyer un fichier ]  │
└────────────────────────────────────────────────────────────┘
```

**Copy (French):**
- « 60 textes · 12 sans anglais · 3 à revérifier » — « à revérifier » is a link that explains: « le
  texte français a changé depuis la traduction »
- « Les traductions se font dans un fichier : télécharge-le, remplis les colonnes de langue,
  renvoie-le. »
- Removal confirmation: « Ce fichier retire 4 traductions » / « 4 cases de langue sont vides alors
  qu'une traduction existe aujourd'hui. Si ce n'est pas voulu, vérifie le fichier avant de continuer. »
  / « Appliquer quand même » · « Annuler »
- Report: « 47 traductions mises à jour · 4 retirées · 2 clés inconnues ignorées. »
- Error: « Ligne 18 : la colonne « clé » est absente. Rien n'a été modifié. »

### The file

```csv
clé,où,français,english,deutsch,à revérifier
category:Animations,Catégorie,Animations,Activities,,
category:Boissons,Catégorie,Boissons,Drinks,,
option:12:description,Option · description,"En famille : partez à la recherche…","With the family: go looking…",,oui
option:12:title,Option · titre,Animation-animaux sauvage,Wild animal trail,,
resource:2:name,Ressource · nom,Bain nordique,Nordic bath,,
```

**Responsive:** the card's two buttons sit side by side from `sm` and stack full-width on `xs`; the
confirmation dialog is `fullScreen` on `xs`. The card is otherwise text and needs no adaptation.

**Sticky action bar:** unchanged — `SettingsPage` already has one, and this is page content.

### What disappears

The « Titre en anglais » field on the option dialog and the « Nom en anglais » field on the resource
dialog, with the components behind them.

## 7. Test plan

### Server unit tests
- [x] `tests/translation-csv.unit.test.js` — rules 7-13: column order; a comma, a quote, a newline and
      an accent survive a round trip; `;` and a BOM are accepted; a missing column names its line and
      changes nothing; `clé`/`où`/`français` edits are ignored and counted; an unknown key is ignored.
- [x] `tests/translation-collector.unit.test.js` — rules 1, 4, 6: a new option appears; renaming the
      French keeps the entry and its translation; an archived option keeps its entry; a deleted one
      loses it; running twice changes nothing.
- [x] `tests/translation-review-flag.unit.test.js` — rule 5: the flag is `sourceAtTime <> sourceText`,
      never stored; emptying the cell clears it by realigning `sourceAtTime`.
- [x] `tests/translation-resolver.unit.test.js` — rules 14-18: French fallback for a title; a
      description omitted when untranslated and served when translated; a category translated as a
      label while grouping stays on the French key; `lang=de` with no German falls back without error.
- [x] `tests/translation-migration.unit.test.js` — §5: existing `titleEn` / `nameEn` land in the
      catalogue; the columns are gone; a mismatch between the counts aborts the whole migration.
- [x] Mutation check: removing the « nothing is lost » verification, making an emptied cell stop
      acknowledging the review, letting an unknown key through, and making the planning delete instead
      of counting — **all four caught**.

### Client tests
- [x] `components/__tests__/TranslationCatalogueCard.test.jsx` — rules 12, 20: the counts are rendered;
      a removing import raises the confirmation and cancelling sends nothing.
- [x] `pages/__tests__/OptionsPage.no-english-field.test.jsx` — rule 19: the option dialog offers no
      translation field.

### Manual UI verification
- [ ] Download → open in Numbers → the columns are the ones in §6, sorted, readable.
- [ ] Fill in 3 English cells + a German one → upload → the report matches → the drawer shows them.
- [ ] Change an option's French title → the entry is flagged « à revérifier » and keeps its English.
- [ ] Empty a cell → the confirmation appears and names the count.
- [ ] Upload a file saved by Excel (`;`, BOM) → accepted.
- [ ] Regression: the French drawer is unchanged; the English drawer keeps its yes/no switches and its
      price suffixes (`specs/site-english-version.md` rule 58).
- [ ] `xs`, `md`, `lg`.

## 8. Out of scope

- **E-mail templates, the CGV, the quote footer, `properties.emailHook`.** They keep their own editors
  (rule 2). They are documents, not labels: the layout, the `{{variables}}` and, for the CGV, a version
  number recorded with every acceptance all matter while translating, and a spreadsheet cell shows none
  of them.
- **Translating anything automatically.** GuestFlow collects and serves; it never invents a translation.
- **The WordPress plugin's own strings.** They are the plugin's interface, they already live in
  `guestflow-booking-en_GB.po`, and they ship with the plugin rather than with the operator's data.
- **A third language actually being turned on.** Rule 17 makes it a one-column change; choosing to do
  it is a separate decision.

## 9. Open questions

**Resolved 2026-09-25.**

- Q: What shape should the file have?
  - A: **A CSV, one column per language.** It opens in Numbers or Excel on a double click and a third
    language is one more column. Rule 7.
- Q: What goes in it?
  - A: **Short labels only** — titles, descriptions, resource names, categories. E-mail templates and
    the CGV keep their editors. Rule 2.
- Q: What happens to an English translation when its French source is corrected?
  - A: **It is kept and flagged « à revérifier ».** Nothing is lost to a typo fix, and the flag asks for
    the second look. Rule 5.

- Q: Where does the catalogue actually live — a file on the server, or the database?
  - A: **The database**, with the CSV as the exchange format. The workflow asked for (download, fill in,
    upload) is identical either way, but a table is included in the backup taken before every release
    install, it cannot be half-written when GuestFlow adds an entry on its own, and it survives a
    release that replaces the application directory. Raise it if the file itself was the point.
