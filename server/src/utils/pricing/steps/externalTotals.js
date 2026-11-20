/**
 * STEP totals (external) — the lines of an external sale, ready to store and to render, and their total (specs/pricing-components.md §3 rules 52, 74).
 *
 * `lines` are the document's lines in sale order — the stored ones as they were frozen, then a fulfilled line (the session of a visit) as its family
 * priced it, then the new articles as the head priced them — each in
 * cents with its VAT class, its rate and its VAT share. `catalogueCents` keeps the value of an offered line for the struck display (rule 14).
 * `totalCents` is what the lines ask once offered and cancelled lines count for nothing; `vatByRate` is the document's VAT per rate.
 */
const { toCents } = require('../money');
const articles = require('../articles');

function newLine(quoted, vat) {
  const figures = quoted.figures || {};
  const offered = quoted.offeredFigures || {};
  const { label, detail } = articles.describe(quoted);
  const isOffered = Boolean(offered.offered);
  return {
    articleRef: quoted.ref,
    kind: 'extra',
    family: quoted.family,
    label,
    detail,
    quantity: Number(figures.quantity || 0),
    unitCents: toCents(figures.unitPrice),
    totalCents: toCents(offered.totalPrice),
    catalogueCents: toCents(isOffered ? offered.originalTotalPrice : offered.totalPrice),
    offered: isOffered,
    cancelled: false,
    vatClass: vat.vatClass,
    vatRate: vat.rate,
    components: quoted.components || [],
    isNew: true,
  };
}

const step = {
  id: 'externalTotals',
  requires: ['quoted', 'fulfilments', 'stored', 'familyVat', 'vatRefusals'],
  provides: ['lines', 'totalCents', 'vatByRate'],
  apply(ctx) {
    const { amounts, slots } = ctx.familyVat;
    const stored = ctx.stored.map((line, index) => ({ ...line, vatCents: amounts[index].vatCents, netCents: amounts[index].netCents }));
    const added = [];
    ctx.fulfilments.forEach((line, index) => {
      const slot = ctx.familyVat.fulfilmentSlots[index];
      if (slot == null) return;
      const vat = amounts[slot];
      added.push({
        articleRef: line.articleRef,
        kind: 'session',
        family: line.family || 'hourly',
        label: line.label,
        detail: line.detail == null ? null : line.detail,
        quantity: Number(line.quantity == null ? 1 : line.quantity),
        unitCents: Number(line.unitCents == null ? line.totalCents : line.unitCents),
        totalCents: line.offered ? 0 : line.totalCents,
        catalogueCents: line.catalogueCents == null ? line.totalCents : line.catalogueCents,
        offered: Boolean(line.offered),
        cancelled: false,
        vatClass: vat.vatClass,
        vatRate: vat.rate,
        components: line.components || [],
        fulfilmentRef: line.fulfilmentRef,
        isNew: true,
        vatCents: vat.vatCents,
        netCents: vat.netCents,
      });
    });
    ctx.quoted.forEach((quoted, index) => {
      if (!quoted || slots[index] == null) return;
      const vat = amounts[slots[index]];
      added.push({ ...newLine(quoted, vat), vatCents: vat.vatCents, netCents: vat.netCents });
    });
    const lines = [...stored, ...added];
    const totalCents = lines.reduce((sum, line) => sum + (line.offered || line.cancelled ? 0 : line.totalCents), 0);
    const byRate = new Map();
    for (const group of ctx.familyVat.groups) {
      const row = byRate.get(group.rate) || { rate: group.rate, vatCents: 0, netCents: 0 };
      row.vatCents += group.vatCents;
      row.netCents += group.netCents;
      byRate.set(group.rate, row);
    }
    return { ...ctx, lines, totalCents, vatByRate: [...byRate.values()].sort((a, b) => a.rate - b.rate) };
  },
};

module.exports = step;
