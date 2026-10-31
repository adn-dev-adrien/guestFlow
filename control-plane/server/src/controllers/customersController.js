/**
 * Customers of the platform (specs/control-plane-plans-and-access.md rules 7, 8, 9, 14, 15, 19, 20).
 *
 * Every action ends the same way: the state is recomputed from the dates (lifecycle.js), a
 * transition is journaled, and the licence is re-issued and written to the instance. The payloads
 * are ready to render: labels, dates, amounts and available actions are decided here.
 */

const crypto = require('crypto');
const fs = require('fs');
const { stateOf, daysLeft, paidEndsAt, STATE_LABELS } = require('../utils/lifecycle');
const { parisDay, addDays, addMonths, isDay, frDay, frStamp } = require('../utils/days');
const { KINDS } = require('../utils/templates');
const { slugError } = require('../utils/slug');
const { buildPayload, pluginsOfPlan } = require('../utils/licenceIssuer');
const { exportInstance } = require('../utils/exporter');
const { eraseInstance } = require('../utils/eraser');
const { httpError } = require('../utils/httpError');
const { euros } = require('../utils/money');
const { plugins: gfPlugins } = require('../utils/gf');
const { CREATE_STEPS: PROVISION_STEPS } = require('../utils/provisioner');
const { hostView, hostColumns } = require('../utils/hostView');
const { shareDatabase } = require('../utils/instanceFiles');

const HOST_STOP = { step: 'deprov-stop', label: 'Processus et route arrêtés, page « Cet espace a été fermé »' };
const HOST_RESTART = { step: 'restart', label: 'Processus et route relancés depuis le dossier' };
const HOST_RENAME = { step: 'rename', label: 'Dossier renommé, processus et route relancés, redirection 301 posée' };

const TRIAL_DAYS = 30;
const ERASE_AFTER_DAYS = 90;
const EXPORT_LINK_DAYS = 30;
const FORCE_ACTIVE_DEFAULT_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Rule 7 (C2b): where a customer can be invoiced from. Qonto wants an ISO country code.
const COUNTRIES = { FR: 'France', BE: 'Belgique', CH: 'Suisse', LU: 'Luxembourg', MC: 'Monaco', ES: 'Espagne', IT: 'Italie', DE: 'Allemagne' };

// Rule 7 with specs/hosting-h1-fleet-runtime.md rules 1–7 (2026-10-08): every step is automatic,
// run by the console through the host drivers; none is ticked by hand any more.
const CREATE_STEPS = PROVISION_STEPS.map((s) => ({ ...s, kind: 'auto' }));
const DEPROVISION_STEPS = [
  { step: 'deprov-export', label: 'Export complet (base, photos, CSV)', kind: 'auto' },
  { step: 'deprov-email', label: 'Lien de l’export envoyé au contact (30 jours)', kind: 'auto' },
  { ...HOST_STOP, kind: 'auto' },
];
const REACTIVATE_STEPS = [{ ...HOST_RESTART, kind: 'auto' }];
// Rule 22 with H1 rule 5: the directory moves and the old address redirects, automatically.
const RENAME_STEPS = [{ ...HOST_RENAME, kind: 'auto' }];
// H1 rule 29: « Redémarrer » on a process that failed.
const PROCESS_RESTART_STEPS = [{ step: 'process-restart', label: 'Processus redémarré', kind: 'auto' }];
const ALL_STEPS = [...CREATE_STEPS, ...DEPROVISION_STEPS, ...REACTIVATE_STEPS, ...RENAME_STEPS, ...PROCESS_RESTART_STEPS];
// H1 rule 38: the steps that serve the instance again; never retried on an archived customer.
const SERVING_STEPS = new Set([HOST_RESTART.step, HOST_RENAME.step, 'process-restart']);
// Rule 22: what must be redone when the address changes, each item ticked before it runs.
const RENAME_CHECKLIST = [
  { key: 'wordpress', label: 'Réglage du plugin WordPress (adresse de l’API)' },
  { key: 'ical', label: 'Adresses des flux iCal collées sur chaque plateforme' },
  { key: 'oauth', label: 'Adresses de retour des applications Google et Qonto du client, puis « Connecter » à nouveau' },
  { key: 'push', label: 'Notifications push : chaque appareil les accepte à nouveau' },
];
const ALIAS_MONTHS = 12;

const BILLING_LABELS = { monthly: 'mensuel', yearly: 'annuel' };
const INVOICE_STATUS = { pending: 'En préparation', open: 'À payer', paid: 'Payée', cancelled: 'Annulée' };
const EMAIL_STATUS = { pending: 'À valider', sent: 'Envoyé', ignored: 'Ignoré', dropped: 'Retiré de la file', failed: 'Échec' };
const pluginName = (id) => (gfPlugins.findPlugin(id) || { name: id }).name;

function createCustomersController(ctx) {
  const { models, now, mailer, instances, issuer, runFirstAdmin, domain, consoleUrl, exportsDir, qonto } = ctx;
  const { customers, catalogue, invoices, audit, provisioning, emails, directory, hosting } = models;
  // Built after this controller (it calls back into it for the licence and the first admin).
  const host = () => ctx.provisioner;
  const modules = () => ctx.controllers.modules;

  const today = () => parisDay(now());
  const stamp = () => now().toISOString();
  const urlOf = (slug) => `https://${slug}.${domain}`;

  // Rule 21 with rule 22: an old slug stays taken while it still redirects.
  const slugTaken = (slug) => customers.slugTaken(slug) || directory.aliasTaken(slug, today());

  // Rule 22: until « Dossier renommé… » is done (H1 rule 5 runs it at once), the instance still runs
  // from its old directory and answers at its old address.
  // H1 rule 38: the « rename » row is written only once the rename holds the customer's lock, so a
  // rename still waiting behind a fleet item is tracked here. A count, since two may overlap.
  const renaming = new Map();
  const markRenaming = (id) => renaming.set(id, (renaming.get(id) || 0) + 1);
  const unmarkRenaming = (id) => {
    const n = renaming.get(id) - 1;
    if (n > 0) renaming.set(id, n); else renaming.delete(id);
  };

  function renamePending(c) {
    if (renaming.has(c.id)) return true;
    const row = provisioning.get(c.id, 'rename');
    return Boolean(row && row.status !== 'ok');
  }

  function servedSlug(c) {
    if (!renamePending(c)) return c.slug;
    const alias = directory.aliasesOf(c.id, today())[0];
    return alias ? alias.slug : c.slug;
  }

  // An action that moves the end date carries the end date the operator was looking at: a second
  // click, or a second tab, finds it changed and is refused instead of counting twice.
  function assertExpectedEndsAt(c, body) {
    if (String((body || {}).expectedEndsAt || '') !== c.endsAt) {
      throw httpError(409, 'STALE', 'Échéance modifiée entre-temps : recharger la page.');
    }
  }

  function journal(customerId, operator, kind, text) {
    audit.log({ at: stamp(), day: today(), operator, customerId, kind, text });
  }

  function mustGet(id) {
    const c = customers.get(id);
    if (!c || c.erasedAt) throw httpError(404, 'NOT_FOUND', 'Client introuvable.');
    return c;
  }

  // Rule 6: a customer's price is the one of the catalogue version they were sold under. One line for
  // the plan and one per add-on, per month excl. VAT: the renewal invoice prints the same lines.
  function priceLines(c) {
    const snap = catalogue.snapshot(c.catalogueVersion) || { plans: catalogue.plans(), addons: catalogue.addons() };
    const plan = snap.plans.find((p) => p.code === c.planCode) || catalogue.plan(c.planCode);
    const addonPrice = (id) => ((snap.addons.find((a) => a.pluginId === id) || catalogue.addons().find((a) => a.pluginId === id) || {}).priceMonthlyCents || 0);
    return [
      { title: `GuestFlow ${catalogue.plan(c.planCode).name}`, monthlyCents: c.billing === 'yearly' ? plan.priceYearlyCents : plan.priceMonthlyCents },
      ...c.addons.map((id) => ({ title: `Option ${pluginName(id)}`, monthlyCents: addonPrice(id) })),
    ];
  }

  function monthlyPriceCents(c) {
    return priceLines(c).reduce((sum, l) => sum + l.monthlyCents, 0);
  }

  // Rule 7 (C2b): the billing identity, checked the same way at creation and on edit.
  function readBilling(body, errors) {
    const billing = {
      billingStreet: String(body.billingStreet || '').trim(),
      billingPostcode: String(body.billingPostcode || '').trim(),
      billingCity: String(body.billingCity || '').trim(),
      billingCountry: String(body.billingCountry || 'FR').trim().toUpperCase(),
      vatNumber: String(body.vatNumber || '').replace(/\s+/g, '').toUpperCase(),
    };
    if (!billing.billingStreet) errors.billingStreet = 'L’adresse est obligatoire : Qonto ne facture pas un client sans adresse.';
    if (!COUNTRIES[billing.billingCountry]) errors.billingCountry = 'Pays non pris en charge.';
    if (!billing.billingPostcode) errors.billingPostcode = 'Le code postal est obligatoire.';
    else if (billing.billingCountry === 'FR' && !/^\d{5}$/.test(billing.billingPostcode)) errors.billingPostcode = 'Code postal français : 5 chiffres.';
    if (!billing.billingCity) errors.billingCity = 'La ville est obligatoire.';
    if (billing.vatNumber && !/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(billing.vatNumber)) errors.vatNumber = 'Numéro de TVA invalide (ex. FR12345678901).';
    return billing;
  }

  // Rule 4: the add-ons on offer for a plan. One the plan already includes is shown as such and
  // never sold on top of it.
  function addonChoices(planCode) {
    const included = pluginsOfPlan(planCode, catalogue.plans(), catalogue.lowest());
    return catalogue.addons().map((a) => ({
      pluginId: a.pluginId,
      name: pluginName(a.pluginId),
      priceLabel: `${euros(a.priceMonthlyCents)} HT / mois`,
      included: included.includes(a.pluginId),
    }));
  }

  function keepSellableAddons(requested, planCode) {
    const choices = addonChoices(planCode);
    const unknown = requested.some((id) => !choices.some((c) => c.pluginId === id));
    return { unknown, addons: requested.filter((id) => choices.some((c) => c.pluginId === id && !c.included)) };
  }

  // Recomputes the state, journals a transition, re-issues the licence. → { state, licence }
  // `writeLicence: false` while the creation has not made the data directory yet.
  function refresh(id, operator = 'système', { writeLicence = true } = {}) {
    const c = customers.get(id);
    if (!c || c.erasedAt) return null;
    const day = today();
    const state = stateOf(c, day);
    if (state !== c.state) {
      customers.setState(id, state, day);
      journal(id, operator, 'state', `État : ${STATE_LABELS[c.state]} → ${STATE_LABELS[state]}`);
    }
    return { state, licence: writeLicence ? issueLicence(id) : null };
  }

  // Rule 37 — a licence is stamped after the one before it, whatever the console's clock did meanwhile;
  // a copy to download keeps the stamp of the last one written when the clock is behind it.
  function stampFor(id, fresh) {
    const last = Date.parse(models.meta.get(`licenceIssuedAt:${id}`));
    const at = now();
    if (!Number.isFinite(last) || last < at.getTime()) return at;
    return fresh ? new Date(last + 1) : new Date(last);
  }

  function licencePayload(id, fresh = false) {
    const c = customers.get(id);
    return buildPayload({
      customer: { ...c, modules: modules().licenceChoice(c) },
      state: c.state,
      plans: catalogue.plans(),
      lowest: catalogue.lowest(),
      catalogueVersion: catalogue.currentVersion(),
      payUrl: invoices.openPayUrl(id),
      now: stampFor(id, fresh),
    });
  }

  const licenceToken = (id) => issuer.sign(licencePayload(id));

  function issueLicence(id) {
    const c = customers.get(id);
    const payload = licencePayload(id, true);
    const result = issuer.write(c.slug, issuer.sign(payload));
    // The stamp the space answers to (specs/plugin-operator-provisioning.md rule 14).
    if (result.written) models.meta.set(`licenceIssuedAt:${id}`, payload.issuedAt);
    provisioning.set(id, 'licence', result.written ? 'ok' : 'failed',
      result.written ? `Écrite dans ${result.path}` : `${result.reason} Téléchargez-la depuis cette page, ou réessayez une fois le dossier créé.`, stamp());
    return result;
  }

  // One customer's failure never stops the others.
  function reissueAll(operator, log = (msg) => console.log(msg)) {
    return customers.list().filter((c) => !c.erasedAt).map((c) => {
      try {
        return refresh(c.id, operator);
      } catch (err) {
        log(`[licence] ${c.slug}: ${err.message}`);
        return null;
      }
    });
  }

  // What the console knows of the establishment, for the instance's own settings (H1 rule 25).
  function establishmentOf(c) {
    const country = c.billingCountry && c.billingCountry !== 'FR' ? `, ${COUNTRIES[c.billingCountry] || c.billingCountry}` : '';
    return {
      name: c.companyName,
      email: c.contactEmail,
      address: c.billingStreet ? `${c.billingStreet}, ${c.billingPostcode} ${c.billingCity}${country}` : '',
      tva: c.vatNumber || '',
    };
  }

  function invitationText(c, password, { reset = false } = {}) {
    return [
      `Bonjour${c.contactName ? ` ${c.contactName}` : ''},`,
      '',
      reset
        ? `L’accès à votre espace GuestFlow ${urlOf(c.slug)} a été réinitialisé.`
        : `Votre espace GuestFlow est ouvert à l’adresse ${urlOf(c.slug)}.`,
      '',
      `Identifiant : ${c.contactEmail}`,
      `Mot de passe provisoire : ${password}`,
      '',
      'Vous choisirez votre propre mot de passe à la première connexion.',
      `${urlOf(c.slug)}/login?login_hint=${encodeURIComponent(c.contactEmail)}`,
    ].join('\n');
  }

  // The instance's own script, of its own version, on its database. `reissue` (H1 rule 24): `unused`
  // gives a new provisional password to an account nobody signed in to, `always` to any account.
  // `seed` — at the creation step only, before the process ever ran: the establishment is filled from
  // the console's records (H1 rule 25), on a database that holds no secret yet.
  async function runAdminScript(c, reissue, { seed = false } = {}) {
    if (!instances.hasDatabase(c.slug)) throw new Error('La base de l’instance est introuvable : créez d’abord le dossier, puis réessayez.');
    const version = (hosting.get(c.id) || {}).version;
    const serverDir = version && ctx.releases && ctx.releases.has(version) ? `${ctx.releases.dirOf(version)}/server` : undefined;
    try {
      return await runFirstAdmin({
        dbPath: instances.dbPath(c.slug), email: c.contactEmail, name: c.contactName, company: c.companyName,
        establishment: seed ? establishmentOf(c) : null, reissue, serverDir,
      });
    } catch (err) {
      throw new Error(`Échec : ${err.message}`);
    } finally {
      shareDatabase(instances.dbPath(c.slug));
    }
  }

  async function sendInvitation(c, password, { reset = false } = {}) {
    await mailer.send({
      to: c.contactEmail,
      subject: reset ? `Accès réinitialisé à votre espace GuestFlow ${c.companyName}` : `Votre espace GuestFlow ${c.companyName} est prêt`,
      text: invitationText(c, password, { reset }),
    });
  }

  // Rule 7: the first administrator, created by the instance's own script of its own version, and
  // the invitation. Resumed after a failed send (H1 rule 24), the account exists but was never used:
  // it gets a new provisional password and the invitation leaves again. → the step's detail; throws
  // with the step's error.
  async function adminStep(id) {
    const c = customers.get(id);
    const result = await runAdminScript(c, 'unused', { seed: true });
    if (!result.created && !result.temporaryPassword) {
      return result.used
        ? `Le compte ${c.contactEmail} a déjà servi : aucune invitation renvoyée.`
        : `Le compte ${c.contactEmail} existe déjà : aucune invitation renvoyée.`;
    }
    try {
      await sendInvitation(c, result.temporaryPassword);
    } catch (err) {
      throw new Error(`Échec : ${err.message}`);
    }
    return result.created ? `Invitation envoyée à ${c.contactEmail}.` : `Nouvelle invitation envoyée à ${c.contactEmail}.`;
  }

  // H1 rule 24: « Renvoyer l’invitation » (an account never used) and « Réinitialiser l’accès » (any
  // account: a new provisional password, the second step turned off), from the customer's page.
  function accessActionsAllowed(c) {
    const admin = provisioning.get(c.id, 'admin');
    return !c.archivedAt && Boolean(admin && admin.status === 'ok') && instances.hasDatabase(c.slug);
  }

  async function resendInvitation(id, operator) {
    const c = mustGet(id);
    if (!accessActionsAllowed(c)) throw httpError(409, 'NOT_READY', 'Aucun compte à inviter : la création n’est pas terminée.');
    return host().exclusive(c.id, async () => {
      const result = await runAdminScript(c, 'unused');
      if (!result.temporaryPassword) throw httpError(409, 'ALREADY_USED', 'Le compte a déjà servi : « Réinitialiser l’accès ».');
      try {
        await sendInvitation(c, result.temporaryPassword);
      } catch (err) {
        throw httpError(502, 'MAIL_FAILED', `Invitation non envoyée : ${err.message}`);
      }
      journal(c.id, operator, 'access', `Invitation renvoyée à ${c.contactEmail} (nouveau mot de passe provisoire)`);
      return { ...view(c.id), notice: `Invitation renvoyée à ${c.contactEmail}.` };
    });
  }

  async function resetAccess(id, operator) {
    const c = mustGet(id);
    if (!accessActionsAllowed(c)) throw httpError(409, 'NOT_READY', 'Aucun compte à réinitialiser : la création n’est pas terminée.');
    return host().exclusive(c.id, async () => {
      const result = await runAdminScript(c, 'always');
      if (!result.temporaryPassword) throw httpError(502, 'NOT_RESET', 'Accès non réinitialisé : la version de l’instance ne le permet pas.');
      try {
        await sendInvitation(c, result.temporaryPassword, { reset: true });
      } catch (err) {
        throw httpError(502, 'MAIL_FAILED', `Mot de passe provisoire changé, mais email non envoyé : ${err.message}`);
      }
      journal(c.id, operator, 'access', `Accès réinitialisé : nouveau mot de passe provisoire envoyé à ${c.contactEmail}${result.secondStepOff ? ', second facteur désactivé' : ''}`);
      return { ...view(c.id), notice: `Nouveau mot de passe provisoire envoyé à ${c.contactEmail}.` };
    });
  }

  // --- views ---------------------------------------------------------------------------------

  // Rule 37 — a step done before 2026-10-18 recorded a host path (« Écrite dans /srv/… »): an
  // operator reads that the step is done, not where it wrote.
  const HOST_PATH = /(^|\s)\/[^\s]+/;
  function stepDetail(r) {
    if (r.status === 'running') return r.detail || 'En cours…';
    if (r.status === 'ok' && HOST_PATH.test(r.detail || '')) return '';
    return r.detail || '';
  }

  function stepsView(c, defs) {
    const rows = new Map(provisioning.list(c.id).map((r) => [r.step, r]));
    return defs.filter((d) => rows.has(d.step)).map((d) => {
      const r = rows.get(d.step);
      return {
        step: d.step,
        label: d.label,
        kind: d.kind,
        status: r.status,
        detail: stepDetail(r),
        // H1 rule 2: a failed creation step resumes the sequence from itself.
        action: r.status !== 'failed' || (c.archivedAt && SERVING_STEPS.has(d.step)) ? null : (CREATE_STEPS.some((x) => x.step === d.step) ? 'resume' : 'retry'),
      };
    });
  }

  // H1 rule 5 with rule 22: the 301 ends after 90 days, the name stays reserved 12 months.
  function formerAddresses(c, day) {
    const redirects = new Map(hosting.redirectsOf(c.id).map((r) => [r.slug, r.until]));
    return directory.aliasesOf(c.id, day).map((a) => {
      const until = redirects.get(a.slug);
      return until && until >= day
        ? `${a.slug}.${domain} → redirigée jusqu’au ${frDay(until)}, réservée jusqu’au ${frDay(a.until)}`
        : `${a.slug}.${domain} → réservée jusqu’au ${frDay(a.until)}`;
    });
  }

  // H1 rule 29: a process that failed, or runs without answering, is restarted from its page.
  function processDown(c) {
    const row = hosting.get(c.id);
    return Boolean(row && row.port && !c.archivedAt && (row.unit_state === 'failed' || (row.unit_state === 'running' && row.down_since)));
  }

  async function restartProcess(id, operator) {
    const c = mustGet(id);
    if (!processDown(c)) throw httpError(409, 'NOT_DOWN', 'Le processus répond : rien à redémarrer.');
    journal(c.id, operator, 'host', 'Redémarrage du processus demandé');
    const ok = await host().restartProcess(c.id);
    return { ...view(c.id), notice: ok ? 'Processus redémarré ; l’instance répond.' : 'Redémarrage en échec : voir l’étape.' };
  }

  function view(id) {
    const c = mustGet(id);
    const day = today();
    const plan = catalogue.plan(c.planCode);
    const archived = Boolean(c.archivedAt);
    const forced = c.forceActiveUntil && day <= c.forceActiveUntil;
    const unsettled = invoices.unsettled(c.id)[0] || null;
    const openInvoice = unsettled && unsettled.status === 'open' ? unsettled : null;
    const steps = stepsView(c, [...CREATE_STEPS, ...REACTIVATE_STEPS, ...RENAME_STEPS, ...PROCESS_RESTART_STEPS]);
    return {
      id: c.id,
      slug: c.slug,
      url: urlOf(c.slug),
      companyName: c.companyName,
      contactName: c.contactName,
      contactEmail: c.contactEmail,
      state: c.state,
      stateLabel: STATE_LABELS[c.state],
      stateNote: forced ? `forcé jusqu’au ${frDay(c.forceActiveUntil)}` : null,
      stateSince: c.stateSince,
      planCode: c.planCode,
      planName: plan.name,
      billing: c.billing,
      billingLabel: BILLING_LABELS[c.billing],
      periodMonths: c.periodMonths,
      priceLabel: `${euros(monthlyPriceCents(c))} HT / mois`,
      catalogueVersion: c.catalogueVersion,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      endsAtLabel: frDay(c.endsAt),
      trialEndsAt: c.trialEndsAt,
      trialEndsAtLabel: c.trialEndsAt ? frDay(c.trialEndsAt) : null,
      daysLeft: archived ? null : daysLeft(c, day),
      addons: c.addons.map((a) => ({ id: a, name: pluginName(a) })),
      grandfathered: c.grandfathered.map((a) => ({ id: a, name: pluginName(a) })),
      archivedAt: c.archivedAt,
      eraseAt: c.eraseAt,
      eraseAtLabel: c.eraseAt ? frDay(c.eraseAt) : null,
      steps,
      // Rule 37 — once every step is done the card folds to one line.
      stepsDone: steps.length > 0 && steps.every((s) => s.status === 'ok' || s.status === 'skipped'),
      stepsSummary: steps.length ? `Terminée : ${steps.length} étape${steps.length > 1 ? 's' : ''}` : '',
      // H1 rule 1: the page polls while a sequence runs.
      provisioningRunning: Boolean(host() && host().running(c.id)) || provisioning.list(c.id).some((r) => r.status === 'running'),
      hosting: hostView(c, hosting.get(c.id), { now: now(), lastCheck: hosting.lastCheck(c.id), dailyMailLimit: ctx.drivers ? ctx.drivers.mail.dailyLimit : null, mailToday: hosting.mailCount(c.id, day) }),
      formerAddresses: formerAddresses(c, day),
      deprovisionSteps: stepsView(c, DEPROVISION_STEPS),
      history: audit.forCustomer(c.id).map((h) => ({ at: h.at, day: frDay(h.day), operator: h.operator, text: h.text })),
      billingIdentity: {
        street: c.billingStreet,
        postcode: c.billingPostcode,
        city: c.billingCity,
        country: c.billingCountry,
        vatNumber: c.vatNumber,
        lines: [
          { label: 'Adresse', value: c.billingStreet ? `${c.billingStreet}, ${c.billingPostcode} ${c.billingCity}, ${COUNTRIES[c.billingCountry] || c.billingCountry}` : 'À compléter : aucune facture ne part sans adresse.' },
          { label: 'N° de TVA', value: c.vatNumber || '—' },
          { label: 'Client Qonto', value: c.qontoClientId ? 'créé' : 'créé à la première facture' },
        ],
      },
      countries: Object.entries(COUNTRIES).map(([code, name]) => ({ code, name })),
      invoices: invoices.list(c.id).map((i) => ({
        id: i.id,
        number: i.number || '—',
        period: `${frDay(i.periodStart)} → ${frDay(i.periodEnd)}`,
        amount: euros(i.amountCents),
        total: i.totalCents != null ? euros(i.totalCents) : '—',
        status: i.status,
        statusLabel: INVOICE_STATUS[i.status] || i.status,
        provider: i.provider,
        detail: invoiceDetail(i),
        invoiceUrl: i.invoiceUrl || null,
        payUrl: i.status === 'open' ? i.payUrl : null,
      })),
      emails: emails.forCustomer(c.id).map((e) => ({
        id: e.id,
        name: (KINDS[e.kind] || { name: e.kind }).name,
        status: e.status,
        statusLabel: EMAIL_STATUS[e.status] || e.status,
        at: frStamp(e.handledAt || e.preparedAt),
        recipient: e.recipient,
        subject: e.subject,
        body: e.body,
        operator: e.operator,
        error: e.error,
      })),
      plans: catalogue.plans().map((p) => ({ code: p.code, name: p.name, addonChoices: addonChoices(p.code) })),
      paymentPreview: archived ? [] : (unsettled ? [unsettled.months] : [1, 12]).map((months) => {
        const endsAt = paidEndsAt(c, months, day);
        const after = stateOf({ ...c, endsAt, forceActiveUntil: null, trialEndsAt: null }, day);
        const inTrial = c.trialEndsAt && day < c.trialEndsAt;
        let from = c.endsAt > day ? 'la période s’ajoute à l’échéance actuelle' : 'l’échéance est passée : la période part d’aujourd’hui';
        if (inTrial) from = 'l’essai s’arrête : la période part d’aujourd’hui';
        const closes = unsettled
          ? `Solde la facture ${unsettled.number || 'en préparation'}${unsettled.payLinkId ? ' et désactive son lien de paiement' : ''} ; rapprochez le virement dans Qonto. `
          : '';
        return {
          months,
          amount: unsettled ? `${euros(unsettled.amountCents)} HT` : `${euros(monthlyPriceCents(c) * months)} HT`,
          text: `${closes}Nouvelle échéance : ${frDay(endsAt)} (${from}). État : ${STATE_LABELS[after]}.`,
        };
      }),
      defaults: {
        paymentMonths: unsettled ? unsettled.months : c.periodMonths,
        extendTo: addDays(c.endsAt, 15),
        forceActiveUntil: addDays(day, FORCE_ACTIVE_DEFAULT_DAYS),
      },
      actions: {
        pay: !archived,
        extend: !archived,
        forceActive: !archived,
        changePlan: !archived,
        downloadLicence: true,
        deprovision: !archived && !renamePending(c),
        deprovisionHint: renamePending(c) ? 'Changement d’adresse à terminer d’abord.' : null,
        reactivate: archived,
        rename: !archived,
        cancelErase: archived && Boolean(c.eraseAt),
        eraseNow: archived && stopped(c),
        eraseHint: archived && !stopped(c) ? '« Processus et route arrêtés » en échec : à relancer d’abord.' : null,
        editBilling: !archived,
        resendInvitation: accessActionsAllowed(c),
        resetAccess: accessActionsAllowed(c),
        restartProcess: processDown(c),
        remind: !archived && Boolean(openInvoice),
        remindHint: openInvoice ? null : 'Aucune facture ouverte à relancer.',
        checkPayment: Boolean(openInvoice) && qonto.ready(),
        retryInvoice: Boolean(unsettled && unsettled.status === 'pending' && unsettled.held) && qonto.ready(),
      },
    };
  }

  function invoiceDetail(i) {
    if (i.provider === 'manual') return i.providerRef ? `Enregistré à la main « ${i.providerRef} »` : 'Enregistré à la main';
    if (i.status === 'pending') return i.lastError || 'Création dans Qonto à la prochaine passe.';
    if (i.status === 'paid' && i.paidBy === 'manual' && !i.payLinkId) return `Soldée à la main le ${frStamp(i.paidAt)}`;
    if (i.status === 'paid') return i.paidBy === 'manual' ? `Soldée à la main le ${frStamp(i.paidAt)}, lien désactivé` : `Payée le ${frStamp(i.paidAt)}`;
    return '';
  }

  function counterKeys(c, day) {
    const keys = [];
    if (['trial', 'active', 'due'].includes(c.state) && daysLeft(c, day) <= 30) keys.push('renew');
    if (['grace', 'read_only'].includes(c.state)) keys.push('late');
    if (c.state === 'suspended') keys.push('suspended');
    return keys;
  }

  function fleet() {
    const day = today();
    const plans = catalogue.plans();
    const rows = customers.list().map((c) => {
      const facts = instances.readFacts(servedSlug(c));
      const cols = hostColumns(hosting.get(c.id), now());
      return {
        id: c.id,
        slug: c.slug,
        url: urlOf(c.slug),
        companyName: c.companyName,
        planName: plans.find((p) => p.code === c.planCode).name,
        addonsCount: c.addons.length,
        state: c.state,
        stateLabel: STATE_LABELS[c.state],
        endsAt: c.endsAt,
        endsAtLabel: frDay(c.endsAt),
        daysLeft: c.archivedAt ? null : daysLeft(c, day),
        installedCount: facts ? facts.installed.length : null,
        // H1 rule 15: measured by the probe; labels and sort keys come ready.
        ...cols,
        counters: counterKeys(c, day),
      };
    });
    const count = (k) => rows.filter((r) => r.counters.includes(k)).length;
    return {
      rows,
      counters: [
        { key: 'renew', label: 'à renouveler sous 30 jours', count: count('renew') },
        { key: 'late', label: 'en grâce ou lecture seule', count: count('late') },
        { key: 'suspended', label: 'suspendus', count: count('suspended') },
      ],
    };
  }

  // --- onboarding (rule 7) -------------------------------------------------------------------

  // Validates the form and computes what it means; `preview` shows it, `create` saves it.
  function plan(body) {
    const errors = {};
    const companyName = String(body.companyName || '').trim();
    const contactName = String(body.contactName || '').trim();
    const contactEmail = String(body.contactEmail || '').trim().toLowerCase();
    const slug = String(body.slug || '').trim();
    if (!companyName) errors.companyName = 'Le nom de la société est obligatoire.';
    if (!EMAIL_RE.test(contactEmail)) errors.contactEmail = 'Adresse email invalide.';
    const slugErr = slugError(slug, slugTaken);
    if (slugErr) errors.slug = slugErr;
    const planRow = catalogue.plan(body.planCode);
    if (!planRow) errors.planCode = 'Forfait inconnu.';
    const billing = body.billing === 'yearly' ? 'yearly' : body.billing === 'monthly' ? 'monthly' : null;
    if (!billing) errors.billing = 'Facturation mensuelle ou annuelle.';
    const startsAt = isDay(body.startsAt) ? body.startsAt : null;
    if (!startsAt) errors.startsAt = 'Date de début invalide.';
    const length = body.length === 'custom' ? 'custom' : Number(body.length);
    let paidEndsAt = null;
    let periodMonths = billing === 'yearly' ? 12 : 1;
    if (length === 'custom') {
      if (!isDay(body.endsAt) || !startsAt || body.endsAt <= startsAt) errors.endsAt = 'La date de fin doit suivre la date de début.';
      else paidEndsAt = body.endsAt;
    } else if (length === 1 || length === 12) {
      periodMonths = length;
      if (startsAt) paidEndsAt = addMonths(startsAt, length);
    } else {
      errors.length = 'Durée : 1 mois, 12 mois ou une date de fin.';
    }
    const requested = Array.isArray(body.addons) ? [...new Set(body.addons)] : [];
    const { unknown, addons } = planRow ? keepSellableAddons(requested, planRow.code) : { unknown: false, addons: [] };
    if (unknown) errors.addons = 'Option inconnue.';
    const incoherent = planRow && !unknown ? modules().refuseComposition(planRow.code, addons) : null;
    if (incoherent) errors.addons = incoherent.message;
    const billingIdentity = readBilling(body, errors);
    const moduleChoice = modules().creationChoices({ planCode: planRow && planRow.code, addons, requested: body.modules, errors });
    const trial = Boolean(body.trial);
    const trialEndsAt = trial && startsAt ? addDays(startsAt, TRIAL_DAYS) : null;

    let summary = null;
    if (planRow && billing && startsAt && paidEndsAt) {
      const monthly = (billing === 'yearly' ? planRow.priceYearlyCents : planRow.priceMonthlyCents)
        + addons.reduce((s, id) => s + ((catalogue.addons().find((a) => a.pluginId === id) || {}).priceMonthlyCents || 0), 0);
      const names = addons.map(pluginName);
      summary = {
        price: `${planRow.name}${names.length ? ` + ${names.join(', ')}` : ''} · ${euros(monthly)} HT / mois${billing === 'yearly' ? ' (facturé à l’année)' : ''}`,
        period: trial
          ? `Essai gratuit du ${frDay(startsAt)} au ${frDay(trialEndsAt)} ; la première période payée (${length === 'custom' ? `jusqu’au ${frDay(paidEndsAt)}` : `${periodMonths} mois`}) commence au paiement.`
          : `Abonnement du ${frDay(startsAt)} au ${frDay(paidEndsAt)}.`,
        catalogue: `Prix du catalogue v${catalogue.currentVersion()} : il reste celui de ce client même si le catalogue change.`,
        url: slugErr ? null : urlOf(slug),
      };
    }
    return {
      errors,
      summary,
      moduleChoice,
      record: {
        customer: { slug, companyName, contactName, contactEmail, ...billingIdentity },
        subscription: {
          planCode: planRow && planRow.code,
          billing,
          periodMonths,
          startsAt,
          endsAt: trial ? trialEndsAt : paidEndsAt,
          trialEndsAt,
          catalogueVersion: catalogue.currentVersion(),
        },
        addons,
        modules: moduleChoice.chosen,
      },
    };
  }

  function preview(body) {
    const { errors, summary, moduleChoice } = plan(body);
    const planRow = catalogue.plan(body.planCode);
    return {
      errors,
      summary,
      moduleChoices: moduleChoice.choices,
      moduleSummary: moduleChoice.summary || null,
      addonChoices: planRow ? addonChoices(planRow.code) : [],
      countries: Object.entries(COUNTRIES).map(([code, name]) => ({ code, name })),
      defaults: { startsAt: today(), billingCountry: 'FR' },
    };
  }

  async function create(body, operator, { background = false } = {}) {
    const { errors, record } = plan(body);
    if (Object.keys(errors).length) {
      const onlyModules = errors.modules && Object.keys(errors).length === 1;
      throw httpError(onlyModules ? 422 : 400, 'INVALID', Object.values(errors)[0], { errors });
    }
    const day = today();
    const state = stateOf({ ...record.subscription }, day);
    const id = customers.create({
      customer: { ...record.customer, state, stateSince: day, createdAt: stamp() },
      subscription: record.subscription,
      addons: record.addons,
      since: day,
    });
    modules().seedAtCreation(id, record.modules, operator);
    const planName = catalogue.plan(record.subscription.planCode).name;
    journal(id, operator, 'created', `Client créé : forfait ${planName}, ${BILLING_LABELS[record.subscription.billing]}${record.subscription.trialEndsAt ? `, essai jusqu’au ${frDay(record.subscription.trialEndsAt)}` : ''}`);
    host().plan(id);
    refresh(id, operator, { writeLicence: false });
    // H1 rule 1: the sequence runs by itself; the route answers at once and the page follows it live.
    const run = host().create(id);
    if (!background) await run;
    return view(id);
  }

  // H1 rule 2: « Reprendre » on a failed creation step, « Réessayer » on a failed stop, restart or
  // rename. Every step is idempotent, so a resumed sequence never duplicates anything.
  async function stepAction(id, step, action, operator, { background = false } = {}) {
    const c = mustGet(id);
    const def = ALL_STEPS.find((s) => s.step === step);
    const row = provisioning.get(c.id, step);
    if (!def || !row) throw httpError(404, 'NOT_FOUND', 'Étape inconnue.');
    if (action !== 'resume' && action !== 'retry') throw httpError(400, 'INVALID', 'Action inconnue.');
    if (row.status !== 'failed') throw httpError(409, 'NOT_FAILED', 'Cette étape n’est pas en échec.');
    if (c.archivedAt && SERVING_STEPS.has(step)) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    let run;
    if (CREATE_STEPS.some((s) => s.step === step)) {
      journal(c.id, operator, 'step', `Création reprise à l’étape « ${def.label} »`);
      run = host().create(c.id);
    } else if (step === 'deprov-stop') run = host().stop(c.id);
    else if (step === 'restart') run = host().restart(c.id);
    else if (step === 'process-restart') run = host().restartProcess(c.id);
    else if (step === 'rename') {
      const previous = directory.aliasesOf(c.id, today())[0];
      markRenaming(c.id);
      run = host().rename(c.id, previous ? previous.slug : c.slug)
        .finally(() => unmarkRenaming(c.id))
        .then((ok) => { if (ok) refresh(c.id, operator); return ok; });
    } else if (step === 'deprov-email') {
      assertNotErasing(c.id);
      run = host().exclusive(c.id, () => resendExportLink(c.id, operator));
    }
    else if (step === 'deprov-export') return deprovision(c.id, { confirmSlug: c.slug, retry: true }, operator);
    if (!background) await run;
    return view(c.id);
  }

  // --- money and overrides (rules 15, 19) ------------------------------------------------------

  // Rules 15 and 35: the paid period moves the end date; a payment during the trial ends the trial.
  // Any « Remettre en actif » override goes with it. → the new end date
  function applyPayment(c, months) {
    const endsAt = paidEndsAt(c, months, today());
    customers.setEndsAt(c.id, endsAt);
    customers.setForceActiveUntil(c.id, null);
    if (c.trialEndsAt) customers.setTrialEndsAt(c.id, null);
    return endsAt;
  }

  function recordPayment(id, body, operator) {
    const c = mustGet(id);
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    assertExpectedEndsAt(c, body);
    const months = Number(body.months);
    if (months !== 1 && months !== 12) throw httpError(400, 'INVALID', 'Durée payée : 1 ou 12 mois.');
    const reference = String(body.reference || '').trim();
    const day = today();
    const inTrial = Boolean(c.trialEndsAt && day < c.trialEndsAt);
    const periodStart = !inTrial && c.endsAt > day ? c.endsAt : day;
    const amountCents = monthlyPriceCents(c) * months;
    invoices.insert({
      customerId: c.id, periodStart, periodEnd: paidEndsAt(c, months, day), amountCents, provider: 'manual', providerRef: reference || null,
      status: 'paid', paidAt: stamp(), createdAt: stamp(),
    });
    const endsAt = applyPayment(c, months);
    journal(c.id, operator, 'payment', `Paiement enregistré (${months} mois, ${euros(amountCents)} HT${reference ? `, « ${reference} »` : ''}) : échéance au ${frDay(endsAt)}`);
    refresh(c.id, operator);
    return view(c.id);
  }

  // Rule 7 (C2b): correcting the billing identity. The next invoice goes to a Qonto client created
  // from the new address; an invoice already issued keeps the old one.
  function setBilling(id, body, operator) {
    const c = mustGet(id);
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    const errors = {};
    const billing = readBilling(body, errors);
    if (Object.keys(errors).length) throw httpError(400, 'INVALID', Object.values(errors)[0], { errors });
    customers.setBilling(c.id, billing);
    journal(c.id, operator, 'billing', `Facturation : ${billing.billingStreet}, ${billing.billingPostcode} ${billing.billingCity}${billing.vatNumber ? `, TVA ${billing.vatNumber}` : ''}`);
    return view(c.id);
  }

  // --- the address (rule 22) -------------------------------------------------------------------

  function renamePreview(id, body) {
    const c = mustGet(id);
    const slug = String(body.slug || '').trim();
    const error = slug === c.slug ? 'C’est déjà son adresse.' : (slug ? slugError(slug, slugTaken) : null);
    const until = addMonths(today(), ALIAS_MONTHS);
    return {
      error,
      url: slug && !error ? urlOf(slug) : null,
      until: `L’ancienne adresse ${c.slug}.${domain} redirige (301) jusqu’au ${frDay(addDays(today(), host().REDIRECT_DAYS))} et reste réservée jusqu’au ${frDay(until)}.`,
      checklist: RENAME_CHECKLIST,
    };
  }

  async function rename(id, body, operator) {
    const c = mustGet(id);
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    assertNotDeprovisioning(c.id);
    const slug = String(body.slug || '').trim();
    const { error } = renamePreview(id, { slug });
    if (!slug || error) throw httpError(400, 'INVALID', error || 'Nouvelle adresse obligatoire.');
    const checked = new Set(Array.isArray(body.checked) ? body.checked : []);
    const missing = RENAME_CHECKLIST.filter((i) => !checked.has(i.key));
    if (missing.length) throw httpError(400, 'CHECKLIST', `À cocher d’abord : ${missing.map((i) => i.label).join(' ; ')}.`);
    const until = addMonths(today(), ALIAS_MONTHS);
    const redirectUntil = addDays(today(), host().REDIRECT_DAYS);
    markRenaming(c.id);
    try {
      customers.setSlug(c.id, slug);
      directory.addAlias(c.slug, c.id, until);
      journal(c.id, operator, 'rename', `Adresse : ${c.slug} → ${slug} ; l’ancienne redirige jusqu’au ${frDay(redirectUntil)} et reste réservée jusqu’au ${frDay(until)}`);
      // H1 rule 5: the directory moves, the unit and the site follow, the old address redirects.
      await host().rename(c.id, c.slug);
    } finally {
      unmarkRenaming(c.id);
    }
    refresh(c.id, operator);
    return view(c.id);
  }

  function requireReason(body) {
    const reason = String(body.reason || '').trim();
    if (!reason) throw httpError(400, 'REASON_REQUIRED', 'Le motif est obligatoire.');
    return reason;
  }

  function extend(id, body, operator) {
    const c = mustGet(id);
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    assertExpectedEndsAt(c, body);
    const reason = requireReason(body);
    if (!isDay(body.endsAt) || body.endsAt <= c.endsAt) throw httpError(400, 'INVALID', 'La nouvelle date doit suivre l’échéance actuelle.');
    customers.setEndsAt(c.id, body.endsAt);
    audit.override({ customerId: c.id, kind: 'extend', reason, operator, at: stamp() });
    journal(c.id, operator, 'override', `Prolongé du ${frDay(c.endsAt)} au ${frDay(body.endsAt)} : « ${reason} »`);
    refresh(c.id, operator);
    return view(c.id);
  }

  function forceActive(id, body, operator) {
    const c = mustGet(id);
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    const reason = requireReason(body);
    if (!isDay(body.until) || body.until < today()) throw httpError(400, 'INVALID', 'La date doit être aujourd’hui ou plus tard.');
    customers.setForceActiveUntil(c.id, body.until);
    audit.override({ customerId: c.id, kind: 'force_active', reason, operator, at: stamp() });
    journal(c.id, operator, 'override', `Remis en actif jusqu’au ${frDay(body.until)} : « ${reason} »`);
    refresh(c.id, operator);
    return view(c.id);
  }

  // Rule 5: a plan change is where grandfathered plugins are withdrawn.
  function changePlan(id, body, operator) {
    const c = mustGet(id);
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    const planRow = catalogue.plan(body.planCode);
    if (!planRow) throw httpError(400, 'INVALID', 'Forfait inconnu.');
    const billing = body.billing === 'yearly' ? 'yearly' : body.billing === 'monthly' ? 'monthly' : null;
    if (!billing) throw httpError(400, 'INVALID', 'Facturation mensuelle ou annuelle.');
    const { unknown, addons } = keepSellableAddons(Array.isArray(body.addons) ? [...new Set(body.addons)] : [], planRow.code);
    if (unknown) throw httpError(400, 'INVALID', 'Option inconnue.');
    const incoherent = modules().refuseComposition(planRow.code, addons);
    if (incoherent) throw incoherent;
    const before = catalogue.plan(c.planCode).name;
    customers.changePlan({
      id: c.id, planCode: planRow.code, billing, periodMonths: billing === 'yearly' ? 12 : 1,
      catalogueVersion: catalogue.currentVersion(), addons, since: today(),
    });
    const lost = c.grandfathered.map(pluginName);
    journal(c.id, operator, 'plan', `Forfait : ${before} → ${planRow.name} (${BILLING_LABELS[billing]})${addons.length ? `, options : ${addons.map(pluginName).join(', ')}` : ''}${lost.length ? ` ; retirés (hors forfait conservés) : ${lost.join(', ')}` : ''}`);
    modules().dropNotAllowed(c.id, operator);
    refresh(c.id, operator);
    return view(c.id);
  }

  function licenceDownload(id) {
    const c = mustGet(id);
    return { filename: `licence-${c.slug}.jws`, token: licenceToken(c.id) };
  }

  // --- deprovisioning (rule 20) ----------------------------------------------------------------

  async function sendExportLink(id, link) {
    const c = customers.get(id);
    const exp = provisioning.get(id, 'deprov-export');
    if (!exp || exp.status !== 'ok' || !link) {
      provisioning.set(id, 'deprov-email', 'skipped', 'Aucun export à envoyer.', stamp());
      return;
    }
    try {
      await mailer.send({
        to: c.contactEmail,
        subject: `Export de votre espace GuestFlow ${c.companyName}`,
        text: [
          `Bonjour${c.contactName ? ` ${c.contactName}` : ''},`,
          '',
          `Votre espace ${urlOf(c.slug)} a été fermé. Toutes vos données sont dans cette archive, téléchargeable jusqu’au ${frDay(link.expiresAt)} inclus :`,
          `${consoleUrl}/exports/${link.token}`,
          '',
          'Elle contient la base complète, vos photos et deux fichiers CSV (réservations et clients).',
        ].join('\n'),
      });
      provisioning.set(id, 'deprov-email', 'ok', `Envoyé à ${c.contactEmail}.`, stamp());
    } catch (err) {
      provisioning.set(id, 'deprov-email', 'failed', `Échec de l’envoi : ${err.message}`, stamp());
    }
  }

  // H1 rule 40: inside the customer's lock. An erasure accepted meanwhile deletes the archive next,
  // and a link that expired or lost its file is replaced by a fresh export while the database is there.
  // A reactivation or another retry that ran first while this one waited leaves nothing to send.
  async function resendExportLink(id, operator) {
    const c = customers.get(id);
    if (!c || c.erasedAt || !c.archivedAt) return;
    if (provisioning.get(id, 'deprov-email')?.status !== 'failed') return;
    if (erasing.has(id)) {
      provisioning.set(id, 'deprov-email', 'failed', 'Effacement en cours : aucun lien envoyé.', stamp());
      return;
    }
    let link = provisioning.latestExport(id);
    if (link && (link.expiresAt < today() || !fs.existsSync(link.path))) {
      if (!instances.hasDatabase(c.slug)) {
        provisioning.set(id, 'deprov-email', 'failed', 'Lien expiré et base introuvable : aucun export à envoyer.', stamp());
        return;
      }
      const fresh = exportForDeprovision(c, operator);
      if (fresh.failed) {
        provisioning.set(id, 'deprov-email', 'failed', 'Nouvel export en échec : aucun lien envoyé.', stamp());
        return;
      }
      journal(id, operator, 'deprovision', 'Nouvel export produit : l’ancien lien avait expiré');
      link = fresh.link;
    }
    await sendExportLink(id, link);
  }

  // H1 rule 38: a customer is archived only after its stop, so a second request (another tab, or one
  // queued behind a fleet item holding the lock) would pass the check above and export and mail again.
  const deprovisioning = new Set();

  // Rule 38: a rename or a restore would otherwise run between the export and the stop, or after it.
  function assertNotDeprovisioning(id) {
    if (deprovisioning.has(id)) throw httpError(409, 'DEPROVISIONING', 'Fermeture en cours.');
  }

  async function deprovision(id, body, operator) {
    const c = mustGet(id);
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client déjà archivé.');
    if (renamePending(c)) throw httpError(409, 'RENAME_PENDING', 'Changement d’adresse à terminer d’abord.');
    if (String(body.confirmSlug || '') !== c.slug) throw httpError(400, 'CONFIRM_SLUG', `Tapez exactement « ${c.slug} » pour confirmer.`);
    if (deprovisioning.has(c.id)) return view(c.id);
    deprovisioning.add(c.id);
    try {
      return await runDeprovision(c, operator);
    } finally {
      deprovisioning.delete(c.id);
    }
  }

  async function runDeprovision(c, operator) {

    // 1. The export. A failure stops here: nothing is archived without its data safe. It runs inside
    // the customer's sequence lock, so never alongside a fleet update's snapshot or rollback; the stop
    // below stays outside it (it takes the same lock).
    const exported = await host().exclusive(c.id, () => exportForDeprovision(c, operator));
    if (exported.failed) return view(c.id);
    // 2. The link to the contact.
    await sendExportLink(c.id, exported.link || null);
    // 3. The process and the route stop; the address serves « Cet espace a été fermé » (H1 rule 3).
    await host().stop(c.id);
    // 4. Archived; 5. erased after 90 days.
    const eraseAt = addDays(today(), ERASE_AFTER_DAYS);
    customers.archive(c.id, stamp(), eraseAt);
    journal(c.id, operator, 'deprovision', `Déprovisionné : export ${exported.token ? 'produit' : 'sans objet'}, effacement prévu le ${frDay(eraseAt)}`);
    refresh(c.id, operator);
    return view(c.id);
  }

  function exportForDeprovision(c, operator) {
    if (!instances.hasDatabase(c.slug)) {
      provisioning.set(c.id, 'deprov-export', 'skipped', 'Aucune donnée : l’instance n’a jamais été créée.', stamp());
      return { token: null };
    }
    try {
      const { file, bytes } = exportInstance({ instances, slug: c.slug, exportsDir, stamp: today() });
      const token = crypto.randomBytes(24).toString('base64url');
      const link = { token, customerId: c.id, path: file, createdAt: stamp(), expiresAt: addDays(today(), EXPORT_LINK_DAYS) };
      provisioning.addExport(link);
      provisioning.set(c.id, 'deprov-export', 'ok', `Archive de ${(bytes / 1048576).toFixed(1).replace('.', ',')} Mo.`, stamp());
      return { token, link };
    } catch (err) {
      provisioning.set(c.id, 'deprov-export', 'failed', `Échec : ${err.message}`, stamp());
      journal(c.id, operator, 'deprovision', `Déprovisionnement interrompu : l’export a échoué (${err.message})`);
      return { failed: true };
    }
  }

  // Rule 39: from the moment an erasure is accepted until it ends, including while it waits for the
  // customer's lock; a count, so two overlapping erasures cannot clear each other.
  const erasing = new Map();
  const markErasing = (id) => erasing.set(id, (erasing.get(id) || 0) + 1);
  const unmarkErasing = (id) => {
    const n = erasing.get(id) - 1;
    if (n > 0) erasing.set(id, n); else erasing.delete(id);
  };
  function assertNotErasing(id) {
    if (erasing.has(id)) throw httpError(409, 'ERASING', 'Effacement en cours.');
  }

  async function reactivate(id, operator) {
    const c = mustGet(id);
    assertNotErasing(c.id);
    if (!c.archivedAt) throw httpError(409, 'NOT_ARCHIVED', 'Ce client n’est pas archivé.');
    customers.unarchive(c.id);
    dropExports(c.id);
    provisioning.clear(c.id, 'deprov-');
    journal(c.id, operator, 'reactivate', 'Réactivé depuis son dossier ; effacement annulé, export supprimé');
    refresh(c.id, operator);
    // H1 rule 4: the unit and the site again.
    await host().restart(c.id);
    return view(c.id);
  }

  function cancelErase(id, operator) {
    const c = mustGet(id);
    assertNotErasing(c.id);
    if (!c.archivedAt || !c.eraseAt) throw httpError(409, 'NOTHING_SCHEDULED', 'Aucun effacement prévu.');
    customers.setEraseAt(c.id, null);
    journal(c.id, operator, 'erase', 'Effacement annulé');
    return view(c.id);
  }

  // Rule 20: an instance is erased only once its process and route are stopped.
  function stopped(c) {
    const row = provisioning.get(c.id, 'deprov-stop');
    return Boolean(row && row.status === 'ok');
  }

  // The export archives hold the whole database: they go with the link (rule 20).
  function dropExports(customerId) {
    for (const exp of provisioning.exportsOf(customerId)) {
      fs.rmSync(exp.path, { force: true });
      provisioning.expireExport(exp.token, addDays(today(), -1));
    }
  }

  function purgeExpiredExports() {
    const expired = provisioning.expiredExports(today()).filter((exp) => fs.existsSync(exp.path));
    for (const exp of expired) {
      fs.rmSync(exp.path, { force: true });
      journal(exp.customerId, 'système', 'deprovision', 'Archive d’export supprimée (lien expiré)');
    }
    return expired.length;
  }

  async function eraseNow(id, body, operator) {
    const c = mustGet(id);
    if (!c.archivedAt) throw httpError(409, 'NOT_ARCHIVED', 'Seul un client archivé peut être effacé.');
    if (!stopped(c)) throw httpError(409, 'NOT_STOPPED', '« Processus et route arrêtés » en échec : à relancer d’abord.');
    if (String(body.confirmSlug || '') !== c.slug) throw httpError(400, 'CONFIRM_SLUG', `Tapez exactement « ${c.slug} » pour confirmer.`);
    const result = await erase(c.id, operator);
    if (result.erased) return result;
    // Rule 39: a second click queued behind the first finds the customer erased by it.
    if (customers.get(c.id)?.erasedAt) return { erased: true, id: c.id };
    throw httpError(409, 'NOT_ARCHIVED', 'Seul un client archivé peut être effacé.');
  }

  // Inside the customer's sequence lock: never alongside a fleet update's snapshot or rollback.
  // Rule 39: the customer is read again once the lock is held; a scheduled erasure also requires
  // its date to still be due.
  async function erase(id, operator, { scheduled = false } = {}) {
    markErasing(id);
    try {
      return await host().exclusive(id, () => runErase(id, operator, scheduled));
    } finally {
      unmarkErasing(id);
    }
  }

  async function runErase(id, operator, scheduled) {
    const c = customers.get(id);
    if (!c || c.erasedAt || !c.archivedAt || (scheduled && !(c.eraseAt && c.eraseAt <= today()))) return { erased: false, id };
    // H1 rule 6: the unit, the site, the replica and the environment file go too.
    await host().erase(c.id);
    eraseInstance({ instances, slug: c.slug });
    dropExports(c.id);
    customers.markErased(c.id, stamp());
    directory.removeCustomer(c.id);
    journal(c.id, operator, 'erase', 'Données, dossier de l’instance, sauvegardes et archive d’export effacés ; l’adresse est de nouveau libre');
    return { erased: true, id: c.id };
  }

  // A customer whose process is not marked stopped waits, and the alerts say so.
  // H1 rule 23: one customer's failed erasure is an alert, and the others are still erased.
  async function eraseDue(operator, log = (msg) => console.log(msg)) {
    const done = [];
    for (const id of customers.dueForErasure(today()).filter((x) => stopped(customers.get(x)))) {
      const c = customers.get(id);
      try {
        const result = await erase(id, operator, { scheduled: true });
        if (result.erased) done.push(result);
        if (ctx.hostAlerts) ctx.hostAlerts.close(`erase:${id}`);
      } catch (err) {
        log(`[erase] ${c.slug}: ${err.message}`);
        if (ctx.hostAlerts) ctx.hostAlerts.open({ key: `erase:${id}`, customerId: id, kind: 'erase', severity: 'error', text: `${c.companyName} : effacement impossible (${err.message}).` });
      }
    }
    return done;
  }

  function erasureBlocked() {
    return customers.dueForErasure(today()).map((id) => customers.get(id)).filter((c) => !stopped(c));
  }

  return {
    CREATE_STEPS,
    DEPROVISION_STEPS,
    REACTIVATE_STEPS,
    RENAME_STEPS,
    PROCESS_RESTART_STEPS,
    issueLicence,
    adminStep,
    resendInvitation,
    resetAccess,
    restartProcess,
    applyPayment,
    mustGet,
    assertNotDeprovisioning,
    refresh,
    reissueAll,
    view,
    fleet,
    preview,
    create,
    stepAction,
    recordPayment,
    setBilling,
    extend,
    forceActive,
    changePlan,
    licenceDownload,
    deprovision,
    reactivate,
    renamePreview,
    rename,
    cancelErase,
    eraseNow,
    eraseDue,
    erasureBlocked,
    purgeExpiredExports,
    assertExpectedEndsAt,
    servedSlug,
    today,
    monthlyPriceCents,
    priceLines,
    journal,
    urlOf,
    RENAME_CHECKLIST,
  };
}

module.exports = { createCustomersController, TRIAL_DAYS, ERASE_AFTER_DAYS, EXPORT_LINK_DAYS };
