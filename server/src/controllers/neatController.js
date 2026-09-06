/**
 * Neat integration controller (specs/neat-cancellation-insurance-subscription.md §4).
 *
 * Orchestrates: the Réglages card (feature-local settings + test-connection + discovery + field
 * mapping), the subscription pass (scheduled + kicked), the per-reservation actions (retry, void)
 * and the fiche's ready-to-render `neat` block. A DI factory (`createNeatController`) backs the
 * unit tests; the default instance binds the real models.
 */

const realDb = require('../database');
const realSettingsModel = require('../models/settingsModel');
const realNeatSubscriptionsModel = require('../models/neatSubscriptionsModel');
const realPushService = require('../utils/pushService');
const { buildNeatClient } = require('../utils/neatClient');
const { runNeatSubscriptionPass, externalIdFor } = require('../utils/neatSubscriptionRunner');
const {
  SOURCES, contractServiceFields, parseMappingJson, validateMapping,
} = require('../utils/neatFieldMapping');
const { isDirectChannel } = require('../utils/platformNameFormat');
const { readNeatConfig } = require('../utils/neatGuestPricing');

const EMPTY_CFG = {
  environment: 'staging', clientId: '', clientSecret: '', storeId: '', salesChannelId: '',
  salesChannelLabel: '', contractId: '', contractLabel: '', paymentMethodId: '',
  paymentMethodKind: '', paymentMethodLabel: '', fieldMappingJson: '', contractFieldsJson: '',
  marginPercent: null,
};

function createNeatController({
  db = realDb,
  settingsModel = realSettingsModel,
  model = realNeatSubscriptionsModel,
  buildClient = buildNeatClient,
  pushService = realPushService,
  now = () => new Date(),
  logger = console,
} = {}) {
  let passInProgress = false;

  // A partial settingsModel (test stub) reads as « unconfigured », never as a crash.
  const currentConfig = () => readNeatConfig(settingsModel) || EMPTY_CFG;

  function clientFromConfig(cfg) {
    return buildClient({ environment: cfg.environment, clientId: cfg.clientId, clientSecret: cfg.clientSecret });
  }

  function parsedContractFields(cfg) {
    try {
      const parsed = JSON.parse(cfg.contractFieldsJson || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // The Réglages card status, derived server-side so the client renders and decides nothing.
  function buildStatus(cfg) {
    const fields = parsedContractFields(cfg);
    const mapping = parseMappingJson(cfg.fieldMappingJson);
    const validation = fields.length ? validateMapping(mapping, fields) : { ok: false, errors: [] };
    const credentialsSet = Boolean(cfg.clientId && cfg.clientSecret);
    const selectionComplete = Boolean(cfg.salesChannelId && cfg.contractId && cfg.paymentMethodId);
    const requiredFields = fields.filter((f) => f.required);
    const mappedRequired = requiredFields.filter((f) => mapping[f.id] && mapping[f.id].source).length;
    return {
      environment: cfg.environment,
      credentialsSet,
      selectionComplete,
      mappingComplete: fields.length > 0 && validation.ok,
      requiredFieldsTotal: requiredFields.length,
      requiredFieldsMapped: mappedRequired,
      subscriptionActive: credentialsSet && selectionComplete && fields.length > 0 && validation.ok,
      pricingActive: credentialsSet && selectionComplete && fields.length > 0 && validation.ok
        && cfg.marginPercent !== null && Number(cfg.marginPercent) >= 0,
    };
  }

  async function runPass(reason) {
    if (passInProgress) return { skipped: 'in-progress' };
    passInProgress = true;
    try {
      return await runNeatSubscriptionPass({ db, settingsModel, model, buildClient, pushService, now, logger }, reason);
    } finally {
      passInProgress = false;
    }
  }

  return {
    runPass,

    // Fire-and-forget kick from the payment flows — must never surface on a request path.
    kickPass(reason) {
      runPass(reason).catch((err) => logger.error(`[neat] kicked pass failed: ${err.message}`));
    },

    // GET /api/neat/settings
    getSettings(req, res) {
      const cfg = currentConfig();
      res.json({
        environment: cfg.environment,
        clientId: cfg.clientId,
        clientSecretSet: Boolean(cfg.clientSecret),
        storeId: cfg.storeId,
        salesChannelId: cfg.salesChannelId,
        salesChannelLabel: cfg.salesChannelLabel,
        contractId: cfg.contractId,
        contractLabel: cfg.contractLabel,
        paymentMethodId: cfg.paymentMethodId,
        paymentMethodKind: cfg.paymentMethodKind,
        paymentMethodLabel: cfg.paymentMethodLabel,
        marginPercent: cfg.marginPercent,
        mapping: parseMappingJson(cfg.fieldMappingJson),
        contractFields: parsedContractFields(cfg),
        sources: Object.entries(SOURCES).map(([key, s]) => ({ key, type: s.type, label: s.label })),
        status: buildStatus(cfg),
        counters: model && typeof model.counters === 'function' ? model.counters(cfg.environment) : { pending: 0, failed: 0, active: 0, voided: 0 },
      });
    },

    // PUT /api/neat/settings — credentials + margin. The secret is 3-way: absent → preserved,
    // '' → cleared, value → stored encrypted (the settingsController Météo pattern).
    updateSettings(req, res) {
      const body = req.body || {};
      const payload = {};
      const errors = {};
      if (body.environment !== undefined) {
        const env = String(body.environment);
        if (env !== 'production' && env !== 'staging') errors.environment = 'Environnement invalide.';
        else payload.neatEnvironment = env;
      }
      if (body.clientId !== undefined) payload.neatClientId = String(body.clientId).trim();
      if (body.clientSecret !== undefined) payload.neatClientSecretEncrypted = String(body.clientSecret).trim();
      if (body.marginPercent !== undefined) {
        const raw = body.marginPercent;
        if (raw === null || raw === '') {
          payload.neatMarginPercent = null;
        } else {
          const n = Number(raw);
          if (!Number.isFinite(n) || n < 0 || n > 1000) errors.marginPercent = 'Marge invalide (0 à 1000 %).';
          else payload.neatMarginPercent = n;
        }
      }
      if (Object.keys(errors).length > 0) {
        return res.status(400).json({ code: 'SETTINGS_INVALID', errors });
      }
      settingsModel.upsert(payload);
      return this.getSettings(req, res);
    },

    // POST /api/neat/test-connection
    async testConnection(req, res) {
      const cfg = currentConfig();
      if (!cfg.clientId || !cfg.clientSecret) {
        return res.status(400).json({ ok: false, error: 'Identifiants Neat non configurés.' });
      }
      try {
        await clientFromConfig(cfg).testConnection();
        return res.json({ ok: true, environment: cfg.environment });
      } catch (err) {
        return res.status(502).json({ ok: false, error: `Connexion Neat impossible : ${err.message}` });
      }
    },

    // GET /api/neat/discovery — stores → channels; with the configured (or ?salesChannelId=) channel:
    // its payment methods + contracts (each with its flattened serviceFields schema). Live from Neat.
    async getDiscovery(req, res) {
      const cfg = currentConfig();
      if (!cfg.clientId || !cfg.clientSecret) {
        return res.status(400).json({ error: 'Identifiants Neat non configurés.' });
      }
      try {
        const client = clientFromConfig(cfg);
        const stores = await client.getStores();
        const channels = [];
        for (const store of stores) {
          for (const ch of store.salesChannels || []) {
            channels.push({
              id: String(ch.id || ch),
              name: String(ch.name || ch.id || ch),
              storeId: String(store.id || ''),
              storeName: String(store.name || ''),
            });
          }
        }
        const salesChannelId = String(req.query.salesChannelId || cfg.salesChannelId || '');
        let channelDetail = null;
        if (salesChannelId) {
          const [channel, contracts] = await Promise.all([
            client.getSalesChannel(salesChannelId),
            client.getSalesChannelContracts(salesChannelId),
          ]);
          channelDetail = {
            id: salesChannelId,
            name: String(channel.name || ''),
            // Neat serves payment methods either as plain ids or as objects — normalized here so
            // the card renders one shape. `kind` feeds paymentContext.method at subscribe time.
            paymentMethods: (channel.paymentMethods || []).map((pm) => (
              typeof pm === 'object' && pm !== null
                ? { id: String(pm.id), kind: String(pm.type || ''), label: String(pm.name || pm.type || pm.id) }
                : { id: String(pm), kind: '', label: String(pm) }
            )),
            contracts: contracts.map((c) => ({
              id: String(c.id),
              label: String((c.product && c.product.name) || c.id),
              status: String(c.status || ''),
              serviceFields: contractServiceFields(c),
            })),
          };
        }
        return res.json({ stores: stores.map((st) => ({ id: String(st.id || ''), name: String(st.name || '') })), channels, channelDetail });
      } catch (err) {
        return res.status(502).json({ error: `Découverte Neat impossible : ${err.message}` });
      }
    },

    // PUT /api/neat/selection — the chosen channel/contract/paymentMethod. Labels and the contract
    // field schema are resolved from Neat SERVER-SIDE (never trusted from the client payload).
    async updateSelection(req, res) {
      const cfg = currentConfig();
      if (!cfg.clientId || !cfg.clientSecret) {
        return res.status(400).json({ error: 'Identifiants Neat non configurés.' });
      }
      const salesChannelId = String(req.body.salesChannelId || '').trim();
      const contractId = String(req.body.contractId || '').trim();
      const paymentMethodId = String(req.body.paymentMethodId || '').trim();
      if (!salesChannelId || !contractId || !paymentMethodId) {
        return res.status(400).json({ error: 'Canal, contrat et mode de paiement sont requis.' });
      }
      try {
        const client = clientFromConfig(cfg);
        const [channel, contracts] = await Promise.all([
          client.getSalesChannel(salesChannelId),
          client.getSalesChannelContracts(salesChannelId),
        ]);
        const contract = contracts.find((c) => String(c.id) === contractId);
        if (!contract) return res.status(422).json({ error: 'Contrat introuvable sur ce canal de vente.' });
        const paymentMethods = (channel.paymentMethods || []).map((pm) => (
          typeof pm === 'object' && pm !== null
            ? { id: String(pm.id), kind: String(pm.type || ''), label: String(pm.name || pm.type || pm.id) }
            : { id: String(pm), kind: '', label: String(pm) }
        ));
        const paymentMethod = paymentMethods.find((pm) => pm.id === paymentMethodId);
        if (!paymentMethod) return res.status(422).json({ error: 'Mode de paiement introuvable sur ce canal de vente.' });
        const fields = contractServiceFields(contract);
        settingsModel.upsert({
          neatSalesChannelId: salesChannelId,
          neatSalesChannelLabel: String(channel.name || salesChannelId),
          neatContractId: contractId,
          neatContractLabel: String((contract.product && contract.product.name) || contractId),
          neatPaymentMethodId: paymentMethodId,
          neatPaymentMethodKind: paymentMethod.kind,
          neatPaymentMethodLabel: paymentMethod.label,
          neatContractFieldsJson: JSON.stringify(fields),
        });
        return this.getSettings(req, res);
      } catch (err) {
        return res.status(502).json({ error: `Sélection impossible : ${err.message}` });
      }
    },

    // PUT /api/neat/mapping
    updateMapping(req, res) {
      const cfg = currentConfig();
      const fields = parsedContractFields(cfg);
      if (fields.length === 0) {
        return res.status(400).json({ error: 'Choisis d’abord un contrat — ses champs pilotent le mappage.' });
      }
      const mapping = req.body && typeof req.body.mapping === 'object' && req.body.mapping !== null
        ? req.body.mapping
        : null;
      if (!mapping) return res.status(400).json({ error: 'Mappage manquant.' });
      const validation = validateMapping(mapping, fields);
      if (!validation.ok) {
        return res.status(422).json({ code: 'MAPPING_INVALID', errors: validation.errors });
      }
      settingsModel.upsert({ neatFieldMappingJson: JSON.stringify(mapping) });
      return this.getSettings(req, res);
    },

    // POST /api/neat/reservations/:id/retry — make the job due and run a pass right now.
    async retry(req, res) {
      const reservationId = Number(req.params.id);
      const cfg = currentConfig();
      const job = model.getByReservationId(reservationId, cfg.environment);
      if (!job) return res.status(404).json({ error: 'Aucune souscription Neat pour cette réservation.' });
      if (job.status === 'active' || job.status === 'voided') {
        return res.status(409).json({ error: 'Cette souscription n’est pas en échec.' });
      }
      model.makeDue(job.id);
      await runPass('retry');
      const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
      return res.json({ neat: this.buildFicheBlock(reservation) });
    },

    // POST /api/neat/reservations/:id/void — always a manual act (spec rule 15).
    async void(req, res) {
      const reservationId = Number(req.params.id);
      const cfg = currentConfig();
      const job = model.getByReservationId(reservationId, cfg.environment);
      if (!job || job.status !== 'active' || !job.neatSubscriptionId) {
        return res.status(409).json({ error: 'Aucune souscription Neat active à résilier.' });
      }
      try {
        await clientFromConfig(cfg).voidSubscription(job.neatSubscriptionId);
        model.markVoided(job.id);
        const reservation = db.prepare('SELECT * FROM reservations WHERE id = ?').get(reservationId);
        return res.json({ neat: this.buildFicheBlock(reservation) });
      } catch (err) {
        return res.status(502).json({ error: `Résiliation Neat impossible : ${err.message}` });
      }
    },

    /**
     * The fiche's `neat` block (spec rules 14-16) — null when there is nothing to show: feature
     * unconfigured with no job, platform reservation, or no insurance and no job. `reservation`
     * is the full row (or the getByIdWithDetails payload — both carry what this needs).
     */
    buildFicheBlock(reservation) {
      if (!reservation) return null;
      if (!isDirectChannel(reservation.platform)) return null;
      // A test double without the neat model (or a legacy DB before the migration ran) has no jobs.
      if (!model || typeof model.getByReservationId !== 'function') return null;
      const cfg = currentConfig();
      const job = model.getByReservationId(reservation.id, cfg.environment);
      if (!job) return null;
      const hasInsuranceLine = Boolean(db.prepare(`
        SELECT 1 FROM reservation_options ro
        JOIN options o ON o.id = ro.optionId
        WHERE ro.reservationId = ? AND o.isCancellationInsurance = 1
      `).get(reservation.id));
      const status = job.status === 'active' && !hasInsuranceLine ? 'line_removed_active' : job.status;
      return {
        status,
        environment: job.environment,
        neatId: job.neatSubscriptionId || null,
        premiumAmount: job.premiumAmount ?? null,
        billedAmount: job.billedAmount ?? null,
        marginPercent: cfg.marginPercent,
        lastError: job.lastError || null,
        errorKind: job.errorKind || null,
        attempts: Number(job.attempts || 0),
        nextAttemptAt: job.nextAttemptAt || null,
        updatedAt: job.updatedAt || null,
      };
    },
  };
}

const defaultController = createNeatController();
defaultController.createNeatController = createNeatController;
defaultController.externalIdFor = externalIdFor;

module.exports = defaultController;
