# Component reuse — extract early, specialize through composition

_Moved out of `CLAUDE.md` to keep the always-loaded context small; `CLAUDE.md` keeps the short rule and links here._

**Visual consistency across GuestFlow comes from a shared component library, not from copy-pasting MUI patterns.** Before writing any new UI block, ask:

> "Could this pattern (visual or behavioral) appear on more than one page?"

- **Yes / probably / unsure → extract as a generic component** in `client/src/components/`, named by *what it does* (`StatusBadge`, `MaskedTextField`) not by *who uses it* (`SettingsKeyField`).
- **Clearly one-off** (tied to one feature's business logic, e.g. `ReservationPricingSummary`) → keep page-specific.

**Default to extracting.** It is cheaper to inline a generic component than to back-extract one after three pages have diverged. A second use case justifies extraction; a strong hunch of a second use case justifies extraction too.

**Cross-cutting components that should exist (extract on first use, reuse forever):**

| Component | Purpose |
|---|---|
| `PageActionBar` | Sticky page-top action bar (see below). |
| `StatusBadge` | Colored dot/chip + label for any status (configured/incomplete/error/locked/etc.). |
| `StatusCard` | Card with a status badge + summary lines + footer actions — used by any "feature health" view. |
| `SummaryItem` | A `label : value` line used inside status/info cards. Supports masked values. |
| `MaskedTextField` | TextField that displays `••••••` + "Modifier" toggle for secrets (private keys, passwords, tokens). |
| `HelpedTextField` | TextField + helper text + optional external help link, with consistent vertical rhythm. |
| `EmptyState` | Icon + message + optional call-to-action for empty lists/views. |
| `ErrorAlert` | Standardized error display with optional retry. |
| `LoadingState` | Standardized spinner/skeleton. |
| `ConfirmDialog` | _(already exists)_ confirmation dialogs. |
| `FormDialog` | _(already exists)_ form dialogs — reuse instead of rolling your own `<Dialog>`. |
| `TableCard` | _(already exists)_ table wrapper. |
| `DataPageScaffold` | _(already exists)_ list/CRUD page scaffold. |

**Rules of thumb:**
- Each new spec must declare in its "Architecture — Client" section whether it consumes existing components or creates new generic ones. Creating a new component? Justify why it's generic (or admit it's specific).
- A spec that creates a Settings-specific `SettingsCard` instead of a generic `StatusCard` should be challenged in review.
- Generic components must have a JSDoc comment at the top of the file listing props + purpose.
- One folder, flat: `client/src/components/<Component>.js`. No deep nesting. No barrel files unless one is already established.
