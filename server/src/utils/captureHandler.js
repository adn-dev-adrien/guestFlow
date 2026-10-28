/**
 * Runs an Express handler and resolves its answer once the handler has finished, so a caller can reuse
 * an endpoint as it is (the start assistant, the plugin reconciliation). An install answers before it
 * releases the plugin lock: resolving on the answer alone would start the next install while the lock
 * was still held (specs/plugins-phase-p-productisation.md rule 37).
 */
function capture(handler, req) {
  return new Promise((resolve) => {
    let answer = null;
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { if (!answer) answer = { status: this.statusCode, body }; return this; },
      end() { if (!answer) answer = { status: this.statusCode, body: null }; return this; },
    };
    Promise.resolve()
      .then(() => handler(req, res))
      .then(() => resolve(answer || { status: 500, body: { error: 'NO_ANSWER' } }))
      .catch((err) => resolve(answer || { status: 500, body: { error: err && err.message } }));
  });
}

module.exports = { capture };
