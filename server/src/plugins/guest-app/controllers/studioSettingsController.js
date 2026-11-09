/**
 * The studio's lodging switcher and Réglages (specs/guest-app.md rules 41bis, 48). Admin only.
 *
 *   GET  /api/guest-app/studio/lodgings        rule 48 — every GuestFlow property, its live name, in or out of the app
 *   GET  /api/guest-app/studio/settings        the app settings, with the Soliomap sync state
 *   PUT  /api/guest-app/studio/settings        the keys sent, judged together (« À retirer » needs its place)
 *   POST /api/guest-app/studio/soliomap/sync   rule 48 — « Synchroniser »: the Soliomap feed read again now
 *
 * Nothing of GuestFlow is cached here: the properties, their names, the articles are read on every load. Only the
 * Soliomap feed, which lives outside GuestFlow, is (rule 15bis).
 */

const { DECLARED, MAX_PICKUP_PLACE } = require('../settings');

const KEYS = Object.freeze(['appName', 'guestHost', 'soliomapUrl', 'soliomapEmbed', 'maxOrderTotal', 'fulfilment', 'pickupPlace']);
const OUT_OF_APP = 'Hors application';

const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

/** « à l'instant », « il y a 2 min », « il y a 3 h », « le 6 nov. ». */
function agoLabel(at, now) {
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return 'Synchronisé à l’instant';
  if (minutes < 60) return `Synchronisé il y a ${minutes} min`;
  if (minutes < 24 * 60) return `Synchronisé il y a ${Math.floor(minutes / 60)} h`;
  return `Synchronisé le ${new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' }).format(at)}`;
}

function syncView(last, now) {
  if (!last) return { syncedAt: null, syncedLabel: 'Pas encore synchronisé', ok: null, count: null };
  return {
    syncedAt: last.at.toISOString(),
    syncedLabel: last.ok ? agoLabel(last.at, now) : `Soliomap injoignable — ${agoLabel(last.at, now).toLowerCase()}`,
    ok: last.ok,
    count: last.count,
  };
}

function buildStudioSettingsController({
  lodgings, settingsStore, soliomapFeed, now,
}) {
  // A feed handed by a suite may know only `activities()`: it has never synchronised, and refreshes by reading.
  const lastSync = () => (typeof soliomapFeed.lastSync === 'function' ? soliomapFeed.lastSync() : null);
  const refresh = () => (typeof soliomapFeed.refresh === 'function' ? soliomapFeed.refresh() : soliomapFeed.activities());

  function lodgingsList(req, res) {
    return res.json({
      lodgings: lodgings().listAll().map((l) => ({
        propertyId: l.propertyId,
        name: l.name,
        enabled: l.enabled,
        hasLodgingCode: l.hasLodgingCode,
        stateLabel: l.enabled ? null : OUT_OF_APP,
      })),
    });
  }

  function view() {
    const get = (key) => settingsStore().get(key);
    return {
      appName: get('appName') || '',
      guestHost: get('guestHost') || '',
      soliomapUrl: get('soliomapUrl') || '',
      soliomapEmbed: truthy(get('soliomapEmbed')),
      maxOrderTotal: Number(get('maxOrderTotal')) || 500,
      fulfilment: get('fulfilment') === 'pickup' ? 'pickup' : 'delivery',
      pickupPlace: get('pickupPlace') || '',
      soliomap: syncView(lastSync(), now()),
    };
  }

  function read(req, res) {
    return res.json(view());
  }

  /** The stored shape of a key, after its own check. */
  const stored = (key, value) => {
    if (key === 'soliomapEmbed') return value ? '1' : '0';
    if (value === null || value === undefined) return null;
    return typeof value === 'string' ? value.trim() : String(value);
  };

  function write(req, res) {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return res.status(400).json({ error: 'Requête invalide.' });
    if (Object.keys(body).some((key) => !KEYS.includes(key))) return res.status(400).json({ error: 'Réglage inconnu.' });
    if (body.soliomapEmbed !== undefined && typeof body.soliomapEmbed !== 'boolean') return res.status(400).json({ error: 'Indiquez si Soliomap est intégré.' });
    if (body.pickupPlace !== undefined && body.pickupPlace !== null && typeof body.pickupPlace !== 'string') return res.status(400).json({ error: `Le lieu de retrait fait au plus ${MAX_PICKUP_PLACE} caractères.` });
    const patch = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, stored(key, value)]));
    const failed = Object.entries(patch).map(([key, value]) => {
      const declared = DECLARED.find((d) => d.key === key);
      return declared && declared.validate ? declared.validate(value) : null;
    }).find(Boolean);
    if (failed) return res.status(400).json({ error: failed });
    // Rule 41bis — « À retirer » asks for the pickup place, required to save.
    const mode = patch.fulfilment !== undefined ? patch.fulfilment : settingsStore().get('fulfilment');
    const place = patch.pickupPlace !== undefined ? patch.pickupPlace : settingsStore().get('pickupPlace');
    if (mode === 'pickup' && !String(place || '').trim()) return res.status(400).json({ error: 'Indiquez le lieu de retrait des commandes.' });
    Object.entries(patch).forEach(([key, value]) => settingsStore().set(key, value));
    return res.json(view());
  }

  async function sync(req, res) {
    if (!settingsStore().get('soliomapUrl')) return res.status(409).json({ error: 'Renseignez d’abord l’adresse de Soliomap.' });
    await refresh();
    return res.json(view().soliomap);
  }

  return {
    lodgingsList, read, sync, write,
  };
}

module.exports = { buildStudioSettingsController, agoLabel };
