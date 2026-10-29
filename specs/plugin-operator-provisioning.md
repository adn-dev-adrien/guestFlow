# Plugins — the operator provisions them, the customer never sees it

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | `feature/plugin-operator-provisioning` (from `inte/plugins` at 714ed5e4) |
| **Created** | 2026-10-28 |
| **Author** | Adrien |
| **Related PR** | — (target `inte/plugins`) |
| **Amends** | [`plugins-phase-4-registry.md`](plugins-phase-4-registry.md) P25, [`control-plane-plans-and-access.md`](control-plane-plans-and-access.md) rules 5 and 11, [`plugins-phase-p-productisation.md`](plugins-phase-p-productisation.md) rules 40 and 43 — on a managed instance only (notes added under each) |
| **Summary for review** | [`docs/specs/2026-10-28-plugin-operator-provisioning.html`](../docs/specs/2026-10-28-plugin-operator-provisioning.html) |

---

## 1. Context

Feedback of 2026-10-28 on the `inte/plugins` shadow (owner, verbatim):

> « Ce n'est pas l'utilisateur qui va activer les plugins, mais bien moi lorsque je vais configurer le
> guestflow pour un client. Il faut donc que l'installation des plugins soit gérée via une autre
> interface et que ça n'apparaisse pas chez un client guestflow. »

GuestFlow is sold to other accommodations (`plugins-inventory.md` D3–D5). The owner is the vendor: he
creates each customer in the console (`control-plane/`) and configures their space. Today the
**customer's administrator** runs the whole plugin lifecycle — a decision taken on 2026-10-08 (P25,
`plugins-phase-4-registry.md` §3.A: « the administrator of the instance installs and updates plugins
within the plugins its licence allows ») and in `control-plane-plans-and-access.md` rule 5
(« installing stays the customer's action »).

What a customer administrator can do today, in the code:

| Surface | Where | What the customer sees / does |
|---|---|---|
| Paramètres › **Plugins** page | `client/src/pages/PluginsPage.jsx` (302 lines), route `App.jsx:826`, menu `constants/settingsMenu.js:59`, search words `settingsMenu.js:136`, role `constants/roles.js:85` (admin) | Tabs Installés / Disponibles, install, activate, deactivate, uninstall + « Effacer aussi ses données », update, « Tout mettre à jour », rollback, « Rechercher des mises à jour », « Hors forfait » chips with « Inclus dans le forfait Pro, sur demande. » |
| Lifecycle API | `server/src/routes/plugins.js:4-16` → `controllers/pluginsController.js` (734 lines); mounted `index.js:260`, guarded only by `enforceRoleAccess` (`middleware/enforceRoleAccess.js:80`: admin is unrestricted) | Any admin session (support session included) can call install/activate/deactivate/uninstall/update/rollback |
| Start assistant, step « Plugins » | `controllers/onboardingController.js:12-14, 396-428`, `constants/onboardingQuestions.js`, `pages/OnboardingPage.jsx:353` | Three yes/no questions that install and activate plugins; last step links to « Plugins : 2 plugins actifs » |
| « Plugin inactif » page | `components/NotFoundPage.jsx:30-44` via `GET /api/plugins/page` | « Cette page dépend du plugin « X », qui n'est pas activé. » + « Ouvrir Plugins » |
| Intégrations tabs | `pages/settings/IntegrationsSettingsPage.jsx:85` reads `GET /api/plugins` | Plugin names and their « à configurer » dot (this one is a feature, it stays) |
| Plugin settings | `GET/PUT /api/plugins/:id/settings` (`routes/plugins.js:17-18`), used by 8 plugin pages (linen stock, weather key, GdF/Airbnb/Booking intake, GVR, SAS extinguisher, reconciliation) | Configuration of a live feature (stays) |

What the console (operator side) already has:

- The **licence** (`control-plane/server/src/utils/licenceIssuer.js:30-53`, read by
  `server/src/utils/licence.js`): a JWS signed with Ed25519, written into `<instance>/data/licence.jws`,
  re-issued daily and on every change. Its `plugins[]` is what the customer is *allowed* to install
  (plan + add-ons + grandfathered). The instance only reads files; no port is opened (CLAUDE.md §5.6).
- A read-only view of each instance's database: `instances.readFacts()`
  (`control-plane/server/src/utils/instances.js:50-68`) already reads the `plugins` table every minute
  (installed, active, versions), shown in the fleet (`FleetPage.jsx:30`, column « Plugins »).
- **Plugin updates are already the operator's** on a hosted instance: « Versions › Plugins » pushes a
  package with `server/scripts/switch-plugin-package.js` (stop, snapshot, switch, restart, health check —
  `hosting-h1-fleet-runtime.md` rule 11).
- **Core updates are already the operator's** on a managed instance: `systemController.js:37-38, 237-242`
  answers 403 `MANAGED_BY_HOST` and the page says « Mises à jour gérées par l'hébergeur »
  (`hosting-h1-fleet-runtime.md` rule 9). This spec applies the same split to the plugins.
- The console audit log (`control-plane/server/src/database.js:123`, table `audit`).

So the only thing missing is the operator's control over *which plugins run* on a customer's space,
and the removal of every trace of that control from the customer's side.

## 2. Goal

The operator decides, from the customer's page in the console, which modules run on that customer's
GuestFlow; the space applies it within a minute without a restart. On a hosted space, nobody — not
the customer's administrator, not a support session — can see, call or guess a plugin management
screen or endpoint: the customer sees only the features themselves.

## 3. Functional rules

### 3.A Who manages the plugins

1. **A space's plugins are « operator-managed » when the hosting sets `GUESTFLOW_MANAGED=1`, or when
   its valid licence carries `activePlugins`.** Otherwise (Solio on its own host, a development
   machine, the E2E server) nothing changes: the administrator keeps Paramètres › Plugins as today —
   the owner of an unmanaged space is its operator. The server decides (`utils/pluginGovernance.js`,
   `operatorManaged()`); the client only reads the result.
2. **The decision cannot be moved from inside the space.** `GUESTFLOW_MANAGED` is the hosting's
   environment, which the customer never controls (`control-plane-plans-and-access.md` rule 30); the
   licence is signed by the console's private key, which never leaves the console. No setting, role,
   user flag or database row turns operator management off.

### 3.B What the customer no longer sees (operator-managed space)

3. **No Plugins page.** The menu entry, its search words (« Plugin », « Extension », « Module »,
   « Activer », « Désactiver ») and the route `/parametres/plugins` are absent: `/api/auth/me` carries
   `pluginsManageable: false` and `/parametres/plugins` joins `ROUTE_CONDITIONS` (`constants/roles.js`),
   so the address reads « Page introuvable » like any unknown one.
4. **The lifecycle endpoints do not exist.** `GET /api/plugins/status`, `GET /api/plugins/page`,
   `POST /api/plugins/refresh`, `POST /api/plugins/update-all`, `POST /api/plugins/:id/install`,
   `…/update`, `…/rollback`, `…/activate`, `…/deactivate` and `DELETE /api/plugins/:id` answer
   **404 `{ error: 'API route not found' }`** — byte for byte the answer of an unknown `/api` path (`index.js:311`), for every role and for a
   support session, so neither the route nor the reason is revealed. The guard runs before the
   controller (`middleware/requireSelfManagedPlugins.js`).
5. **`GET /api/plugins` gives only what a feature needs.** On an operator-managed space it lists the
   **live** plugins only, each as `{ id, name, icon, setup }` — no version, source, state, plan chip,
   plan hint, offer, update, data lines or not-installed plugin. The Intégrations page keeps its tabs
   and its « à configurer » dot (`integrations-tab-per-plugin.md` rules 4, 11) unchanged.
6. **A plugin's own settings stay with the customer.** `GET/PUT /api/plugins/:id/settings` and every
   settings page a live plugin brings (Intégrations tab, Linge, Paiements…) are unchanged: they
   configure a feature the customer uses, with the customer's own accounts and keys.
7. **An address of a plugin that is off reads « Page introuvable ».** On an operator-managed space,
   `NotFoundPage` never asks `GET /api/plugins/page` (rule 4) and never offers « Ouvrir Plugins »:
   « Page introuvable » and « Retour au tableau de bord », for every role
   (`plugins-phase-p-productisation.md` rules 40, 42 apply to unmanaged spaces only).
8. **The start assistant has no « Plugins » step.** `GET /api/onboarding` answers `pluginStep: false`
   and `PUT /api/onboarding/plugins` answers 404; the assistant shows its other steps, numbered without
   a gap, and the last step drops the « Plugins : … » link
   (`plugins-phase-p-productisation.md` rule 43 applies to unmanaged spaces only).
9. **No plan or update wording reaches the customer about plugins.** « Hors forfait », « Forfait Pro »,
   « Inclus dans le forfait…, sur demande. », « Désactivé — hors forfait », « Mise à jour 1.2.0 » and
   « n mises à jour disponibles » are produced only by the endpoints of rule 4: they disappear with
   them. The quota refusals (`control-plane-plans-and-access.md` rule 13) and the subscription
   banners are not about plugins and stay.

### 3.C What the operator decides (console)

10. **The customer's page has a « Modules » section**: one line per plugin of the catalogue (16 today),
    grouped « Inclus » (allowed by the licence: plan, add-ons, grandfathered) then « Hors forfait »
    (folded, closed at first, with the plan that includes each: « Forfait Premium », or « Option à la
    carte »). Each « Inclus » line has a switch: on = the module runs on the space. A « Hors forfait »
    line has no switch; « Changer de forfait » (existing dialog, add-ons included) is how it becomes
    « Inclus ».
11. **The operator's choice is stored in the console** (`customer_plugins`, §5) and is always a subset
    of the allowed plugins. The server refuses, with the reason in French:
    - a plugin outside the allowed set → 422 « Hors forfait : à ajouter au forfait ou en option
      d'abord. »;
    - switching on a plugin whose requirement (`manifest.requires`) is off → 422 « Nécessite Réservation
      depuis le site : à activer d'abord. » (mirror of `plugins-phase-4-registry.md` rule 37);
    - switching off a plugin that a switched-on plugin requires → 422 « Nécessaire à Google Vacation
      Rentals : à désactiver d'abord. » (mirror of rule 36).
12. **A switch saves at once** (no Save button, like the Plugins page did): the console stores the
    choice, writes one audit line (« Linge activé » / « Linge désactivé », operator, customer) and
    re-issues the licence immediately. Switching off asks first, in a dialog: « Désactiver Linge et
    blanchisserie ? Ses pages disparaissent de l'espace ; ses données sont conservées. » —
    « Désactiver » / « Annuler ». Switching on asks nothing.
13. **Creating a customer pre-selects the plan's modules.** The « Nouveau client » form gains a
    « Modules » group: every plugin the chosen plan and add-ons allow, ticked; the operator may untick
    some. Changing the plan in the form re-ticks the new plan's set. The first licence carries that set
    (rule 15), so a new space starts with its modules on — before its first administrator logs in.
14. **Each line tells what the space actually runs**, as the console reads it (rule 20), never what it
    hopes:
    - « Actif · 1.2.0 » — applied;
    - « Inactif » — applied, off;
    - « En attente » — the licence carrying this choice has not been applied yet (the space reads it
      within a minute; after 5 minutes: « En attente depuis 6 min — espace injoignable ? »);
    - « Échec : <message> » with « Réessayer » — the space could not apply it (rule 18);
    - « Bloqué : <message> » — a deactivation the space refuses for a business reason (rule 19);
    - « Actif · à configurer : <what is missing> » — applied, but the plugin reports missing setup
      (`ctx.setupStatus`, `plugins-phase-0-foundation.md` rule 25), so the operator knows a
      configuration step remains (rule 6: done in the space, by the customer or through a support
      session).
    The section's header counts « 7 actifs · 1 à configurer · 1 en échec ».
    _As rendered (2026-10-28 review):_ the state is a short badge — « Actif · 1.2.0 », « Inactif »,
    « En attente », « Échec », « Bloqué » — beside what goes with it: `detail` as text (the space's
    sentence; « L’espace lit la licence… » while waiting; « Depuis 6 min — espace injoignable ? » with
    `stale: true`, a warning badge; « données conservées » on an inactive module that still holds data),
    and `setupLabel` (« à configurer : <what is missing> ») as a second warning badge that never replaces
    the version badge. The header comes as `headerParts: [{ text, tone }]`: only the failed count is red.

### 3.D How the space applies it

15. **The licence carries the operator's choice.** `buildPayload` adds `activePlugins: [<id>…]`
    (catalogue order, ⊆ `plugins`) for a customer whose choice is known (§5 migration). A licence
    without `activePlugins` (an older console, a licence written by hand) changes nothing on the
    space: the stored plugin states stand, and rule 1 still makes the space operator-managed when
    `GUESTFLOW_MANAGED=1`.
16. **The space reconciles.** At boot and then every minute (`tasks/pluginProvisioning.js`, which also
    drops the licence reader's one-minute cache so a choice is applied within the minute), when the
    valid licence carries `activePlugins`, the space compares it with its `plugins` table and acts
    through the same code paths the Plugins page used (`pluginsController` install / activate /
    deactivate, with the plugin lock): no logic is duplicated, every existing refusal applies.
    - A plugin in `activePlugins` and not installed → installed from the best compatible source
      (registry, then the release's own package — `plugins-phase-4-registry.md` rules 10–11) with its
      requirements, then active.
    - Installed and inactive → activated.
    - Active and absent from `activePlugins` → deactivated; its data and settings are kept
      (phase 0, D6 Q1).
    - Order: deactivations first, dependants before their requirements; then activations,
      requirements first.
17. **Applying needs no restart.** Install and activation take effect live (phase 4 rule 13). A
    browser already open sees a switched-off module disappear at its next request (`enabledPlugins`
    in `/auth/me`) and a switched-on one at its next page load (bundles are imported before render,
    phase 4 rule 18). A plugin whose package must replace an already-loaded different version (phase 4
    rule 13, restart case) is not switched by the reconciliation: it is reported « Échec :
    Redémarrage nécessaire — passer par Versions › Plugins. ».
18. **A failure is reported, not retried in a loop.** Each plugin's outcome is written to
    `plugin_provisioning` (§5) with the licence's `issuedAt`. A plugin that failed for a given licence
    is not retried until a licence with another `issuedAt` arrives — the daily re-issue, any change, or
    the console's « Réessayer », which simply re-issues the licence. One plugin failing never stops
    the others.
19. **Business blockers still hold.** A deactivation refused by the existing guards
    (`pluginsController.js:41-80` — open payment links, links pending deactivation, reception or
    accountant users; `REQUIRED_BY`) is recorded `blocked` with the guard's French message (« 2 liens
    de paiement ouverts : à clôturer d'abord. »). It is retried every hour (the blocker can clear by
    itself), and the plugin stays active meanwhile.
20. **The console reads the outcome, read-only.** `instances.readFacts()` also reads
    `plugin_provisioning`, the applied licence's `issuedAt`, the erase orders the space ran, and the
    setup and data lines the space publishes for each installed plugin (rule 28); the customer page
    shows rule 14's states from it. (The fleet table is unchanged: its « Plugins » column still shows
    the installed versions.) Nothing is ever sent to the console by the space.
21. **A plugin outside `plugins[]` stays governed by the licence downgrade rule**
    (`control-plane-plans-and-access.md` rule 12): treated inactive, data untouched. `activePlugins`
    never revives it (rule 11 keeps it a subset; the space intersects it with `plugins` anyway). The
    reconciliation does not look at such a plugin at all: its stored `enabled` flag stands, so a plan
    that takes it back finds it as it was (found on the shadow copy: the three intakes, active in the
    shadow but in no plan, were being switched off in the table by the first pass).

### 3.E Erasing a module's data

22. **« Effacer les données » is the operator's, on an inactive module only.** A line whose switch is
    off has a menu « Effacer les données… ». Its dialog lists what will be erased, as the space counts
    it (the plugin's `data.describe`, read with the facts), and asks to type the customer's slug, like
    « Déprovisionner » (`control-plane-plans-and-access.md` rule 20). It is recorded in the audit
    log (« Données de Linge effacées »).
23. **The order travels in the licence, once.** The licence carries `eraseOrders: [{ order, id }]`
    (`order` a random id). The space executes an order only when the plugin is installed and not in
    `activePlugins`, through the existing uninstall with purge (phase 1 rules 12, 21), records the order
    id in `plugin_provisioning` and never executes the same order twice. The console drops the order
    from the next licences once it reads it acknowledged. A hosted space keeps its continuous backup
    (`hosting-h1-fleet-runtime.md`, « Restaurer à une date »): an erasure done by mistake is
    recoverable from the console.

### 3.F Updates

24. **Plugin updates stay where they already are**: « Versions › Plugins » in the console
    (`hosting-h1-fleet-runtime.md` rules 11, 30–31). On an operator-managed space the update chip, the
    banner, « Tout mettre à jour », the rollback and « Rechercher des mises à jour » disappear with
    the page (rule 3); the core self-update already says « Mises à jour gérées par l'hébergeur »
    (H1 rule 9). The release archive still ships every package (P24), so rule 16 can always install
    from the space's own release.
    > **Sans test** — pas de comportement nouveau : cette règle ne fait que renvoyer à « Versions › Plugins » (H1 règles 11, 30–31) et aux règles 3–4 testées.

### 3.G Migration

25. **Existing spaces keep exactly what they run, with no manual step.**
    - **Unmanaged spaces (Solio, dev, E2E):** rule 1 leaves them self-managed: the Plugins page,
      the assistant step and « Plugin inactif » stay; nothing is migrated.
    - **Hosted customers:** on its first start with this release, the console seeds each customer's
      `customer_plugins` from the space's currently **active** plugins (`readFacts().active` ∩ allowed)
      and records `customer_plugins_seeded_at`. Only then does that customer's licence carry
      `activePlugins` — so the first reconciliation is a no-op. A space the console cannot read stays
      unseeded: its licence carries no `activePlugins` (rule 15) and the « Modules » section says
      « Espace illisible : modules non relevés. » with « Relever maintenant ».
26. **Release order.** The space's code (rules 1–9, 15–23) is inert without `activePlugins`; the
    console's code writes it. Shipping the space first then the console, or both in one release, never
    leaves a hosted customer with plugins switched by surprise.
    > **Sans test** — règle de processus de publication ; l'invariant qu'elle protège (aucun changement tant qu'aucune licence ne porte `activePlugins`) est testé par les règles 15 et 25.
27. **A pending erase order is cancelled when the module is switched back on.** The order is dropped
    from the licence and the journal says « Effacement des données de X annulé »: otherwise it would
    fire the next time the module is switched off (rule 23 only executes an order for a plugin the
    operator no longer wants). _Added at implementation._
28. **The space publishes what the console cannot compute.** Each reconciliation pass writes, for
    every installed plugin, `facts:<id>` in `plugin_provisioning_meta` — `{ setup, erasable, data }`:
    the setup the plugin still lacks (`ctx.setupStatus`, rule 14) and the lines `data.describe`
    returns (rule 22: `[{ label, count, warning? }]`, a warning saying what stays) — and removes it for a
    plugin that is not installed. The console reads them with
    the rest of rule 20. The ids of the erase orders executed are kept as `erase:<order>` (rule 23).
    _Added at implementation._

29. **A space is seeded only if it runs the reconciler.** `seedCustomer` requires
    `facts.provisioning !== null`: a readable space on a release before this feature would otherwise
    receive a licence whose `activePlugins` it ignores, the customer would keep toggling plugins there
    and the first reconciliation after the upgrade would switch them off. Such a customer stays
    unseeded — « Espace à mettre à jour : modules non relevés. » (an unreadable one keeps « Espace
    illisible… ») — and is seeded by the minute tick as soon as the space reports. _Added at review._
30. **The lifecycle 404 leaves the trace of an unknown path.** The audit forbids `DELETE /plugins/:id`
    and `POST /plugins/:id/deactivate` to a support session (403 and a log entry), which told an
    operator-managed space from an unmanaged one. `createSupportAudit` takes `isHidden(req)`
    (`requireSelfManagedPlugins.isHidden`: the lifecycle routes of rule 4, on a managed space) and, for
    such a request, skips only the policy's 403: it is logged like any other (a change always, a read
    once per path and minute, summary `404`) and reaches the router guard that answers the unknown-route
    404. Skipping the log too would have made the support log — which the support session can read — a
    second way to tell a hidden route from an unknown one, and would have dropped the audit trace of
    hosting rule 19. An ended access still answers `SUPPORT_ACCESS_ENDED`, like any path. _Added at review; amended at second review._
31. **Erase orders follow the settled rule of rules 18–19.** A refused erase (`REQUIRED_BY`,
    `PLUGIN_BLOCKED`) is recorded `blocked` and retried at most hourly; any other failure is recorded
    `failed` and waits for a new `issuedAt`. The closing pass of the reconciler leaves the line of a
    plugin with an erase order still on its way alone, so the record survives. The console shows it on
    the line (« Effacement bloqué : <message> » / the space's failure sentence, for the licence it last
    wrote only) instead of « Effacement des données en cours. », and refuses the erase itself
    (422 `REQUIRED_BY`, « Nécessaire à X : à désinstaller d’abord. ») while an installed plugin the
    plan allows requires the module; the line itself says so and offers no menu (rule 38). _Added at review._
32. **A reconciler run ignores the dependants the licence does not allow.** A plugin outside `plugins[]`
    keeps its stored state (rule 21) and cannot be acted on by the operator, so it no longer holds
    back the deactivation or the erase of what it requires (`req.reconciling`). The plugins page rules
    (phase 4 rules 12 and 36) are unchanged for an unmanaged space. _Added at review._
33. **An older licence never replaces a newer one.** The highest `issuedAt` the reconciler acted on is
    kept in `plugin_provisioning_meta` (`highestIssuedAt`); a pass whose licence is older is skipped
    (a restored backup, a replayed file). _Added at review._
34. **The closing pass touches only the licence's plugins.** The loop that marks leftover rows
    `applied` is limited to ids the licence allows, so the state kept for a plugin outside the plan
    (rule 21) is not rewritten. _Added at review._
35. **No plugins line in Paramètres › summary on a managed space.** `GET /api/settings/summary` omits
    `/parametres/plugins` when the plugins are not the administrator's (rule 3). _Added at review._
36. **The session is re-read as the operator changes the plugins.** `useAuth` re-reads
    `GET /api/auth/me` on every route change and when the tab becomes visible again, at most once every
    30 s; a failed re-read keeps the session. A module switched off by the operator thus leaves the menu
    without a reload (rule 3 hides entries from `enabledPlugins` / `pluginsManageable`). _Added at review._
37. **A licence dated in the future never becomes the mark.** Both sides: the console stamps each
    licence strictly after the previous one it wrote for the customer (`issuedAt = max(now,
    lastWritten + 1 ms)`, so a clock that stepped back cannot issue an older licence; a download of an
    unchanged licence keeps the last stamp), and the space applies a licence whose `issuedAt` is more
    than 5 minutes ahead of its own clock but does not keep it as `highestIssuedAt` (rule 33) — otherwise
    every honest licence would be skipped as « older » until the clock caught up, the console showing
    « En attente » then « espace injoignable ? » with no retry possible. _Added at second review._
38. **A module needed by an installed plugin, and the way out.** For a module that is off, the line
    computes its installed dependants (an installed plugin the plan allows that requires it, active or
    not). While one exists the line shows « Nécessaire à X : à désinstaller d’abord. » (`blockedBy`, also
    the `detail`) and offers no erase. To make that reachable, a module that is off, installed and
    holding no data gets `canUninstall`: the menu reads « Désinstaller… », a plain confirmation (no typed
    address, nothing to lose) sends the same `POST …/erase` order as rule 22, and the space settles it by
    leaving the module uninstalled (rule 31's `NOT_ERASABLE` path). A module off, not installed and
    without data offers nothing. The order remembers that it is a removal (`customer_erase_orders.removal`,
    added by the idempotent column pass), so the words follow: the line reads « Désinstallation en cours. »
    / « Désinstallation bloquée : … », the journal « Désinstallation de X demandée » / « Désinstallation de X
    annulée » / « X désinstallé » — never « Effacement des données » for a module that holds none.
    _Added at second review; wording amended at follow-up._

39. **An installed plugin whose code is gone stays until it is uninstalled.** A row without a module
    (`PACKAGE_MISSING`, specs/plugin-removal-resilience.md rule 1) is outside the catalogue the reconciler
    walks: it ignores it, whatever `activePlugins` says, and an erase order naming it is settled without
    touching anything (rule 23). The row stays — never live, never listed by the managed `GET /api/plugins`
    (rule 5) — until a release ships the plugin again or the row is removed from the database.
40. **A removal order never purges, and an unknown data count is not « no data »** (audit 2026-10-28,
    console H2). Each erase order of the licence is `{ order, id, removal }`. `removal: true` is the
    console's « Désinstaller » of a module it showed with no data to lose: the space uninstalls it
    **without** `purge`, whatever the plugin keeps (data stays for a later reinstall). `removal` absent
    or false is the data erase of rule 23 (purge, then plain uninstall for a plugin keeping no data).
    When a plugin's own data count (`describe`) throws, the plugin view carries `dataUnknown: true`
    with `data: []`, logged, and the facts published to the console carry `dataUnknown: true`: the
    console must offer neither erase nor removal on it. A removal order that fails is recorded « Échec de
    la désinstallation. » (an erase order keeps « Échec de l’effacement. »). **Version skew:** a space
    from before this rule would purge a removal order, so the console offers « Désinstaller » only to a
    space that declares it understands it: each reconciliation pass publishes, in
    `plugin_provisioning_meta`, `capabilities` = `{"removalOrders":true,"coreVersion":"x.y.z"}`
    (`provisioning.setCapabilities`), which the console reads next to `facts:<id>`. A space without that
    key predates the rule. This is the space side of `removal` and `dataUnknown`; the console refers to
    it. Test: `plugin-removal-order-no-purge.unit.test.js`.

**Edge cases:**

- The console is down for days → the last licence still carries `activePlugins`; the space keeps
  applying it; after 7 days the licence expires and the instance goes read-only as today
  (`control-plane-plans-and-access.md` rule 10) — `activePlugins` of that expired licence still holds
  (same rule as `plugins[]`).
- A customer administrator types `/parametres/plugins` or calls `POST /api/plugins/linen/activate`
  with curl → « Page introuvable » / the unknown-route 404 (rules 3–4).
- A support session on a managed space → same 404s; the operator acts from the console, not from
  inside the space.
- The operator switches a module on, then off within the same minute → the space applies only the
  latest licence; the audit keeps both lines.
- Switching on a module whose package is missing from the release and from the registry → « Échec :
  Paquet introuvable. » (phase 4 rule 14 wording).
- A plan change that removes an active module (downgrade) → the console drops it from
  `customer_plugins` in the same transaction as the plan change, with an audit line « Linge retiré
  (hors forfait) »; the space deactivates it (rule 16) and rule 21 hides it anyway.
- Zero modules switched on → the section reads « Aucun module actif. »; the space runs the core only.
- An unmanaged space that receives a licence with `activePlugins` (a self-hosted customer later) →
  rule 1 makes it operator-managed; its Plugins page disappears at the next `/auth/me`.

---

## 4. Architecture

> **Fat backend, thin frontend.** Every decision (who manages, what is allowed, requirement checks,
> the reconciliation, the state of each line) is computed on the server — in the space or in the
> console. Both clients render ready-made payloads: the console client gets each line's `stateLabel`,
> `switchable`, `refusal` and the header's counts; the GuestFlow client only reads
> `pluginsManageable` and `pluginStep`.

### 4.1 Server side — instance (`server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `utils/` | `pluginGovernance.js` | C | `operatorManaged({ env, licence })` (rule 1), `desiredPlugins(licence)` (`activePlugins` ∩ `plugins`, rules 15, 21), `pendingEraseOrders(licence)` (rule 23) — pure |
| `utils/` | `licence.js` | T | Expose `activePlugins()` and `eraseOrders()` of the valid (or expired, as for `plugins`) payload; `null` when absent |
| `utils/` | `pluginReconciler.js` | C | Rules 16–19, 23: diff desired vs `plugins` rows, ordered plan (deactivate dependants first, activate requirements first), calls the controller's handlers, writes outcomes; pure planning + injected effects for tests |
| `middleware/` | `requireSelfManagedPlugins.js` | C | Rule 4: 404 (unknown-route body) for the lifecycle routes when `operatorManaged()` |
| `routes/` | `plugins.js` | T | Mount the guard on the lifecycle routes; `settings` routes untouched |
| `controllers/` | `pluginsController.js` | T | Rule 5: `list` narrows to live `{ id, name, icon, setup }` when operator-managed; expose `install/activate/deactivate/uninstall` internals for the reconciler (no HTTP round-trip) |
| `controllers/` | `authController.js` | T | Rule 3: `pluginsManageable` in `login`/`me` (admin && !operatorManaged) |
| `controllers/` | `onboardingController.js` | T | Rule 8: `pluginStep` in `GET`, 404 on `PUT /plugins` when operator-managed; `pluginsSummary` omitted |
| `models/` | `pluginProvisioningModel.js` | C | Read/write `plugin_provisioning` and `plugin_provisioning_meta` (applied licence, `facts:<id>`, `erase:<order>`) |
| `utils/` | `captureHandler.js` | C | Runs an Express handler and resolves its answer, shared by the start assistant and the reconciler (extracted from `onboardingController`) |
| `utils/` | `pluginsSchema.js` | T | Idempotent `CREATE TABLE IF NOT EXISTS` for the two tables (§5) |
| `tasks/` | `pluginProvisioning.js` | C | Rule 16: at boot (after plugins load) and every minute; hourly retry of `blocked` (rule 19) |
| `scheduledTasks.js` | `scheduledTasks.js` | T | Registers the task |
| `controllers/` | `settingsSummary`, `routes/onboarding.js`, `routes/settings.js` | — | Unchanged: the summary still reads `views()` (the Plugins row is hidden with its menu entry) |
| `database.js` | — | — | Unchanged: the plugin tables are created by `pluginsSchema.js`, already called at boot |

### 4.2 Server side — console (`control-plane/server/src/`)

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `database.js` | `database.js` | T | `customer_plugins`, `customer_erase_orders`, column `customers.pluginsSeededAt` (§5) |
| `controllers/` | `customerModulesController.js` | C | Rules 10–14, 22: the « Modules » view (lines, states, counts, refusals), switch, erase, retry; audit lines; licence re-issue |
| `controllers/` | `customersController.js` | T | Rule 13: modules at creation; edge case: plan change drops modules no longer allowed |
| `routes/` | `console.js` | T | The four endpoints of §4.4 |
| `utils/` | `licenceIssuer.js` | T | `buildPayload` adds `activePlugins` (seeded customers only) and `eraseOrders` (rules 15, 23); `allowedPlugins` is shared with the modules view |
| `models/` | `customerPluginsModel.js` | C | The operator's choice, the erase orders, the seed marker |
| `utils/` | `instances.js` | T | `readFacts` also reads `plugin_provisioning`, `plugin_provisioning_meta`, and each inactive plugin's data lines (rules 20, 22) |
| `utils/` | `moduleStates.js` | C | Rule 14: one line's state from (choice, facts, licence issuedAt, now) — pure |
| `tasks/` | `scheduler.js` | T | Rule 25: every minute, `syncModules` seeds the customers that became readable and closes the erase orders the space ran (rule 23); « Relever maintenant » reuses the seed |

### 4.3 Client side

| Layer | File | T/C | Responsibility in this change |
|---|---|---|---|
| `client/src/constants/roles.js` | — | T | `ROUTE_CONDITIONS['/parametres/plugins'] = (user) => user.pluginsManageable` (rule 3) |
| `client/src/components/NotFoundPage.jsx` | — | T | Ask `getPluginPage` only when `user.pluginsManageable` (rule 7) |
| `client/src/pages/OnboardingPage.jsx` | — | T | Skip the plugin step and its last-step link when `pluginStep` is false (rule 8) |
| `client/src/pages/PluginsPage.jsx` | — | — | Unchanged (unmanaged spaces only) |
| `control-plane/client/src/pages/CustomerPage.jsx` | — | T | Mounts `ModulesSection` |
| `control-plane/client/src/components/ModulesSection.jsx` | — | C | Rules 10, 12, 14, 22: the two groups, switches, state lines, dialogs; renders the server's payload |
| `control-plane/client/src/pages/NewCustomerPage.jsx` | — | T | Rule 13: the « Modules » group, ticks from the server's form preview |
| `control-plane/client/src/api.js` | — | T | The four calls of §4.4 |

**Component reuse declaration:**

| Category | Components | Notes |
|---|---|---|
| **Consumed (existing generic)** | `PageActionBar`, `ConfirmDialog`, `FormDialog`, `StatusBadge`, `EmptyState`, `ErrorAlert`, `LoadingState` (`@gf/components`), the console's `Section` | The console already imports GuestFlow's components through `@gf/` |
| **Created (new generic)** | — | None: a line is a `StatusBadge` + MUI `Switch`; no second use outside this section |
| **Specific (kept feature-local)** | `ModulesSection` | Bound to the console's customer page and its payload |

### 4.4 API contract

**Console** (operator session, second factor, same-origin writes — `control-plane-plans-and-access.md`
rules 31, 36):

| Method | Endpoint | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/customers/:id/modules` | — | `{ seeded, seedLabel, counts: { active, toConfigure, failed, blocked }, header: "7 actifs · 1 à configurer", headerParts: [{ text, tone }], empty, included: [Line], outOfPlan: [Line] }` | `Line = { id, name, on, switchable, state: 'active'\|'inactive'\|'pending'\|'failed'\|'blocked'\|'unknown'\|'outOfPlan', stateLabel, detail, setupLabel, stale, needsSetup, canRetry, canErase, eraseLines: [string], eraseWarnings: [string], planChip }` — an unseeded customer gets `seeded: false`, `seedLabel` and empty lists |
| POST | `/api/customers/:id/modules/:pluginId` | `{ on: boolean }` | the GET payload | 422 `{ error: 'OUT_OF_PLAN' \| 'REQUIREMENT_OFF' \| 'REQUIRED_BY', message }`; re-issues the licence |
| POST | `/api/customers/:id/modules/retry` | — | the GET payload | Re-issues the licence (rule 18); also « Relever maintenant » when unseeded |
| POST | `/api/customers/:id/modules/:pluginId/erase` | `{ confirmSlug }` | the GET payload | 409 `MODULE_ACTIVE` / `NOTHING_TO_ERASE` / `NOT_SEEDED`, 422 `REQUIRED_BY` (rule 31), 400 `SLUG_MISMATCH`; one pending order per plugin |
| POST | `/api/customers/preview` (existing) | `+ modules: [id]` | `+ moduleChoices: [{ id, name, ticked, allowed }], moduleSummary` | Rule 13 |
| POST | `/api/customers` (existing) | `+ modules: [id]` | unchanged | Refuses a module outside the allowed set (422) |

**Licence payload** (added fields): `activePlugins: string[]` (optional), `eraseOrders: [{ order: string, id: string }]` (optional, default `[]`).

**Instance** (changes only on an operator-managed space):

| Method | Endpoint | Change |
|---|---|---|
| GET | `/api/auth/me`, `POST /api/auth/login` | `+ pluginsManageable: boolean` |
| GET | `/api/plugins` | Live plugins only, `{ id, name, icon, setup }` |
| * | `/api/plugins/status`, `/page`, `/refresh`, `/update-all`, `/:id/install`, `/:id/update`, `/:id/rollback`, `/:id/activate`, `/:id/deactivate`, `DELETE /:id` | 404 `{ error: 'API route not found' }` |
| GET/PUT | `/api/plugins/:id/settings` | Unchanged |
| GET | `/api/onboarding` | `+ pluginStep: boolean`; `pluginsSummary` absent when false |
| PUT | `/api/onboarding/plugins` | 404 when operator-managed |

## 5. Data model

**Instance** (`utils/pluginsSchema.js`, idempotent):

```sql
CREATE TABLE IF NOT EXISTS plugin_provisioning (
  pluginId TEXT PRIMARY KEY,
  desired TEXT NOT NULL CHECK (desired IN ('active', 'inactive')),
  outcome TEXT NOT NULL CHECK (outcome IN ('applied', 'failed', 'blocked')),
  code TEXT,                 -- e.g. OPEN_PAYMENT_LINKS, PACKAGE_NOT_FOUND
  message TEXT,              -- French, as the refusal reads
  licenceIssuedAt TEXT NOT NULL,
  eraseOrder TEXT,           -- last executed erase order id (rule 23)
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugin_provisioning_meta (
  key TEXT PRIMARY KEY,      -- 'appliedLicenceIssuedAt', 'highestIssuedAt', 'facts:<pluginId>', 'erase:<orderId>'
  value TEXT NOT NULL
);
```

No existing row changes. An unmanaged space creates the empty tables and never writes them.

**Console** (`control-plane/server/src/database.js`, idempotent):

```sql
CREATE TABLE IF NOT EXISTS customer_plugins (
  customerId INTEGER NOT NULL REFERENCES customers(id),
  pluginId TEXT NOT NULL,
  since TEXT NOT NULL,
  operator TEXT NOT NULL,
  PRIMARY KEY (customerId, pluginId)
);
CREATE TABLE IF NOT EXISTS customer_erase_orders (
  orderId TEXT PRIMARY KEY,
  customerId INTEGER NOT NULL REFERENCES customers(id),
  pluginId TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  operator TEXT NOT NULL,
  acknowledgedAt TEXT,
  removal INTEGER NOT NULL DEFAULT 0      -- rule 38: 1 = uninstall of a module without data
);
ALTER TABLE customers ADD COLUMN pluginsSeededAt TEXT;  -- guarded by pragma_table_info
```

Rows of `customer_plugins` are the switched-on modules. Seed (rule 25): for each live customer with
`pluginsSeededAt IS NULL` and a readable space, insert `readFacts().active ∩ allowed` with
`operator = 'migration'`, then set `pluginsSeededAt`.

**Data impact:** none on guest, reservation or finance data. The only writes on a space's plugins are
the ones its administrator could already do from the Plugins page, now driven by the operator.

## 6. UI / UX

Skills loaded for the mockups: `apple-design`, `impeccable`. Interactive mockups:
[`docs/specs/2026-10-28-plugin-operator-provisioning.html`](../docs/specs/2026-10-28-plugin-operator-provisioning.html).

### 6.1 Console — customer page, « Modules » section

- Placed after « Création » and before « Hébergement »: it is what the operator sets up right after
  creating the space.
- Header: section title « Modules » (serif `sectionHeader`), counts on the right « 7 actifs · 1 à
  configurer » (`text.secondary`, a failed count in `error.main`).
- « Inclus » list: name (no icon: the catalogue's icon names have no mapping in the console), one state line under it (rule 14) as a soft `StatusBadge`
  (success « Actif · 1.2.0 », neutral « Inactif », info « En attente », warning « à configurer » and
  « Bloqué », error « Échec »), a `Switch` on the right (44 px target). « Échec » adds « Réessayer »;
  an inactive line that still holds data adds a « ⋯ » menu with « Effacer les données… » (« Désinstaller… » for an installed one without data, rule 38; none while an installed plugin requires it). The switch-off dialog is a `ConfirmDialog` (« Désactiver » in the primary colour: the data is kept).
- A refused switch (rule 11) snaps back and shows the server's sentence under the line in
  `error.main`, until the next action.
- « Hors forfait (n) »: a disclosure, closed at first; lines with the plan chip and no switch.
- Dialogs: switch-off confirmation (`ConfirmDialog`), erase (`FormDialog` with the data lines and the
  slug field; « Effacer » disabled until the slug matches, red).
- Empty: « Aucun module actif. ». Unread space: `ErrorAlert` « Espace illisible : modules non
  relevés. » + « Relever maintenant ».
- No new PageActionBar action: the switches act at once.

**Responsive.** `md+`: two columns are not used — one list at 900 px max, line = icon · name/state ·
switch. `xs`: the same line, the state wraps under the name, the switch stays right, « Réessayer »
moves under the state line (beside the switch it squeezed the name into mid-word breaks); dialogs
full-screen; the counts move under the title. Long names wrap on two lines, never ellipsed (« Arrivée
et départ guidés », « Google Vacation Rentals »).

### 6.2 Console — « Nouveau client »

A « Modules » group of checkboxes under the add-ons, all ticked for the chosen plan, unticked lines
kept visible; changing plan re-ticks. Under it: « 8 modules actifs à la création. » (server text).

### 6.3 GuestFlow — what disappears (operator-managed space)

- Paramètres: no « Plugins » entry (the last entry becomes « Système »).
- `/parametres/plugins` → « Page introuvable ».
- The page of a module that is off → « Page introuvable » (no « Plugin inactif », no « Ouvrir
  Plugins »).
- Start assistant: 3 steps (Établissement, Logement, Emails) then « C'est prêt », without the
  « Plugins : … » link.
- Nothing is added: no « Modules inclus » list (see §9 Q3).

## 7. Test plan

### Server unit tests — instance

- [x] `server/src/tests/plugin-operator-governance.unit.test.js` — rules 1, 2, 15, 21 (operator-managed
  by env, by licence, neither; `activePlugins` ∩ `plugins`; absent field = no desire; expired licence
  keeps its `activePlugins`) — **9 cases (done: 9)**
- [x] `server/src/tests/plugin-operator-hidden-surface.unit.test.js` — rules 3–9 (each lifecycle route
  404 with the unknown-path body, for admin and support session; `GET /api/plugins` narrowed shape;
  settings routes still answer; `pluginsManageable`; `pluginStep` and `PUT /onboarding/plugins` 404;
  unmanaged space unchanged) — **16 cases (done: 15)**
- [x] `server/src/tests/plugin-reconciler.unit.test.js` — rules 16–19 (install + requirements,
  activate, deactivate keeps data, ordering both ways, no restart path → failure message, failure not
  retried for the same `issuedAt`, retried on a new one, blocked by open links then retried hourly,
  one failure does not stop the others) — **14 cases (done: 17, incl. the facts publication)**
- [x] `server/src/tests/plugin-erase-orders.unit.test.js` — rule 23 (executed once, refused while
  desired active, not installed = acknowledged no-op, recorded order id) — **5 cases (done: 6)**

### Server unit tests — console

- [x] `control-plane/server/src/tests/customer-modules.unit.test.js` — rules 10–14, 22 (allowed subset
  refusals with their French text, requirement both ways, audit lines, licence re-issued, state lines
  from facts incl. pending after 5 min, erase slug check, plan downgrade drops a module) — **15 cases (done: 17, plus `customer-modules-erase.unit.test.js`, 7 cases, rules 22–23)**
- [x] `control-plane/server/src/tests/licence-active-plugins.unit.test.js` — rules 15, 23, 25
  (payload fields, unseeded customer has none, seed from active ∩ allowed, unreadable space stays
  unseeded, acknowledged order dropped) — **8 cases (done: 8)**

- [x] `server/src/tests/plugin-reconciler-hardening.unit.test.js` — rules 31–34, 37 (erase order blocked hourly /
  failed until a new licence, the record survives the closing pass, out-of-plan dependants ignored, an
  allowed one still blocks, older licence skipped, closing pass limited to the plan, a licence dated far
  ahead applied but not kept as the mark, a few minutes ahead still kept) — **9 cases**
- [x] `server/src/tests/plugin-operator-support-hidden.unit.test.js` — rules 30, 35 (through the real
  chain: `createSupportAudit` with a real `supportAccessId` session gets the byte-identical 404 on
  every lifecycle route, and the same log trace as an unknown path; unmanaged space unchanged, 403
  logged; the matcher covers exactly the guarded routes; no plugins line in the summary) — **5 cases**
- [x] `server/src/tests/plugin-provisioning-task.unit.test.js` — rule 16 (boot pass, one per minute, a failing pass is logged) — 2 cases (added)

- [x] `control-plane/server/src/tests/customer-modules-hardening.unit.test.js` — rules 29, 31, 37, 38 (an old-release
  space stays unseeded then seeds once it reports; erase refused naming the dependant; an erase the
  space blocked or failed shows on the line, for the current licence only; licence stamps strictly
  increase when the clock steps back; the dependant line shows its reason and the data-less dependant
  offers removal, whose order lifts it, in « désinstallation » words; nothing to remove when not installed; a data erase keeps its words and cancelling a removal says so) — **8 cases**; the state
  lines of rule 14 (short badge + detail, `setupLabel`, `stale`, « données conservées ») are covered in
  `customer-modules.unit.test.js` and `customer-modules-erase.unit.test.js`.

### Client Vitest

- [x] `client/src/hooks/__tests__/useAuth.revalidate.test.jsx` — rule 36 (route change after 30 s, tab
  visible again, failed re-read keeps the session) — **3 cases**
- [x] `control-plane/client/src/__tests__/ModulesSection.polish.test.jsx` — rules 10–12, 14, 22 (refusal and
  failed count red, stale wait in warning, focus kept on the switch being saved, switch 44 px tall and fully clickable whose
  root clips its hidden input, so it never covers « Plus d’actions » — also proved with real pointer clicks in Playwright, erase
  dialog focus and Enter, no animation under reduced motion) — **6 cases**; `NewCustomerPage.modules`
  gains the two-quick-unticks case (rule 13).

- [x] `client/src/__tests__/App.plugins-managed.test.jsx` — rule 3 (the route itself: « Page introuvable » managed, the Plugins page unmanaged) — 2 cases (added)

- [x] `client/src/constants/__tests__/roles.plugins-managed.test.js` — rule 3 (route condition,
  settings menu without « Plugins », search words gone) — **3 cases (done: 3)**
- [x] `client/src/components/__tests__/NotFoundPage.plugins-managed.test.jsx` — rule 7 — **2 cases**
- [x] `client/src/pages/__tests__/OnboardingPage.plugins-managed.test.jsx` — rule 8 (no step, numbering,
  no last link) — **3 cases**
- [x] `control-plane/client/src/__tests__/ModulesSection.switches.test.jsx` — rules 10, 12, 14 (groups,
  confirm on off, refusal snaps back with text, state badges, retry) — **7 cases**
- [x] `control-plane/client/src/__tests__/ModulesSection.erase.test.jsx` — rules 22, 38 (« Désinstaller… » with a plain confirmation; the blocked line has no menu) — **5 cases**
- [x] `control-plane/client/src/__tests__/NewCustomerPage.modules.test.jsx` — rule 13 — **3 cases**

### E2E

The E2E server is unmanaged and must stay so (H2 rule 36 refuses the test key on a managed space), so
the existing suites keep covering the self-managed Plugins page unchanged. The managed behaviour is
covered at the HTTP level by the server suites above (real Express app, real routes). Rules 24 and 26
are release-process rules → marked « Sans test » with that reason.

### Manual UI verification

- [x] Shadow copy started with `GUESTFLOW_MANAGED=1` and a licence signed by the test key carrying
  `activePlugins`: no Plugins entry, `/parametres/plugins` 404, a module page off → « Page
  introuvable », assistant without the step; desktop and **390 px phone**.
- [x] Console dev (own ports, real console server on a seeded customer whose space is a copy of the shadow): switch Linge off → confirm → space shows « Inactif » within a
  minute and the Linge menu is gone after reload; switch it on → « Actif · 1.0.x ».
- [x] Refusal: out-of-plan 422 on the real console; the requirement refusals (switch off Réservation
  depuis le site while Google Vacation Rentals is on → sentence under the line, switch back on) are
  covered by the server and component suites.
- [x] Blocked: open payment links, switch Paiement en ligne off → « Bloqué : … ».
- [x] Phone (390 px) console: lines wrap, switches 44 px, dialogs full-screen.
- [x] Regression: Solio copy (unmanaged, no licence) — Plugins page, assistant step and « Plugin
  inactif » unchanged.

## 8. Out of scope

- An operator role or hidden page **inside** the space (rejected: credentials on every space, a route a
  customer can probe, and it would need the customer's consent each time — §9 Q1).
- Configuring a plugin's settings from the console (rule 6; support access covers it, §9 Q4).
- Plugin updates (already in « Versions › Plugins », rule 24).
- Fleet-wide « switch module X on for every Pro customer »: one customer at a time.
- Showing the customer a list of included modules or an upsell (§9 Q3).
- Self-hosted customers (no such offer today; rule 1 already covers them when they get a licence).
- Core self-update on a space that is managed only by its licence (`activePlugins`, without
  `GUESTFLOW_MANAGED=1`): `systemController` keeps keying on `GUESTFLOW_MANAGED`, so such a space still
  offers « Installer » for the core. The operator's updates go through the hosting; making a licence-only
  space refuse self-update is a separate decision (2026-10-28 review).

## 9. Open questions

All resolved by Adrien on 2026-10-28.

- **Q1 — How does the operator's choice reach the space?** Resolved 2026-10-28: `activePlugins` travels
  in the signed licence and is applied live by the space's reconciler (rules 15–19). Rejected: a
  console-driven stop-and-script, an operator account inside each space (§8), an SSH-only path.
- **Q2 — Does the plan switch on all its modules, or does the operator pick?** Resolved 2026-10-28: the
  operator picks within the plan plus options, with the whole plan pre-ticked (rules 10–13).
- **Q3 — Does the customer see anything about modules?** Resolved 2026-10-28: nothing about modules,
  only the features themselves. No « Modules inclus » card, no « Demander un module ».
- **Q4 — Who configures a module's settings (keys, accounts, linen stock)?** Resolved 2026-10-28: the
  customer in their own space (rule 6); Adrien does it through consented support access (H2). No
  settings page is duplicated in the console.
- **Q5 — Unmanaged spaces (Solio today):** Resolved 2026-10-28: they keep the Plugins page (rule 1);
  their owner is their operator.
- **Q6 — Per-module data erasure:** Resolved 2026-10-28: allowed, operator-only, inactive module only,
  slug typed to confirm, recoverable through the hosting backup (rules 22–23).

## 10. Implementation

Four lots, each shippable on `inte/plugins`:

1. **Lot 1 — the space applies the licence** (rules 15–21, §5 instance): `pluginGovernance`,
   `licence.activePlugins`, reconciler, task, outcome table. Inert until a licence carries
   `activePlugins`. ~8 files, 3 test files.
2. **Lot 2 — the console decides** (rules 10–14, 25, §5 console): `customer_plugins`, seed, licence
   field, `ModulesSection`, « Nouveau client ». ~10 files, 4 test files.
3. **Lot 3 — the customer no longer sees it** (rules 1–9): guard middleware, narrowed list,
   `pluginsManageable`, route condition, NotFound, assistant. ~8 files, 4 test files.
4. **Lot 4 — erasure** (rules 22–23). ~5 files, 2 test files.

Lots 1 → 2 → 3 in one release is the safe order (rule 26); lot 4 can follow.

### Implementation progress

**Second review (2026-10-28):** the switch's hidden input no longer covers « Plus d’actions » (the
root keeps `overflow: hidden`, 44 px tall); rule 30 amended (a hidden route is logged like an unknown
one); rules 37 (future-dated licence) and 38 (dependants and the removal of a data-less module) added.

**Review fixes (2026-10-28, two Opus reviewers):** rules 29–36 and the UI details of rule 14 — see the
rules; the `inte/plugins` merge (2FA, perf, planning, calendar, options) was resolved without conflict
and every suite re-run.

All four lots are in, one commit each, on `feature/plugin-operator-provisioning`.

| Lot | Commit | Server | Client |
|---|---|---|---|
| 1 — the space applies the licence (and runs erase orders, rule 23) | `feat(plugins): the space applies…` | governance 9, reconciler 18, erase orders 6, task 2 | — |
| 2 — the console decides | `feat(console): the operator switches…` | `customer-modules` 17, `licence-active-plugins` 8 | console: switches 7, new customer 3 |
| 3 — the customer no longer sees it | `feat(plugins): an operator-managed space hides…` | hidden surface 15 | roles 3, not found 2, assistant 3, App route 2 |
| 4 — erasure from the console | `feat(console): erase one module's data…` | `customer-modules-erase` 7 | console: erase 3 |

Deviations from the draft, all recorded in the rules above: no plugin icon in the console lines (the
catalogue's icon names have no mapping there); the fleet table is unchanged (rule 20); `counts` also
has `blocked`; rules 27 and 28 added; the reconciliation ignores plugins outside the licence (rule 21)
and drops the licence reader's cache (rule 16); the `/parametres/plugins` route itself is guarded in
`App.jsx` (the menu condition alone left the page reachable by address).

Verified on a shadow copy (prod data of 22/10): unmanaged — Plugins page, assistant step, lifecycle API
as before; managed with a console-signed licence — no Plugins entry, `/parametres/plugins` and a
module page that is off read « Page introuvable », every lifecycle call answers `{"error":"API route
not found"}`, settings still answer, the first reconciliation changed nothing, a licence without
Linge switched it off within seconds and a new one switched it on, an open payment link blocked its
deactivation (« Bloqué : 5 liens de paiement en attente… »); real console: seed from the space, switch
off with confirmation, « En attente » then « Inactif », out-of-plan refusal, erase with the typed slug
(tables, settings and row gone, order acknowledged and dropped from the licence), at 1280 and 390 px.
