# Control plane — plans, subscriptions and access

| Field | Value |
|---|---|
| **Status** | Approved |
| **Branch** | `feature/control-plane-plans-access` |
| **Created** | 2026-09-29 |
| **Author** | Adrien |
| **Related PR** | (link once opened) |
| **Summary for review** | `docs/specs/2026-09-29-control-plane-plans-and-access.html` |

---

## 1. Context

`specs/plugins-inventory.md` settled how GuestFlow is sold and hosted:

- **Hosting (D3):** one process per customer behind a thin control plane.
- **Plugins (D6):** 12 plugins, the rest in the core.
- **Market (D7):** France only.

On 2026-09-28 the owner asked for a full operator console (§14, "Control plane"). The console must
cover:

- onboarding a customer with the length of their subscription;
- a view of the whole fleet;
- easy deprovisioning;
- alerts when a subscription reaches its end;
- a payment reminder when the renewal is due.

On 2026-09-29 the owner added three requirements:

1. **Three plans, sold like Qonto's.** Each plan unlocks a different set of plugins, and each plan
   contains everything in the plan below it plus some more.
2. **A tool to assign plugins to plans.** Changing the offer must not require a code release.
3. **Access control:**
   - an instance only works while its plan is paid and valid;
   - every user starts from **one shared login page** and lands on **their own GuestFlow**;
   - every GuestFlow keeps **its own address**.

Several plugins, and parts of the core, are bound to the instance's address:

| Feature | How it depends on the address |
|---|---|
| Qonto | OAuth callback, webhook and payment return URL (`utils/qontoConfig.js`, `qontoWebhookRegistrar.js`) |
| Google Calendar | OAuth callback (`plugins/google-calendar/oauthClient.js`) |
| Gate access | Guest links (`plugins/gate-access/controller.js`) |
| WordPress plugin | The API base URL it calls |
| iCal export feeds | The URL pasted into Airbnb and Booking |
| Web push | Subscriptions are bound to the origin of the service worker |
| Emails | Every link in an email (`utils/emailTemplates.js`, `notificationService.js`) |
| Users | Invitation links (`usersController.js`) |

### 1.1 How Qonto sells (reference observed 2026-09-29, qonto.com/fr/pricing)

| Qonto Solo | Price excl. VAT / month | What it adds |
|---|---|---|
| Basic | 9 € | account, 30 transfers, 1 card |
| Smart | 19 € | everything in Basic + interest, 100 transfers, sub-account |
| Premium | 39 € | everything in Smart + 200 transfers, 4 sub-accounts, priority support |

The model has four traits:

- **The plans are nested.** Each plan is "everything in the plan below, plus more".
- **Plans have quotas**, on top of features.
- **Some features are sold à la carte** as add-ons (e.g. automated invoicing at 12 €/month).
- **Billing is monthly or yearly**, with a discount for yearly, and a 30-day trial.

The market for gîtes is 30–60 € per month for one or two units (`specs/plugins-inventory.md`
§9.1).

## 2. Goal

- **Sell three nested plans** whose plugin sets the operator edits in the console, with no release.
- **Each instance enforces its own entitlement.** It knows its plan, its allowed plugins and its
  quotas, and whether it is paid. It enforces all of this server-side, and it keeps working if the
  control plane is briefly down.
- **Unpaid subscriptions follow a predictable path:**
  - reminders before the end date;
  - a grace period;
  - read-only;
  - suspended;
  - archived.

  The customer's data is never lost by surprise, and anti-overbooking is never switched off while
  the customer is still reachable.
- **One login entry point** at `app.<domain>` sends every user to their own instance at
  `<slug>.<domain>`. Passwords stay in each instance, so a breach of the central page never exposes
  every customer.

## 3. Functional rules

### A. The plan catalogue

1. **The catalogue has exactly three plans, ordered** (names decided 2026-09-29, §9 Q1):
   - **Essentiel**;
   - **Pro**;
   - **Premium**.

   Each plan has:
   - a monthly and a yearly price excl. VAT;
   - quotas: a number of rental units and of user accounts;
   - its set of plugins.

   > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.
2. **Plans are nested.**
   - A plugin allowed in a plan is allowed in every plan above it.
   - The editor refuses to remove a plugin from a higher plan while a lower plan still holds it.
   - Adding a plugin to a lower plan adds it to the plans above it.

   > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.
3. **Allocation of the 12 plugins** (owner's decision, 2026-09-29, §9 Q2). The core (reservations,
   calendar, iCal, planning, emails, breakfast, push, tourist tax…) is in every plan.

   | Plan | Adds | Why |
   |---|---|---|
   | **Essentiel** | French school holidays, Météo-France vigilance, Google Calendar, Guided arrival/departure (SAS) | Useful to every gîte; no external contract; nearly free to run. The SAS is in the base plan at the owner's request: guiding the arrival and the departure is part of what every customer buys. |
   | **Pro** | Website booking (WordPress), Online payment (Qonto), Linen & laundry, Accounting export | Selling direct and running the stay: the features that pay for the subscription. |
   | **Premium** | Tariff recipes, Hourly resources (nordic bath), Neat cancellation insurance, Sowel gate access | A domain with equipment and yield management. Three of these need hardware or a partner contract. |

   Quotas and prices (market-aligned, decided 2026-09-29, §9 Q3; editable in the console without a release):

   | Plan | Units | Accounts | Price per month excl. VAT (monthly billing) | Price per month excl. VAT (yearly billing) |
   |---|---|---|---|---|
   | Essentiel | 2 | 2 | 29 € | 24 € |
   | Pro | 6 | 5 | 59 € | 49 € |
   | Premium | 15 | unlimited | 99 € | 83 € |

   > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.

4. **Add-ons à la carte.** A single plugin can be granted to one customer outside their plan, with
   its own monthly price. Example: a Pro customer who owns a Sowel gate buys "Sowel gate access".
   An add-on is part of the customer's subscription and follows its state (rules 14–19).
5. **Editing a plan never breaks a running customer.**
   - A plugin **added** to a plan becomes available to that plan's customers at their next licence
     refresh (rule 9). It is *available*, not installed: installing stays the customer's action
     (plugins phase 0).
   - A plugin **removed** from a plan stays allowed, as *grandfathered*, for customers who have
     already installed it. It is withdrawn only when they change plan. New customers do not get it.
   - The editor shows how many customers each change affects before it saves.

   > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.
6. **Every catalogue change is versioned.** The log records who changed it, when, and the before
   and after. A customer's subscription references the catalogue version it was sold under, so a
   past price can always be explained.

   > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.

### B. Customers and subscriptions (the console)

7. **Onboarding.** Creating a customer takes:
   - the company name and its contact (name, email);
   - the **slug** (the address, rule 21);
   - the plan;
   - monthly or yearly billing;
   - the **start date** and the **length of the subscription** (1 month, 12 months, or a custom
     end date);
   - optionally a trial, 30 days by default, with no payment required;
   - optionally add-ons.

   Saving provisions the instance:
   - its directory, encryption key and database;
   - its process unit and its route;
   - its first admin account, which receives an invitation email.

   The console then shows each step, green or red. A failed step can be retried alone.

   > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.
8. **Fleet view.** One line per customer, filterable and sortable by each field:
   - the slug and a link to its address;
   - the plan and its add-ons;
   - the subscription state (rule 14) and the renewal date;
   - the days left;
   - the app version;
   - the installed plugins;
   - the process status and the last backup.

   Three counters sit above it: "to renew within 30 days", "in grace or read-only", "suspended".

   > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.

### C. Entitlement inside the instance

9. **The licence.**
   - The control plane issues one **signed licence** per customer: a JWS signed with Ed25519.
   - It carries: `slug`, `plan`, `planName`, `catalogueVersion`, `plugins[]` (plan, add-ons and
     grandfathered ones), `planOf` (pluginId → name of the lowest plan that includes it, for the
     plugins outside `plugins[]`; absent = sold à la carte only), `quotas` (`units`, `users`; `null`
     = unlimited), `state`, `stateSince`, `endsAt`, `payUrl` (the Qonto link of the open renewal
     invoice, or `null`), `issuedAt`, `expiresAt` (issuedAt + 7 days).
   - It is written to `<dataDir>/licence.jws`, next to the database. The instance re-reads it at
     most once a minute and verifies it with the key of rule 30.
   - The state is the control plane's: the instance never derives it from the dates. `expiresAt`
     bounds how stale it can be.
   - The control plane re-issues every licence daily and on every change. No network port is opened
     on the instance for this.
10. **Missing or invalid licence.**
    - A missing, badly signed, or `expiresAt`-expired licence puts the instance in **read-only**
      (rule 16), never in suspended.
    - The failure is logged as `[licence]`.
    - A control-plane outage of less than 7 days therefore changes nothing for the customer.
11. **Plugins outside the licence.**
    - `POST /api/plugins/:id/install` and `…/activate` answer `402 PLAN_REQUIRED` for a plugin
      outside `plugins[]`.
    - The Plugins page shows such a plugin under « Disponibles » with the chip « Forfait Pro » or
      « Forfait Premium » (« Option à la carte » when no plan includes it), and a disabled
      « Installer » button whose tooltip is « Inclus dans le forfait Pro — contactez-nous pour
      changer de forfait. » (« Disponible en option — contactez-nous pour l'ajouter à votre
      abonnement. »). The server sends that text as `planHint`, and the 402 carries the same
      `message`.
12. **Downgrade.**
    - When the licence drops a plugin that is installed, the instance **treats it as inactive** from
      the next read: `isLive` answers false, so its routes, jobs, screens and `enabledPlugins` entry
      disappear exactly as for a deactivated plugin.
    - Its stored state and its data are **not touched**: nothing is written, so the plugin comes
      back as it was on upgrade.
    - The Plugins page shows « Désactivé — hors forfait » and « Données conservées », with no
      Activer button (`activate` answers 402). Désinstaller stays, with or without erasure.
13. **Quotas.**
    - Creating a unit or an account beyond the quota answers `402 QUOTA_REACHED`, and the page names
      the limit.
    - Existing units and accounts above a lowered quota keep working; only new ones are refused.

### D. Subscription lifecycle, reminders and payment

14. **States, in order** (durations decided by the owner on 2026-09-29, §9 Q4):

    | State | When | What changes for the customer |
    |---|---|---|
    | `trial` | During the trial | Everything works. An admin banner shows the days left. |
    | `active` | Paid, more than 30 days before `endsAt` | Nothing. |
    | `due` | 30 days before `endsAt`, until `endsAt` | Everything works. An admin banner reads « Votre abonnement se termine le … » and links to the payment. |
    | `grace` | From `endsAt` to `endsAt` + 7 days | Everything works. An orange admin banner is shown. |
    | `read_only` | From + 8 to + 30 days | Everyone can log in and read. Every export works. Every write answers `402 SUBSCRIPTION_READ_ONLY`, except those listed below this table. |
    | `suspended` | From + 31 days | The process is stopped. Its address serves a static page « Cet espace est suspendu ». Data is kept intact. |
    | `archived` | Operator's action (rule 20) | Data is exported, then erased after 90 days. |

    In `read_only`, these keep running:
    - the iCal import and export, and the anti-overbooking engine, including the manual
      « Synchroniser » (`POST /api/properties/:id/ical-sources/:sourceId/sync`, `…/sync-all`) and
      `POST /api/google-calendar/sync-now`;
    - receiving a payment on an existing booking: the Qonto webhook and poll, creating or emailing a
      payment link (`POST /api/payments/reservations/:id/payment-links|payment-emails`), recording a
      payment (`PATCH /api/reservations/:id/payment`, `POST /api/reservations/:id/arrival-payment`),
      and the website's payment of an existing booking;
    - registering a device for push notifications;
    - the scheduled jobs of the core (emails, sync): only requests from people are refused.

    In the instance, `suspended` and `archived` behave like `read_only`: stopping the process is the
    hosting's job, not the application's.

    Read-only closes the WordPress booking endpoint (`POST /public/v1/booking-requests`) with
    `503 BOOKING_UNAVAILABLE` and the public message « Réservations en ligne momentanément
    indisponibles. ». The quote keeps answering. It never cancels a booking.
15. **Renewal.** A payment received for a renewal:
    - moves `endsAt` by the length paid (1 or 12 months);
    - sets the state to `active`, whatever it was, including `suspended`: the process restarts;
    - re-issues the licence.

    > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.
16. **Why read-only keeps iCal alive.** A customer who has not paid still has guests arriving.
    Stopping the calendar sync would sell the same night twice on two platforms. That harm is the
    guest's and the platform's, not only the customer's.
17. **Payment requests.**
    - At `due` + 0 (30 days before the end), the control plane creates the renewal invoice and a
      Qonto payment link for the amount of the plan + add-ons for the next period, and emails them to the
      customer's contact.
    - Reminders go out at 7 days before the end, on the end date, and at + 7 days, each with the
      same link.
    - Every email appears in the customer's history in the console.
    - The operator can send a reminder by hand at any time (« Relancer maintenant »).
    - All reminder emails are templates the operator can edit.

    > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.
18. **Operator alerts.** The console's home page, and a daily email to the operator, list:
    - the customers entering `due`, `grace`, `read_only` or `suspended` that day;
    - the failed payments;
    - the failed provisioning steps.

    > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.
19. **Manual override.** The operator can:
    - extend `endsAt` (a commercial gesture, with a mandatory reason);
    - mark an invoice paid by hand (a transfer outside the payment link);
    - put a customer back to `active` with a reason.

    Every override is logged with its reason.

    > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.

### E. Deprovisioning

20. **« Déprovisionner » is one action with a confirmation that names what happens, in order:**
    1. the customer's full export (a database copy + uploads + CSV of reservations and clients) is
       produced;
    2. its link is emailed to the contact, valid 30 days (GDPR reversibility, study §9.5);
    3. the process and its route are stopped, and the address serves « Cet espace a été fermé »;
    4. the state becomes `archived`;
    5. 90 days later the data directory and its backups are erased. The console shows the date and
       lets the operator erase earlier, with a second confirmation, or cancel the erasure.

    Reactivating an archived customer before erasure restores the process from its directory.

    > **Sans test** — pas encore implémentée : livrée avec la console (C2), dont les tests remplaceront cette ligne.

### F. Addresses and login

21. **One address per customer.**
    - Each instance lives at `https://<slug>.<domain>` with its own TLS certificate.
    - The slug is 3 to 30 characters of `a-z 0-9 -`.
    - It is unique across the fleet, including archived customers until they are erased.
    - These slugs are reserved: `app`, `www`, `auth`, `api`, `admin`, `console`, `mail`, `status`,
      `demo`.

    > **Sans test** — pas encore implémentée : livrée avec la connexion commune (C3), dont les tests remplaceront cette ligne.
22. **Renaming a slug** is an operator action with a checklist shown before it runs:
    - the WordPress plugin setting;
    - the iCal feed URLs on every platform;
    - the Google and Qonto re-connections;
    - the push re-subscriptions.

    The old address answers `301` to the new one for 12 months.

    > **Sans test** — pas encore implémentée : livrée avec la connexion commune (C3), dont les tests remplaceront cette ligne.
23. **Isolated sessions.**
    - The session cookie stays **host-only** (no `Domain=` attribute), so one instance's cookie is
      never sent to another.
    - A test pins it: setting `Domain` on the session cookie is a security regression.
24. **The shared login page `https://app.<domain>`** asks only for an email. It then does one of
    four things:

    | The email belongs to | What happens |
    |---|---|
    | one active instance | The browser is redirected to `https://<slug>.<domain>/login?login_hint=<email>`. The instance's login page opens with the email filled in and the focus on the password. |
    | several instances (e.g. an accountant working for two gîtes) | A list of the spaces, by company name and address. Each one leads to the same redirect. |
    | a suspended or archived instance | The redirect happens anyway, and the instance's address shows its own suspended or closed page. |
    | no instance | A neutral answer: « Aucun espace GuestFlow n'est associé à cette adresse. Vérifiez l'orthographe ou contactez la personne qui vous a invité. » |

    `app.<domain>` remembers the last space chosen in a cookie of its own for 90 days, and offers it
    directly on the next visit: « Continuer vers Domaine Solio ».
25. **Passwords never leave the instance.**
    - The central page receives only an email. It never sees a password, a session or a user's
      role.
    - Password reset, first login and password change stay on the instance's page.

    > **Sans test** — pas encore implémentée : livrée avec la connexion commune (C3), dont les tests remplaceront cette ligne.
26. **The directory.**
    - The control plane keeps `(HMAC-SHA256(email), customerId)` pairs, never the email in clear.
    - Each instance reports its active accounts:
      - on every user create, update, deactivate or delete, the instance writes the list of HMACs of
        its active emails to its data directory;
      - the control plane reads it every minute.
    - A nightly full rebuild corrects any drift.

    > **Sans test** — pas encore implémentée : livrée avec la connexion commune (C3), dont les tests remplaceront cette ligne.
27. **The login page is rate-limited.** It allows 10 lookups per minute per IP, then answers `429`,
    because a lookup reveals whether an email has a space. The owner accepts that trade-off for
    convenience (§9 Q5, decided 2026-09-29): the address of a gîte's staff is not a secret held against the public.

    > **Sans test** — pas encore implémentée : livrée avec la connexion commune (C3), dont les tests remplaceront cette ligne.
28. **OAuth callbacks are central.**
    - Google refuses wildcard redirect URIs. Google Calendar and Qonto therefore return to one
      callback, `https://auth.<domain>/oauth/<provider>/callback`.
    - That callback resolves the customer from a `state` signed by the instance and forwards the code
      to `<slug>.<domain>` (study §9.4).
    - A `state` older than 10 minutes, or signed with a key of another customer, is refused.

    > **Sans test** — pas encore implémentée : livrée avec la connexion commune (C3), dont les tests remplaceront cette ligne.
29. **Unmanaged instances** (added 2026-09-29 during C1).
    - An instance is **managed** when the hosting sets `GUESTFLOW_MANAGED=1`.
    - An unmanaged instance **with no licence file** enforces nothing: all plugins, no quota, no
      banner, no read-only. This covers Solio on its own host until it moves to the platform, dev
      machines and the E2E server.
    - A licence file that is present is always enforced, managed or not.
    - Without this rule, rule 10 would have put Solio's production and every dev machine in
      read-only with the first release that carries C1.
30. **The verification key** (added 2026-09-29 during C1).
    - The instance verifies the licence with the Ed25519 public key in
      `GUESTFLOW_LICENCE_PUBLIC_KEY` (base64 DER SPKI), which the hosting sets with the rest of the
      environment. The customer never controls a hosted instance's environment.
    - The private key lives only in the control plane (C2).
    - A licence present with no key set cannot be trusted: read-only, logged `[licence]`.
    - Tests and the shadow sign licences with a throwaway key pair the same way.

## 4. Architecture

A new application, the **control plane**, lives next to the GuestFlow application: a top-level
`control-plane/` folder in the same repository, deployed separately, with its own SQLite database
(decided 2026-09-29, §9 Q6). The GuestFlow instance only gains the licence reader, the entitlement checks and the login
hint.

**Delivery in three PRs onto `inte/plugins`**, each usable on its own:

1. **C1: entitlement in the instance** (implemented 2026-09-29, branch `feature/control-plane-c1-entitlement`). The licence reader, `enforceSubscription`, the plan chip, the
   402 errors, the quotas and the banners (rules 9–16, 23). A licence written by hand drives it, so
   it can ship before the console.
2. **C2: the console.** Catalogue, customers, lifecycle, Qonto invoices and reminders, operator
   alerts, deprovisioning (rules 1–8, 17–20). Onboarding records the customer and issues its
   licence. The provisioning steps (process, route, TLS) call the hosting scripts of phase H. Until
   phase H they are a checklist the operator ticks by hand.
3. **C3: addresses and login.** `app.<domain>`, the directory, `login_hint`, the central OAuth relay,
   slug rules (rules 21–28).

### 4.1 Server side

**Control plane (`control-plane/server/src/`) — new:**

| Layer | File | Responsibility |
|---|---|---|
| database | `database.js`, `schema.sql` | Tables of §5, idempotent migrations. |
| models | `catalogueModel.js` | Plans, prices, quotas, plugin sets, versions (rules 1–6). |
| models | `customersModel.js`, `subscriptionsModel.js`, `invoicesModel.js` | Customers, subscription periods, invoices and their payment state. |
| models | `directoryModel.js` | HMAC email → customer pairs (rule 26). |
| models | `auditModel.js` | Every catalogue change, override and deprovisioning, with its reason. |
| controllers | `catalogueController.js` | Nested-set checks (rule 2), impact count (rule 5), versioning. |
| controllers | `customersController.js` | Onboarding (rule 7), fleet (rule 8), overrides (rule 19), deprovisioning (rule 20), slug rename (rule 22). |
| controllers | `loginController.js` | Email lookup and redirect (rules 24–27). |
| controllers | `oauthRelayController.js` | Central OAuth callbacks (rule 28). |
| utils | `lifecycle.js` | Pure state machine: `(endsAt, payments, overrides, now) → state` (rule 14). |
| utils | `licence.js` | Builds and signs the JWS (rule 9). |
| utils | `provisioner.js` | Directory, key, process unit, Caddy route, first admin; one retryable function per step (rule 7). |
| utils | `billing/qonto.js` | Qonto (§9 Q7): create the renewal invoice with its payment link, and read its payment state. A provider interface keeps the door open to automatic renewal later. |
| tasks | `scheduler.js` | Daily: state transitions, invoices, reminders, operator digest, licence re-issue, the 90-day erasure. Every minute: directory ingestion. |
| routes | `console/*`, `public/login.js`, `public/oauth.js` | Thin. The console routes sit behind operator auth with 2FA; the others are public. |

**GuestFlow instance (`server/src/`) — touched:**

| Layer | File | Responsibility |
|---|---|---|
| utils | `licence.js` (new, C1) | Reads and verifies `<dataDir>/licence.jws`, caches it for one minute, falls back to read-only; `allowsPlugin`, `quota`, `planFor`, `banner` (rules 9–10, 29–30). |
| utils | `planQuota.js` (new, C1) | The `QUOTA_REACHED` refusal; counts only when the plan has a limit (rule 13). |
| plugins/sdk | `registry.js` (C1) | `isLive` also asks the licence, so routes, public mounts, jobs and `requirePlugin` all drop a plugin outside the plan (rule 12). |
| middleware | `enforceSubscription.js` (new, C1) | `enforceSubscription()`: read-only → 402 on writes except the allow-list of rule 14, mounted on `/api` after the role guard. `closedWhenReadOnly()`: the website booking 503. |
| controllers | `pluginsController.js` (C1) | 402 `PLAN_REQUIRED` on install and activate; `outOfPlan`, `planChip`, `planHint` in the list payload (rules 11–12). |
| controllers | `authController.js` (C1) | `enabledPlugins` leaves out the plugins outside the licence (rule 12). C3: writes the directory file on user changes (rule 26). |
| controllers | `neatController.js` (C1) | Its job asks `isLive`, like every other plugin gate. |
| controllers, models | `propertiesController.js` + `propertiesModel.count()`, `usersController.js` + `usersModel.countActive()` (C1) | 402 `QUOTA_REACHED` (rule 13), for users before the welcome email. |
| routes | `public/bookingRequests.js` (C1) | Booking endpoint closed in `read_only` (rule 14). |
| routes | `subscription.js` (new, C1) | `GET /api/subscription` gives the banner payload; admin-only through the role guard. |
| index.js | | Session cookie stays host-only; a test pins it (rule 23). |

### 4.2 Client side

**Control plane (`control-plane/client/src/`) — new**, built with the same MUI theme and generic
components as GuestFlow (`PageActionBar`, `StatusBadge`, `DataPageScaffold`, `ConfirmDialog`,
`FormDialog`, `EmptyState`):

| Layer | File | Responsibility |
|---|---|---|
| pages | `FleetPage.jsx` | Rule 8: counters and a table on `md+`, cards on `xs`. |
| pages | `CustomerPage.jsx` | Subscription, invoices, reminders history, overrides, deprovisioning. |
| pages | `NewCustomerPage.jsx` | Rule 7 form and the provisioning steps. |
| pages | `CataloguePage.jsx` | The plan × plugin matrix (rules 2–6), prices, quotas, history. |
| pages | `EmailTemplatesPage.jsx` | Reminder texts (rule 17). |
| components | `PlanMatrix.jsx` | Specific to the catalogue. |
| components | `ProvisioningSteps.jsx` | Specific to onboarding. |
| components | `LifecycleTimeline.jsx` | Generic: states on a date axis. |

**Login page (`control-plane/client/src/public/LoginLookupPage.jsx`) — new.**

**GuestFlow instance (`client/src/`) — touched:**

| Layer | File | Responsibility |
|---|---|---|
| components | `SubscriptionBanner.jsx` (new, generic, C1) | The `trial`, `due`, `grace` and read-only banners, admins only, mounted in `App.jsx` next to `EmailVerifyBanner`; for every role, the toast of a write refused for the subscription. |
| pages | `LoginPage.jsx` (C1) | Reads `login_hint`, fills the email, focuses the password. |
| components | `PluginCard.jsx` (C1) | Plan chip and disabled Install with `planHint`; « Désactivé — hors forfait » (rules 11–12). |
| api | `api.js` (C1) | `getSubscription()`; fires `guestflow:read-only` on a 402 SUBSCRIPTION_READ_ONLY. The 402 bodies carry a French `message`, which the existing error path shows: no code-to-text mapping is added. |

### 4.3 API contract

- **Instance:**
  - `GET /api/subscription` → `{ state, endsAt, daysLeft, planName, payUrl }`, admins only;
    `{ state: null }` when nothing is enforced (rule 29).
  - The Plugins list entries gain `outOfPlan: boolean`, `planChip: 'Forfait Pro' | 'Forfait
    Premium' | 'Option à la carte' | null` and `planHint: string | null`.
  - New errors, each with a French `message`: `402 PLAN_REQUIRED {plan}`, `402 QUOTA_REACHED
    {quota, limit}`, `402 SUBSCRIPTION_READ_ONLY`, and on the public API `503 BOOKING_UNAVAILABLE`.
- **Control plane, public:**
  - `POST /login/lookup {email}` →
    `{ spaces: [{ name, url }] }` (the `url` carries `login_hint`), or `{ spaces: [] }`, or `429`.
  - `GET /oauth/:provider/callback`.
- **Control plane, console** (operator session + 2FA):
  - `/api/catalogue`;
  - `/api/customers`;
  - `/api/customers/:id/{renew, remind, override, deprovision, rename}`;
  - `/api/templates`.

## 5. Data model

**Control plane database (new):**

| Table | Contents |
|---|---|
| `plans` | `code`, `name`, `rank`, `priceMonthlyCents`, `priceYearlyCents`, `maxUnits`, `maxUsers` |
| `plan_plugins` | `planCode`, `pluginId` (the lowest plan holding it; higher plans inherit) |
| `addons` | `pluginId`, `priceMonthlyCents` |
| `catalogue_versions` | `version`, `snapshotJson`, `changedBy`, `changedAt`, `reason` |
| `customers` | `slug`, `companyName`, `contactName`, `contactEmail`, `state`, `createdAt`, `archivedAt`, `eraseAt` |
| `subscriptions` | `customerId`, `planCode`, `billing` (`monthly` \| `yearly`), `startsAt`, `endsAt`, `trialEndsAt`, `catalogueVersion` |
| `customer_addons` | `customerId`, `pluginId`, `since` |
| `grandfathered_plugins` | `customerId`, `pluginId`, `since` |
| `invoices` | `customerId`, `periodStart`, `periodEnd`, `amountCents`, `provider`, `providerRef`, `payUrl`, `status`, `paidAt` |
| `reminders` | `customerId`, `invoiceId`, `kind`, `sentAt` |
| `overrides` | `customerId`, `kind`, `reason`, `operator`, `at` |
| `directory` | `emailHmac`, `customerId` |
| `provisioning_steps` | `customerId`, `step`, `status`, `error`, `at` |

**Instance:** no new table. The licence and the directory file are files in the data directory,
next to the database.

## 6. UI / UX

The interactive summary shows each screen in a state you can manipulate: the plan matrix with its
refusals, the lifecycle on a date slider, the login lookup, and the customer's Plugins page for
each plan.

- **Catalogue (console):**
  - a matrix with 12 rows (plugins) and 3 columns (plans);
  - cells inherited from a lower plan are ticked and greyed out, with the tooltip « Inclus via
    Essentiel »;
  - saving opens a confirmation listing the impact: « 3 clients Pro gagnent Linge (disponible, non
    installé) », « 2 clients gardent Recettes (hors forfait, conservé) »;
  - on `xs` the matrix becomes one card per plan.
- **Fleet (console):** a sticky `PageActionBar` with « Nouveau client », the three counters as
  filter chips, the table, and a row click that opens the customer.
- **Instance banners** (`SubscriptionBanner`, at the top of the main area on every page, admins
  only; « Renouveler » opens `payUrl` when the licence carries one). The instance only knows
  `endsAt`, not the grace length, so no banner quotes a later date:
  - `trial` is blue: « Période d'essai : 12 jours restants. » (« Dernier jour de la période
    d'essai. » on the last day).
  - `due` is blue: « Votre abonnement Pro se termine le 12/11/2026. »
  - `grace` is orange: « Abonnement échu depuis le 12/11/2026 : renouvelez-le pour garder l'accès
    complet. »
  - `read_only`, `suspended` and `archived` are red: « Lecture seule : vos données restent
    consultables et exportables, la synchronisation des calendriers continue. »

  On `xs` the banner is full width, its text wraps, and « Renouveler » stays a 44 px target.
- **A refused write is never silent.** For every role, a `402 SUBSCRIPTION_READ_ONLY` also shows the
  error toast « Modification impossible : l'abonnement de cet espace est à renouveler. », even on a
  page that does not display its own errors: found on the shadow, where the client dialog swallowed
  the refusal. `api.js` fires `guestflow:read-only` and `SubscriptionBanner` turns it into the toast
  (one toast at a time, so a page that also toasts the message shows it once).

  Other roles see nothing until `read_only`. Then a write shows the 402 message: « Modification
  impossible : l'abonnement de cet espace est à renouveler. »
- **Instance Plugins page:** see rules 11–12 for the chip, the disabled « Installer » and « Désactivé —
  hors forfait ».
- **Instance login page:** with `?login_hint=`, the email is filled in and the password field has
  the focus; without it, the email field has the focus as before.
- **Login (`app.<domain>`):** a centred card with the logo, one email field and « Continuer ». It is
  full-width on `xs` with no horizontal scroll.

## 7. Test plan

### Server unit tests

- **Control plane:**
  - `lifecycle.js`: every transition at its day boundary, in Paris time; renewal from each state;
    override.
  - Catalogue: nested-set refusals; inheritance; impact count; grandfathering; versioning.
  - Licence: signature round-trip; tampered payload refused; expiry.
  - Login lookup: 0, 1 and n spaces; suspended; rate limit; no email stored in clear.
  - OAuth relay: valid, expired and foreign `state`.
  - Provisioner: each step's retry is idempotent.
  - Scheduler: reminder days; no duplicate reminder on the same day.
- **Instance (C1, implemented): `server/src/tests/subscription-entitlement.unit.test.js`, 28 tests.**
  - Licence reader (rules 9, 10, 29, 30): a valid licence; a tampered payload; another key; expired;
    missing when managed; missing when unmanaged; present when unmanaged; no key; the one-minute
    cache; the read-only states; an unknown state.
  - The banner payload: days left counted in Paris days; an untrusted licence.
  - Plugins (rules 4, 11, 12): 402 on install and activate with the plan hint; `outOfPlan`,
    `planChip`, `planHint` in the list; « Option à la carte »; a downgrade writes nothing and an
    upgrade restores; `isLive` false outside the licence.
  - Quotas (rule 13): the refusal message; unlimited never counts; an account refused before any
    email; below the quota creation carries on.
  - Read-only over HTTP (rules 14, 16): a write refused with the French message while reads pass;
    every allow-listed write passes; neighbouring writes stay refused; nothing refused outside
    read-only; the website booking closed with 503.
  - The session cookie has no `Domain` (rule 23).
- **Instance client (C1, implemented), 12 Vitest tests:**
  - `components/__tests__/SubscriptionBanner.test.jsx` (7): due with the pay link; grace; read-only;
    trial; nothing when active or unmanaged; nothing for other roles; the refused-write toast for
    every role.
  - `components/__tests__/PluginCard.plan.test.jsx` (3): chip and disabled Installer with its hint;
    installed outside the plan; unchanged inside the plan.
  - `pages/__tests__/LoginPage.login-hint.test.jsx` (2).

### Manual UI verification

**C1, done 2026-09-29 on the shadow** (`:4101`, a copy of the dev database, `GUESTFLOW_MANAGED=1`,
licences signed with a throwaway key):
- **Pro licence:** the 4 Premium plugins read « Désactivé — hors forfait »; `/api/tariff-recipes`
  answers 404; `enabledPlugins` has 8 ids. Activating Neat answers 402 with the plan hint.
  Uninstalled, Neat shows « Forfait Premium » and a disabled « Installer » with its tooltip.
- **Premium:** the 4 plugins come back active, with no write.
- **Essentiel, due in 10 days:** the blue banner with « Renouveler »; a 3rd unit is refused with
  « Votre forfait Essentiel comprend 2 logements. … ».
- **Read-only:**
  - saving a client is refused with the toast (the fix above), at 375 px;
  - the red banner fits 375 px with no horizontal scroll;
  - the iCal sync of a source runs (15 events scanned);
  - recording a payment passes the guard.
- **Managed, licence removed:** read-only, with `[licence] missing` in the log.
- **Unmanaged restart, no licence:** `state: null`, 12 plugins, nothing out of plan.
- **`/login?login_hint=`:** the email is filled in and the password field has the focus.

**Still to do with C2 and C3:**

- **Console:**
  - create a customer on a local shadow;
  - move the clock through every state (the instance reads a licence written by hand);
  - downgrade Premium → Pro and check the Plugins page;
  - deprovision, then reactivate.
- **Login:** reach two local instances (`*.localhost`) from `app.localhost` with one email that
  belongs to both.
- Check at 375 px: login, banners, the matrix as cards.

## 8. Out of scope

- **Custom domains** (`reservation.mongite.fr`): later, with Caddy on-demand TLS (study §9.3).
- **Self-service sign-up and plan change by the customer:** the operator does both in the console
  for now.
- **Fleet updates and backups:** a separate hosting spec (phase H).
- **Central identity** (one password for all spaces, SSO): rejected in rule 25 for isolation.
  Reconsider only if customers ask.
- **VAT handling beyond French VAT on French customers** (D7).

## 9. Open questions

- **Q1 — Names of the plans.** *Resolved 2026-09-29:* Essentiel / Pro / Premium.
- **Q2 — Allocation of the 12 plugins.** *Resolved 2026-09-29:* the proposal, with the SAS moved to
  Essentiel. Add-ons à la carte are kept (rule 4).
- **Q3 — Prices, quotas, yearly discount, trial.** *Resolved 2026-09-29:* 29/59/99 € excl. VAT,
  2/6/15 units, 2/5/unlimited accounts, 2 months free when billed yearly, a 30-day trial.
- **Q4 — Unpaid timeline.** *Resolved 2026-09-29:* 7 days of grace, read-only until + 30 days, then
  suspended. Archiving stays the operator's action.
- **Q5 — The login lookup reveals whether an email has a space.** *Resolved 2026-09-29:* direct
  redirect, rate-limited (rule 27). Emailing the links (Slack style) is rejected.
- **Q6 — Where the control plane's code lives.** *Resolved 2026-09-29:* a `control-plane/` folder in
  this repository, deployed separately. It reuses GuestFlow's MUI theme and generic components, and
  shares one CI.
- **Q7 — Billing tool.** *Resolved 2026-09-29:* **Qonto**. The renewal is an invoice with a payment
  link, emailed and reminded (rule 17); there is no automatic debit. Stripe Billing and GoCardless
  are set aside for now.
