/**
 * Pure bed-distribution suggestion: place adults in double beds first, children/teens in single beds
 * first, then fill remaining beds to maximize accommodation. Never exceeds configured bed counts.
 */
function suggestBedDistribution({
  adults,
  children,
  teens,
  maxSingleBeds,
  maxDoubleBeds,
}) {
  const safeAdults = Math.max(0, Number(adults) || 0);
  const safeChildren = Math.max(0, Number(children) || 0);
  const safeTeens = Math.max(0, Number(teens) || 0);
  const safeMaxSingle = Math.max(0, Number(maxSingleBeds) || 0);
  const safeMaxDouble = Math.max(0, Number(maxDoubleBeds) || 0);

  let remainingAdults = safeAdults;
  let remainingChildrenTeens = safeChildren + safeTeens;
  let singleBeds = 0;
  let doubleBeds = 0;

  // Adults first in double beds (2 per bed) as requested.
  const adultsInDouble = Math.min(safeMaxDouble, Math.ceil(remainingAdults / 2));
  doubleBeds += adultsInDouble;
  remainingAdults = Math.max(0, remainingAdults - adultsInDouble * 2);

  // Children + teens first in single beds as requested.
  const childrenTeensInSingle = Math.min(safeMaxSingle, remainingChildrenTeens);
  singleBeds += childrenTeensInSingle;
  remainingChildrenTeens = Math.max(0, remainingChildrenTeens - childrenTeensInSingle);

  // Then place remaining adults in remaining single beds.
  const singleBedsLeft = Math.max(0, safeMaxSingle - singleBeds);
  const adultsInSingle = Math.min(singleBedsLeft, remainingAdults);
  singleBeds += adultsInSingle;
  remainingAdults = Math.max(0, remainingAdults - adultsInSingle);

  // Finally, use remaining double beds to maximize accommodation.
  const peopleLeft = remainingAdults + remainingChildrenTeens;
  const doubleBedsLeft = Math.max(0, safeMaxDouble - doubleBeds);
  const fallbackInDouble = Math.min(doubleBedsLeft, Math.ceil(peopleLeft / 2));
  doubleBeds += fallbackInDouble;

  return {
    singleBeds,
    doubleBeds,
    unassignedPeople: Math.max(0, peopleLeft - fallbackInDouble * 2),
  };
}

module.exports = { suggestBedDistribution };
