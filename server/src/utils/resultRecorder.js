/**
 * A stand-in for an Express `res` that only records what a handler answered, so the handler's work can
 * be called from the server itself (`performUpdate`, specs/gites-de-france-mail-intake.md §4.1).
 * Supports `res.status(n).json(body)` and `res.json(body)`; `result()` returns `{ status, body }`.
 */
function createResultRecorder() {
  let status = 200;
  let body;
  const recorder = {
    status(code) { status = code; return recorder; },
    json(payload) { body = payload; return { status, body }; },
    result: () => ({ status, body }),
  };
  return recorder;
}

module.exports = { createResultRecorder };
