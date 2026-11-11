# Free text keeps the operator's capitals

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `fix/free-text-keeps-case` |
| **Created** | 2026-10-15 |
| **Author** | Adrien |
| **Related PR** | — |

---

## 1. Context

`sentenceCase` (`server/src/utils/textFormatters.js`) lowercases the **whole** string, then
capitalises its first letter. That is the intended normalisation for short labels and names typed in
any case (« FERMETURE HIVER » → « Fermeture hiver »).

It is also applied to **free text**, where it destroys what the operator typed. Seen on 2026-10-15,
reservation 22309:

```
typed : Arrivée annoncée entre 20:00 et 21:00 (acceptée sur Booking).
        Demande 2 lits d'appoint (message Booking du 15/10).
stored: Arrivée annoncée entre 20:00 et 21:00 (acceptée sur booking).
        demande 2 lits d'appoint (message booking du 15/10).
```

Proper nouns, platform names, acronyms (« SAS », « TVA ») and every line after the first lose their
capitals. The `booking-intake` plugin (`specs/booking-extranet-intake.md`) appends guest requests to
the notes, so it would make this worse on every Booking stay.

## 2. Goal

What the operator types in a free-text field is stored as typed — only its first letter is
capitalised.

## 3. Functional rules

1. New helper `capitalizeFirst(value)`: trims, upper-cases the first letter, keeps every other
   character as typed. `null`/`undefined`/blank → `''` (same contract as `sentenceCase`).
2. It replaces `sentenceCase` on the **free-text** fields:
   - reservation `notes` (create and update, `reservationsModel.js`);
   - client `notes` (`clientsModel.js`);
   - devis `notes` (`devisModel.js`);
   - calendar notes (`calendarNotesModel.js`);
   - option `description` (`optionsModel.js`, create and update);
   - resource `note` (`resourcesModel.js`);
   - the notes comparison in `reservationAudit.js`, so the audit compares with the same rule the
     model stores.
3. `sentenceCase` stays unchanged on labels and names: client first/last name, street, address,
   city, option titles, closure and school-holiday labels, rate labels, document names, iCal
   platform labels and placeholder names. (Their known quirks — « Saint-étienne » — are out of
   scope.)
4. Existing rows are **not rewritten**: the lost capitals cannot be recovered. The next save of a
   fiche keeps whatever the operator then types.
   > **Sans test** — no code path: the rule is the absence of a data migration.

**Edge cases:**
- Note starting with a digit or a symbol (« 2 lits… ») → the first letter found is capitalised
  (« 2 Lits… »), exactly as `sentenceCase` does today; nothing else changes.
- Multi-line note → every line kept as typed; only the first letter of the whole text changes.

**Added 2026-10-18 (review of the website plugin):**

5. **Person names get `personNameCase`, not `sentenceCase`** (client `firstName` / `lastName` in
   `clientsModel.buildClientFields`, so the admin form and the website request alike). A name typed in
   a single case gets a capital on each word and after each hyphen or apostrophe (« jean-pierre » →
   « Jean-Pierre », « MARTIN-DUPONT » → « Martin-Dupont », « d'arc » → « D'Arc »); a name typed in
   mixed case is kept as typed (« McDonald », « Le Goff », « de La Fontaine »). This narrows rule 3 for
   names only; the other labels keep `sentenceCase`. Existing rows are not rewritten (rule 4).

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `textFormatters.js` | T | Adds `capitalizeFirst`. |
| `models/` | `reservationsModel.js`, `clientsModel.js`, `devisModel.js`, `calendarNotesModel.js`, `optionsModel.js`, `resourcesModel.js` | T | Free-text fields switch to `capitalizeFirst` (rule 2). |
| `utils/` | `reservationAudit.js` | T | Notes comparison uses `capitalizeFirst`. |
| `tests/` | `free-text-keeps-case.unit.test.js` | C | §7. |

No route, controller, middleware, scheduled task or schema change. No migration.

### 4.2 Client side (`client/src/`)

None. The client never changed the case.

### 4.3 API contract

Unchanged shape. Observable change: `notes` / `description` / `note` are returned as typed.

## 5. Data model

No change. Existing rows untouched (rule 4).

## 6. UI / UX

No visual change; the text simply stays as typed after save.

## 7. Test plan

- `server/src/tests/free-text-keeps-case.unit.test.js`:
  - `capitalizeFirst`: blank, null, leading digit/symbol, accents (« été » → « Été »), multi-line,
    already capitalised, all-caps acronyms kept.
  - reservation create + update keep « Booking » and the second line's capital;
  - client notes, devis notes, calendar note, option description, resource note keep their case;
  - labels still normalised (« FERMETURE HIVER » → « Fermeture hiver », client last name unchanged
    behaviour);
  - reservation audit: no false « notes changed » entry when the note is re-saved unchanged.
- Existing suites green (`cd server && npm test`).
- Manual: save a reservation note with two lines and « Booking » on dev → reload → unchanged.

## 8. Out of scope

- Repairing notes already stored in lowercase.
- Quirks of `sentenceCase` on names and cities (« Saint-étienne »).

## 9. Open questions

None.

## 10. Implementation progress

- 2026-10-15 — implemented: `capitalizeFirst` in `textFormatters.js`, 7 free-text call sites
  switched, `free-text-keeps-case.unit.test.js` (7 tests). Full server suite green (4660
  tests, the new file included). Manual check on dev: a two-line note with « Booking », « SAS », « TVA »
  saved from the fiche, reloaded unchanged, re-saved without a « Notes » history entry.
