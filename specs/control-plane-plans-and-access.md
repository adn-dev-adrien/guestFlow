# Control plane — plans, subscriptions and access

| Field | Value |
|---|---|
| **Status** | Implemented |
| **Branch** | C1: `feature/control-plane-c1-entitlement`; C2a: `feature/control-plane-c2-console`; C2b: `feature/control-plane-c2b-billing`; C3: `feature/control-plane-c3-login` |
| **Created** | 2026-09-29 |
| **Author** | Adrien |
| **Related PR** | C1: https://github.com/adn-dev-adrien/guestFlow/pull/637; C2a: https://github.com/adn-dev-adrien/guestFlow/pull/641; C2b: https://github.com/adn-dev-adrien/guestFlow/pull/644; C3: https://github.com/adn-dev-adrien/guestFlow/pull/646 |
| **Summary for review** | `docs/specs/2026-09-29-control-plane-plans-and-access.html`; C2a console screens: `docs/specs/2026-09-29-control-plane-c2a-console.html`; C2b billing screens: `docs/specs/2026-09-30-control-plane-c2b-billing.html`; C3 login and rename: `docs/specs/2026-09-30-control-plane-c3-login.html` |

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
2. **Plans are nested.**
   - A plugin allowed in a plan is allowed in every plan above it.
   - The editor refuses to remove a plugin from a higher plan while a lower plan still holds it.
   - Adding a plugin to a lower plan adds it to the plans above it.
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

4. **Add-ons à la carte.** A single plugin can be granted to one customer outside their plan, with
   its own monthly price. Example: a Pro customer who owns a Sowel gate buys "Sowel gate access".
   An add-on is part of the customer's subscription and follows its state (rules 14–19). An add-on
   the customer's plan already includes is shown as « inclus dans le forfait » and never sold on top
   of it; after a plan change that no longer includes it, it can be sold again.
5. **Editing a plan never breaks a running customer.**
   - A plugin **added** to a plan becomes available to that plan's customers at their next licence
     refresh (rule 9). It is *available*, not installed: installing stays the customer's action
     (plugins phase 0).
   - A plugin **removed** from a plan stays allowed, as *grandfathered*, for customers who have
     already installed it. It is withdrawn only when they change plan. New customers do not get it.
   - The editor shows how many customers each change affects before it saves.
6. **Every catalogue change is versioned.** The log records who changed it, when, and the before
   and after. A customer's subscription references the catalogue version it was sold under, so a
   past price can always be explained.

### B. Customers and subscriptions (the console)

7. **Onboarding.** Creating a customer takes:
   - the company name and its contact (name, email);
   - its **billing identity**: street, postcode, city, country (France by default) and, optionally,
     a VAT number (added 2026-09-30 with C2b: Qonto refuses to invoice a client with no address,
     rule 17);
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
   - Until phase H, the directory, the process and the route are manual steps the operator ticks.
     The console does the licence (rule 9) and the first admin itself.
   - The first admin is created by the instance's own `server/scripts/create-first-admin.js`, run
     against the instance's database: an admin with a temporary password to change at first login.
     The console emails the address, the login link with `login_hint` and that password to the
     contact; the password is never stored or logged. An email that already has an account is not
     invited twice. The seeded bootstrap account (`admin@guestflow.local` and its documented
     password) is removed once the real admin exists, if nobody ever used it: on a hosted instance a
     well-known password must not stay open.
   - The end date, the price and the field errors are computed by the server as the form is typed.
     With a trial, the subscription's end is the trial's end: the first paid period starts with the
     first payment.
8. **Fleet view.** One line per customer, filterable and sortable by each field:
   - the slug and a link to its address;
   - the plan and its add-ons;
   - the subscription state (rule 14) and the renewal date;
   - the days left;
   - the app version;
   - the installed plugins;
   - the process status and the last backup.

   Three counters sit above it: "to renew within 30 days", "in grace or read-only", "suspended".

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
    | `due` | 30 days before `endsAt` for yearly billing, 7 days before for monthly billing, until `endsAt` | Everything works. An admin banner reads « Votre abonnement se termine le … » and links to the payment. |
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
16. **Why read-only keeps iCal alive.** A customer who has not paid still has guests arriving.
    Stopping the calendar sync would sell the same night twice on two platforms. That harm is the
    guest's and the platform's, not only the customer's.
17. **Payment requests** (decided 2026-09-30 with C2b, §9 Q11–Q13).
    - **The renewal invoice.** On the day a customer's next deadline comes within its `due` window
      (30 days before it when billed yearly, 7 days when billed monthly, rule 14), the daily run
      creates, in the Qonto organisation connected to the console (rule 32):
      - the customer's Qonto client, once, from its billing identity (rule 7);
      - a **numbered client invoice**, `unpaid`, due on the deadline: one line for the plan and one
        per add-on, excl. VAT at the price of the catalogue version the customer was sold under
        (rule 6) times the period length, French VAT at 20 %, the period as performance dates, and
        the IBAN of the account chosen in rule 32;
      - a **payment link attached to that invoice** (`invoice_id`), card and Apple Pay.

      The licence carries that link as `payUrl` (rule 9), so the instance's « Renouveler » opens it.
      The deadline is the end of the paid period, or the end of the trial: a trial customer's first
      invoice follows the same rule.
    - One invoice per period. A failure (Qonto unreachable, no address) is retried at every run and
      stays in the alerts until it succeeds (rule 18).
    - **The emails.** Each invoice has up to four scheduled emails, each carrying the invoice's page
      and its payment link (D is the deadline):

      | Email | Day | Monthly billing | Yearly billing |
      |---|---|---|---|
      | `invoice` | the invoice's day | D-7 | D-30 |
      | `reminder_before` | D-7 | none: D-7 is the invoice's day | yes |
      | `reminder_due` | D | yes | yes |
      | `reminder_after` | D+7 | yes | yes |

      A run handles only the latest email whose day has come and that was not handled yet: a console
      down for several days sends one email, not a burst. Nothing is sent once the invoice is paid
      or cancelled.
    - **« Relancer maintenant »** on the customer page sends the `reminder_manual` email for the open
      invoice at once, after a preview. The click is the approval, whatever the template's mode
      (rule 33).
    - Every email, whether prepared, sent, ignored or failed, appears in the customer's history and
      in its « Emails » list.

18. **Operator alerts.** The console's home page, and a daily email to the operator, list:
    - the customers entering `due`, `grace`, `read_only` or `suspended` that day;
    - the failed payments (rule 34);
    - the failed provisioning steps;
    - the emails awaiting approval (rule 33), each with « Envoyer » and « Ignorer » on the home page;
    - the invoices that could not be created, and a Qonto connection that is missing or broken
      (rules 17, 32).

    The daily email goes to every operator at the end of the daily run, only when at least one line
    is there, and links to the console. The on-screen alerts shipped with C2a, the rest with C2b.
19. **Manual override.** The operator can:
    - extend `endsAt` (a commercial gesture, with a mandatory reason);
    - mark an invoice paid by hand (a transfer outside the payment link);
    - put a customer back to `active` with a reason, until a date the operator picks (7 days by
      default); after that date the state follows the calendar again.

    Every override is logged with its reason. « Remettre en actif » takes a date, 7 days ahead by
    default; the payment dialog shows, before saving, the new end date and the state it leads to.

### E. Deprovisioning

20. **« Déprovisionner » is one action with a confirmation that names what happens, in order, and
    that the operator confirms by typing the customer's slug:**
    1. the customer's full export (a database copy + uploads + CSV of reservations and clients) is
       produced;
    2. its link is emailed to the contact, valid 30 days (GDPR reversibility, study §9.5);
    3. the process and its route are stopped, and the address serves « Cet espace a été fermé »;
    4. the state becomes `archived`;
    5. 90 days later the data directory and its backups are erased. The console shows the date and
       lets the operator erase earlier, with a second confirmation, or cancel the erasure.

    Reactivating an archived customer before erasure restores the process from its directory.

    - A failed export stops the deprovisioning before anything is archived. A customer whose instance
      never existed is archived with nothing to export.
    - The export is one `.tar.gz`: the database copy, the uploads, and `reservations.csv` and
      `clients.csv`. The console serves it at `/exports/<token>`, a random token that is the only
      credential, until the 30 days are over (then `410`).
    - Stopping the process and the route is a manual step until phase H.
    - The erasure only ever removes `<CP_INSTANCES_ROOT>/<slug>`; any other path is refused.

### F. Addresses and login

21. **One address per customer.**
    - Each instance lives at `https://<slug>.<domain>` with its own TLS certificate.
    - The slug is 3 to 30 characters of `a-z 0-9 -`.
    - It is unique across the fleet, including archived customers until they are erased.
    - These slugs are reserved: `app`, `www`, `auth`, `api`, `admin`, `console`, `mail`, `status`,
      `demo`.
22. **Renaming a slug** (detailed 2026-09-30 with C3). « Changer l'adresse » on the customer page.
    - The new slug follows rule 21. The old one stays reserved for 12 months, so nobody else can
      take it, and answers `301` to the new address for those 12 months.
    - Before it runs, the console lists what must be redone, each item to tick:
      - the WordPress plugin setting (the API base URL);
      - the iCal export feed URLs pasted on every platform;
      - the redirect URIs declared in the customer's own Google and Qonto applications (rule 28),
        then « Connecter » again in the instance;
      - the instance's public URL (Réglages → Envoi d'emails);
      - the push notifications, which each device accepts again.

      « Changer l'adresse » stays disabled until every item is ticked and the new slug is valid.
    - The console renames the customer, journals it, and re-issues the licence (written to the new
      directory when it exists, downloadable otherwise, as in rule 9). Until phase H, a manual step
      « Dossier renommé, processus et route relancés, redirection 301 posée jusqu'au … » follows.
    - The directory (rule 26) follows at its next read.
23. **Isolated sessions.**
    - The session cookie stays **host-only** (no `Domain=` attribute), so one instance's cookie is
      never sent to another.
    - A test pins it: setting `Domain` on the session cookie is a security regression.
24. **The shared login page `https://app.<domain>`** asks only for an email. It then does one of
    four things:

    | The email belongs to | What happens |
    |---|---|
    | one instance | The browser is redirected to `https://<slug>.<domain>/login?login_hint=<email>`. The instance's login page opens with the email filled in and the focus on the password. |
    | several instances (e.g. an accountant working for two gîtes) | A list of the spaces, by company name and address. Each one leads to the same redirect. |
    | a suspended or archived instance | The redirect happens anyway, and the instance's address shows its own suspended or closed page. |
    | no instance | A neutral answer: « Aucun espace GuestFlow n'est associé à cette adresse. Vérifiez l'orthographe ou contactez la personne qui vous a invité. » |

    `app.<domain>` remembers the last space chosen in a cookie of its own for 90 days, and offers it
    directly on the next visit: « Continuer vers Domaine Solio », or « Utiliser une autre adresse ».

    Details (C3, 2026-09-30):
    - The console's process serves the page when the request's host is `app.<domain>`
      (`CP_APP_HOST`), and nothing else on that host. The page is HTML rendered by the server, with
      no script: it works on any phone, and there is no second client bundle to ship.
    - The email is matched trimmed and case-insensitive.
    - In the list, each space is a button; choosing one redirects like a single match.
    - The cookie `gf_space` holds only the slug, host-only on `app.<domain>`, `HttpOnly`,
      `SameSite=Lax`. A remembered space that was erased or renamed is forgotten silently.
    - The page carries its own Content-Security-Policy: no script, nothing framed, and
      `form-action 'self' https://*.<domain>`. Helmet's default `form-action 'self'` blocks a form
      whose answer redirects to the customer's space: found in the browser on the first run.
25. **Passwords never leave the instance.**
    - The central page receives only an email. It never sees a password, a session or a user's
      role.
    - Password reset, first login and password change stay on the instance's page.
    - The page has no password field. The lookup reads only `email` and ignores any other field; it
      answers company names and addresses, nothing about the account.
26. **The directory** (reworked 2026-09-30 with C3, §9 Q16).
    - The control plane keeps `(HMAC-SHA256(email), customerId)` pairs, never the email in clear.
      The HMAC key is the console's own (`CP_DATA_DIR/.directory-key`, created on first run).
    - Every minute it reads, read-only, the active accounts of each instance (`users` where
      `isActive = 1`), like it already reads the installed plugins (rule 5). It normalises each email
      (trimmed, lower-case) and replaces that customer's pairs in one transaction. The instance
      changes nothing and receives no key; a full read every minute leaves no drift to rebuild.
    - A customer whose database cannot be read keeps its last pairs. An erased customer's pairs are
      removed with it.
    - Suspended and archived customers stay in the directory (rule 24).
27. **The login page is rate-limited.** It allows 10 lookups per minute per IP, then answers `429`,
    because a lookup reveals whether an email has a space. The owner accepts that trade-off for
    convenience (§9 Q5, decided 2026-09-29): the address of a gîte's staff is not a secret held against the public.
    The `429` is the page itself, with « Trop de recherches depuis votre connexion. Réessayez dans une
    minute. »
28. **OAuth callbacks are central.** _(Withdrawn 2026-09-30, §9 Q17.)_ Google Agenda and Qonto are
    plugins, not installed on a new space, and their settings pages stay hidden until they are. A
    hosted customer who installs one connects it with their own application, declared with their own
    address `https://<slug>.<domain>/…/callback`, from the plugin's page, as Solio does. With no
    shared application, there is nothing to relay.

    > **Sans test** — retirée le 2026-09-30 : chaque client connecte ses propres applications, il n'y a pas de rappel central à tester (§9 Q17).
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
31. **Operator access to the console** (added 2026-09-29 with C2a, §9 Q8).
    - The console has operator accounts only, created from the command line
      (`npm run create-operator`); there is no sign-up page.
    - Every login takes a password and a second factor. Each operator chooses, in their profile,
      between an **authenticator app** (TOTP, RFC 6238, 6 digits, 30 s, ±1 step) and a **code sent
      by email** (6 digits, valid 10 minutes, a new code voids the previous one).
    - Changing the method takes effect only once a code of the new method is typed: a wrong code
      keeps the old method.
    - Activating a method issues 10 single-use **backup codes**, shown once and stored hashed. Each
      one replaces the second factor once.
    - Five wrong codes in a row lock the login for 15 minutes.
    - An operator session expires after 12 hours, or after 30 minutes without a request.
32. **The console's Qonto connection** (added 2026-09-30 with C2b, §9 Q12, Q14).
    - The console invoices from the Qonto organisation that sells GuestFlow, **ADN Dev**, never from
      a customer's or Solio's.
    - **It is GuestFlow's own Qonto module, settings included** (decided by the owner on
      2026-09-30): the same page « Paiements en ligne » (`client/src/pages/PaymentsSettingsPage.jsx`),
      at the same path `/parametres/paiements`, with the same card (environment, client id, secrets
      masked, « Connexion », « Tester la connexion », the verified diagnosis and the last failure),
      the same payment-link provider form (bank account, phone, website, description, KYC
      redirect), the same routes `/api/payments/qonto/*`, the same OAuth flow, the same automatic
      webhook subscription and the same signature check (specs/qonto-settings-in-app.md,
      specs/settings-one-save-and-automatic-webhook.md, specs/online-payments-qonto.md). Nothing is
      set through the console's environment: a secret Qonto regenerates is rotated from the page.
    - Only the storage differs: the console keeps these settings in its own database, secrets and
      tokens encrypted with its own key, and its public URL is `CP_PUBLIC_URL`.
    - The console asks Qonto for the instance's scopes plus `client.read`, `client.write`,
      `client_invoice.read` and `client_invoice.write`.
    - The invoices print the IBAN of the bank account chosen in the provider connection.
    - Without a working connection nothing is invoiced, and the home page says so.
    - The console's session cookie is `SameSite=Lax`, like GuestFlow's: Qonto's consent comes back
      with a top-level GET from qonto.com, which must carry the session that holds the OAuth
      `state`. Cross-site POSTs still carry no cookie.
33. **Email templates and their mode** (added 2026-09-30 with C2b, §9 Q13).
    - Five templates: `invoice`, `reminder_before`, `reminder_due`, `reminder_after`,
      `reminder_manual`. Their subject and text are edited in « Emails », with the placeholders
      `{{contactName}}`, `{{companyName}}`, `{{planName}}`, `{{period}}`, `{{amount}}` (incl. VAT),
      `{{deadline}}`, `{{invoiceNumber}}`, `{{invoiceUrl}}`, `{{payUrl}}` and `{{spaceUrl}}`. An
      unknown placeholder, or an empty subject or text, is refused on save. The page shows the
      server's rendering on a sample customer as the text is typed.
    - Each scheduled template is **Automatique** or **Manuel**, and all four ship as **Manuel**:
      the same guard as GuestFlow's rule that no email reaches a customer without the owner's
      approval. A payment made by transfer and not yet matched must never trigger a reminder on its
      own until the owner trusts the flow.
    - **Manuel:** the run prepares the email, with its text frozen at that moment, and puts it in
      « Emails à valider » on the home page, where « Envoyer » sends it and « Ignorer » drops it. A
      prepared email leaves the queue unsent when its invoice is paid or cancelled, or when a later
      email of the same invoice is prepared.
    - **Automatique:** the run sends it directly.
    - A mode that cannot be read counts as Manuel.
    - The account emails (the first admin's invitation, the export link, the operator's code) are
      not templates.
34. **Payment detection** (added 2026-09-30 with C2b).
    - Every 15 minutes, and on « Vérifier le paiement », the console reads each open invoice in
      Qonto. A `paid` payment on its link, or the invoice itself `paid` (a transfer matched in Qonto),
      renews the subscription by the invoiced length (rule 15), once. The invoice is marked paid with
      its date.
    - A failed or expired payment attempt on a link is journaled and listed once in the alerts.
    - « Enregistrer un paiement » (rule 19) while a Qonto invoice is open for the period marks that
      invoice paid instead of adding another, and deactivates its payment link so the customer
      cannot pay twice. The transfer is then matched in Qonto by the operator.
    - Deprovisioning cancels the open invoice in Qonto (`mark_as_canceled`) and deactivates its
      link.
    - A plan change while an invoice is open leaves that invoice as issued: the new price applies
      from the next invoice.

## 4. Architecture

A new application, the **control plane**, lives next to the GuestFlow application: a top-level
`control-plane/` folder in the same repository, deployed separately, with its own SQLite database
(decided 2026-09-29, §9 Q6). The GuestFlow instance only gains the licence reader, the entitlement checks and the login
hint.

**Delivery in three PRs onto `inte/plugins`**, each usable on its own:

1. **C1: entitlement in the instance** (implemented 2026-09-29, branch `feature/control-plane-c1-entitlement`). The licence reader, `enforceSubscription`, the plan chip, the
   402 errors, the quotas and the banners (rules 9–16, 23). A licence written by hand drives it, so
   it can ship before the console.
2. **C2: the console**, in two PRs (decided 2026-09-29, §9 Q9). Onboarding records the customer
   and issues its licence. The provisioning steps (process, route, TLS) call the hosting scripts of
   phase H. Until phase H they are a checklist the operator ticks by hand.
   - **C2a** (implemented 2026-09-29, branch `feature/control-plane-c2-console`): the operator
     login and its second factor (rule 31), the catalogue (rules 1–6), the customers, onboarding
     and the fleet (rules 7–8), the slug rules (rule 21), the licence issued and written to the
     instance's data directory or downloaded, the daily lifecycle, a payment recorded by hand
     (rules 15, 19), the on-screen alerts (rule 18), deprovisioning (rule 20).
   - **C2b** (implemented 2026-09-30, branch `feature/control-plane-c2b-billing`): the Qonto connection (rule 32), the
     renewal invoice and its payment link, the reminders and « Relancer maintenant » (rule 17), the
     email templates and their mode (rule 33), payment detection (rule 34), the operator's daily
     email and the remaining alerts (rule 18), the billing identity (rule 7).
3. **C3: addresses and login** (implemented 2026-09-30, one PR, §9 Q15; branch
   `feature/control-plane-c3-login`). The page
   `app.<domain>`, the directory read from the instances, the rate limit, and the slug rename
   (rules 22, 24–27). The central OAuth relay (rule 28) is withdrawn. The slug rules themselves
   (rule 21) shipped with C2a, which needs them at onboarding.

**Running the console.** `control-plane/server` (Express, its own SQLite database) serves the API
and the built client; `npm run dev:console` runs both in dev (API :4100, client :3200). Its
environment:
- `CP_INSTANCES_ROOT`: the instances' directories, `<root>/<slug>/data/guestflow.db`.
- `CP_LICENCE_PRIVATE_KEY`: the Ed25519 private key of rule 30, base64 DER PKCS8. The console
  refuses to start without it.
- `CP_DATA_DIR`: its database, the key that encrypts the TOTP seeds, and the exports.
- `CP_DOMAIN`, `CP_PUBLIC_URL`, `CP_SESSION_SECRET`, `CP_SMTP_*`, `CP_PORT`.
- `CP_APP_HOST` (C3): the host of the shared login page, `app.<CP_DOMAIN>` by default
  (`app.localhost` in dev).
- `CP_NOW` moves its clock, outside production only, to walk a customer through the lifecycle.

Operators are created with `npm run create-operator -- --email … --name …` (rule 31).

### 4.1 Server side

**Control plane (`control-plane/server/src/`) — new:**

| Layer | File | Responsibility |
|---|---|---|
| database | `database.js` | Tables of §5, idempotent; seeds the catalogue decided on 2026-09-29 (rule 3). |
| models | `catalogueModel.js` | Plans, prices, quotas, the lowest plan of each plugin, add-ons, versions (rules 1–6). |
| models | `customersModel.js` | Customers, their subscription, add-ons and grandfathered plugins. |
| models | `invoicesModel.js` | Invoices: `manual` (a payment recorded by the operator) and, from C2b, `qonto` with their number, pages, link and payment state. |
| models | `emailsModel.js` (C2b) | The templates and their mode, and every customer email with its status (`reminders`, rules 17, 33). |
| models | `auditModel.js` | The journal (catalogue changes, state transitions, overrides, deprovisioning) and the overrides with their reason. |
| models | `provisioningModel.js` | The creation and deprovisioning steps, and the export links. |
| models | `operatorsModel.js`, `metaModel.js` | Operator accounts and their second factor (rule 31); the last daily run. |
| models | `directoryModel.js` (C3) | HMAC email → customer pairs, replaced per customer (rule 26); the reserved old slugs (rule 22). |
| controllers | `catalogueController.js` | The matrix, one click at a time with the nesting refusal (rule 2), the impact (rule 5), the save with its version and the grandfathering (rules 5–6). |
| controllers | `customersController.js` | Onboarding and its steps (rule 7), the fleet (rule 8), payment and overrides (rules 15, 19), plan change, the licence (rule 9), deprovisioning and erasure (rule 20). C3: slug rename with its checklist (rule 22). |
| controllers | `alertsController.js` | The home page alerts (rule 18). |
| controllers | `authController.js` | Password, then TOTP, email or backup code; the lockout; the method change (rule 31). |
| controllers | `loginController.js` (C3) | The lookup: an email → one space, several, or none; the remembered space; the instance login URL with its hint (rules 24, 25); `readDirectory`, each instance's active accounts into the directory (rule 26). |
| utils | `directory.js` (C3) | The normalised email and its HMAC under the console's key (rule 26). `instances.readActiveEmails` reads the accounts, read-only. |
| utils | `loginPage.js` (C3) | The HTML of `app.<domain>`: the form, the list, the neutral answer, the remembered space, the 429; every value escaped (rules 24, 27). |
| routes | `public.js` (C3) | Mounted for the host `app.<domain>` only: `GET /`, `POST /lookup` (rate-limited), `POST /go`, `POST /forget` (rules 24, 27). |
| middleware | `requireOperator.js` | Every console route but the login needs the second factor; 12 h / 30 min idle session. |
| utils | `lifecycle.js` | Pure state machine on Paris days: `(endsAt, trialEndsAt, billing, forceActiveUntil, archivedAt, today) → state`; the renewal (rules 14, 15, 19). |
| utils | `licenceIssuer.js` | Builds the rule 9 payload, signs it with GuestFlow's own `signLicence`, writes it atomically to the instance. |
| utils | `instances.js` | Where an instance lives; reads its `plugins` table read-only. |
| utils | `firstAdmin.js` | Runs the instance's `scripts/create-first-admin.js` against its database (rule 7). |
| utils | `exporter.js`, `eraser.js` | The deprovisioning export; the erasure that only ever removes `<root>/<slug>` (rule 20). |
| utils | `totp.js`, `secrets.js`, `mailer.js`, `slug.js`, `days.js`, `clock.js`, `gf.js` | RFC 6238; AES-256-GCM for the TOTP seeds; SMTP; rule 21; Paris days; `CP_NOW`; the GuestFlow modules shared by path. |
| models | `qontoSettingsModel.js` (C2b) | The settings interface GuestFlow's Qonto module expects (`qontoCredentials`, `qontoTokens`, `recordQontoHealth`…), on the console's own table, secrets encrypted (rule 32). |
| utils | `qontoBilling.js` (C2b) | The renewal in Qonto terms: the client, the invoice and its lines, the attached link, their payment state, cancel and deactivate — every call through GuestFlow's `withQonto`. |
| utils | `templates.js` (C2b) | Placeholder rendering and validation (rule 33). |
| controllers | `billingController.js` (C2b) | The invoice of a period, the emails due that day, the approval queue, « Relancer maintenant », payment detection (rules 17, 33, 34). |
| controllers | `templatesController.js` (C2b) | The email templates, their mode and their preview (rule 33). |
| routes | `payments.js` (C2b) | GuestFlow's `/api/payments/qonto/*` and `/api/payments/settings`, built by the shared `createQontoSettingsController` over the console's settings; the webhook is public, the rest behind `requireOperator` (rule 32). |
| tasks | `scheduler.js` | Daily at 04:00 Paris time, catching up a missed day: states, licence re-issue, the 90-day erasure, then (C2b) invoices, emails and the operator's email. Every 15 minutes (C2b): payment detection. Every minute (C3): the directory read. |
| routes | `auth.js`, `console.js`, `exports.js` | Thin. `/api/auth/*` (rate-limited), `/api/*` behind `requireOperator`, `/exports/:token` public (the token is the credential). |
| — | `app.js`, `context.js`, `index.js` | The Express app, the wiring with every external injected (tests use an in-memory database), the entry point. |
| scripts | `control-plane/server/scripts/create-operator.js` | Creates an operator; there is no sign-up page (rule 31). |

**GuestFlow instance (`server/src/`) — touched:**

| Layer | File | Responsibility |
|---|---|---|
| utils | `licence.js` (new, C1) | Reads and verifies `<dataDir>/licence.jws`, caches it for one minute, falls back to read-only; `allowsPlugin`, `quota`, `planFor`, `banner` (rules 9–10, 29–30). |
| utils | `planQuota.js` (new, C1) | The `QUOTA_REACHED` refusal; counts only when the plan has a limit (rule 13). |
| plugins/sdk | `registry.js` (C1) | `isLive` also asks the licence, so routes, public mounts, jobs and `requirePlugin` all drop a plugin outside the plan (rule 12). |
| middleware | `enforceSubscription.js` (new, C1) | `enforceSubscription()`: read-only → 402 on writes except the allow-list of rule 14, mounted on `/api` after the role guard. `closedWhenReadOnly()`: the website booking 503. |
| controllers | `pluginsController.js` (C1) | 402 `PLAN_REQUIRED` on install and activate; `outOfPlan`, `planChip`, `planHint` in the list payload (rules 11–12). |
| controllers | `authController.js` (C1) | `enabledPlugins` leaves out the plugins outside the licence (rule 12). |
| controllers | `neatController.js` (C1) | Its job asks `isLive`, like every other plugin gate. |
| controllers, models | `propertiesController.js` + `propertiesModel.count()`, `usersController.js` + `usersModel.countActive()` (C1) | 402 `QUOTA_REACHED` (rule 13), for users before the welcome email. |
| routes | `public/bookingRequests.js` (C1) | Booking endpoint closed in `read_only` (rule 14). |
| routes | `subscription.js` (new, C1) | `GET /api/subscription` gives the banner payload; admin-only through the role guard. |
| index.js | | Session cookie stays host-only; a test pins it (rule 23). |
| controllers | `qontoSettingsController.js` (new, C2b) | `createQontoSettingsController({ settings, env, scopes, … })`: the Qonto settings handlers moved out of `paymentsController.js` unchanged, so the console mounts the same ones over its own settings (rule 32). |
| controllers | `paymentsController.js`, `qontoWebhookController.js` (C2b) | Use the factory above and the shared signature check; behaviour unchanged. |
| utils | `qontoClient.js` (C2b) | Gains the invoicing calls: client, client invoice, invoice payment link, cancel, link deactivation; `getAuthorizeUrl` already takes the scopes. |
| utils | `qontoWebhookSignature.js` (new, C2b) | `verifySignature` and `extractPaymentLinkId`, out of the webhook controller. |
| utils | `qontoService.js`, `qontoWebhookRegistrar.js` (C2b) | Load GuestFlow's settings model only when no `settings` is passed, so the console can require them without opening an instance database. |
| utils, scripts | `firstAdmin.js` + `scripts/create-first-admin.js` (new, C2a) | The first administrator of a hosted instance, created through the instance's own `usersModel`; prints the temporary password for the console's invitation; removes the unused bootstrap account (rule 7). |

### 4.2 Client side

**Control plane (`control-plane/client/src/`) — new.** It imports GuestFlow's theme and generic
components straight from `client/src` as `@gf/…` (`PageActionBar`, `StatusBadge`,
`ResponsiveTable`, `FormDialog`, `DialogProvider`, `LoadingState`, `ErrorAlert`), and resolves
React, MUI and the router from its own `node_modules` so both trees share one copy
(`control-plane/client/shared.config.js`).

| Layer | File | Responsibility |
|---|---|---|
| pages | `LoginPage.jsx` | Password, then the second factor or a backup code (rule 31). |
| pages | `ProfilePage.jsx` | The second-factor method, its QR code, the backup codes shown once (rule 31). |
| pages | `FleetPage.jsx` | Rules 8 and 18: alerts, counters as filters, a table on `sm+`, cards on `xs`. |
| pages | `NewCustomerPage.jsx` | Rule 7 form, checked by the server as it is typed. |
| pages | `CustomerPage.jsx` | Subscription, creation and deprovisioning steps, invoices, history, and the actions of rules 15, 19, 20. |
| pages | `CataloguePage.jsx` | The matrix, prices, quotas, add-ons, the impact before saving and the versions (rules 1–6). |
| pages | `EmailTemplatesPage.jsx` (C2b) | The five templates, their mode and the server's preview (rule 33). |
| components | `EmailQueue.jsx` (C2b) | Specific: the emails awaiting approval, with their preview, « Envoyer » and « Ignorer »; on the home page and the customer page. |
| components | `PlanMatrix.jsx` | Specific: the matrix, one card per plan on `xs`. |
| components | `ProvisioningSteps.jsx` | Specific: steps green, red, to do or skipped, with their one action. |
| components | `LifecycleChip.jsx` | Generic: a subscription state as a `StatusBadge`. |
| components | `KeyValues.jsx` | Generic: a « label : value » list, stacked on `xs`. |

The console also mounts GuestFlow's `PaymentsSettingsPage` at `/parametres/paiements` (rule 32);
its `api.js` calls land on the console's identical `/api/payments/*` routes.

**Login page (`app.<domain>`) — C3:** rendered by the server (`utils/loginPage.js`), no client
code. The customer page gains « Changer l'adresse », a `FormDialog` with the new slug checked as
it is typed and the rule 22 checklist, and « Anciennes adresses » in its subscription card
(`formerAddresses` in the customer payload).

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
- **Control plane, public, host `app.<domain>`** (HTML, forms, no JSON):
  - `GET /` → the form, or the remembered space;
  - `POST /lookup {email}` → `303` to `https://<slug>.<domain>/login?login_hint=<email>` for one
    space, the list for several, the neutral answer for none, `429` past 10 per minute per IP;
  - `POST /go {slug, email}` → the same `303`, and the `gf_space` cookie; `POST /forget` clears it.
- **Control plane, operator login** (rate-limited): `POST /api/auth/login {email, password}` →
  `{ step: 'second-factor', method, message }`; `POST /api/auth/verify {code}` (6 digits or a
  `xxxxx-xxxxx` backup code) → `{ operator, notice }`; `POST /api/auth/resend`; `POST
  /api/auth/logout`; `GET /api/auth/me`; `POST /api/auth/mfa/start {method}` → `{ qrDataUrl,
  secret }` for the app; `POST /api/auth/mfa/confirm {code}` → `{ operator, backupCodes }`.
- **Control plane, console** (operator session + second factor):
  - `GET /api/alerts`;
  - `GET /api/catalogue`, `POST /api/catalogue/toggle {lowest, pluginId, planCode}` (409
    `NESTED`), `POST /api/catalogue/impact {lowest}`, `PUT /api/catalogue {lowest, plans, addons,
    reason}`;
  - `GET /api/customers` (fleet rows + counters), `POST /api/customers/preview` (field errors, the
    summary, the add-ons on offer), `POST /api/customers` (400 with `errors` per field),
    `GET /api/customers/:id`;
  - `POST /api/customers/:id/{payment, extend, force-active, plan, deprovision, reactivate,
    cancel-erase, erase}` and `POST /api/customers/:id/steps/:step {action}`; `GET
    /api/customers/:id/licence` (the `.jws`);
  - C2b: `POST /api/customers/:id/{remind, check-payment}` (`remind` takes `{preview: true}` for
    the text first); `POST /api/emails/:id/{send, ignore}`; `GET /api/templates`, `PUT
    /api/templates/:key {subject, body, sendMode}` (400 `UNKNOWN_PLACEHOLDER`), `POST
    /api/templates/:key/preview {subject, body}`; GuestFlow's own `/api/payments/settings` and
    `/api/payments/qonto/{authorize, callback, status, credentials, test, bank-accounts,
    connect-provider, refresh-connection, webhook}`, same contracts (rule 32).
  - C3: `POST /api/customers/:id/rename/preview {slug}` → `{ error, url, until, checklist: [{ key,
    label }] }`; `POST /api/customers/:id/rename {slug, checked: [keys]}` (400 `CHECKLIST` until
    every item is ticked, 400 with the slug's error).
- **Control plane, public:** `GET /exports/:token` (410 once expired); `POST
  /api/payments/qonto/webhook` (Qonto's signature, 503 without a secret, 401 on a bad one).
- **Control plane payloads (C2b):** `GET /api/alerts` → `{ alerts: [{ customerId, link?, severity,
  text }], queue: [{ id, customerId, companyName, name, preparedOn, recipient, subject, body }] }`;
  the customer gains `billingIdentity { street, postcode, city, country, vatNumber, lines }`,
  `countries`, `invoices[] { number, period, amount, total, status, statusLabel, detail, invoiceUrl,
  payUrl }`, `emails[] { name, status, statusLabel, at, recipient, subject, body, operator, error }`
  and `actions.{ editBilling, remind, remindHint, checkPayment }`; `check-payment` answers the
  customer plus a `notice`. The customer's `billing` stays the billing mode (`monthly` |
  `yearly`).

## 5. Data model

**Control plane database (new):**

| Table | Contents |
|---|---|
| `plans` | `code`, `name`, `rank`, `priceMonthlyCents`, `priceYearlyCents`, `maxUnits`, `maxUsers` (null = unlimited) |
| `plan_plugins` | `pluginId`, `planCode` (the lowest plan holding it; higher plans inherit) |
| `addons` | `pluginId`, `priceMonthlyCents` |
| `catalogue_versions` | `version`, `snapshotJson`, `changedBy`, `changedAt`, `reason` |
| `customers` | `slug` (unique until erased), `companyName`, `contactName`, `contactEmail`, `state`, `stateSince`, `createdAt`, `archivedAt`, `eraseAt`, `erasedAt`; C2b: `billingStreet`, `billingPostcode`, `billingCity`, `billingCountry` (default `FR`), `vatNumber`, `qontoClientId` |
| `subscriptions` | `customerId`, `planCode`, `billing` (`monthly` \| `yearly`), `periodMonths`, `startsAt`, `endsAt`, `trialEndsAt`, `forceActiveUntil`, `catalogueVersion` |
| `customer_addons` | `customerId`, `pluginId`, `since` |
| `grandfathered_plugins` | `customerId`, `pluginId`, `since` |
| `invoices` | `customerId`, `periodStart`, `periodEnd`, `amountCents`, `provider`, `providerRef`, `payUrl`, `status`, `paidAt`, `createdAt`; C2b: `months`, `totalCents` (incl. VAT), `number`, `invoiceUrl`, `payLinkId`, `paidBy` (`qonto` \| `manual`), `lastError` |
| `overrides` | `customerId`, `kind`, `reason`, `operator`, `at` |
| `provisioning_steps` | `customerId`, `step`, `status` (`ok` \| `failed` \| `todo` \| `skipped`), `detail`, `at` |
| `audit` | `at`, `day`, `operator`, `customerId`, `kind`, `text` (the sentence the history shows) |
| `exports` | `token`, `customerId`, `path`, `createdAt`, `expiresAt` |
| `operators` | `email`, `name`, `passwordHash`, `mfaMethod`, `totpSecret` (encrypted), `pendingMethod`, `pendingTotpSecret`, `backupCodes` (hashed), `failedCount`, `lockedUntil` |
| `mfa_codes` | `operatorId`, `codeHash`, `expiresAt` (the email code) |
| `meta` | `key`, `value` (the last daily run) |
| `qonto_settings` (C2b) | one row: the columns GuestFlow's Qonto module reads and writes (environment, client id, secrets and tokens encrypted, connection, health, webhook subscription) |
| `reminders` (C2b) | `customerId`, `invoiceId`, `kind`, `status` (`pending` \| `sent` \| `ignored` \| `dropped` \| `failed`), `recipient`, `subject`, `body`, `preparedAt`, `handledAt`, `operator`, `error`; unique (`invoiceId`, `kind`) except `reminder_manual` |
| `email_templates` (C2b) | `key`, `subject`, `body`, `sendMode` (`manual` \| `auto`), `updatedAt`, `updatedBy` |
| `payment_failures` (C2b) | `invoiceId`, `providerPaymentId` (unique), `status`, `at` |
| `directory` (C3) | `emailHmac`, `customerId`, `seenAt` |
| `slug_aliases` (C3) | `slug`, `customerId`, `until` (the old address, reserved and redirected for 12 months) |

**Instance:** no new table. The licence and the directory file are files in the data directory,
next to the database.

## 6. UI / UX

The interactive summary shows each screen in a state you can manipulate: the plan matrix with its
refusals, the lifecycle on a date slider, the login lookup, and the customer's Plugins page for
each plan. The C2a console screens have their own mock
(`docs/specs/2026-09-29-control-plane-c2a-console.html`).

- **Console shell:** a green app bar with « Clients », « Catalogue », « Profil » and a logout
  button; the navigation scrolls sideways on `xs` rather than wrapping. Every page opens with
  GuestFlow's `PageActionBar`; on `xs` the customer page's actions fold into its « … » menu.
- **Console login:** a centred card. Step 1 asks for the email and the password; step 2 shows the
  server's sentence (the app's code, or « Un code à 6 chiffres vient d'être envoyé à a•••n@… »),
  one code field, « Renvoyer le code » for the email method only, and « Utiliser un code de
  secours ». A lockout brings back step 1 with its message.
- **Profile:** the current method and the backup codes left; choosing the app shows its QR code and
  its key in groups of four; the new method is active only after « Activer » with a valid code, and
  the 10 backup codes are then shown once.
- **New customer:** two cards (identity, subscription) and the server's summary below them. The slug
  error shows as it is typed; the other errors after a save attempt. Add-ons the chosen plan
  already includes are ticked, disabled and labelled « inclus dans le forfait ». Saving opens the
  customer's page on its steps.
- **Customer page:** the subscription card and the creation steps side by side on `md+`, stacked on
  `xs`; then the deprovisioning steps when there are some, the invoices and the history. Each
  action opens a `FormDialog` (full screen on `xs`); a refused action toasts the server's message
  and the dialog stays open. « Déprovisionner » lists the five steps and stays disabled until the
  slug is typed; « Effacer maintenant » asks for the slug again.
- **Alerts:** at the top of the fleet, one `Alert` per line, coloured by severity; a click opens
  the customer.
- **Emails à valider (C2b):** a card under the alerts, one line per prepared email: the customer,
  the email's name (« Relance J+7 ») and its day, « Voir » (the frozen text), « Envoyer »,
  « Ignorer ». On `xs` the buttons go under the line. The card is absent when the queue is empty.
- **Customer page (C2b):** a billing card with the address and the VAT number; the invoices table
  gains the number, the amount incl. VAT, a status chip (« À payer », « Payée », « Annulée »), and
  links to the invoice's page and to the payment link; « Vérifier le paiement » and « Relancer
  maintenant » (a preview, then « Envoyer ») join the actions, the latter disabled with a tooltip
  when no invoice is open. An « Emails » list shows each email with its status.
- **New customer (C2b):** a third card « Facturation » with the address and the VAT number; the
  postcode is checked by the server (5 digits in France).
- **Emails (C2b):** one card per template: its name, its day, the Manuel / Automatique switch (not on
  « Relancer maintenant »). « Modifier » opens a `FormDialog` (full screen on `xs`) with the subject,
  the text, the placeholders as chips that insert at the cursor, and the server's rendering below;
  an unknown placeholder shows the server's refusal under the text.
- **Réglages (C2b):** GuestFlow's « Paiements en ligne » page, unchanged (rule 32).
- **Console navigation (C2b):** « Clients », « Catalogue », « Emails », « Réglages », « Profil ».

- **Catalogue (console):**
  - a matrix with 12 rows (plugins) and 3 columns (plans);
  - cells inherited from a lower plan are ticked and greyed out, with the tooltip « Inclus via
    Essentiel »;
  - saving opens a confirmation listing the impact: « 3 clients Pro gagnent Linge (disponible, non
    installé) », « 2 clients gardent Recettes (hors forfait, conservé) »;
  - on `xs` the matrix becomes one card per plan;
  - every click goes to the server, which answers the new matrix and a sentence (« Linge descend en
    Essentiel. »), or the refusal (« Refusé : … est inclus via Essentiel. … retirez-le d'abord du
    forfait Essentiel. ») as a toast;
  - prices are typed in euros, quotas as whole numbers or left empty for unlimited; the add-ons can
    be priced, added and removed; nothing is saved before « Enregistrer », which asks for a reason.
- **Fleet (console):** a sticky `PageActionBar` with « Nouveau client », the three counters as
  filter chips, the table (sortable by every column), and a row click that opens the customer. On
  `xs`, one card per customer: name and state, address and plan, end date and days left. Version,
  process and last backup read « — » until phase H.
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
- **Login (`app.<domain>`):** a centred card on GuestFlow's paper background, the serif
  « GuestFlow » title, one email field and « Continuer ». Several spaces: a list of buttons, the
  company name above the address. No space: the neutral sentence and the form again. A remembered
  space: « Continuer vers Domaine Solio » and « Utiliser une autre adresse ». Full-width on `xs`,
  44 px targets, no horizontal scroll, no script.
- **Changer l'adresse (console, C3):** the new slug with the server's error as it is typed and the
  new address below it; the five items to tick; the date until which the old address redirects;
  « Changer l'adresse » disabled until the slug is valid and every item ticked.

## 7. Test plan

### Server unit tests

- **Control plane (C2a, implemented): `control-plane/server/src/tests/`, 48 tests** (`node --test`,
  one file per subject, fixtures in `helpers.js`: an in-memory database, a temporary instances root,
  a throwaway key pair, a clock the test moves, a recording mailer).
  - `lifecycle.unit.test.js` (9, rules 14, 15, 19): every boundary, yearly and monthly `due`, the
    trial, Paris days, forced active until a date, a renewal from the end or from today.
  - `operator-auth.unit.test.js` (6, rule 31): the RFC 6238 vectors, one step of drift, password
    then email code, expiry and replacement of the email code, switching to the app only once its
    code is typed with 10 hashed single-use backup codes, the 15-minute lockout.
  - `catalogue.unit.test.js` (7, rules 1–3, 5, 6): the seeded plans, the nesting refusal and
    cascade, the impact before saving, grandfathering and its withdrawal on a plan change, versions
    with author and reason, the price a customer was sold under, quota and price validation.
  - `licence-issuer.unit.test.js` (4, rule 9): every field verified by the instance's own reader,
    atomic re-issue, the download when the instance directory is missing, another key refused.
  - `customers.unit.test.js` (10, rules 4, 7, 8, 15, 19, 21): the slug rules, the preview, the
    onboarding steps and the invitation, the retry of a failed step, no second invitation, the
    fleet and its counters, a payment, the overrides, add-ons and add-ons already included.
  - `deprovisioning.unit.test.js` (7, rule 20): the slug confirmation, the order and the export
    contents, a failed export archives nothing, an instance that never existed, reactivation, the
    erasure after 90 days or on demand, the eraser's path guard.
  - `alerts.unit.test.js` (1, rule 18), `scheduler.unit.test.js` (1, rules 9, 14),
    `http.unit.test.js` (3, rules 7, 8, 20, 31): nothing but the login before the second factor,
    the idle expiry, the routes and the public export link.
- **Instance (C2a, implemented): `server/src/tests/control-plane-first-admin.unit.test.js`, 2 tests**
  (rule 7): the script against a real database (admin, password to change, bootstrap account
  removed, idempotent); a used bootstrap account is never removed.
- **Control plane (C3, implemented): 11 more tests, 87 in all.** `helpers.js` instances now carry a
  `users` table.
  - `directory.unit.test.js` (2, rule 26): active accounts only, normalised, no account email
    anywhere in the console's database; the next read replaces, an unreadable instance keeps its
    pairs, an archived space stays findable, erasure removes them.
  - `login-lookup.unit.test.js` (2, rules 24, 25): none, invalid, one (case and spaces ignored),
    several sorted by name, only names and addresses; a suspended space still a match; the hint.
  - `login-page.unit.test.js` (4, rules 24, 25, 27) over HTTP on the `app` host: no password field
    and no script, the page's own CSP; the `303` with `login_hint` and the host-only cookie, other
    fields ignored; the list, `/go`, the neutral answer, the remembered space, `/forget`, a renamed
    space forgotten; the `429` page after 10; each host answers nothing of the other's.
  - `slug-rename.unit.test.js` (3, rules 21, 22): the preview and the slug's refusals; refused until
    every item is ticked, then renamed, journaled, licence re-issued under the new slug, the manual
    step; the old slug taken for 12 months, then free.
- **Console client (C3, implemented): 1 more Vitest test, 30 in all.** `CustomerPage.rename.test.jsx`
  (rule 22): the slug refused as typed, the new address and the date, the button enabled only when
  the slug is valid and every item ticked.
- **Control plane (C2b, implemented): 28 more tests, 76 in all**, with a fake Qonto facade in
  `helpers.js` (`makeFakeQonto`: the test pays a link, fails an attempt, or marks an invoice paid).
  - `billing-invoice.unit.test.js` (7, rules 6, 7, 17, 18, 32): the monthly invoice at D-7 with its
    lines, VAT, dates, IBAN and the link in the licence; yearly at D-30 with an add-on at the price
    sold; a trial's first invoice; one invoice per period and one Qonto client; a failure kept
    pending, alerted and resumed without a second invoice; a total Qonto computes differently
    cancels that invoice; no connection, no invoice, and the alert.
  - `billing-emails.unit.test.js` (7, rules 17, 33): the days of each email; « Manuel » queues a
    frozen text and a later email replaces it unsent; only the latest after a gap; « Automatique »
    sends; send and ignore once; nothing after payment; « Relancer maintenant ».
  - `billing-payments.unit.test.js` (6, rules 15, 19, 34): a paid link renews once, whatever reports
    it; an invoice paid in Qonto renews; a failed attempt alerted once for 7 days; a payment by hand
    closes the invoice and deactivates its link; deprovisioning cancels; a plan change keeps the
    invoice issued.
  - `email-templates.unit.test.js` (3, rule 33), `operator-digest.unit.test.js` (2, rule 18).
  - `qonto-settings.unit.test.js` (3, rule 32): GuestFlow's handlers over the console's settings,
    secrets encrypted and masked, a new application drops the old tokens; the Paiements routes
    behind the operator's session, `authorize` with the console's scopes and address, a forged
    `state`; the webhook's signature, then Qonto re-read before renewing.
- **Instance (C2b, implemented):** the existing Qonto and payment suites (464 tests) pass unchanged
  after the move to `createQontoSettingsController` and `qontoWebhookSignature`;
  `qonto-invoicing-client.unit.test.js` (5, rules 17, 32, 34) covers the new client calls: the
  client's address, the invoice's payload and VAT, the money guard, the attached link, read, cancel
  and deactivate.
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
- **Console client (C2a, implemented): `control-plane/client/src/__tests__/`, 19 Vitest tests.**
  - `PlanMatrix.nesting.test.jsx` (4, rules 2, 3, 5): the inherited cell and the refusal, the
    redrawn matrix, one card per plan on a phone, the impact and the reason before saving.
  - `FleetPage.counters.test.jsx` (3, rules 8, 18): alerts, a counter as a filter, cards on a phone.
  - `NewCustomerPage.slug.test.jsx` (4, rules 4, 7, 21): the slug refused as typed, the server's
    summary and add-ons, a refused save, the customer page after saving.
  - `CustomerPage.actions.test.jsx` (5, rules 4, 5, 7, 15, 19, 20): the step actions, the payment
    preview, an override refused, deprovisioning behind the slug, the plan change.
  - `LoginPage.second-factor.test.jsx` (3, rule 31): the email code and its resend, the app and a
    backup code, the lockout.
- **Console client (C2b, implemented): 10 more Vitest tests, 29 in all.** The customer payload moved
  to `consoleFixtures.jsx`, shared by the two CustomerPage suites.
  - `FleetPage.email-queue.test.jsx` (2, rules 18, 32, 33): « Voir », « Envoyer », « Ignorer »; the
    Qonto alert opens the Paiements page.
  - `CustomerPage.billing.test.jsx` (5, rules 7, 17, 34): invoices and emails, « Relancer maintenant »
    disabled then previewed and sent, « Vérifier le paiement », the billing identity refused then
    saved.
  - `NewCustomerPage.billing.test.jsx` (1, rule 7), `EmailTemplatesPage.editor.test.jsx` (2, rule 33).

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

**C2a, done 2026-09-29** (console on :4100/:3200, a throwaway key, the shadow database copied to
`<CP_INSTANCES_ROOT>/domaine-ombre/data/` and served by an instance on :4101 with
`GUESTFLOW_MANAGED=1`):
- **Login:** password, then the emailed code read from the dev log; later the switch to the app
  (a wrong code refused and the email method kept; the right one gives the 10 backup codes).
- **Onboarding:** « admin » refused as typed; a Premium yearly customer created; the licence was
  written into the instance's data directory and the instance's own script created the admin, whose
  invitation carried the `login_hint` link. The instance then answered `planName: Premium`.
- **Catalogue:** clicking an inherited cell was refused with its reason; Neat moved to à la carte;
  the impact said « 1 client Premium garde Assurance annulation Neat déjà installé »; saved as v2
  with its reason. Changing the customer to Pro warned that Neat would go; the instance then showed
  the 4 Premium plugins out of plan (Neat as « Option à la carte ») and `/api/tariff-recipes` 404.
- **Lifecycle** (`CP_NOW`): 19 days before the end the instance read `due`, 3 days after `grace`,
  13 days after `read_only`, and refused a client write with `402 SUBSCRIPTION_READ_ONLY`; the
  fleet showed « Domaine Ombre passe aujourd'hui en « Lecture seule » » and its counter.
- **Payment:** the dialog previewed « Nouvelle échéance : 12/10/2028 … État : Actif » and the
  customer went back to active.
- **Deprovisioning:** disabled until the slug was typed; the export (database, `reservations.csv`,
  `clients.csv`) was downloadable from its emailed link; then reactivated.
- **375 px:** login, fleet cards, customer page with its actions in the « … » menu, the catalogue
  as three cards, the profile: no horizontal scroll.
- Found and fixed on the way: an add-on the chosen plan already includes could be sold on top of it
  (rule 4), and the nesting refusal read « retirez-le d'abord de Essentiel ».

**C2b, done 2026-09-30** (the console on :4100/:3200 with the tests' fake Qonto facade, the clock
moved by hand):
- A monthly Pro customer with the Neat add-on, created with its billing identity, was invoiced at
  D-7: client, IBAN, invoice, link, in that order; « Facture F-… (1 mois, 68,00 € HT, 81,60 € TTC) ».
- The home page showed « Domaine Ombre passe aujourd'hui en « À renouveler » » and « Emails à
  valider (1) »; « Voir » showed the frozen text, « Envoyer » sent it (the `[mail]` log) and the
  daily email listed the same lines.
- The customer page: the invoice « À payer » with its two links, « Relancer maintenant » previewed
  then sent, « Vérifier le paiement » answered « toujours à payer »; a refused card then a paid link
  turned the invoice « Payée », the end date to 01/12/2026, the state to « Actif », with « paiement
  refusé » in the history.
- GuestFlow's Paiements page rendered unchanged at `/parametres/paiements`, with the console's own
  callback address; the credentials saved there were encrypted in `qonto_settings`.
- The template editor: server preview, placeholder chips; its « Objet » label was clipped at the
  top of the dialog, fixed.
- 375 px: home, customer page, emails, new customer (the postcode refused as typed), Paiements: no
  horizontal scroll.

**C3, done 2026-09-30** (the console on :4100 with `appHost: 'app.localhost'`, two instance
databases with a `users` table, the client on :3200):
- The first « Continuer » was refused by the browser: helmet's `form-action 'self'` blocked the
  form (and, in production, would block its redirect to the space). The page now has its own CSP;
  a test pins it.
- `app.localhost:4100`: « Compta@Lamy.fr » with spaces listed the two spaces; « Le Moulin » sent a
  `303` to `https://moulin.guestflow.fr/login?login_hint=compta%40lamy.fr`, which the browser
  followed; the next visit offered « Continuer vers … »; « Utiliser une autre adresse » cleared it.
- The console: « Changer l'adresse » on Le Moulin, the slug checked as typed, the button disabled
  until the five items were ticked; after it, « Anciennes adresses : moulin.guestflow.fr → redirigée
  jusqu'au 01/10/2027 » and the history line; the remembered `moulin` was then forgotten on
  `app.localhost`.
- 375 px: the login page (48 px targets) and the customer page, no horizontal scroll.

**Still to do:**

- **C2b, against Qonto itself:** the ADN Dev application (with the `client*` and `client_invoice*`
  scopes) is not created yet. On its sandbox: connect, connect the payment-link provider, invoice a
  customer, pay the link with the test card, match a transfer, and confirm two points the
  documentation leaves open: the VAT rate format of an invoice line (`"0.2"` is sent) and the
  `paid` state read on an invoice link.
- **C3 against a real host:** the proxy routing of `app.<domain>` to the console and the `301` of an
  old address come with phase H.
- Check at 375 px: login, banners, the matrix as cards.

## 8. Out of scope

- **Custom domains** (`reservation.mongite.fr`): later, with Caddy on-demand TLS (study §9.3).
- **Self-service sign-up and plan change by the customer:** the operator does both in the console
  for now.
- **Fleet updates and backups:** a separate hosting spec (phase H).
- **Central identity** (one password for all spaces, SSO): rejected in rule 25 for isolation.
  Reconsider only if customers ask.
- **VAT handling beyond French VAT on French customers** (D7).
- **A central OAuth callback** (rule 28, withdrawn 2026-09-30): only if the platform ever offers
  shared Google and Qonto applications.

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
- **Q8 — Second factor of the console.** *Resolved 2026-09-29:* both an authenticator app and a
  code by email, each operator chooses (rule 31).
- **Q9 — One PR or two for the console.** *Resolved 2026-09-29:* two, C2a then C2b (§4).
- **Q11 — What the console creates in Qonto.** *Resolved 2026-09-30:* a numbered Qonto client
  invoice with a payment link attached to it, rather than a payment link alone (rule 17).
- **Q12 — Which Qonto organisation.** *Resolved 2026-09-30:* ADN Dev (rule 32).
- **Q14 — The console's Qonto settings.** *Resolved 2026-09-30:* GuestFlow's own Qonto module and
  settings page, reused whole, rather than a console page fed by environment variables (rule 32).
- **Q13 — Do the customer emails go on their own.** *Resolved 2026-09-30:* a mode per template,
  shipped as Manuel with an approval queue, like GuestFlow's own emails (rule 33).
- **Q15 — One PR or two for C3.** *Resolved 2026-09-30:* one.
- **Q16 — How the directory learns the emails.** *Resolved 2026-09-30:* the console reads each
  instance's active accounts every minute, read-only, and keeps only their HMAC, rather than a file
  of HMACs written by the instance (rule 26).
- **Q17 — Whose Google and Qonto applications a hosted customer uses.** *Resolved 2026-09-30:*
  their own, declared with their own address, from the plugin's page; the plugins are not installed
  by default and their pages stay hidden until they are. The central relay (rule 28) is withdrawn.
- **Q10 — The `due` window for monthly billing.** *Resolved 2026-09-29:* 7 days before the end
  for monthly billing, 30 days for yearly (rule 14). Found on the C2a mock: with 30 days
  everywhere, a monthly customer would have seen the renewal banner, and received the invoice, on
  the first day of every paid month.
