/**
 * Customers of the platform (specs/control-plane-plans-and-access.md rules 7, 8, 9, 14, 15, 19, 20).
 *
 * Every action ends the same way: the state is recomputed from the dates (lifecycle.js), a
 * transition is journaled, and the licence is re-issued and written to the instance. The payloads
 * are ready to render: labels, dates, amounts and available actions are decided here.
 */

const crypto = require('crypto');
const fs = require('fs');
const { stateOf, daysLeft, renewedEndsAt, STATE_LABELS } = require('../utils/lifecycle');
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
const ALL_STEPS = [...CREATE_STEPS, ...DEPROVISION_STEPS, ...REACTIVATE_STEPS, ...RENAME_STEPS];
// Rule 22: what must be redone when the address changes, each item ticked before it runs.
const RENAME_CHECKLIST = [
  { key: 'wordpress', label: 'Réglage du plugin WordPress (adresse de l’API)' },
  { key: 'ical', label: 'Adresses des flux iCal collées sur chaque plateforme' },
  { key: 'oauth', label: 'Adresses de retour des applications Google et Qonto du client, puis « Connecter » à nouveau' },
  { key: 'publicUrl', label: 'URL publique de l’espace (Réglages → Envoi d’emails)' },
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

  const today = () => parisDay(now());
  const stamp = () => now().toISOString();
  const urlOf = (slug) => `https://${slug}.${domain}`;

  // Rule 21 with rule 22: an old slug stays taken while it still redirects.
  const slugTaken = (slug) => customers.slugTaken(slug) || directory.aliasTaken(slug, today());

  // Rule 22: until « Dossier renommé… » is done (H1 rule 5 runs it at once), the instance still runs
  // from its old directory and answers at its old address.
  function renamePending(c) {
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

  function licenceToken(id) {
    const c = customers.get(id);
    const payload = buildPayload({
      customer: c,
      state: c.state,
      plans: catalogue.plans(),
      lowest: catalogue.lowest(),
      catalogueVersion: catalogue.currentVersion(),
      payUrl: invoices.openPayUrl(id),
      now: now(),
    });
    return issuer.sign(payload);
  }

  function issueLicence(id) {
    const c = customers.get(id);
    const result = issuer.write(c.slug, licenceToken(id));
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

  // Rule 7: the first administrator, created by the instance's own script of its own version, and
  // the invitation. → the step's detail; throws with the step's error.
  async function adminStep(id) {
    const c = customers.get(id);
    if (!instances.hasDatabase(c.slug)) throw new Error('La base de l’instance est introuvable : créez d’abord le dossier, puis réessayez.');
    const version = (hosting.get(c.id) || {}).version;
    const serverDir = version && ctx.releases && ctx.releases.has(version) ? `${ctx.releases.dirOf(version)}/server` : undefined;
    let result;
    try {
      result = await runFirstAdmin({ dbPath: instances.dbPath(c.slug), email: c.contactEmail, name: c.contactName, serverDir });
    } catch (err) {
      throw new Error(`Échec : ${err.message}`);
    }
    if (!result.created) return `Le compte ${c.contactEmail} existe déjà : aucune invitation renvoyée.`;
    try {
      await mailer.send({
        to: c.contactEmail,
        subject: `Votre espace GuestFlow ${c.companyName} est prêt`,
        text: [
          `Bonjour${c.contactName ? ` ${c.contactName}` : ''},`,
          '',
          `Votre espace GuestFlow est ouvert à l’adresse ${urlOf(c.slug)}.`,
          '',
          `Identifiant : ${c.contactEmail}`,
          `Mot de passe provisoire : ${result.temporaryPassword}`,
          '',
          'Vous choisirez votre propre mot de passe à la première connexion.',
          `${urlOf(c.slug)}/login?login_hint=${encodeURIComponent(c.contactEmail)}`,
        ].join('\n'),
      });
    } catch (err) {
      throw new Error(`Échec : ${err.message}`);
    }
    return `Invitation envoyée à ${c.contactEmail}.`;
  }

  // --- views ---------------------------------------------------------------------------------

  function stepsView(c, defs) {
    const rows = new Map(provisioning.list(c.id).map((r) => [r.step, r]));
    return defs.filter((d) => rows.has(d.step)).map((d) => {
      const r = rows.get(d.step);
      return {
        step: d.step,
        label: d.label,
        kind: d.kind,
        status: r.status,
        detail: r.detail || (r.status === 'running' ? 'En cours…' : ''),
        // H1 rule 2: a failed creation step resumes the sequence from itself.
        action: r.status !== 'failed' ? null : (CREATE_STEPS.some((x) => x.step === d.step) ? 'resume' : 'retry'),
      };
    });
  }

  function view(id) {
    const c = mustGet(id);
    const day = today();
    const plan = catalogue.plan(c.planCode);
    const archived = Boolean(c.archivedAt);
    const forced = c.forceActiveUntil && day <= c.forceActiveUntil;
    const unsettled = invoices.unsettled(c.id)[0] || null;
    const openInvoice = unsettled && unsettled.status === 'open' ? unsettled : null;
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
      steps: stepsView(c, [...CREATE_STEPS, ...REACTIVATE_STEPS, ...RENAME_STEPS]),
      // H1 rule 1: the page polls while a sequence runs.
      provisioningRunning: Boolean(host() && host().running(c.id)) || provisioning.list(c.id).some((r) => r.status === 'running'),
      hosting: hostView(c, hosting.get(c.id), { now: now(), lastCheck: hosting.lastCheck(c.id), dailyMailLimit: ctx.drivers ? ctx.drivers.mail.dailyLimit : null, mailToday: hosting.mailCount(c.id, day) }),
      formerAddresses: directory.aliasesOf(c.id, day).map((a) => `${a.slug}.${domain} → redirigée jusqu’au ${frDay(a.until)}`),
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
        const endsAt = renewedEndsAt(c.endsAt, months, day);
        const after = stateOf({ ...c, endsAt, forceActiveUntil: null }, day);
        const from = c.endsAt > day ? 'la période s’ajoute à l’échéance actuelle' : 'l’échéance est passée : la période part d’aujourd’hui';
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
    const billingIdentity = readBilling(body, errors);
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
      },
    };
  }

  function preview(body) {
    const { errors, summary } = plan(body);
    const planRow = catalogue.plan(body.planCode);
    return {
      errors,
      summary,
      addonChoices: planRow ? addonChoices(planRow.code) : [],
      countries: Object.entries(COUNTRIES).map(([code, name]) => ({ code, name })),
      defaults: { startsAt: today(), billingCountry: 'FR' },
    };
  }

  async function create(body, operator, { background = false } = {}) {
    const { errors, record } = plan(body);
    if (Object.keys(errors).length) throw httpError(400, 'INVALID', Object.values(errors)[0], { errors });
    const day = today();
    const state = stateOf({ ...record.subscription }, day);
    const id = customers.create({
      customer: { ...record.customer, state, stateSince: day, createdAt: stamp() },
      subscription: record.subscription,
      addons: record.addons,
      since: day,
    });
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
    let run;
    if (CREATE_STEPS.some((s) => s.step === step)) {
      journal(c.id, operator, 'step', `Création reprise à l’étape « ${def.label} »`);
      run = host().create(c.id);
    } else if (step === 'deprov-stop') run = host().stop(c.id);
    else if (step === 'restart') run = host().restart(c.id);
    else if (step === 'rename') {
      const previous = directory.aliasesOf(c.id, today())[0];
      run = host().rename(c.id, previous ? previous.slug : c.slug).then((ok) => { if (ok) refresh(c.id, operator); return ok; });
    } else if (step === 'deprov-email') run = sendExportLink(c.id);
    else if (step === 'deprov-export') return deprovision(c.id, { confirmSlug: c.slug, retry: true }, operator);
    if (!background) await run;
    return view(c.id);
  }

  // --- money and overrides (rules 15, 19) ------------------------------------------------------

  function recordPayment(id, body, operator) {
    const c = mustGet(id);
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client archivé : réactivez-le d’abord.');
    assertExpectedEndsAt(c, body);
    const months = Number(body.months);
    if (months !== 1 && months !== 12) throw httpError(400, 'INVALID', 'Durée payée : 1 ou 12 mois.');
    const reference = String(body.reference || '').trim();
    const day = today();
    const periodStart = c.endsAt > day ? c.endsAt : day;
    const endsAt = renewedEndsAt(c.endsAt, months, day);
    const amountCents = monthlyPriceCents(c) * months;
    invoices.insert({
      customerId: c.id, periodStart, periodEnd: endsAt, amountCents, provider: 'manual', providerRef: reference || null,
      status: 'paid', paidAt: stamp(), createdAt: stamp(),
    });
    customers.setEndsAt(c.id, endsAt);
    customers.setForceActiveUntil(c.id, null);
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
    const slug = String(body.slug || '').trim();
    const { error } = renamePreview(id, { slug });
    if (!slug || error) throw httpError(400, 'INVALID', error || 'Nouvelle adresse obligatoire.');
    const checked = new Set(Array.isArray(body.checked) ? body.checked : []);
    const missing = RENAME_CHECKLIST.filter((i) => !checked.has(i.key));
    if (missing.length) throw httpError(400, 'CHECKLIST', `À cocher d’abord : ${missing.map((i) => i.label).join(' ; ')}.`);
    const until = addMonths(today(), ALIAS_MONTHS);
    const redirectUntil = addDays(today(), host().REDIRECT_DAYS);
    customers.setSlug(c.id, slug);
    directory.addAlias(c.slug, c.id, until);
    journal(c.id, operator, 'rename', `Adresse : ${c.slug} → ${slug} ; l’ancienne redirige jusqu’au ${frDay(redirectUntil)} et reste réservée jusqu’au ${frDay(until)}`);
    // H1 rule 5: the directory moves, the unit and the site follow, the old address redirects.
    await host().rename(c.id, c.slug);
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
    const before = catalogue.plan(c.planCode).name;
    customers.changePlan({
      id: c.id, planCode: planRow.code, billing, periodMonths: billing === 'yearly' ? 12 : 1,
      catalogueVersion: catalogue.currentVersion(), addons, since: today(),
    });
    const lost = c.grandfathered.map(pluginName);
    journal(c.id, operator, 'plan', `Forfait : ${before} → ${planRow.name} (${BILLING_LABELS[billing]})${addons.length ? `, options : ${addons.map(pluginName).join(', ')}` : ''}${lost.length ? ` ; retirés (hors forfait conservés) : ${lost.join(', ')}` : ''}`);
    refresh(c.id, operator);
    return view(c.id);
  }

  function licenceDownload(id) {
    const c = mustGet(id);
    return { filename: `licence-${c.slug}.jws`, token: licenceToken(c.id) };
  }

  // --- deprovisioning (rule 20) ----------------------------------------------------------------

  async function sendExportLink(id) {
    const c = customers.get(id);
    const exp = provisioning.get(id, 'deprov-export');
    const link = provisioning.latestExport(id);
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
          `Votre espace ${urlOf(c.slug)} a été fermé. Toutes vos données sont dans cette archive, téléchargeable pendant ${EXPORT_LINK_DAYS} jours :`,
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

  async function deprovision(id, body, operator) {
    const c = mustGet(id);
    if (c.archivedAt) throw httpError(409, 'ARCHIVED', 'Client déjà archivé.');
    if (renamePending(c)) throw httpError(409, 'RENAME_PENDING', 'Changement d’adresse à terminer d’abord.');
    if (String(body.confirmSlug || '') !== c.slug) throw httpError(400, 'CONFIRM_SLUG', `Tapez exactement « ${c.slug} » pour confirmer.`);

    // 1. The export. A failure stops here: nothing is archived without its data safe.
    let token = null;
    if (!instances.hasDatabase(c.slug)) {
      provisioning.set(c.id, 'deprov-export', 'skipped', 'Aucune donnée : l’instance n’a jamais été créée.', stamp());
    } else {
      try {
        const { file, bytes } = exportInstance({ instances, slug: c.slug, exportsDir, stamp: today() });
        token = crypto.randomBytes(24).toString('base64url');
        provisioning.addExport({ token, customerId: c.id, path: file, createdAt: stamp(), expiresAt: addDays(today(), EXPORT_LINK_DAYS) });
        provisioning.set(c.id, 'deprov-export', 'ok', `Archive de ${(bytes / 1048576).toFixed(1).replace('.', ',')} Mo.`, stamp());
      } catch (err) {
        provisioning.set(c.id, 'deprov-export', 'failed', `Échec : ${err.message}`, stamp());
        journal(c.id, operator, 'deprovision', `Déprovisionnement interrompu : l’export a échoué (${err.message})`);
        return view(c.id);
      }
    }
    // 2. The link to the contact.
    await sendExportLink(c.id);
    // 3. The process and the route stop; the address serves « Cet espace a été fermé » (H1 rule 3).
    await host().stop(c.id);
    // 4. Archived; 5. erased after 90 days.
    const eraseAt = addDays(today(), ERASE_AFTER_DAYS);
    customers.archive(c.id, stamp(), eraseAt);
    journal(c.id, operator, 'deprovision', `Déprovisionné : export ${token ? 'produit' : 'sans objet'}, effacement prévu le ${frDay(eraseAt)}`);
    refresh(c.id, operator);
    return view(c.id);
  }

  async function reactivate(id, operator) {
    const c = mustGet(id);
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
    return erase(c.id, operator);
  }

  async function erase(id, operator) {
    const c = customers.get(id);
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
        done.push(await erase(id, operator));
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
    issueLicence,
    adminStep,
    mustGet,
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
    monthlyPriceCents,
    priceLines,
    journal,
    urlOf,
    RENAME_CHECKLIST,
  };
}

module.exports = { createCustomersController, TRIAL_DAYS, ERASE_AFTER_DAYS, EXPORT_LINK_DAYS };
