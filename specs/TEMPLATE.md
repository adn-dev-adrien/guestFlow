# <Feature Name>

| Field | Value |
|---|---|
| **Status** | Draft \| Approved \| Implemented |
| **Branch** | `feature/<short-kebab-name>` _(user-managed)_ |
| **Created** | YYYY-MM-DD |
| **Author** | Adrien |
| **Related PR** | (link once opened) |

---

## 1. Context

What is the current situation? What problem or limitation triggered this work?
Reference existing pages/endpoints/files when relevant.

## 2. Goal

The single user-facing outcome, in one or two sentences.
Avoid solution wording here — describe what the user will be able to do.

## 3. Functional rules

The exhaustive list of rules the implementation must satisfy.
Numbered for easy reference in code review.

1. Rule one.
2. Rule two.
3. ...

**Edge cases:**
- Edge case A → expected behavior
- Edge case B → expected behavior

---

## 4. Architecture

Describe explicitly which layers/files are touched or created, and what each one is responsible for.
Goal: a reader should be able to picture the full code map of the change before reading any code.

> **Reminder — Fat backend, thin frontend.**
> All business logic, calculations, data shaping, and authoritative validation live on the server.
> The client only renders ready-to-use payloads and handles local UI state.
> If a piece of logic in this spec ends up in `client/`, justify it explicitly here.

### 4.1 Server side (`server/src/`)

For each layer, list files **touched** (T) or **created** (C) and one-line responsibility.

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `routes/` | e.g. `clients.js` | T | Adds POST/PUT validation for new field |
| `controllers/` | e.g. `clientsController.js` | T | Orchestrates create/update flow |
| `models/` | e.g. `clientsModel.js` | T | Reads/writes new column |
| `middleware/` | — | — | (none) |
| `utils/` | e.g. `dateUtils.js` | C | New helper for ISO date validation |
| `scheduledTasks.js` | — | — | (none) |
| `database.js` | `database.js` | T | Idempotent migration block |

**Notes:**
- Keep routes thin; logic in controllers/models.
- New utils should be pure functions, unit-testable.
- Mention any new dependency.

### 4.2 Client side (`client/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `pages/` | e.g. `ClientsPage.js` | T | Adds form field + display |
| `components/` | e.g. `BirthdateField.js` | C | Reusable date input wrapper |
| `hooks/` | — | — | (none) |
| `services/` | e.g. `clientsService.js` | T | Adds new field to payload |
| `utils/` | — | — | (none) |
| `constants/` | — | — | (none) |
| `styles/` | — | — | (none) |
| `api.js` | `api.js` | T/— | Passes new field through |

**Component reuse declaration (mandatory):**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | e.g. `FormDialog`, `PageActionBar`, `StatusBadge` | Pre-existing in `components/`. |
| **Created (new generic)** | e.g. `MaskedTextField` | New, designed for general reuse. Justify each: why generic, what other pages will use it. |
| **Specific (kept feature-local)** | e.g. `ReservationPricingSummary` | Page/feature-specific. Justify why it can't be a composition of generics. |

If a "specific" component looks like an obvious candidate for generification, extract it now (don't defer). See CLAUDE.md §7 "Component reuse" for the rule.

### 4.3 API contract

| Method | Endpoint | Request body | Response | Notes |
|---|---|---|---|---|
| GET | `/api/...` | — | `{ ... }` | |
| POST | `/api/...` | `{ ... }` | `{ ... }` | |

Specify auth requirements, error shapes, and idempotency if relevant.

---

## 5. Data model

Schema changes (new columns, indices, tables).
Migration strategy:
- Idempotent block to add in `server/src/database.js`.
- Default values for existing rows.
- Backfill logic, if any.

**Data impact:** does this change affect existing records? Risk of loss/corruption?

## 6. UI / UX

Visual and interaction details:
- Wireframe, screenshot, or textual description per affected screen.
- Copy (French strings shown to the user).
- Empty states, error states, loading states.
- **Responsive behavior (mandatory):** describe how each screen adapts on `xs` (mobile, ≤600px), `md` (tablet, ~900px), `lg` (desktop, ≥1200px). Note dialog fullscreen, table → cards swap, button stacking, padding changes, etc.
- **Sticky action bar (`PageActionBar`) — mandatory for any page:** list the page-level actions to put in the bar (title, optional `backTo`, each action with icon + French tooltip + handler + color/variant). If the page genuinely has no actions, state it explicitly and render `<PageActionBar title="..." actions={[]} />` for visual consistency. See CLAUDE.md §7 "Page layout — sticky action bar" for the component contract.

## 7. Test plan

### Server unit tests
- [ ] `tests/<name>.unit.test.js` — covers rule N
- [ ] ...

### Manual UI verification
- [ ] Happy path: <scenario>
- [ ] Edge case: <scenario>
- [ ] Regression check on adjacent feature: <name>

## 8. Out of scope

What this spec explicitly does NOT cover.
Helps prevent scope creep during implementation.

## 9. Open questions

(Resolved before moving Status to Approved.)
- Q: …
  - A: …
