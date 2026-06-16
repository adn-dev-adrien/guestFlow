# Paramètres submenu reorganization

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/settings-submenu-reorg` |
| **Created** | 2026-06-16 |
| **Author** | Adrien |
| **Touches** | `App.js`, `constants/roles.js`, new pages `BillableAmountsPage` / `SeasonsClosuresPage` / `OptionsResourcesPage`, `LinenStockPage`, `SettingsPage` |

---

## 1. Context

The Paramètres left submenu had grown long, and two price lists (linge manquant + réparations SAS)
lived hidden inside the big « Générale » settings page, where Adrien couldn't find them. This regroups
related entries and surfaces the prices as their own menu item.

## 2. Goal

A shorter, clearer Paramètres submenu where each concern is one findable entry.

## 3. Functional rules

1. **« Tarifs facturables » becomes its own page** (`/parametres/tarifs`, admin) — the « Prix du linge »
   (éléments manquants) + « Montants de réparation » (utilisés dans le SAS). Moved out of Paramètres →
   Générale (it was a section there).
2. **« Jour de blanchisserie » moves to the « Blanchisserie » page** (`/parametres/stock-blanchisserie`),
   next to the linen stock it relates to. Removed from Paramètres → Générale. One save bar covers the day
   + the stock.
3. **« Vacances scolaires » + « Fermetures » merge** into one entry **« Vacances & fermetures »**
   (`/parametres/vacances-fermetures`) — a tabbed page over the two existing views.
4. **« Options » + « Ressources » merge** into one entry **« Options & ressources »**
   (`/parametres/options-ressources`) — a tabbed page over the two existing views.

The standalone routes (`/options`, `/resources`, `/school-holidays`, `/establishment-closures`) are kept
(still reachable directly) but dropped from the menu; the combined pages render those same components.

## 4. Architecture (client)

| Layer | File | C/T | Responsibility |
|---|---|---|---|
| pages | `pages/BillableAmountsPage.js` | C | Thin wrapper: `PageActionBar` + the self-contained `SettingsBillableAmountsSection`. |
| pages | `pages/SeasonsClosuresPage.js` | C | Tabs over `SchoolHolidaysPage` / `EstablishmentClosuresPage` (only the active tab is mounted). |
| pages | `pages/OptionsResourcesPage.js` | C | Tabs over `OptionsPage` / `ResourcesPage`. |
| pages | `pages/LinenStockPage.js` | T | Now also loads/saves `laundry.weekday` (renders `SettingsLaundrySection`); dirty guard + save bar cover both stock + day. |
| pages | `pages/SettingsPage.js` | T | Removed the `SettingsLaundrySection` + `SettingsBillableAmountsSection` sections (moved out). |
| routing | `App.js` | T | New routes + sidebar: replace the 4 entries with 2 combined + add « Tarifs facturables »; `SETTINGS_CHILDREN` updated. |
| constants | `constants/roles.js` | T | `/parametres/tarifs`, `/parametres/vacances-fermetures`, `/parametres/options-ressources` → `[ADMIN]`. |

No server / API / data-model change (the moved sections keep their existing endpoints).

## 5. UI / UX

- Paramètres submenu, new order: Générale · Logements · **Options & ressources** · Clients ·
  **Vacances & fermetures** · Blanchisserie · **Tarifs facturables** · Paiements · Gestion utilisateur.
- The combined pages put non-sticky `Tabs` above the existing page (which keeps its own header/actions),
  so no sticky-bar overlap. Mobile: tabs scroll, inner pages already responsive.

## 6. Test plan

- [x] Client suite green (521) after the moves (no test referenced the removed Settings sections by
  position; `SettingsBillableAmountsSection` still unit-tested standalone).
- [x] **Playwright**: the submenu shows the 2 merged entries + « Tarifs facturables »; `/parametres/tarifs`
  renders the prices; the two combined pages switch tabs; the Blanchisserie page shows « Jour de
  blanchisserie » (Mardi) + the stock; Générale no longer shows the laundry/billable sections.

## 7. Out of scope

- Merging the page bodies into a single header (the tab wrapper reuses the full existing pages as-is).
- Any change to the moved features' behaviour or endpoints.
