# Clients — « À venir » / « Passés », date de séjour et tri par colonne

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/clients-upcoming-past-directory` _(user-managed)_ |
| **Created** | 2026-08-17 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Extends** | [clients.md](clients.md) |

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

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `services/` | `api.js` | T | `getClientsDirectory({ q, bucket, sort, dir })`. |
| `pages/` | `pages/ClientsPage.jsx` | T | Tabs in the bar (`barCenter`, xs strip like Options/Ressources) with the counts; sortable `Nom` / `Prénom` / `Séjour` headers; the new « Séjour » column (table + mobile card); reload on (search, tab, sort) and after every mutation. |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `DataPageScaffold` (incl. `barCenter`), MUI `Tabs`/`Tab`, `TableSortLabel` | Reused as-is — the tab-in-bar pattern is `OptionsResourcesPage`, the sortable header is `PricedItemsPage`. |
| **Created (new generic)** | — | None. |

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

---

## 5. Data model

No schema change, no migration: the buckets are derived from `reservations.startDate` / `endDate` at
read time.

## 6. UI / UX

- **Tabs** « À venir (n) » / « Passés (n) », centred in the action bar on `sm+`, slim strip under the
  bar on `xs` (same as Options / Ressources).
- **Table (md+)**: `Nom` · `Prénom` · `Séjour` · `Email` · `Téléphone` · `CP` · `Ville` · `Notes` ·
  actions. The three first headers carry a sort arrow.
- **Mobile (`xs`)**: the existing card gains a date line — « Séjour : 20/08/2026 » — under the name.
  Sorting stays available through the (hidden) table headers? No: on `xs` the cards are ordered by the
  same server sort, and the tab strip stays reachable; no extra control is added.
- Empty state, search field, « Cleanup clients » button, create/edit dialog: unchanged.

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

## 8. Out of scope

- Pagination (49 clients today; the page still loads a full list).
- Filtering by property or by platform.
- Showing the stay's property / number in the column (date only, per the issue).
- Touching `GET /api/clients` (pickers keep their plain array).

## 9. Open questions

Resolved during scoping (2026-08-17, issue #19):
- **Présentation** → **onglets dans la barre d'action** (rejected: two stacked tables).
- **Séjour en cours** → **« À venir »** (rejected: only strictly future stays count).
- **Clients sans séjour** → **« À venir »** (rejected: « Passés », and a third tab).
