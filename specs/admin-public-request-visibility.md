# Admin visibility of public (WordPress) booking requests

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/admin-public-request-badge` _(user-managed)_ |
| **Created** | 2026-06-09 |
| **Author** | Adrien |
| **Depends on** | [public-api.md](public-api.md) (#142 — the `requestOrigin='public'` draft devis) |

---

## 1. Context

The public API ([public-api.md](public-api.md)) creates a **draft devis** flagged
`requestOrigin='public'` for each booking request submitted from the WordPress showcase site. Until
now there was no way for the operator to tell those apart from internally-created devis in the admin
**Devis** list — the request would silently sit among the others.

## 2. Goal

In the admin Devis list, public-origin booking requests are visually flagged and can be filtered, so
the operator immediately sees and can process requests that arrived from WordPress.

## 3. Functional rules

1. Each devis row whose `requestOrigin === 'public'` shows a **« Site internet »** badge (`StatusBadge`,
   info, globe icon) + tooltip « Demande de réservation reçue depuis le site internet ». (Wording
   aligned on the code at the 2026-10-27 spec review: the operator's word is « site internet », not
   the CMS behind it.)
2. The Devis list gains an **"Origine"** filter: *Toutes* (default) / *Demandes du site internet*
   (`public`) / *Devis internes* (`internal` = `requestOrigin` NULL or any non-`public` value).
3. The filter is applied **server-side** (`GET /api/devis?requestOrigin=public|internal`), consistent
   with the existing `status` filter.
4. Devis created in the admin (no `requestOrigin`) are unaffected — no badge, counted as "internes".

**Edge cases:**
- A `public` request later converted/edited keeps its `requestOrigin` (badge persists) — useful audit
  trail of where it came from.
- Pre-existing devis (before the column) have `NULL` requestOrigin → "internes".

---

## 4. Architecture

### 4.1 Server side (`server/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `models/` | `models/devisModel.js` | T | `list()` accepts a `requestOrigin` filter (`'public'` → `requestOrigin='public'`; `'internal'` → NULL or non-public). `requestOrigin` is already surfaced per row via `SELECT d.*`. |
| `controllers/` | `controllers/devisController.js` | — | No change — `list` already passes `req.query` through to the model. |

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility |
|---|---|---|---|
| `pages/` | `pages/DevisPage.jsx` | T | New "Origine" `Select` filter (wired to `requestOrigin` query param) + a « Site internet » `StatusBadge` on rows where `requestOrigin === 'public'`. |
| `services/` | `api.js` | — | `getDevis(params)` already forwards arbitrary params. |

**Component reuse:** MUI `Chip` / `Select` / `Tooltip` (existing primitives). No new component.

### 4.3 API contract

`GET /api/devis?requestOrigin=public` (or `internal`) — additive optional query param; existing
callers unaffected. Response shape unchanged (each devis already carries `requestOrigin`).

## 5. Data model

No change (uses the `reservations.requestOrigin` column from public-api.md).

## 6. UI / UX

- Devis table: a small **« Site internet »** badge (`StatusBadge`, info, globe icon) next to the devis
  number for public requests; the tooltip explains the origin.
- A second filter dropdown "Origine" beside the existing "Statut" filter. Responsive: filters stack on
  narrow screens (existing `Stack` behavior).

## 7. Test plan

### Server unit tests
- [x] `devis-model` (extended, +1): `list({ requestOrigin: 'public' })` returns only public rows;
  `'internal'` returns NULL + non-public rows; no filter returns all.

### Client
- [x] Full client suite green (398). Badge + filter are presentational wiring over the existing list.

### Manual UI verification
- [ ] Submit a booking request via the public API → it appears in the Devis list with the « Site
  internet » badge; the « Origine → Demandes du site internet » filter narrows to it. *(pending — needs
  the running app.)*

## 8. Out of scope

- A dashboard notification card for new public requests (possible later, mirroring the iCal-imports card).
- Editing/clearing `requestOrigin` from the UI (it's an immutable origin marker).

## 9. Open questions

(None.)
