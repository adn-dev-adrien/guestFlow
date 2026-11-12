# Resource booking — a client picker ordered by stay and searchable

| Field | Value |
|---|---|
| **Status** | Implemented (2026-11-12) |
| **Branch** | `feature/resource-booking-client-picker` |
| **Created** | 2026-11-12 |
| **Author** | Adrien |
| **Related PR** | [#1040](https://github.com/adn-dev-adrien/guestFlow/pull/1040) |
| **Plugins** | `hourly-resources` (consumer of a core read) |
| **Builds on** | [`clients-upcoming-past-directory.md`](clients-upcoming-past-directory.md) (buckets, qualifying stay, labels), [`resource-booking-pricing-and-invoicing.md`](resource-booking-pricing-and-invoicing.md) (the dialog) |
| **Summary for decision** | [`docs/specs/2026-11-12-resource-booking-client-picker.html`](../docs/specs/2026-11-12-resource-booking-client-picker.html) (interactive mockup, desktop and 390 px) |

---

## 1. Context

Request of 2026-11-12: « Dans Ressources, sur le bain nordique, si je veux ajouter une session et que
je clique sur Client enregistré, fais apparaître en premier les clients en cours ou à venir les plus
proches, puis le reste des clients à venir, et enfin les clients dont le séjour est passé. Il faudrait
pouvoir taper du texte pour faire une recherche dans cette liste. »

Today the « Client enregistré » switch of
[`ResourceBookingDialog.jsx`](../client/src/plugins/hourly-resources/ResourceBookingDialog.jsx) shows
an MUI `Autocomplete` fed by `GET /api/clients`: every client, **alphabetical**, one line « Prénom
Nom ». The operator books a bath for a guest who is on site, and has to scroll past dozens of people
who left months ago. Typing already filters, but only on the exact « Prénom Nom » text: « dupont jean »,
an accent left out, an email or the property name find nothing, and nothing on the line says who is
here now.

The server already knows, per client, the qualifying stay, its property and its dates
(`clientsModel.directory`, rules 11-14 of the directory spec). The picker just never asked.

## 2. Goal

When adding or editing a session, the client list opens on the guests who are there, then the next
arrivals, then the rest of the upcoming ones, then the past ones; each line says where and when; and
typing narrows the list on name, first name, email, phone or property, in any order and without caring
about accents.

## 3. Functional rules

### 3.1 Order and groups

1. **One read, ordered server-side.** The picker's options come from a new core read
   `GET /api/clients/picker?date=YYYY-MM-DD`, already ordered and grouped. The client renders the order
   it receives; it never sorts.
2. **Reference day.** The groups are computed against the **session's date** (`date` of the dialog),
   falling back to today when the date field is empty (the dialog still asks; the server answers for
   today). A bath on 20/12 is for whoever is on site on 20/12. While a new day is being asked, the
   previous day's list is not shown, and an answer arriving late for an older day is dropped.
   _(Decision A of 2026-11-12, §9.)_
3. **Three groups, in this order** (decision B of 2026-11-12; an empty group is omitted):
   1. `soon` « En séjour ou bientôt » — a real stay covers the reference day (`start ≤ day ≤ end`; the
      arrival day and the departure day both count, a bath can be taken on either), **or** the next
      stay starts within reference day + 7. When the reference day is not today the label reads « En
      séjour le 20/12 ou bientôt ». Clients on site first (departure ascending), then the arrivals
      (arrival ascending).
   2. `upcoming` « À venir » — every other client with a stay to come. Arrival ascending.
   3. `past` « Passés » — every real stay ended before the reference day, most recent departure
      first; then the clients without any real stay (a devis only, or nothing), last name then first
      name, French locale.
   Ties break on last name, first name, id (deterministic).
4. **Only real stays count** — `kind = 'reservation'`, as in the directory (rule 2 there). A
   cancelled stay or a devis does not place a client in `soon` / `upcoming`.
5. **Each option carries its own line.** `{ id, firstName, lastName, group, groupLabel, detail,
   searchText }` where `detail` is server-built:
   - with a qualifying stay → « La Granja · 18/12 → 22/12/2026 » (property name + `stayDatesLabel`);
   - without one → the email, else the phone, else « Aucun séjour ».
   The qualifying stay is the one covering the reference day, else the next one, else the last one.

### 3.2 Search

6. **Typing filters the list in place**, keeping the groups and their order; a group with no match
   disappears.
7. **What a query matches.** The query is split on spaces; an option matches when **every** word is
   found in its `searchText`. `searchText` is built server-side: first name, last name, email, phone
   (digits only too, so « 0612 » finds « 06 12 34… »; a `+33` number also in its national form, so
   « 0612 » finds « +33 6 12 34… » — review of 2026-11-12), property name of the qualifying stay —
   lower-cased and accent-stripped. The client applies the same lower-case + accent strip to what is
   typed; a typed word made of digits and separators (« 06.12 ») also matches on its digits, and a word
   made of separators only (« . ») is ignored.
8. **No match** → « Aucun client trouvé ». The « Client externe » switch stays where it is, so a
   walk-in guest is one tap away.

### 3.3 What does not change

9. Selecting, saving and editing a booking are unchanged: the dialog still sends `clientId`. A booking
   being edited opens with its client selected even when that client is in « Passés ».
10. `GET /api/clients` (other pickers, ReservationPage) is unchanged.

**Edge cases:**
- A client with two upcoming stays → placed by the nearest one; `detail` shows that one.
- A client who leaves on the reference day and another arrives the same day → both in `soon`, the
  leaving one first (departure ascending).
- Reference day far in the future (session booked for July) → the July guests come first, everyone
  who leaves before then is « Passés ». That is the intended reading of rule 2.
- Name of 60 characters / property name long → the option truncates with an ellipsis on one line per
  row, never wraps the dialog wider.
- Zero client in the database → « Aucun client trouvé » in the list, the switch to « Client externe » works.

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | `clients.js` | T | `GET /clients/picker`, declared before `/:id`. |
| `controllers/` | `clientsController.js` | T | `picker(req, res)` — hands `req.query.date` to the model and returns its payload (the model judges the day: `isRealIsoDay`, else today). |
| `models/` | `clientsModel.js` | T | `picker({ date, today })` — two reads (clients, real stays), group + order + `detail` + `searchText`. Reuses `stayDatesLabel`, `addDays`, `compareNames` (French collator), `isRealIsoDay`. |
| `utils/` | `searchText.js` | C | Pure `normalizeSearchText(...parts)` — joins the non-empty parts, lower-case, NFD accent strip, collapse spaces. Shared by the model; mirrored by one tiny client helper (rule 7). |
| `database.js` | — | — | (none) |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `plugins/hourly-resources/` | `ResourceBookingDialog.jsx` | T | Loads `api.getClientPicker(date)` once the dialog has its date and again when `date` changes (the latest answer wins); renders `ClientPickerField` from the SDK. Plugin **1.6.0**, `sdk ^2.27.0`, French changelog lines in `manifest.json`. |
| `components/` | `ClientPickerField.jsx` | C | Generic grouped, searchable client `Autocomplete` (props: `options`, `value`, `onChange`, `disabled`, `label`). Generic because ReservationPage and the devis client field are the next candidates (out of scope here). |
| `utils/` | `searchMatch.js` | C | `matchesSearch(searchText, query)` — normalise the query, every word must be included. No business rule: the server decides what is searchable. |
| `api.js` | `api.js` | T | `getClientPicker(date)`. |
| `plugins/sdk/` | `index.js` | T | Exports `ClientPickerField` to plugins — an added client SDK entry point, so **SDK 2.27.0** (MINOR, `server/src/plugins/sdk/version.js`). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | MUI `Autocomplete`, `TextField` | |
| **Created (new generic)** | `ClientPickerField` | Any screen that picks a client can take it as is. |
| **Specific (kept feature-local)** | — | |

### 4.3 API contract

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/clients/picker` | `?date=YYYY-MM-DD` (optional) | `{ referenceDay, options: [{ id, firstName, lastName, group, groupLabel, detail, searchText }] }` | Authenticated like every `/api/clients/*`. Bad / absent `date` → today. Ordered by rule 3. |

---

## 5. Data model

No schema change. Two read queries per call (clients; real stays joined with property names).

## 6. UI / UX

- **Field:** label « Client * », placeholder « Rechercher un client », search icon at start. Opening the
  list (focus or tap) shows it immediately, no need to type.
- **Option (two lines):** line 1 « Prénom Nom » (body2, 500); line 2 `detail` (caption, muted). Min
  height 48 px. Both lines single-line with ellipsis.
- **Group header:** sticky inside the list (MUI `ListSubheader` default), small caps-free label in
  `text.secondary`, with the group's count (« En séjour ou bientôt · 2 »).
- **Empty:** « Aucun client trouvé ».
- **Responsive:** the dialog is already `fullScreen` on `xs`. On `xs` the list opens below the field
  with MUI's default height (40 % of the viewport, then scroll); options keep 48 px rows (touch). On
  `md` / `lg` the list is the width of the field, same default height. No horizontal scroll.
- **Motion:** none added — MUI's default popper.
- No `PageActionBar` change (dialog only).

## 7. Test plan

**Server — `server/src/tests/clients-picker.unit.test.js`** (new):
- group order on a fixture covering every group, reference day = today;
- reference day in the future moves a guest from `upcoming` to `soon` and an earlier guest to `past`;
- arrival day and departure day both count as on site; day + 7 is in `soon`, day + 8 is not;
- devis-only and cancelled-only clients land at the end of `past`, after the real past stays;
- in-group order (on site by departure then arrivals, arrival asc, most recent past first then names fr-locale) and tie-break;
- `detail` with stay / email / phone / nothing; `searchText` accent-stripped with digits-only phone;
- invalid `date` falls back to today;
- rule 10: `GET /api/clients` (`model.list()`) stays alphabetical;
- a `+33` number is searchable in its national form, another country code is not rewritten.

**Client — `client/src/plugins/hourly-resources/__tests__/ResourceBookingDialog.client-picker.test.jsx`** (new):
- options render under their group headers in server order;
- « jean dupont » and « dupont jéan » both find « Jean Dupont »; a property name finds its guests;
- no match shows « Aucun client trouvé »;
- changing the session date reloads the picker with that date; a late answer for the previous day is
  dropped (out-of-order promises);
- an emptied date still asks (the server answers for today);
- an edited session keeps its client, selected in the open list;
- a phone typed with separators matches on its digits; a lone separator is ignored.
- Existing dialog suites: their `api` mocks gain `getClientPicker` (fixtures only, no behaviour change).

**E2E — `e2e/specs/plugins/hourly-resources-client-picker.spec.js`** (new, 2 tests): the past stays are seeded ahead then moved with `setReservationDates` (the API refuses a stay in the past).

**Manual:** run `npm run test:e2e`; in the browser, Ressources → Bain nordique → add a session on
a day with a guest on site: the guest is first; type part of a property name; repeat at 390 px.

## 8. Out of scope

- The client field of ReservationPage and of the devis (same component later, separate spec).
- Searching on the server with a query string (the list is small; the server provides the text to search).
- Creating a client from the picker.

## 9. Open questions

_Resolved 2026-11-12:_
- **A. Reference day** → the **session date** (today when the dialog has none). Rule 2.
- **B. Groups** → **three** groups, as worded in the request: « En séjour ou bientôt », « À venir »,
  « Passés » (clients without a stay at the end of « Passés »). Rule 3. The five-group variant (same
  words as the Clients page) was shown and not kept.

## 10. Implementation progress

- [x] Server read + unit tests — `clients-picker.unit.test.js`, 13 tests (rule 10 included).
- [x] `ClientPickerField` + dialog wiring + client tests — `ResourceBookingDialog.client-picker.test.jsx`, 7 tests; the six other dialog suites mock `getClientPicker`.
- [x] SDK 2.27.0, `hourly-resources` 1.6.0.
- [x] E2E `e2e/specs/plugins/hourly-resources-client-picker.spec.js` (2 tests: order + search at 1280 px, 48 px rows and no horizontal scroll at 390 px); full suite 214/214; server 11 979/11 979; client 3 988/3 988.
- [x] Changelog fragments
- [x] Agent review of 2026-11-12: stale-answer guard tested, empty date asks for today, previous list cleared while loading, `+33` national form and phone separators searchable, rule-9 test checks the selected option, spec wording aligned. The E2E timezone remark was a false positive (`playwright.config.js` sets `TZ=Europe/Paris`).
