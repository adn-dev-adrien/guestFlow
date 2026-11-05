/**
 * `GET/PUT /api/guest-app/lodgings/:propertyId` — the per-lodging configuration (specs/guest-app.md rules
 * 11bis-11quater). Admin only: the guard refuses every role but admin on a path no role has listed. The
 * boundary validates everything; French messages reach the operator as they are.
 */

const { readModules, modulesInputError } = require('../modules');
const { lodgingUrl, renderQrPoster } = require('../qrPoster');

const MAX = Object.freeze({
  displayName: 80, network: 64, password: 128, note: 200, contacts: 10, contactName: 80, contactRole: 80, phone: 30, email: 120,
});

const isBoundedText = (value, max) => typeof value === 'string' && value.length <= max;

function wifiInputError(wifi) {
  if (!wifi || typeof wifi !== 'object' || Array.isArray(wifi)) return 'Le wifi est invalide.';
  if (typeof wifi.available !== 'boolean') return 'Indiquez si le wifi est disponible.';
  if (wifi.network !== undefined && !isBoundedText(wifi.network, MAX.network)) return 'Le nom du réseau est trop long.';
  if (wifi.password !== undefined && !isBoundedText(wifi.password, MAX.password)) return 'Le mot de passe est trop long.';
  if (wifi.note !== undefined && !isBoundedText(wifi.note, MAX.note)) return 'La note est trop longue.';
  if (wifi.available && !String(wifi.network || '').trim()) return 'Le nom du réseau est obligatoire quand le wifi est disponible.';
  return null;
}

function contactsInputError(contacts) {
  if (!Array.isArray(contacts) || contacts.length > MAX.contacts) return 'La liste des contacts est invalide.';
  const bad = contacts.some((c) => !c || typeof c !== 'object'
    || !isBoundedText(c.name, MAX.contactName) || !c.name.trim()
    || (c.role !== undefined && !isBoundedText(c.role, MAX.contactRole))
    || (c.phone !== undefined && !isBoundedText(c.phone, MAX.phone))
    || (c.whatsapp !== undefined && !isBoundedText(c.whatsapp, MAX.phone))
    || (c.email !== undefined && !isBoundedText(c.email, MAX.email)));
  return bad ? 'Un contact est invalide.' : null;
}

/** → an error message or null. Only the keys present are judged: a screen saves its own. */
function lodgingInputError(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Requête invalide.';
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return 'Indiquez si le logement est dans l’application.';
  if (body.displayName !== undefined && body.displayName !== null && !isBoundedText(body.displayName, MAX.displayName)) return 'Le nom affiché est trop long.';
  if (body.heroMediaId !== undefined && body.heroMediaId !== null && !(Number.isInteger(body.heroMediaId) && body.heroMediaId > 0)) return 'La photo est invalide.';
  if (body.modules !== undefined) {
    const error = modulesInputError(body.modules);
    if (error) return error;
  }
  if (body.wifi !== undefined) {
    const error = wifiInputError(body.wifi);
    if (error) return error;
  }
  if (body.contacts !== undefined) {
    const error = contactsInputError(body.contacts);
    if (error) return error;
  }
  return null;
}

const toView = (lodging) => ({
  propertyId: lodging.propertyId,
  enabled: lodging.enabled,
  hasLodgingCode: lodging.hasLodgingCode,
  displayName: lodging.displayName,
  name: lodging.name,
  heroMediaId: lodging.heroMediaId,
  modules: readModules(lodging.modules),
  wifi: lodging.wifi,
  contacts: lodging.contacts,
});

function buildLodgingsController({
  lodgings, booklet, appName, guestHost, now,
}) {
  const propertyIdOf = (req) => {
    const id = Number(req.params.propertyId);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  function read(req, res) {
    const id = propertyIdOf(req);
    if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
    const lodging = lodgings().get(id);
    if (!lodging) return res.status(404).json({ error: 'Logement introuvable' });
    return res.json(toView(lodging));
  }

  function write(req, res) {
    const id = propertyIdOf(req);
    if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
    const error = lodgingInputError(req.body);
    if (error) return res.status(400).json({ error });
    const { enabled, displayName, heroMediaId, modules, wifi, contacts } = req.body;
    const before = lodgings().get(id);
    const saved = lodgings().save(id, { enabled, displayName, heroMediaId, modules, wifi, contacts });
    if (!saved) return res.status(404).json({ error: 'Logement introuvable' });
    // §9 Q1 — a lodging entering the app for the first time starts with the neutral pages.
    if (saved.enabled && !before.enabled) booklet().seedPlaceholders(id, now());
    return res.json(toView(saved));
  }

  /** The enabled lodging the URL names, or the error answered (rule 11quater: a lodging off has no QR code). */
  function enabledLodging(req, res) {
    const id = propertyIdOf(req);
    if (!id) { res.status(400).json({ error: 'Identifiant invalide' }); return null; }
    const lodging = lodgings().get(id);
    if (!lodging) { res.status(404).json({ error: 'Logement introuvable' }); return null; }
    if (!lodging.enabled) { res.status(409).json({ error: 'Ce logement n’est pas dans l’application : il n’a pas de code QR.' }); return null; }
    return lodging;
  }

  // POST /lodgings/:propertyId/regenerate-qr — rule 1: the old code is dead at once, the posters with it.
  function regenerateQr(req, res) {
    const lodging = enabledLodging(req, res);
    if (!lodging) return null;
    lodgings().regenerateCode(lodging.propertyId);
    return res.json(toView(lodgings().get(lodging.propertyId)));
  }

  // GET /lodgings/:propertyId/qr-poster.pdf — rule 48: the A4 poster of the lodging's current code.
  async function qrPoster(req, res, next) {
    const lodging = enabledLodging(req, res);
    if (!lodging) return null;
    const host = guestHost();
    if (!host) return res.status(409).json({ error: 'Renseignez d’abord l’adresse de l’application (Paramètres › Intégrations).' });
    try {
      const pdf = await renderQrPoster({
        appName: appName() || 'Mon séjour',
        lodgingName: lodging.name,
        url: lodgingUrl(host, lodgings().codeOf(lodging.propertyId)),
      });
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="qr-${lodging.slug || lodging.propertyId}.pdf"`,
        'Cache-Control': 'no-store',
      });
      return res.send(pdf);
    } catch (error) {
      return next(error);
    }
  }

  return {
    qrPoster, read, regenerateQr, write,
  };
}

module.exports = { buildLodgingsController, lodgingInputError };
