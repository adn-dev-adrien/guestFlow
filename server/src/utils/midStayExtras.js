const {
  MID_STAY_SOURCE, ARRIVAL_COMPLEMENT_EXCESS_KEY, ARRIVAL_COMPLEMENT_EXCESS_LABEL, extraLineKey, buildExtrasBaseline, arrivalBaselineOf,
  splitMidStayExtras, splitFromStoredLines, resolveMidStaySplit, buildMidStayLine, parseNotes, parseDetail, settledByKey,
  notesTotal, nextNoteId, mergeMidStayIntoDetail, sasDetailAmount, sasDetailAmountAuto, storedMidStayLines, parseBaseline,
} = require('./pricing/settlement');

// guest-app rule 113 a, pricing-components rule 23 (loop t5 A5-1, t6 A6-2) — a note paid online (an app or shop card order, a payment link:
// `method 'card'`) is money the register gives back: never put back to the departure, its amount and its means never changed (only its date).
// → the reason the fiche shows, or null.
const NOTE_PAID_ONLINE_REASON = 'Payée en ligne : offrir la ligne, puis rembourser.';
function notePaidOnlineReason(note) {
  return note && note.method === 'card' ? NOTE_PAID_ONLINE_REASON : null;
}
// The fiche's locks on its notes, served with the stay: { [noteId]: reason } for the notes the operator cannot adjust nor put back.
function midStayNoteLocks(notesJson) {
  const locks = {};
  for (const note of parseNotes(notesJson)) {
    const reason = notePaidOnlineReason(note);
    if (reason && note.id != null) locks[note.id] = reason;
  }
  return locks;
}

module.exports = {
  MID_STAY_SOURCE,
  ARRIVAL_COMPLEMENT_EXCESS_KEY,
  ARRIVAL_COMPLEMENT_EXCESS_LABEL,
  extraLineKey,
  buildExtrasBaseline,
  arrivalBaselineOf,
  splitMidStayExtras,
  splitFromStoredLines,
  resolveMidStaySplit,
  buildMidStayLine,
  parseNotes,
  parseDetail,
  settledByKey,
  notesTotal,
  nextNoteId,
  mergeMidStayIntoDetail,
  sasDetailAmount,
  sasDetailAmountAuto,
  storedMidStayLines,
  parseBaseline,
  notePaidOnlineReason,
  midStayNoteLocks,
};
