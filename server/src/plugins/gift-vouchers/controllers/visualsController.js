/**
 * `/api/gift-vouchers/visuals` — the visual library (specs/gift-voucher-campaigns.md rules 47-48, §4.4). Thin: the image is judged by `visualImages`, the rows are kept by
 * `visualsModel`. Replacing the image adds a version; deleting is refused while an on-sale campaign uses the visual and otherwise only takes it out of the library — the
 * vouchers already issued keep the version they carry.
 */

const multer = require('multer');
const images = require('../visualImages');
const { USES } = require('../models/visualsModel');
const rules = require('../voucherRules');

const MAX_NAME = 80;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: images.MAX_UPLOAD_BYTES, files: 1, fields: 4, fieldSize: 1024,
  },
});

/** Reads one optional `file` and the text fields of a multipart body; a JSON body passes through. */
function receive(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();
    const message = error.code === 'LIMIT_FILE_SIZE'
      ? `Image trop volumineuse (${images.MAX_UPLOAD_BYTES / 1024 / 1024} Mo au plus).`
      : 'Une seule image à la fois, avec son nom et son usage.';
    return res.status(400).json({ error: message, code: 'UPLOAD_INVALID' });
  });
}

function buildVisualsController({
  visuals, filesDir, now = () => new Date(),
}) {
  const idOf = (req) => { const n = Number(req.params.id); return Number.isInteger(n) && n > 0 ? n : null; };
  const today = () => rules.parisDate(now());
  const notFound = (res) => res.status(404).json({ error: 'Visuel introuvable.', code: 'VISUAL_NOT_FOUND' });
  const bad = (res, message, code = 'VISUAL_INVALID') => res.status(422).json({ error: message, code });
  const found = (req) => {
    const visual = idOf(req) ? visuals.find(idOf(req)) : null;
    return visual && !visual.deletedAt ? visual : null;
  };

  const present = (visual) => ({
    id: visual.id,
    name: visual.name,
    use: visual.use,
    createdAt: visual.createdAt,
    versionId: visual.current.id,
    versions: visuals.versionCount(visual.id),
    width: visual.current.width,
    height: visual.current.height,
    campaigns: visuals.campaignsUsing(visual.id).map(({ id, name, state }) => ({ id, name, state })),
    validVouchers: visuals.validVouchersCarrying(visual.id, today()),
  });

  const nameProblem = (value) => (typeof value === 'string' && value.trim() && value.trim().length <= MAX_NAME ? null : `Nom : un texte de 1 à ${MAX_NAME} caractères est attendu.`);
  const useProblem = (value) => (USES.includes(value) ? null : 'Usage : face du bon, face de la carte commerçant, ou les deux.');

  /** Judges and stores an uploaded file. → `{ file }` or `{ message }`. */
  async function accept(req) {
    if (!req.file) return { message: 'Une image est attendue.' };
    const checked = await images.inspect(req.file.buffer);
    if (!checked.ok) return { message: checked.message };
    return {
      file: { path: images.store(req.file.buffer, filesDir(), checked.format), width: checked.width, height: checked.height },
    };
  }

  const list = (req, res) => res.json({ items: visuals.list().map(present) });

  const read = (req, res) => {
    const visual = found(req);
    return visual ? res.json(present(visual)) : notFound(res);
  };

  const create = async (req, res) => {
    const body = req.body || {};
    const problem = nameProblem(body.name) || useProblem(body.use);
    if (problem) return bad(res, problem);
    const stored = await accept(req);
    if (stored.message) return bad(res, stored.message, 'IMAGE_REFUSED');
    const id = visuals.insert({ name: body.name.trim(), use: body.use, file: stored.file });
    return res.status(201).json(present(visuals.find(id)));
  };

  const update = async (req, res) => {
    const visual = found(req);
    if (!visual) return notFound(res);
    const body = req.body || {};
    const name = body.name === undefined ? visual.name : body.name;
    const use = body.use === undefined ? visual.use : body.use;
    const problem = nameProblem(name) || useProblem(use);
    if (problem) return bad(res, problem);
    const cannotServe = (c) => (c.voucherVisualId === visual.id && use === 'merchant') || (c.merchantVisualId === visual.id && use === 'voucher');
    const relying = visuals.campaignsUsing(visual.id).find((c) => c.state === 'on_sale' && cannotServe(c));
    if (relying) return bad(res, `Utilisé par la campagne en vente « ${relying.name} ». Retirez-le de la campagne d’abord.`, 'VISUAL_IN_USE');
    if (req.file) {
      const stored = await accept(req);
      if (stored.message) return bad(res, stored.message, 'IMAGE_REFUSED');
      visuals.addVersion(visual.id, stored.file);
    }
    visuals.rename(visual.id, { name: name.trim(), use });
    return res.json(present(visuals.find(visual.id)));
  };

  const remove = (req, res) => {
    const visual = found(req);
    if (!visual) return notFound(res);
    const using = visuals.campaignsUsing(visual.id).find((c) => c.state === 'on_sale');
    if (using) return bad(res, `Utilisé par la campagne en vente « ${using.name} ». Retirez-le de la campagne d’abord.`, 'VISUAL_IN_USE');
    visuals.softDelete(visual.id);
    return res.status(204).end();
  };

  /** The visual's image for the admin screens: a thumbnail by default, the file as uploaded with `?full=1`, a given version with `?version=`. */
  const image = async (req, res) => {
    const visual = found(req);
    if (!visual) return notFound(res);
    const asked = req.query.version === undefined ? visual.current : visuals.versionById(req.query.version);
    if (!asked || asked.visualId !== visual.id || asked.purgedAt) return notFound(res);
    let bytes;
    try {
      bytes = images.read(filesDir(), asked.path);
    } catch {
      return notFound(res);
    }
    res.set({ 'Cache-Control': 'private, max-age=300' });
    if (req.query.full === '1') return res.type(asked.path.endsWith('.png') ? 'image/png' : 'image/jpeg').send(bytes);
    return res.type('image/jpeg').send(await images.thumbnail(bytes));
  };

  return {
    list, read, create, update, remove, image,
  };
}

module.exports = { buildVisualsController, receive };
