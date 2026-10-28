# Clients — « À venir » / « Passés », date de séjour et tri par colonne

| Field | Value |
|---|---|
| **Status** | Implemented (rules 1-10) · **Draft** amendment of 2026-10-28 (rules 11-22, §3.5) |
| **Branch** | `feature/clients-upcoming-past-directory` _(user-managed)_ |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [clients.md](clients.md) |
| **Amendment 2026-10-28** | Branch `feature/clients-directory-and-fiche-tariff` · summary [docs/specs/2026-10-28-clients-directory-and-fiche-tariff.html](../docs/specs/2026-10-28-clients-directory-and-fiche-tariff.html) (interactive mockups, 1280 and 390 px) |

---

## 1. Context

The Clients page is one flat alphabetical list ([ClientsPage.jsx](../client/src/pages/ClientsPage.jsx)):
`GET /api/clients` returns every client ordered by `lastName, firstName`, and nothing on screen says
whether a client is expected next week or last came three years ago. Finding « qui arrive bientôt »
means going through the Planning instead.

Issue **#19** asks for three things: **two lists** (« à venir » / « passés »), a **stay-date column**
(the next stay when there is one, the last one otherwise), and **sortable column headers** — « comme
c'est fait pour la page Options », i.e. the `TableSortLabel` headers of
[PricedItemsPage.jsx](../client/src/components/PricedItemsPage.jsx). The search must keep working
across both lists.

## 2. Goal

The operator opens Clients on the people who are coming, sees when each one arrives, can flip to the
past clients, sort either list by name, first name or stay date, and search across both.

## 3. Functional rules

### 3.1 The two lists

1. **Bucket per client**, resolved server-side:
   - **À venir** — the client has at least one stay whose **end date is ≥ today**. A guest currently in
     a property counts as « à venir » (decision 2026-08-17): they are still in the operator's hands.
   - **Passés** — every stay of the client ended before today.
   - **A client with no stay at all** (created by hand, devis never converted) is listed in **« À venir »**
     with an empty date (decision 2026-08-17): nothing disappears from the screen the operator works on.
2. **Only real stays count** — `kind = 'reservation'`; a devis is not a stay.
3. **Presentation:** two **tabs centred in the page action bar** (« À venir » / « Passés »), the pattern
   already used by Options / Ressources. Only the active list is rendered. Each tab label carries its
   **count** for the current search (`À venir (3)`), which is what makes a search « afficher dans l'une
   ou l'autre des catégories » legible: an empty active tab with a non-zero count on the other one says
   where the match is.

### 3.2 The date column

4. A **« Séjour »** column shows the date of the stay that qualifies the client:
   - a client with an upcoming stay → the **start date of the NEXT stay** (the earliest one still
     running or to come);
   - a client with only past stays → the **start date of the LAST stay**;
   - no stay → **« — »**.
   Per issue #19: when a client has both, the upcoming stay wins.

### 3.3 Sorting

5. Three **sortable headers**: **Nom**, **Prénom**, **Séjour** — a `TableSortLabel` each, click to sort,
   click again to flip the direction (same interaction as the « Tarifs facturables » page).
6. **Default sort per tab**: « À venir » → `Séjour` ascending (the soonest arrival first); « Passés » →
   `Séjour` descending (the most recent stay first). Switching tab restores that tab's default.
7. **A client with no date sorts last**, whatever the direction — an empty cell is never « the smallest ».
8. Names sort with the **French locale** (accent-aware), server-side.

### 3.4 Search

9. The search box is unchanged (name, first name, email, phone, street, city, postal code) and applies
   **before** the bucket split, so the counts on both tabs describe the same query.
10. The list, the buckets, the counts and the order are all resolved **server-side**: the page renders
    what it receives.

**Edge cases:**
- A client whose only stay ends today → « À venir » (end date ≥ today).
- Two stays the same day → deterministic order (date, then last name, then id).
- Search with no match → the active tab shows the existing empty state, and both counts read 0.
- A client deleted / created keeps the current tab, search and sort (the page reloads with the same
  parameters).

### 3.5 Amendment of 2026-10-28 — a directory that reads at a glance, past clients out of the way

Feedback of 2026-10-28 on the `inte/plugins` shadow: « Dans la page Clients, je voudrais une UI plus
sympa et plus ergonomique, là elle est trop plate. Et je voudrais pouvoir cacher les clients dont la
réservation est déjà passée, ça doit même être l'affichage par défaut. »

What the shadow shows (prod copy of 2026-10-22, 78 clients): the « À venir » tab already opens by
default, but it lists **29** rows of which **20 have no stay at all** (18 with nothing, 2 with a devis
only) — rule 1 puts a stay-less client in « À venir ». The 9 real arrivals are drowned, and the page
reads as « everybody is there ». The row itself is one line of seven equal text columns (`Nom`,
`Prénom`, `Séjour`, `Email`, `Téléphone`, `CP`, `Ville`) plus two stacked icons that double its height:
nothing says *where* or *when* the guest comes, the platform, or how many times they came. The tabs
are small, in the bar, and a search with no match in the open tab says nothing about the other one.

Rules 1 (third bullet) and 5 are superseded by rules 11 and 17; every other rule of §3.1-§3.4 stands.

11. **Three views, one per bucket.** The server resolves each client into exactly one bucket:
    `upcoming` (at least one real stay whose end date is ≥ today — rule 1 unchanged for them), `past`
    (every real stay ended before today), `none` (no real stay: a devis only, or nothing at all). A
    stay-less client is no longer in « À venir » (supersedes the third bullet of rule 1). The views are
    labelled « À venir », « Passés », « Sans séjour », each with its count for the current search.
12. **« À venir » is what opens.** `/clients` without a view parameter shows `upcoming`. The view the
    operator picks is kept in the URL (`?vue=passes`, `?vue=sans-sejour`; absent = à venir), so the
    back button from a fiche and a shared link land on the same list. An unknown value falls back to
    à venir.
13. **Rows are grouped by when, server-side.** With the default sort (rule 17) each view comes as
    ordered groups `{ key, label, count, items }`:
    - `upcoming` → `inStay` « En séjour » (start ≤ today ≤ end), `next7` « 7 prochains jours » (start
      within today + 7), `next30` « 30 prochains jours », `later` « Plus tard »; an empty group is
      omitted.
    - `past` → one group per year of the last stay's start date, most recent year first (« 2026 »,
      « 2025 »…).
    - `none` → `devis` « Devis en cours » (at least one devis), then `nothing` « Aucune réservation ».
    With the name sort there is a single group without a label (a flat A → Z list).
14. **Each row says where and when.** Every item carries `stay` — the stay that qualifies it (rule 4:
    the next one, else the last one) as `{ reservationId, propertyName, startDate, endDate, nights,
    platform }` — or `null`, and a server-built `whenLabel`:
    - in stay → « En séjour · départ le 08/11 »; arriving today / tomorrow → « Arrive aujourd'hui » /
      « Arrive demain »; later → « Arrive dans 9 j » up to 60 days, then « Arrive le 24/12/2026 »;
    - past → « Parti le 27/10 » under 7 days, then « Parti il y a 3 sem. » under 2 months, « il y a 4
      mois » under 2 years, « il y a 2 ans » beyond (counted from the end date);
    - none → « Devis D-2026-014 · envoyé » for the most recent devis, else « Créé le 12/10/2026 ».
    The row renders `propertyName`, the dates and nights, the platform chip and `whenLabel`; it computes
    none of them.
15. **Loyalty is visible.** Each item carries `stayCount`, the number of real stays (all time, past and
    to come). From 2, the row shows « 3 séjours ».
16. **A search looks everywhere.** The search (rule 9, unchanged fields) runs over the three buckets;
    the counts of the three views describe the query. When the open view has no match and another one
    has, the payload names it (`elsewhere: { bucket, count }`, the bucket with the most matches) and the
    list shows « Aucun résultat dans À venir » with one button « 2 dans Passés » that switches view.
17. **One sort control, every width.** A single « Trier » select replaces the three sortable headers
    (supersedes rule 5): « Date de séjour » (default; per-view direction of rule 6; `none` sorts by
    creation date, newest first) or « Nom » (last name then first name, French locale, rule 8). Rules 6,
    7 and 8 stand. On `xs`, where the headers never existed, the operator can now sort too.
18. **A row opens the client; contact is one tap away.** Clicking a row opens the client sheet, as
    today. The email and the phone are links (`mailto:`, `tel:`) that do not open the sheet. The row
    carries no delete button any more: deletion goes through the sheet's « Supprimer », which opens the
    same impact dialog ([clients.md](clients.md) rule 10); `?deleteClientId=` deep links keep working
    (clients.md rule 11).
19. **« Nettoyer les clients » lives where the orphans are.** The button leaves the search row and sits
    at the head of the « Sans séjour » view, with the number of clients it would offer (no reservation
    **and** no devis — clients.md rule 8, unchanged dialog). It is hidden when that number is 0.
20. **Empty views say what to do.** « À venir » with no client and no search → « Aucune arrivée
    prévue. » and a button « Voir les passés (49) ». A search with no match anywhere → « Aucun client
    trouvé. » « Sans séjour » empty → « Tous les clients ont un séjour. »
21. **The page stays a renderer.** Buckets, groups, labels, counts, `elsewhere`, the orphan count and the
    order are computed by `clientsModel.directory`; the page holds the view, the search, the sort and
    the open sheet. `GET /api/clients` (pickers) is unchanged (rule 10 of §4.1 stands).
22. **Names never break the row.** A name, a property name or an email of any length truncates with an
    ellipsis on one line (full value in the `title` attribute and in the sheet); a client with an empty
    first name shows the last name alone; initials fall back to « ? » when both are empty.

**Edge cases (amendment):**
- A client in stay today and with a second stay next month → `upcoming`, group `inStay`, `stay` = the
  current one, `stayCount` 2.
- A client whose only stay ended yesterday → `past`, label « Parti le 27/10 » (rule 14).
- A devis-only client whose devis dates are in the future → `none`, group `devis` (a devis is not a stay,
  rule 2).
- A cancelled reservation (`cancelledAt` set) is not a stay for the bucket, the date, `stayCount` or the
  label — same as the planning. _(Today no row is cancelled on the shadow; the rule is set before one
  is.)_
- 0 clients in the base → the three counts read 0 and « À venir » shows rule 20's first state without
  its button.

---

## 4. Architecture

> **Fat backend.** The bucket, the stay date, the counts and the ordering are computed by the model;
> the page holds only the active tab, the search string and the sort state, and renders the payload.

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/clientsModel.js` | T | New `directory({ q, bucket, sort, dir })`: one query resolving per client the next stay (`MIN(startDate)` where `endDate >= today`) and the last one (`MAX(startDate)` where `endDate < today`), the derived `bucket` + `stayDate`, the per-bucket counts for the search, and the French-locale ordering. |
| `controllers/` | `controllers/clientsController.js` | T | `directory` handler: whitelists `bucket`/`sort`/`dir`, passes the search through, answers `{ items, counts }`. |
| `routes/` | `routes/clients.js` | T | `GET /api/clients/directory`, declared **before** `/:id` so the literal path wins. |

`GET /api/clients` (the plain array used by the reservation + resource-booking pickers) is **left
untouched**: a list page's shaping has no business changing what a picker receives.

**Amendment 2026-10-28 (rules 11-22):**

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `models/` | `models/clientsModel.js` | T | `directory({ q, view, sort, dir, today })`: one aggregate query per call (a `GROUP BY clientId` over non-cancelled real stays: next / last stay id + dates, `stayCount`; a second over devis: latest devis number + status) instead of two correlated sub-selects per client; resolves the three buckets, the groups, `stay`, `whenLabel`, `elsewhere`, `orphanCount`; `today` injectable for tests. |
| `utils/` | `utils/clientWhenLabel.js` | C | Pure: `(bucket, stay, latestDevis, createdAt, today) → whenLabel` (rule 14). French labels, unit-tested at every threshold. |
| `controllers/` | `controllers/clientsController.js` | T | `directory` whitelists `view` (`upcoming`/`past`/`none`; legacy `bucket` accepted as an alias) and `sort` (`stayDate`/`name`; legacy `lastName`/`firstName` map to `name`). |
| `routes/` | `routes/clients.js` | — | Unchanged (`GET /api/clients/directory`). |
| `middleware/`, `tasks/`, `database.js` | — | — | Untouched: no schema change, no job. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `services/` | `api.js` | T | `getClientsDirectory({ q, bucket, sort, dir })`. |
| `pages/` | `pages/ClientsPage.jsx` | T | Tabs in the bar (`barCenter`, xs strip like Options/Ressources) with the counts; sortable `Nom` / `Prénom` / `Séjour` headers; the new « Séjour » column (table + mobile card); reload on (search, tab, sort) and after every mutation. **2026-09-25:** the `Notes` column and the mobile note chip are removed. |

**Amendment 2026-10-28 (rules 11-22):**

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `services/` | `api.js` | T | `getClientsDirectory({ q, view, sort, dir })`. |
| `pages/` | `pages/ClientsPage.jsx` | T | View from `?vue=` (rule 12); `PageTabs` with three counts; search + « Trier » select in the top row; renders the server groups through `GroupedListCard`; the `elsewhere` switch (rule 16); « Nettoyer » at the head of « Sans séjour » (rule 19); drops the table head, the sortable headers and the row delete icon. The sheet, the impact dialog and the cleanup dialog are untouched. |
| `components/` | `components/GroupedListCard.jsx` | C | **Generic**: a card listing ordered groups (`label`, `count`, rows rendered by the caller) with a sticky group heading on `md+`, an `EmptyState` slot and keyboard-reachable rows. Generic because the « Réservations à venir » list and the Devis list group by period the same way; it knows nothing about clients. |
| `components/` | `components/ClientDirectoryRow.jsx` | C | Specific: one client row — initials, name, `whenLabel`, property · dates · nights, `PlatformChip`, « N séjours », `mailto:` / `tel:` links (rule 18, 22). Desktop: one line in four zones; `xs`: three lines. |
| `components/` | `components/DataPageScaffold.jsx` | T | Gains an optional `body` prop: custom content rendered in place of the table, keeping the bar, `topContent`, loading / error states. Without it nothing changes for the other pages. |
| `constants/` | `constants/clientsDirectory.js` | C | The French UI strings of the page (view labels, sort labels, empty states, « Nettoyer les clients »). |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `DataPageScaffold` (incl. `barCenter`), MUI `Tabs`/`Tab`, `TableSortLabel` | Reused as-is — the tab-in-bar pattern is `OptionsResourcesPage`, the sortable header is `PricedItemsPage`. |
| **Created (new generic)** | — | None. |
| **Amendment 2026-10-28 — consumed** | `DataPageScaffold` (+ `body`), `PageTabs`, `PlatformChip`, `StatusBadge`, `EmptyState`, `LoadingState`, `ErrorAlert`, `FormDialog`, `ClientFormFields`, `ClientCleanupDialog` | `TableSortLabel` is no longer used on this page. |
| **Amendment 2026-10-28 — created** | `GroupedListCard` (generic), `ClientDirectoryRow` (specific) | See the table above for why. |

### 4.3 API contract

`GET /api/clients/directory?q=&bucket=upcoming|past&sort=lastName|firstName|stayDate&dir=asc|desc`

```json
{
  "items": [{ "...client fields": "…", "bucket": "upcoming", "stayDate": "2026-08-20" }],
  "counts": { "upcoming": 3, "past": 46 }
}
```

Unknown `bucket` / `sort` / `dir` fall back to the defaults (`upcoming`, `stayDate`, per-bucket
direction). `GET /api/clients` unchanged.

**Amendment 2026-10-28** — `GET /api/clients/directory?q=&view=upcoming|past|none&sort=stayDate|name&dir=asc|desc`

```json
{
  "view": "upcoming",
  "sort": "stayDate", "dir": "asc",
  "counts": { "upcoming": 9, "past": 49, "none": 20 },
  "orphanCount": 18,
  "elsewhere": null,
  "groups": [
    {
      "key": "inStay", "label": "En séjour", "count": 1,
      "items": [{
        "id": 41, "lastName": "Morel", "firstName": "Inès", "email": "ines.morel@example.fr",
        "phone": "06 12 34 56 78", "postalCode": "69003", "city": "Lyon",
        "bucket": "upcoming", "stayDate": "2026-10-26",
        "stay": { "reservationId": 22324, "propertyName": "La Granja", "startDate": "2026-10-26",
                  "endDate": "2026-11-08", "nights": 13, "platform": "Booking" },
        "stayCount": 2,
        "whenLabel": "En séjour · départ le 08/11"
      }]
    }
  ]
}
```

`items` flattened in group order equals the former `items` array; the server still answers `items` for
one release so a stale tab never breaks (removed in the next minor). `elsewhere` is
`{ "view": "past", "count": 2 }` or `null`. `orphanCount` counts clients with no reservation and no
devis (the cleanup dialog's set).

---

## 5. Data model

No schema change, no migration: the buckets are derived from `reservations.startDate` / `endDate` at
read time.

**Amendment 2026-10-28:** still no schema change and no migration. The amendment reads
`reservations.cancelledAt` (existing column) to leave cancelled stays out, and `reservations` rows of
`kind = 'devis'` for the « Sans séjour » label.

## 6. UI / UX

- **Tabs** « À venir (n) » / « Passés (n) », centred in the action bar on `sm+`, slim strip under the
  bar on `xs` (same as Options / Ressources).
- **Table (md+)**: `Nom` · `Prénom` · `Séjour` · `Email` · `Téléphone` · `CP` · `Ville` · actions. The
  three first headers carry a sort arrow. _(2026-09-25: the `Notes` column is removed — a note is too
  long to survive a 30-character truncation and too private for a shared screen; it lives in the client
  sheet. Same for the chip the `xs` card used to carry. See `specs/clients.md` §6.)_
- **Mobile (`xs`)**: the existing card gains a date line — « Séjour : 20/08/2026 » — under the name.
  Sorting stays available through the (hidden) table headers? No: on `xs` the cards are ordered by the
  same server sort, and the tab strip stays reachable; no extra control is added.
- Empty state, search field, « Cleanup clients » button, create/edit dialog: unchanged.

### Amendment 2026-10-28 — the directory (rules 11-22)

Mockups: [docs/specs/2026-10-28-clients-directory-and-fiche-tariff.html](../docs/specs/2026-10-28-clients-directory-and-fiche-tariff.html).

- **Bar:** title « Clients », `PageTabs` centred « À venir 9 · Passés 49 · Sans séjour 20 » (`sm+`),
  slim strip under the bar on `xs`; « Nouveau client » stays the bar's action.
- **Top row:** search field (full width on `xs`) + « Trier : Date de séjour ▾ » select; on `xs` the
  select goes under the search, full width.
- **List (`md+`):** one white card (`GroupedListCard`); each group opens with a small heading
  (`kpiLabel` style, « EN SÉJOUR · 1 ») that sticks under the action bar while its rows scroll. A row,
  72 px high, four zones: [initials 40 px, soft primary background] [last name in 600 + first name,
  `whenLabel` underneath in `text.secondary`, « En séjour » in success tone] [property · « 06/11 →
  08/11/2026 · 2 nuits » + `PlatformChip`] [email and phone, ellipsised, right-aligned]. Hover tints
  the row (`action.hover`), the whole row is the click target, focus ring visible. « 3 séjours » is a
  neutral `StatusBadge` after the name.
- **List (`xs`):** same card, rows on three lines: name + « 3 séjours »; `whenLabel`; property · dates
  + platform chip. Phone is a `tel:` icon button (44 × 44) at the right, email inside the sheet only.
  No horizontal scroll.
- **Sans séjour:** a header strip « 18 clients sans réservation ni devis » + « Nettoyer les clients »
  (outlined warning) above the groups.
- **Search miss:** inside the card, « Aucun résultat dans À venir » + button « 2 dans Passés ».
- **Motion:** none added beyond MUI's tab indicator; switching view swaps the list (no slide).

## 7. Test plan

### Server unit tests (`server/src/tests/clients-directory.unit.test.js`, 8 tests)
- [x] A client with a future stay → `bucket = 'upcoming'`, `stayDate` = that stay's start date.
- [x] A client with a stay in progress (started, not ended) → `upcoming`.
- [x] A client with both a past and a future stay → `upcoming`, with the FUTURE date.
- [x] A client with only past stays → `past`, with the LAST stay's start date.
- [x] A client with no stay → `upcoming`, `stayDate = null`; a devis-only client too (a devis is not a
      stay).
- [x] `counts` describe the searched set, whatever the requested bucket.
- [x] Sorting: by `stayDate` asc/desc, by `lastName` (accent-aware), and null dates last in both
      directions.
- [x] The search still matches email / phone / city and applies before the split.

### Client tests (vitest, `pages/__tests__/ClientsPage.test.jsx`)
- [x] The two tabs render with their counts; clicking « Passés » reloads with `bucket=past`.
- [x] Clicking the « Séjour » header reloads with `sort=stayDate` and flips the direction.
- [x] The stay date renders in the row (and « — » when empty).

### Manual UI verification
- [x] Both tabs, the sort and the search exercised in the browser, desktop + mobile. Screenshot in the PR.

### Amendment 2026-10-28 — tests

Server — `server/src/tests/clients-directory-views.unit.test.js` (new, 14 cases):
- [ ] rule 11 — a stay-less client is `none`, not `upcoming`; a devis-only client too; counts of the three views.
- [ ] rule 11 — a cancelled reservation does not make a client `upcoming`, nor count in `stayCount`.
- [ ] rule 12 — unknown `view` falls back to `upcoming`; legacy `bucket=past` still answers the past view.
- [ ] rule 13 — upcoming groups at the thresholds (in stay, J+7, J+8, J+30, J+31), empty groups omitted, order.
- [ ] rule 13 — past groups by year, newest first; none groups `devis` before `nothing`; name sort → one unlabelled group.
- [ ] rule 14 — `stay` is the next stay when both exist, the last one otherwise, `null` when none.
- [ ] rule 15 — `stayCount` counts past and future real stays.
- [ ] rule 16 — the search spans the three views; `elsewhere` names the view with the most matches, `null` when the open view matches.
- [ ] rule 17 — `sort=name` French-locale order; `none` sorted by creation date desc; legacy `lastName` maps to `name`.
- [ ] rule 19 — `orphanCount` equals `listOrphans().length`.
- [ ] rule 21 — `GET /api/clients` payload unchanged (plain array).
- [ ] rule 13 — groups' `items` flattened equal the legacy `items` field.

Server — `server/src/tests/client-when-label.unit.test.js` (new, 10 cases): rule 14 at every threshold
(in stay, today, tomorrow, J+60, J+61, ended J-1, J-7, J-60, J-730, devis label, creation date).

Client — `client/src/pages/__tests__/ClientsPage.directory-views.test.jsx` (new, 8 cases):
- [ ] rule 12 — opens on « À venir » without `?vue=`; `?vue=passes` opens Passés; switching view writes the URL.
- [ ] rule 13 — renders the server groups' labels and counts, in order, and no client-side regrouping.
- [ ] rule 16 — the `elsewhere` button switches view.
- [ ] rule 17 — the « Trier » select reloads with `sort=name`.
- [ ] rule 18 — clicking the phone link does not open the sheet; no delete button in a row.
- [ ] rule 19 — « Nettoyer les clients » only in « Sans séjour », hidden when `orphanCount` is 0.
- [ ] rule 20 — the three empty states.
- [ ] rule 22 — a 120-character name renders on one line with a `title`.

Client — `client/src/components/__tests__/GroupedListCard.rendering.test.jsx` (new, 4 cases): groups
and counts, empty slot, unlabelled single group, rows reachable by keyboard.

The existing `ClientsPage.test.jsx` (tabs/sort headers) and `ClientsPage.delete.test.jsx` (headers, row
trash) are updated: the header assertions move to the new row structure, the « re-click the trash »
case goes through the sheet's « Supprimer ».

E2E — `e2e/specs/clients/clients-directory.spec.js` (new, 3): opens on À venir with no past client;
switch to Passés and back from a fiche keeps `?vue=passes`; 390 px: no horizontal scroll, `tel:` link.

Manual — shadow copy at 390 / 900 / 1280: the three views, the search miss, a long name, the cleanup
from « Sans séjour ».

## 8. Out of scope

- Pagination (49 clients today; the page still loads a full list).
- Filtering by property or by platform.
- Showing the stay's property / number in the column (date only, per the issue).
- Touching `GET /api/clients` (pickers keep their plain array).

**Amendment 2026-10-28 — out of scope:** pagination and virtualisation (78 clients today; the single
aggregate query keeps the page one round-trip), a « Fidèles » view or tags, merging duplicate clients,
bulk e-mail from the list, and the client sheet itself (unchanged).

## 9. Open questions

Resolved during scoping (2026-08-17, issue #19):
- **Présentation** → **onglets dans la barre d'action** (rejected: two stacked tables).
- **Séjour en cours** → **« À venir »** (rejected: only strictly future stays count).
- **Clients sans séjour** → **« À venir »** (rejected: « Passés », and a third tab).

### Amendment of 2026-10-28 — resolved

- **Q-A. Where do clients without a stay go? — Resolved 2026-10-28:** (a) their own view « Sans séjour »,
  with « Nettoyer les clients » in it. Rejected: (b) with « Passés »; (c) unchanged in « À venir ».
- **Q-B. The row delete icon. — Resolved 2026-10-28:** (a) removed; deletion through the client sheet
  only. Rejected: (b) a « ⋯ » menu per row.
