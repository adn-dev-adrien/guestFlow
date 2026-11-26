/**
 * `ctx` — everything a plugin may ask of the core (specs/plugins-phase-1-sdk.md §3.B). `register(ctx)`
 * only DECLARES: nothing it declares runs before the loader mounts, migrates and schedules it, and
 * nothing runs while the plugin is not live.
 */

const registry = require('./registry');
const eventBus = require('./eventBus');

const { EVENTS, PLUGIN_EMITTABLE } = eventBus;
const coreServices = require('./coreServices');
const articles = require('../../utils/pricing/articles');
const articleFulfilment = require('../../utils/pricing/articleFulfilment');

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const PROVIDER_MEMBERS = ['id', 'label', 'errorCode', 'isReady', 'createLink', 'getPayment', 'getLinkStatus', 'cancelLink'];
const PROCESSOR_MEMBERS = ['id', 'isReady', 'priceSync', 'priceLive'];
const CONTRIBUTOR_MEMBERS = ['id', 'priceTypes', 'priceLine'];
const SAS_COMMIT_MEMBERS = ['step', 'validate', 'complementItems', 'write'];
const SCHEDULER_MEMBERS = ['slotsForStay', 'validateSessions'];
const SLOT_AVAILABILITY_MEMBERS = ['slots', 'validate'];
const RESOURCE_BOOKING_OFFER_MEMBERS = ['freeSlots', 'quote', 'hold', 'release', 'bookOutside', 'limits'];
const HOME_DATA_MEMBERS = ['channel', 'catalog', 'readings', 'series', 'queueCommand', 'command', 'confirmed'];
const ISSUER_MEMBERS = ['id', 'isReady', 'issue', 'findCardBatch', 'attach', 'invoiceStatus'];
const PUSH_CHANNEL_KEY = /^[a-z][a-z0-9-]{0,39}$/;

// The web apps of plugins never shadow the core's trees (rule 47).
const WEB_APP_PATH = /^\/[a-z0-9][a-z0-9-]*$/;
const RESERVED_WEB_PATHS = Object.freeze(['/api', '/public', '/uploads', '/plugin-assets', '/login', '/assets']);

function createContext(id, {
  db, settingsModel, dataDir = null, mailService = null,
} = {}) {
  const record = registry.ensure(id);
  const prefix = `[plugin:${id}]`;

  const settings = {
    // [{ key, secret?, internal?, supportLocked?, default?, validate?, afterSave? }] — `supportLocked`: readable, but refused
    // to a support session like a secret (rule 18) — the keys `GET/PUT /api/plugins/:id/settings`
    // accept (rule 7); `validate(value)` returns a French message to refuse a write, or null;
    // `internal`: the plugin's own bookkeeping, refused by the PUT and left out of the GET (SDK 2.17.0);
    // `afterSave(value)` runs once the value is stored (specs/plugins-phase-p-productisation.md rule 16).
    declare(keys) { record.settings.push(...keys); },
    get(key) {
      const decl = record.settings.find((k) => k.key === key);
      const value = settingsModel().get(id, key, { secret: Boolean(decl && decl.secret) });
      return value === '' && decl && decl.default !== undefined ? decl.default : value;
    },
    set(key, value) {
      const decl = record.settings.find((k) => k.key === key);
      if (!decl) throw new Error(`${prefix} undeclared setting "${key}"`);
      settingsModel().set(id, key, value, { secret: Boolean(decl.secret) });
    },
    // The stored value, untouched — a secret's blob. Used as a cache key, never decrypted.
    raw: (key) => settingsModel().raw(id, key),
  };

  return Object.freeze({
    id,
    // A prefix the plugin owns. `public: true` only under /public/ — outside the /api guards.
    mount(path, router, { public: isPublic = false } = {}) {
      if (isPublic && !path.startsWith('/public/')) throw new Error(`${prefix} public mounts must live under /public/`);
      if (!isPublic && !path.startsWith('/api/')) throw new Error(`${prefix} mounts must live under /api/`);
      record.mounts.push({ path, router, public: isPublic });
    },
    // SDK 2.26.0 (specs/plugins-phase-1-sdk.md rule 48) — a web app the plugin serves itself: under `path` (one
    // segment of its own, e.g. '/studio') on every host, or on its own `host()` (a hostname, read on each request;
    // null = none yet) at every path. Never under /api, /public, /uploads or /plugin-assets: those stay the core's,
    // on every host. Reached only while the plugin is live.
    webApp({ key, path = null, host = null, handler } = {}) {
      if (!key || typeof key !== 'string') throw new Error(`${prefix} a web app needs a key`);
      if (typeof handler !== 'function') throw new Error(`${prefix} web app "${key}" needs a handler`);
      if (path === null && host === null) throw new Error(`${prefix} web app "${key}" needs a path or a host`);
      if (path !== null && (!WEB_APP_PATH.test(String(path)) || RESERVED_WEB_PATHS.includes(path))) {
        throw new Error(`${prefix} web app "${key}" path must be one segment of its own, like "/studio"`);
      }
      if (host !== null && typeof host !== 'function') throw new Error(`${prefix} web app "${key}" host must be a function`);
      record.webApps.push({ key, path, host, handler });
    },
    // One route under a core prefix, at its full URL (rule 5).
    route(method, path, ...handlers) {
      if (!METHODS.has(method)) throw new Error(`${prefix} unknown method ${method}`);
      if (!path.startsWith('/api/')) throw new Error(`${prefix} routes must live under /api/`);
      record.routes.push({ method, path, handlers });
    },
    // Allowlist entries for a restricted role, matched like enforceRoleAccess's own ({ method, re }
    // on the path below /api) — specs/plugins-phase-2-hosts.md rule 3. `reception(entries)` is its
    // shorthand from phase 1.
    roleAccess(role, entries) {
      if (!Object.prototype.hasOwnProperty.call(record.roleAccess, role)) throw new Error(`${prefix} unknown role ${role}`);
      record.roleAccess[role].push(...entries);
    },
    reception(entries) { record.roleAccess.reception.push(...entries); },
    // Routes that hand out, create or rotate a secret ({ method: 'GET' | … | '*', re } on the lower-case
    // path below /api, like roleAccess). A support session is refused them
    // (specs/hosting-h2-account-security.md rule 23).
    secretRoutes(entries) {
      (entries || []).forEach((e) => {
        if (!e || !(e.re instanceof RegExp) || typeof e.method !== 'string') throw new Error(`${prefix} a secret route needs { method, re }`);
      });
      record.secretRoutes.push(...entries);
    },
    // A POST under /api/ that no session reaches — a provider calling back. It bypasses the session,
    // role and read-only guards, so the plugin authenticates it itself (specs/plugins-phase-3a-online-payment.md rule 12).
    webhook(path, handler) {
      if (!path.startsWith('/api/')) throw new Error(`${prefix} webhooks must live under /api/`);
      record.webhooks.push({ path, handler });
    },
    // The payment provider the core's money path talks to (rule 4). One per instance.
    paymentProvider(provider) {
      PROVIDER_MEMBERS.forEach((m) => {
        if (provider == null || provider[m] == null) throw new Error(`${prefix} payment provider lacks "${m}"`);
      });
      const other = registry.all().find((r) => r.id !== id && r.paymentProvider);
      if (other) throw new Error(`${prefix} a payment provider is already declared by ${other.id}`);
      record.paymentProvider = provider;
    },
    // The quote post-processor (specs/plugins-phase-3b-neat.md rule 1): its single output is the
    // cancellation insurance unit price, so at most one per instance.
    quotePostProcessor(processor) {
      PROCESSOR_MEMBERS.forEach((m) => {
        if (processor == null || processor[m] == null) throw new Error(`${prefix} quote post-processor lacks "${m}"`);
      });
      const other = registry.all().find((r) => r.id !== id && r.quotePostProcessor);
      if (other) throw new Error(`${prefix} the cancellation insurance price is already declared by ${other.id}`);
      record.quotePostProcessor = processor;
    },
    // The price-line contributor (specs/plugins-phase-3c-hourly-resources.md rule 1): it prices the
    // resource lines of its price types, inside the engine's loop. At most one per price type.
    priceLineContributor(contributor) {
      CONTRIBUTOR_MEMBERS.forEach((m) => {
        if (contributor == null || contributor[m] == null) throw new Error(`${prefix} price-line contributor lacks "${m}"`);
      });
      contributor.priceTypes.forEach((type) => {
        const other = registry.all().find((r) => r.id !== id && r.priceLineContributor
          && r.priceLineContributor.priceTypes.includes(type));
        if (other) throw new Error(`${prefix} the "${type}" lines are already priced by ${other.id}`);
      });
      record.priceLineContributor = contributor;
    },
    // SDK 2.30.0 (specs/pricing-components.md rules 5, 47; plugins-phase-1-sdk rule 54) — a pricing family for the Articles head:
    // `{ id, configSchema, validate(config, request, ctx), price(config, request, ctx), describe(config, line) }`.
    // `ctx.priceLineContributor` stays as the alias of the hourly one. A family id is declared once
    // (DUPLICATE_FAMILY); it prices only while this plugin is live (FAMILY_UNAVAILABLE otherwise).
    articleFamily(familyId, family) {
      articles.registerFamily(familyId, family, { owner: id, isLive: () => registry.isLive(id) });
      record.articleFamilies.push(familyId);
    },
    // SDK 2.26.0 (specs/guest-app.md rules 28-31) — the slots of an hourly resource for a stay, read from the
    // resource planning by the plugin that owns it: `slotsForStay(args)` → `{ days }` | null and
    // `validateSessions(args)` → `{ results }` | null, and optionally `orderSupplement(args)` → the evening supplement of sessions an order
    // places on hours the stay already holds (guest-app rule 82). One per instance; the core hands it out as
    // `ctx.core.resourceScheduler()`, so a plugin never requires another.
    resourceScheduler(provider) {
      SCHEDULER_MEMBERS.forEach((m) => {
        if (provider == null || typeof provider[m] !== 'function') throw new Error(`${prefix} resource scheduler lacks "${m}"`);
      });
      const other = registry.all().find((r) => r.id !== id && r.resourceScheduler);
      if (other) throw new Error(`${prefix} a resource scheduler is already declared by ${other.id}`);
      record.resourceScheduler = provider;
    },
    // SDK 2.30.0 (specs/pricing-components.md rule 49) — the downstream booking an article names (`fulfilment: 'hourly-slot'`):
    // `{ reserve(draft, ctx), confirm(hold, line, tx), release(hold, reason) }`. A fulfilment id is declared once (DUPLICATE_FULFILMENT);
    // it is asked only while this plugin is live.
    articleFulfilment(fulfilmentId, adapter) {
      articleFulfilment.register(fulfilmentId, adapter, { owner: id, isLive: () => registry.isLive(id) });
      record.articleFulfilments.push(fulfilmentId);
    },
    // SDK 2.30.0 (specs/pricing-components.md rule 48) — the SlotAvailabilityProvider: `slots(resourceId, range)` and
    // `validate(sessions)`, one per instance, handed out as `ctx.core.slotAvailability()`.
    slotAvailability(provider) {
      SLOT_AVAILABILITY_MEMBERS.forEach((m) => {
        if (provider == null || typeof provider[m] !== 'function') throw new Error(`${prefix} slot availability lacks "${m}"`);
      });
      const other = registry.all().find((r) => r.id !== id && r.slotAvailability);
      if (other) throw new Error(`${prefix} a slot availability provider is already declared by ${other.id}`);
      record.slotAvailability = provider;
    },
    // SDK 2.33.0 (rules 25, 29, 53 of the campaigns spec) — what another plugin may ask of the plugin that owns the outside bookings of an hourly resource,
    // handed out as `ctx.core.resourceBookingOffer()`; one per instance:
    //   freeSlots({ resourceId, from, to, minutes, band? })  → `{ horizonUntil, days: [{ date, slots: [{ start, end }] }] }`, bounded by the resource's horizon;
    //   quote({ resourceId, date, start, coveredBand, coveredMinutes, extraMinutes }) → the engine's priced breakdown of a session partly covered in advance;
    //   hold({ resourceId, date, start, end, ref, minutes? }) / release(ref)  a slot held for a few minutes, blocking every availability read;
    //   bookOutside({ ... }) → `{ ok: true, bookingId, saleId, announce? }` | `{ ok: false, code, message }`, in one transaction; called inside the caller's own transaction it sends nothing
    //   (the operator's notice would leave before the commit) and returns `announce()` for the caller to run once its outermost transaction has committed (SDK 2.35.0);
    //   limits({ resourceId }) → `{ ok: true, stepMinutes, minMinutes, maxMinutes, maxPeople }` | `{ ok: false, code, message }`: what a session of the resource may ask (SDK 2.35.0).
    resourceBookingOffer(provider) {
      RESOURCE_BOOKING_OFFER_MEMBERS.forEach((m) => {
        if (provider == null || typeof provider[m] !== 'function') throw new Error(`${prefix} resource booking offer lacks "${m}"`);
      });
      const other = registry.all().find((r) => r.id !== id && r.resourceBookingOffer);
      if (other) throw new Error(`${prefix} a resource booking offer is already declared by ${other.id}`);
      record.resourceBookingOffer = provider;
    },
    // SDK 2.26.0 (specs/guest-app.md rule 35) — ({ resourceId, from, to }) → [{ date, start, end, reservationId? }]:
    // slots a plugin holds on a resource before they reach the planning (an order awaiting payment). Read by
    // `ctx.core.resourceHolds(...)` as occupancy. Synchronous, one per plugin.
    resourceHolds(source) {
      if (typeof source !== 'function') throw new Error(`${prefix} resourceHolds needs a function`);
      if (record.resourceHolds) throw new Error(`${prefix} resourceHolds is already declared`);
      record.resourceHolds = source;
    },
    // SDK 2.26.0 (specs/guest-app.md rules 35-36) — the baskets a plugin bills through a `complement` link
    // (`ctx.core.payments.basketLink(...)`): `paid({ reservationId, ref, amountCents, paidDate, paidAt, providerPaymentId })`
    // runs, synchronously, when such a link is paid — on time or late — and answers `{ effect }`; `refundOwed: true`
    // marks money the stay keeps nothing for. One plugin per `source`. A link minted with `core.payments.saleLink(...)` has no stay:
    // `reservationId` is then null and `ref` is the plugin's own.
    paymentBasket({ source, paid, labels } = {}) {
      if (!/^[a-z][a-zA-Z0-9-]{0,39}$/.test(String(source || ''))) throw new Error(`${prefix} a payment basket needs a source like "shopOrder"`);
      if (typeof paid !== 'function') throw new Error(`${prefix} payment basket "${source}" needs a paid function`);
      const other = registry.all().find((r) => (r.paymentBaskets || []).some((b) => b.source === source));
      if (other) throw new Error(`${prefix} the payment basket "${source}" is already declared by ${other.id}`);
      // The ledger's words for a payment of this basket the core must refund (« Commande client à rembourser »);
      // without them it reads « Paiement en ligne à rembourser ».
      if (labels !== undefined && (!labels || typeof labels !== 'object'
        || ['refundOne', 'refundMany'].some((k) => labels[k] !== undefined && (typeof labels[k] !== 'string' || !labels[k].trim())))) {
        throw new Error(`${prefix} payment basket "${source}" labels are { refundOne?, refundMany? } texts`);
      }
      record.paymentBaskets.push({ source, paid, labels: { ...(labels || {}) } });
    },
    // SDK 2.33.0 (specs/mixed-method-payments.md rules 60-63) — a prepaid instrument the plugin keeps the balance of: an amount a guest
    // already paid elsewhere (a stored credit) and may use on a booking. `source` names it, and is the `kind` of the booking
    // request's opaque `prepaid` field; `label` is what the stay's payments call it. The core asks the live plugin, never names it:
    //   apply({ devisId, input, capCents, visitor, dryRun }) → { ok: true, heldCents, display } | { ok: false, status, code, message }
    //     holds what `input` is worth on a new quote (never above `capCents`), in the caller's transaction; `dryRun` only prices it;
    //   held(devisId) → { amountCents, display } | null;
    //   settle({ devisId, reservationId, amountCents, paidDate }) → { ref } | null  the quote became a stay and uses `amountCents`;
    //   release({ devisId, reason })  the quote was refused, deleted or lapsed unpaid.
    // One plugin per `source`. What it received on a stay is written with the core module `prepaidReceipts`.
    //   unused?({ ref, label, valueCents })  an element the source paid for was not taken (an option the operator marks « non pris »): the source traces it.
    // Optional words for the lines it paid on an outside visit: `includedTitle` (« Compris dans … »), `paidMark` (« Réglé par … »).
    prepaid({
      source, label, apply, held, settle, release, unused, includedTitle, paidMark,
    } = {}) {
      if (!/^[a-z][a-zA-Z0-9-]{0,39}$/.test(String(source || ''))) throw new Error(`${prefix} a prepaid source needs a source like "storedCredit"`);
      if (typeof label !== 'string' || !label.trim()) throw new Error(`${prefix} prepaid source "${source}" needs a label`);
      if ([apply, held, settle, release].some((fn) => typeof fn !== 'function')) throw new Error(`${prefix} prepaid source "${source}" needs apply, held, settle and release`);
      const other = registry.all().find((r) => (r.prepaidSources || []).some((b) => b.source === source));
      if (other) throw new Error(`${prefix} the prepaid source "${source}" is already declared by ${other.id}`);
      if (unused !== undefined && typeof unused !== 'function') throw new Error(`${prefix} prepaid source "${source}" unused must be a function`);
      [includedTitle, paidMark].forEach((text) => {
        if (text !== undefined && (typeof text !== 'string' || !text.trim())) throw new Error(`${prefix} prepaid source "${source}" wording must be texts`);
      });
      record.prepaidSources.push({
        source,
        label: label.trim(),
        apply,
        held,
        settle,
        release,
        unused: unused || null,
        includedTitle: includedTitle ? includedTitle.trim() : `Compris dans : ${label.trim()}`,
        paidMark: paidMark ? paidMark.trim() : `Réglé par : ${label.trim()}`,
      });
    },
    // `{ key, label, seed? }` — an activity whose core terms (CGV) the plugin declares (core terms per activity, rule 37 of the campaigns spec, SDK 2.33.0): one draft, one
    // versioned publication and one tab of Réglages → Conditions générales, stored exactly like the lodging's. `seed: { fr, en }` is the first draft, written
    // once while the activity has none and never published. While the plugin is off the tab and the public text go; the versions and acceptances stay.
    termsActivity({ key, label, seed } = {}) {
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(String(key || ''))) throw new Error(`${prefix} a terms activity needs a key like "resource"`);
      if (key === 'lodging') throw new Error(`${prefix} the "lodging" terms are the core's`);
      if (typeof label !== 'string' || !label.trim()) throw new Error(`${prefix} terms activity "${key}" needs a label`);
      if (seed !== undefined && (!seed || typeof seed.fr !== 'string' || typeof seed.en !== 'string')) throw new Error(`${prefix} terms activity "${key}": seed needs fr and en`);
      const other = registry.all().find((r) => r.id !== id && (r.termsActivities || []).some((a) => a.key === key));
      if (other) throw new Error(`${prefix} the terms activity "${key}" is already declared by ${other.id}`);
      record.termsActivities.push({ key, label: label.trim(), seed: seed || null });
    },
    // (resource, { properties }) → { lines?: [{ label, value }], footer?: string } | null — what the plugin
    // adds to a resource's card on Options & ressources while it is live (specs/options-resources-ux.md
    // rule 19). Synchronous, no I/O; a plugin declares one.
    resourceCatalogueLines(build) {
      if (typeof build !== 'function') throw new Error(`${prefix} resourceCatalogueLines needs a function`);
      if (record.resourceCatalogueLines) throw new Error(`${prefix} resourceCatalogueLines is already declared`);
      record.resourceCatalogueLines = build;
    },
    // The invoice issuer (specs/resource-booking-pricing-and-invoicing.md rule 14): numbers and keeps the invoices a
    // plugin asks for, and joins their PDF to a bank transaction. One per instance, like the payment provider.
    invoiceIssuer(issuer) {
      ISSUER_MEMBERS.forEach((m) => {
        if (issuer == null || issuer[m] == null) throw new Error(`${prefix} invoice issuer lacks "${m}"`);
      });
      const other = registry.all().find((r) => r.id !== id && r.invoiceIssuer);
      if (other) throw new Error(`${prefix} an invoice issuer is already declared by ${other.id}`);
      record.invoiceIssuer = issuer;
    },
    // `{ kind, label, list, shownOnSite }` — a kind of sale context the generic « Options proposées » lists are kept for (the outside-visit spec rule 37, SDK 2.32.0): `kind` names it
    // (`resource`), `label` heads it in Réglages → Options et ressources, `list() → [{ id, label }]` says which contexts of that kind exist now. `shownOnSite(id) → boolean` (optional, SDK 2.36.0,
    // site-outside-resource-booking rule 35) says whether the website shows that context's list; absent, the list is shown at the arrival only. `property` is the core's own kind. While the
    // plugin is off its kind disappears from the settings page and from `suggestedArticles.resolve`; the stored lists stay.
    suggestionContexts({ kind, label, list, shownOnSite } = {}) {
      if (!/^[a-z][a-zA-Z0-9-]{0,39}$/.test(String(kind || ''))) throw new Error(`${prefix} a suggestion context needs a kind like "resource"`);
      if (kind === 'property') throw new Error(`${prefix} the "property" suggestion context is the core's`);
      if (typeof label !== 'string' || !label.trim()) throw new Error(`${prefix} suggestion context "${kind}" needs a label`);
      if (typeof list !== 'function') throw new Error(`${prefix} suggestion context "${kind}" needs a list function`);
      if (shownOnSite !== undefined && typeof shownOnSite !== 'function') throw new Error(`${prefix} suggestion context "${kind}" shownOnSite must be a function`);
      const other = registry.all().find((r) => r.id !== id && (r.suggestionContexts || []).some((c) => c.kind === kind));
      if (other) throw new Error(`${prefix} the suggestion context "${kind}" is already declared by ${other.id}`);
      record.suggestionContexts.push({ kind, label, list, shownOnSite });
    },
    // ({ from, to }) → [sale] — what the plugin sold outside any stay, for the journal and the card batch
    // (specs/resource-booking-pricing-and-invoicing.md rules 20-21). Synchronous, reads the plugin's own tables.
    standaloneSales(list) {
      if (typeof list !== 'function') throw new Error(`${prefix} standaloneSales needs a function`);
      if (record.standaloneSales) throw new Error(`${prefix} standaloneSales is already declared`);
      record.standaloneSales = list;
    },
    // SDK 2.28.0 (specs/guest-app-home-automation.md §4.1) — the house's data as the Sowel connector stores it, and the
    // light commands it relays. One per instance; read as `ctx.core.homeData()`.
    homeData(provider) {
      HOME_DATA_MEMBERS.forEach((m) => {
        if (provider == null || typeof provider[m] !== 'function') throw new Error(`${prefix} home data provider lacks "${m}"`);
      });
      const other = registry.all().find((r) => r.id !== id && r.homeData);
      if (other) throw new Error(`${prefix} a home data provider is already declared by ${other.id}`);
      record.homeData = provider;
    },
    // SDK 2.28.0 (specs/guest-app-home-automation.md rule 4) — () → [{ equipmentId, alias }]: the readings the lodgings
    // show, the only ones the house is asked to send. One per instance; read as `ctx.core.homeSelection()`.
    homeSelection(list) {
      if (typeof list !== 'function') throw new Error(`${prefix} homeSelection needs a function`);
      const other = registry.all().find((r) => r.id !== id && r.homeSelection);
      if (other) throw new Error(`${prefix} a home selection is already declared by ${other.id}`);
      record.homeSelection = list;
    },
    // SDK 2.29.0 (specs/mollie-rolling-reserve-and-incoming-payments.md rule 18) — ({ reservationId }) →
    // { rows: { [ledgerKey]: [tranche] }, schedule: object | null } | null: the dated bank tranches of a paid row of the
    // payments ledger, and the one-line schedule of the money summary. Synchronous, reads the plugin's own tables.
    ledgerBankTranches(provider) {
      if (typeof provider !== 'function') throw new Error(`${prefix} ledgerBankTranches needs a function`);
      if (record.ledgerBankTranches) throw new Error(`${prefix} ledgerBankTranches is already declared`);
      record.ledgerBankTranches = provider;
    },
    // SDK 2.29.0 (rule 23) — ({ recent }) → [item]: the sums the plugin expects on the bank account (or, with `recent`,
    // received in the last 30 days), for « Versements à venir ». Synchronous.
    incomingPayments(provider) {
      if (typeof provider !== 'function') throw new Error(`${prefix} incomingPayments needs a function`);
      if (record.incomingPayments) throw new Error(`${prefix} incomingPayments is already declared`);
      record.incomingPayments = provider;
    },
    // SDK 2.29.0 (rule 28) — ({ from, to }) → { entries, unattached, clearing }: the entries of a provider's own
    // journal for the accounting export, the bank credits it could not attach, and its clearing account's balance.
    journalEntries(provider) {
      if (typeof provider !== 'function') throw new Error(`${prefix} journalEntries needs a function`);
      if (record.journalEntries) throw new Error(`${prefix} journalEntries is already declared`);
      record.journalEntries = provider;
    },
    // A commit hook for one of the plugin's arrival SAS steps (rule 6).
    sasCommit(hook) {
      SAS_COMMIT_MEMBERS.forEach((m) => {
        if (hook == null || hook[m] == null) throw new Error(`${prefix} SAS commit hook lacks "${m}"`);
      });
      record.sasCommits.push(hook);
    },
    // (reservation) → a block added under `key` to the fiche payload while the plugin is live (rule 12).
    // The key is the plugin's id: the fiche hands each plugin's line component the block of its id.
    reservationBlock(key, build) {
      if (typeof build !== 'function') throw new Error(`${prefix} reservation block "${key}" needs a builder`);
      if (key !== id) throw new Error(`${prefix} a reservation block is keyed by the plugin id ("${id}"), not "${key}"`);
      record.reservationBlocks.push({ key, build });
    },
    // A subject of the home's « À traiter » (specs/shell-and-home-day-first.md rule 9): `handler` is the
    // plugin's own handler of the card's list, `summarize(payload)` → { count, title, detail, severity }
    // or null. The key is the one of its client contribution to `dashboard.alerts(.urgent)`.
    attention({ key, rank, handler, summarize } = {}) {
      if (!key || typeof key !== 'string') throw new Error(`${prefix} an attention subject needs a key`);
      if (typeof handler !== 'function' || typeof summarize !== 'function') {
        throw new Error(`${prefix} attention subject "${key}" needs a handler and a summarize function`);
      }
      const other = registry.all().find((r) => (r.attention || []).some((s) => s.key === key));
      if (other) throw new Error(`${prefix} the attention subject "${key}" is already declared by ${other.id}`);
      record.attention.push({ key, rank, handler, summarize });
    },
    // () → null when the plugin has what it needs, else a short French label of what it lacks
    // (« à connecter », « identifiants manquants »). The Plugins page prints « Actif · <label> » and
    // offers « Configurer » (specs/plugins-phase-0-foundation.md rule 25). Read on every list: keep it
    // a cheap, synchronous look at the plugin's own settings — never a call to a remote service.
    setupStatus(check) {
      if (typeof check !== 'function') throw new Error(`${prefix} setupStatus needs a function`);
      record.setupStatus = check;
    },
    // A push notification toggle of « Notifications push » (specs/platform-settings-relay-and-review.md
    // rule 8, SDK 2.6.0): offered while the plugin is live, sent with `pushService.sendToPref(key, …)`.
    // `label` is French, as the toggle reads. SDK 2.35.0 (specs/site-outside-resource-booking.md rule 24): several plugins may
    // declare the same key when every declaration says `shared: true` with the same label; the toggle is then listed once, while any of them is live.
    pushChannel({ key, label, shared = false } = {}) {
      if (!PUSH_CHANNEL_KEY.test(String(key || ''))) throw new Error(`${prefix} a push channel needs a key like "my-channel"`);
      if (!label || typeof label !== 'string') throw new Error(`${prefix} push channel "${key}" needs a label`);
      const { CORE_PUSH_CHANNELS } = require('../../utils/pushChannels');
      if (CORE_PUSH_CHANNELS.some((c) => c.key === key)) throw new Error(`${prefix} the push channel "${key}" is already declared`);
      const declared = registry.all().flatMap((r) => (r.pushChannels || []).filter((c) => c.key === key));
      if (declared.length && !(shared === true && declared.every((c) => c.shared === true && c.label === label))) {
        throw new Error(`${prefix} the push channel "${key}" is already declared${shared === true ? ' with another label or not shared' : ''}`);
      }
      record.pushChannels.push({ key, label, shared: shared === true });
    },
    // (rows) → rows: decorates the rows of the home's « Échéances » card while the plugin is live — a row may
    // gain a `bank` line or be dropped (specs/reconciliation-assisted-matching.md rule 22). At most one per plugin.
    paymentDeadlineDecorator(decorate) {
      if (typeof decorate !== 'function') throw new Error(`${prefix} the payment-deadline decorator must be a function`);
      if (record.paymentDeadlineDecorator) throw new Error(`${prefix} the payment-deadline decorator is already declared`);
      record.paymentDeadlineDecorator = decorate;
    },
    migrations(list) { record.migrations.push(...list); },
    settings,
    jobs: {
      every({ name, intervalMs, bootDelayMs, run }) {
        record.jobs.push({ name, intervalMs, bootDelayMs, run });
      },
    },
    events: {
      on(name, handler) {
        if (!EVENTS.includes(name)) throw new Error(`${prefix} unknown event ${name}`);
        if (!record.handlers.has(name)) record.handlers.set(name, []);
        record.handlers.get(name).push(handler);
      },
      // SDK 2.4.0 — only the events of PLUGIN_EMITTABLE; dispatched like the core's own emits.
      emit(name, payload) {
        if (!PLUGIN_EMITTABLE.includes(name)) throw new Error(`${prefix} may not emit ${name}`);
        eventBus.emit(name, payload);
      },
    },
    // { tokens: [{ name, label }], flags: [name], build(reservationId) → { tokens, flags } } (rule 10)
    emailContext(provider) { record.emailProviders.push(provider); },
    // (reservationId) → object merged into the SAS payload under pluginData[<id>] (rule 17). Sync:
    // the SAS read never waits on a plugin.
    sasData(provider) { record.sasProviders.push(provider); },
    // Runs after the migrations of an install (rules 18, 26).
    onInstall(fn) { record.onInstall.push(fn); },
    // Runs at every boot, only while the plugin is installed (rule 18).
    onBoot(fn) { record.onBoot.push(fn); },
    // SDK 2.11.0 — runs each time the plugin goes from off to live: activated, or installed (after its
    // install hooks). Events sent while it was off were dropped, so it recovers from its own data here
    // (specs/plugin-removal-resilience.md rule 17). Not awaited by the request that switched it on.
    onActivate(fn) { record.onActivate.push(fn); },
    // { tables: [name], describe(db) → [{ label, count }], purge?(db), refuse?(db) } (rule 12). SDK 2.33.0 — `refuse(db)` → a
    // French sentence when the erasure must not run now (money the plugin still holds), else null: the core answers 409 ERASE_REFUSED.
    data(declaration) { record.data = declaration; },
    isLive: () => registry.isLive(id),
    // SDK 2.33.0 — one e-mail that belongs to no stay (a receipt, a ticket): `{ to, subject, text, html?, key, attachments? }` (`attachments`: `[{ filename, content (Buffer), contentType }]`), sent through
    // the operator's own SMTP settings. `key` names the message in the log (never the address). The e-mail history is keyed by
    // reservation, so the plugin records the send on its own rows. → `{ messageId }`; throws `EMAIL_NOT_CONFIGURED`.
    mail: Object.freeze({
      async send({
        to, subject, text, html, key, attachments,
      } = {}) {
        if (typeof to !== 'string' || !to.trim() || typeof subject !== 'string' || !subject.trim() || typeof text !== 'string' || !text.trim()) {
          throw new Error(`${prefix} mail.send needs to, subject and text`);
        }
        const service = mailService ? mailService() : require('../../utils/emailService').createEmailService(require('../../models/settingsModel').decryptedSmtpSettings());
        const info = await service.send({
          to, subject, text, ...(html ? { html } : {}), ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}),
        });
        console.log(prefix, `mail sent${key ? ` (${key})` : ''}`); // eslint-disable-line no-console
        return { messageId: (info && info.messageId) || null };
      },
    }),
    // SDK 2.33.0 (core terms per activity, rules 37-38 of the campaigns spec) — the core terms of an activity a plugin declared with `termsActivity` (or `lodging`).
    // `current(activity)` → `{ id, version, publishedAt }` | null (nothing published: nothing to ask). `requireAccepted({ activity, versionId, subjectType, subjectRef })`
    // → `TERMS_NOT_ACCEPTED` | `TERMS_OUTDATED` | null (null also when the subject already accepted the current version). `accept({ activity, versionId, subjectType
    // (reservation | outsideBooking | a plugin's own order), subjectRef, reservationId?, channel (site | guest-app | payment-link | mon-bain), ip, userAgent, pluginVersion?, onAccepted? })`
    // records the acceptance (a reservation's history gets its line; `onAccepted(row)` is the owning plugin's hook for any other subject) and throws the refusal code
    // when `versionId` is not the current version.
    terms: Object.freeze({
      current(activity) {
        const v = require('../../models/termsModel').getCurrent(activity);
        return v ? { id: v.id, version: v.version, publishedAt: v.publishedAt } : null;
      },
      requireAccepted: (input) => require('../../utils/termsAcceptance').requireAccepted(input),
      accept: (input) => require('../../utils/termsAcceptance').accept({ ...input, pluginId: id }),
    }),
    // specs/plugins-phase-4-registry.md rule 15 — the plugin's own directory, kept across updates,
    // removed only by « Effacer aussi ses données ». Created on first read.
    get dataDir() {
      if (!dataDir) return null;
      const dir = dataDir();
      require('fs').mkdirSync(dir, { recursive: true });
      return dir;
    },
    core: coreServices,
    db,
    log: {
      info: (...args) => console.log(prefix, ...args), // eslint-disable-line no-console
      warn: (...args) => console.warn(prefix, ...args), // eslint-disable-line no-console
      error: (...args) => console.error(prefix, ...args), // eslint-disable-line no-console
    },
  });
}

module.exports = { createContext };
