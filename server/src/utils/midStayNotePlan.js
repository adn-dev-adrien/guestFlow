/**
 * What a « Nouvelle note » collects (specs/mid-stay-notes.md rule 22, audit 2026-10-27). Pure.
 *
 * The dialog sends only the keys the operator ticked and the remainder it opened on; the amounts are
 * derived here, per key:
 *   added  = max(0, current − opening)          — what the dialog sold on top (catalogue additions)
 *   ticked = ticked ? min(opening, current) : 0  — what was already due and is paid now
 *   amount = ticked + added
 * `current` is the remainder after the sale: the live quote's `midStayExtrasLines` for the preview,
 * the stored mid-stay lines of the fiche (saved first) for the settlement.
 */

const { extraLineKey } = require('./midStayExtras');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function byKey(lines) {
  const out = new Map();
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    if (!line) return;
    const key = String(line.key || extraLineKey(line) || '');
    if (!key) return;
    const prev = out.get(key);
    out.set(key, { label: (prev && prev.label) || line.label || null, amount: round2((prev ? prev.amount : 0) + Number(line.amount || 0)) });
  });
  return out;
}

/**
 * @param {object} p
 * @param {Array<{key, amount, label?}>} p.opening the remainder when the dialog opened
 * @param {Array<{key, amount, label?}>} p.current the remainder after the dialog's additions
 * @param {string[]} p.checkedKeys the ticked « À percevoir » lines
 * @returns {{ items: Array<{key, label, amount}>, total: number }}
 */
function planMidStayNote({ opening = [], current = [], checkedKeys = [] } = {}) {
  const base = byKey(opening);
  const live = byKey(current);
  const checked = new Set((Array.isArray(checkedKeys) ? checkedKeys : []).map(String));
  const items = [];
  new Set([...live.keys(), ...checked]).forEach((key) => {
    const b = base.has(key) ? base.get(key).amount : 0;
    const l = live.has(key) ? live.get(key).amount : 0;
    const added = Math.max(0, round2(l - b));
    const ticked = checked.has(key) ? Math.max(0, Math.min(b, l)) : 0;
    const amount = round2(ticked + added);
    if (amount <= 0) return;
    const label = (base.get(key) && base.get(key).label) || (live.get(key) && live.get(key).label) || 'Prestation';
    items.push({ key, label, amount });
  });
  return { items, total: round2(items.reduce((s, i) => s + i.amount, 0)) };
}

module.exports = { planMidStayNote };
