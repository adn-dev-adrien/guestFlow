/**
 * Keys of `editLock.arrivalLines` (specs/mid-stay-extras-on-locked-fiche.md rule 13): `opt:<id>` and
 * `res:<id>`. Custom lines are frozen by id (`editLock.frozenCustomOptionIds`), never by label.
 */
export const optionLineKey = (optionId) => `opt:${Number(optionId)}`;

export const resourceLineKey = (resourceId) => `res:${Number(resourceId)}`;

// The floor, in the unit the quantity field shows. Whole units unless the line is billed by the hour,
// so a conversion never prints « 2.01 ».
export const displayedFloor = (displayedValue, hourly = false) => (
  hourly ? displayedValue : Math.ceil(Math.round(displayedValue * 1e6) / 1e6)
);
