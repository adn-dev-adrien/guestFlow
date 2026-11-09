# « Mon séjour » — design

The guest app wears the **Domaine Solio** identity — « forêt et heure dorée », the showcase site's and the gate app's —
not GuestFlow's « Maison » (specs/guest-app.md §6.0). The spec's §6 is the authority; this file only says where each
decision lives in the code.

- **Tokens** — `src/theme.js` (§6.1): paper / card / ink / sapin / lichen / ocre / action / line and the semantic soft
  pairs, day and night. The filled button is `action` `#9A6318` (5.0:1), never the site's `#B87B2A` (3.6:1).
- **Night register** — the guest's choice, else the device's dark scheme or the server's sunset (`/me.isNight`).
- **Type** — Marcellus for display and titles, Karla for everything else, figures always Karla `tabular-nums` (§6.2).
  Eyebrows (`.eb`, 11.5 px, `.32em`) are the site's signature and stay, against generic advice to drop them.
- **Shape and depth** — square-cut: buttons 2 px, cards and photos 4 px; sheets 16 px on top, chips and the cart pill
  round. Cards are set off by a line, one shadow for what floats (cart bar, sheets) (§6.3).
- **Photography** — every page opens on a photo under the site's scrim; the default is the site's home hero.
- **Motion** — one moment per screen: 8 px rise on enter, sheets 280-340 ms decelerate and pulled down with the
  finger, the cart bar slides up once and its count ticks, the gold check draws on a confirmed order.
  `prefers-reduced-motion` → no movement.
- **Layouts** (rule 51) — tab bar under 900 px; rail, two-pane booklet and shop, centred dialogs from 900 px; content
  capped at 1200 px from 1200 px.
- **Look source** — `src/styles.css`, ported from the validated review boards v5 (`specs/guest-app-planches.html`).
