# Page layout — sticky action bar (`PageActionBar`)

_Moved out of `CLAUDE.md` to keep the always-loaded context small; `CLAUDE.md` keeps the short rule and links here._

**Every page in GuestFlow must use the shared `<PageActionBar>` component** at the top, immediately below the main app header. It is the single, consistent place for page-level actions.

The component bundles two canonical actions — **Save** and **Cancel** — that 90% of pages need, plus two slots for page-specific actions on either side.

**Component contract (`client/src/components/PageActionBar.js`):**

```jsx
<PageActionBar
  title="Paramètres"                   // string, shown left (hidden on xs by default)
  backTo="/"                           // optional path; shows a back icon button on the left
  subtitle={<Chip ... />}              // optional ReactNode beside the title (chip, caption, etc.)
  center={<Box>…</Box>}                // optional ReactNode CENTERED in the bar (3-equal-cols layout); hidden on xs

  // Canonical actions — both optional. Omit a prop to hide the button.
  onSave={handleSave}                  // omit → no Save button
  saveDisabled={!isDirty}              // optional, default false
  saveTooltip="Enregistrer"            // optional, default "Enregistrer"
  saveBusy={false}                     // optional; when true, shows a spinner inside the Save button
  onCancel={handleCancel}              // omit → no Cancel button
  cancelDisabled={!isDirty}
  cancelTooltip="Annuler"

  // Custom action slots
  actionsBefore={[                     // inserted BEFORE Save — page-specific helpers
    { icon: <SyncIcon />, tooltip: "Synchroniser Google", onClick: handleSync, color: 'info' },
    { icon: <DescriptionIcon />, tooltip: "Télécharger PDF", onClick: handlePdf, color: 'info' },
  ]}
  actionsAfter={[                      // inserted AFTER Cancel — destructive zone
    { icon: <DeleteIcon />, tooltip: "Supprimer", onClick: handleDelete, color: 'error', disabled },
  ]}
/>
```

Each action item:
```ts
{
  icon: ReactNode,
  tooltip: string,             // French, required
  onClick: () => void,
  color?: 'primary' | 'info' | 'success' | 'warning' | 'error' | 'default',  // controls border color
  disabled?: boolean,
  ariaLabel?: string,          // defaults to tooltip
}
```

**Behavior rules:**
- **Position:** sticky just below the main AppBar (`top: { xs: 56, sm: 64 }`). White background, thin border, small radius — matches the legacy bar style of `ReservationPage.js` post "Improve sticky banner" commit.
- **Buttons are icon-only** (`<IconButton>` wrapped in `<Tooltip>`), each rendered with a **1px colored border** matching its `color` prop (`divider` for `default`, `<color>.main` for colored). Save uses a filled primary background; everything else is bordered.
- **Tooltips in French**, MUI defaults for hover/long-press timing.
- **Touch targets:** ≥44×44px (MUI's IconButton handles this; if not, force `sx={{ minWidth: 44, minHeight: 44 }}`).
- **Layout order, left → right:** `[Back] [Title + Subtitle] … [center] … [actionsBefore[]] [Save] [Cancel] [actionsAfter[]]`. When `center` is set, the two side sections take an equal flex basis so the centered node is truly centered; `center` is hidden on `xs`.
- **Responsive overflow:** on `xs`, if `actionsBefore + actionsAfter` has more than 2 items combined, the extras collapse into a "…" overflow menu before Save (the canonical Save/Cancel always stay visible).
- **Save button visual:** filled `bgcolor: 'primary.main'`, white icon, hover darkens. When `saveBusy` is true → swap icon for `<CircularProgress size={18} color="inherit" />`.
- **Cancel button visual:** bordered IconButton with divider border, default icon color.

**When to skip Save/Cancel:**
- Read-only pages (no save action) → omit `onSave` and `onCancel`. The bar still renders with title + any actions.
- Pages with only a save flow and no revertable draft → omit `onCancel`.

**Current state vs. target:**
- `ReservationPage.js` already implements this pattern inline (lines ~1855–2051). It's the visual reference for `PageActionBar` and will be migrated to the shared component when the Bloc 3 Réservations spec lands.
- `SettingsPage.js` has a simpler inline version (Save + Cancel only) — migrated to `PageActionBar` by the Settings spec.

**When to skip the bar entirely:** pages with literally zero actions and no useful title. Rare; even then, prefer `<PageActionBar title="..." />`.
