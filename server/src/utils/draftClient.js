/**
 * A client typed on the fiche is written with the stay, never before (specs/clients.md rule 13).
 *
 * The fiche used to save « Créer un nouveau client » at once: a fiche abandoned afterwards left a
 * client with no stay, and three tries left three copies. The fiche now sends the typed client as
 * `newClient` with the reservation or devis it belongs to; this runs the save and the client insert as
 * one transaction, so a refused save leaves no client behind.
 *
 * `run(body)` is the save itself and answers `{ status, body }`. A body that already names a client,
 * or carries no draft, is passed through untouched.
 */

const { validateClientPayload } = require('./clientValidation');
const { clientExistsRefusal } = require('./clientDuplicates');

class SaveRefused extends Error {
  constructor(result) {
    super('save refused');
    this.result = result;
  }
}

function saveWithDraftClient({ db, clientsModel, body, run }) {
  const draft = body && !body.clientId && body.newClient && typeof body.newClient === 'object' ? body.newClient : null;
  if (!draft) return run(body);
  if (!String(draft.lastName || '').trim() || !String(draft.firstName || '').trim()) {
    return { status: 400, body: { error: 'Nom et prénom du client requis.' } };
  }
  const invalid = validateClientPayload(draft);
  if (invalid) return { status: 400, body: { error: invalid } };
  if (!draft.allowDuplicate) {
    const existing = clientsModel.findDuplicate(draft);
    if (existing) return { status: 409, body: clientExistsRefusal(existing) };
  }
  const { newClient, ...rest } = body;
  try {
    return db.transaction(() => {
      const client = clientsModel.insert(draft);
      const result = run({ ...rest, clientId: client.id });
      if (!result || result.status >= 300) throw new SaveRefused(result);
      return result;
    })();
  } catch (err) {
    if (err instanceof SaveRefused) return err.result;
    throw err;
  }
}

module.exports = { saveWithDraftClient };
