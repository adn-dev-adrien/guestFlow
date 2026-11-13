/**
 * Keys of `editLock.arrivalLines` (specs/mid-stay-extras-on-locked-fiche.md rule 13): `opt:<id>` and
 * `res:<id>` for the first line of an article, `line:<table>:<lineId>` for a later sale of the same article
 * (specs/pricing-components.md §3 rule 85, mirror of the server's `utils/pricing/lineKeys.js`: pass the
 * line, which carries `lineKey` when it is not the article's first). Custom lines are frozen by id
 * (`editLock.frozenCustomOptionIds`), never by label.
 */
export const optionLineKey = (optionId, line) => (line && line.lineKey ? String(line.lineKey) : `opt:${Number(optionId)}`);

export const resourceLineKey = (resourceId, line) => (line && line.lineKey ? String(line.lineKey) : `res:${Number(resourceId)}`);

// The floor, in the unit the quantity field shows. Whole units unless the line is billed by the hour,
// so a conversion never prints « 2.01 ».
export const displayedFloor = (displayedValue, hourly = false) => (
  hourly ? displayedValue : Math.ceil(Math.round(displayedValue * 1e6) / 1e6)
);
