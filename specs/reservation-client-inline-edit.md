# Reservation page — client section: bold name + click-to-edit (no dropdown)

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/reservation-client-inline-edit` _(user-managed)_ |
| **Created** | 2026-06-11 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

On the reservation page (`pages/ReservationPage.js`), the **Client** section was a single
`Autocomplete` dropdown (« Rechercher ou créer un client ») used both to **attach** a client and to
**display** the attached one. There was no way to **edit the attached client's fiche** from the
reservation, and the dropdown felt heavy for what is, most of the time, an already-attached client.

## 2. Goal

Show the attached client's **name in bold** (clear, not oversized, consistent with the page), make it
**clickable to edit that client's fiche**, keep **« + créer un nouveau client »** below — while still
allowing a different **existing** client to be attached via a search that stays out of the way.

## 3. Functional rules

1. When a client is attached, the Client section shows the client's **full name in bold** (≈1rem,
   weight 700) with a person icon and a small edit icon. It is not a heading-sized title.
2. **Clicking the name (or Enter/Space when focused)** opens the client's fiche in an edit dialog
   (same fields as creation), pre-filled with the client's data; saving updates the client via
   `PUT /api/clients/:id` and refreshes the displayed name immediately.
3. A discreet **« Changer le client »** text link below the name reveals the search (the former
   Autocomplete) to attach a **different existing** client. Picking one collapses back to the bold
   name. This preserves the repeat-guest flow (no forced duplicate creation).
4. When **no** client is attached (e.g. a fresh reservation), the **search is shown directly**.
5. **« + créer un nouveau client »** is always shown below; it opens the same dialog in *create* mode
   and attaches the new client.
6. The create/edit dialog is the **same** `FormDialog` + `ClientFormFields`, switched by a
   `clientDialogMode` flag (`'create'` | `'edit'`); the title reads « Créer un nouveau client » or
   « Modifier la fiche client » accordingly.

**Edge cases:**
- Initial load / deep-link: the bold name resolves even if the client isn't in the current search
  list — `selectedClient` is fetched by id when not found locally.
- Email/phone format validation still gates the dialog's save (create and edit).
- Editing only changes the client record; it does not detach/re-attach (the same `clientId` stays).

---

## 4. Architecture

> **Fat backend, thin frontend.** No business logic added — the client CRUD endpoints already exist
> (`GET/PUT /api/clients/:id`). This is presentational wiring + reuse of the existing client form.

### 4.1 Server side
| Layer | File | T/C | Responsibility |
|---|---|---|---|
| — | — | — | **No change.** Reuses `GET /api/clients/:id` and `PUT /api/clients/:id`. |

### 4.2 Client side (`client/src/`)
| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | `ReservationPage.js` | T | Replace the Client Autocomplete with: bold clickable name (`selectedClient`) → edit dialog; « Changer le client » toggles `clientSearchOpen` to reveal the search; create/edit share the dialog via `clientDialogMode`. New `selectedClient` state + an effect syncing it from `form.clientId` (from the search list or fetched by id). `openCreateClient` / `openEditClient` / `handleSaveClient` (create→POST, edit→PUT). |
| `components/` | `ClientFormFields`, `FormDialog` | — | Reused as-is for both create and edit. |
| `api.js` | `api.js` | — | Reused (`getClient`, `updateClient`, `getClients`, `createClient`). |

**Component reuse declaration:** consumes existing `ClientFormFields` + `FormDialog`; the bold-name
block is a tiny inline presentational element (no new generic component warranted).

### 4.3 API contract
No change.

## 5. Data model
No schema change. Uses existing `clients` columns (lastName, firstName, streetNumber, street,
postalCode, city, address, phone, email, notes).

## 6. UI / UX
- **Attached client:** `[👤] **Prénom Nom** [✎]` on a hover-highlighted, fit-width clickable row;
  below it a text link « Changer le client », then « + créer un nouveau client ».
- **No client / change mode:** the search field (« Rechercher un client », autofocused when opened
  via « Changer »), with « Créer un nouveau client » in its empty state, and « + créer… » below.
- **Dialog:** title « Modifier la fiche client » (edit) / « Créer un nouveau client » (create).
- **Responsive:** unchanged card; the bold-name row and links wrap naturally on `xs`.

## 7. Test plan
### Client
- [x] Client build green (Vite) — imports + JSX compile.
- [ ] Manual UI verification (GuestFlow runs on the user's env): attached client shows the bold name;
      clicking it edits the fiche and the name refreshes; « Changer le client » reveals the search and
      picking another collapses back; a fresh reservation shows the search; « + créer » still works.

> No isolatable pure logic was added (the change is presentational wiring around existing CRUD), so
> there is no new unit test; correctness is covered by the build + the manual checks above.

## 8. Out of scope
- Changing the client CRUD endpoints or the `ClientFormFields` content.
- Detaching a client without attaching another.
- Any change to how the public/iCal flows attach clients.

## 9. Open questions — resolved 2026-06-11
- Attaching an existing client after removing the dropdown → **keep a collapsed search** behind a
  « Changer le client » link (operator's choice), so repeat guests don't create duplicates.
