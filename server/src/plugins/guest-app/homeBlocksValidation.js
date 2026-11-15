/**
 * Rule 14 of specs/guest-app-home-automation.md — what Studio may save for a lodging's « Domotique » page. Pure: the
 * submitted blocks and the catalogue in, `{ ok: true, blocks }` or `{ ok: false, errors: { 'blocks.1.items.2.label':
 * '…' } }` out, every error at once so the page shows them all.
 */

const crypto = require('crypto');
const { KINDS, LIST_KINDS, MAX_ITEMS, fits } = require('./homeRoles');

const MAX_LABEL = 24;
const ID_RE = /^[a-z0-9]{6,16}$/;

const newItemId = () => crypto.randomBytes(5).toString('hex');

function validateHomeBlocks(input, catalog, makeId = newItemId) {
  const errors = {};
  if (!Array.isArray(input) || input.length !== KINDS.length) {
    return { ok: false, errors: { blocks: 'La liste des blocs est incomplète.' } };
  }
  const kinds = input.map((b) => b && b.kind);
  if (kinds.some((k) => !KINDS.includes(k)) || new Set(kinds).size !== KINDS.length) {
    return { ok: false, errors: { blocks: 'Bloc inconnu ou en double.' } };
  }
  const byId = new Map(catalog.map((e) => [e.id, e]));

  const blocks = input.map((raw, bi) => {
    const at = `blocks.${bi}`;
    const on = raw.on === true;
    if (!LIST_KINDS.includes(raw.kind)) {
      const equipmentId = typeof raw.equipmentId === 'string' && raw.equipmentId ? raw.equipmentId : null;
      if (equipmentId && !fits(raw.kind, byId.get(equipmentId))) errors[`${at}.equipmentId`] = 'Équipement qui ne convient pas à ce bloc.';
      else if (on && !equipmentId) errors[`${at}.equipmentId`] = 'Choisir un équipement.';
      return { kind: raw.kind, on, equipmentId, items: [] };
    }

    const list = Array.isArray(raw.items) ? raw.items : [];
    const max = MAX_ITEMS[raw.kind];
    if (list.length > max) errors[`${at}.items`] = raw.kind === 'rooms' ? `${max} pièces au plus.` : `${max} lumières au plus.`;
    else if (on && list.length === 0) errors[`${at}.items`] = raw.kind === 'rooms' ? 'Ajouter au moins une pièce, ou couper le bloc.' : 'Ajouter au moins une lumière, ou couper le bloc.';

    const seen = new Set();
    const usedIds = new Set();
    const items = list.slice(0, max).map((rawItem, ii) => {
      const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
      const iat = `${at}.items.${ii}`;
      const label = typeof item.label === 'string' ? item.label.trim() : '';
      if (!label) errors[`${iat}.label`] = 'Nom requis.';
      else if (label.length > MAX_LABEL) errors[`${iat}.label`] = `Trop long : ${label.length} caractères sur ${MAX_LABEL}.`;
      const equipmentId = typeof item.equipmentId === 'string' && item.equipmentId ? item.equipmentId : null;
      const entry = byId.get(equipmentId);
      if (!equipmentId) errors[`${iat}.equipmentId`] = 'Choisir un équipement.';
      else if (seen.has(equipmentId)) errors[`${iat}.equipmentId`] = 'Déjà utilisé dans cette liste.';
      else if (!fits(raw.kind, entry)) errors[`${iat}.equipmentId`] = 'Équipement qui ne convient pas à ce bloc.';
      if (equipmentId) seen.add(equipmentId);
      let id = typeof item.id === 'string' && ID_RE.test(item.id) && !usedIds.has(item.id) ? item.id : makeId();
      while (usedIds.has(id)) id = makeId();
      usedIds.add(id);
      if (raw.kind === 'rooms') return { id, label, equipmentId };
      const pilotable = item.pilotable === true;
      if (pilotable && entry && !entry.guestSwitchable) errors[`${iat}.pilotable`] = 'Non confiée aux voyageurs dans Sowel.';
      return { id, label, equipmentId, pilotable };
    });
    return { kind: raw.kind, on, equipmentId: null, items };
  });

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, blocks };
}

module.exports = { validateHomeBlocks, MAX_LABEL };
