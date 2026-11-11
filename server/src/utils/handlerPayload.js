/**
 * Runs an Express handler in-process and resolves with the JSON body it answers, so a summary can be
 * built from the very list a card reads (specs/shell-and-home-day-first.md rule 7).
 *
 * Resolves — never rejects — `{ ok: true, body }`, or `{ ok: false, reason }` when the handler
 * answers an error status, throws, calls `next`, or returns without answering. The caller decides
 * what a failed source becomes (rule 20: it is said, never silently dropped). `query` overrides the
 * request's query string for this call; everything else (session, user) is read through to the
 * caller's request.
 */
function payloadOf(handler, req, { query } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const fail = (reason) => done({ ok: false, reason });
    let statusCode = 200;
    const answer = (body) => (statusCode < 400
      ? done({ ok: true, body: body === undefined ? null : body })
      : fail(`HTTP ${statusCode}${body && body.error ? ` ${body.error}` : ''}`));
    const res = {
      get statusCode() { return statusCode; },
      status(code) { statusCode = code; return res; },
      json(body) { answer(body); return res; },
      send(body) { answer(body); return res; },
      end() { fail('no body'); return res; },
      set() { return res; },
      setHeader() { return res; },
      type() { return res; },
    };
    const scoped = Object.create(req || {});
    if (query) {
      Object.defineProperty(scoped, 'query', { value: { ...((req && req.query) || {}), ...query }, enumerable: true });
    }
    const errorText = (err) => (err && err.message) || String(err || 'error');
    try {
      const returned = handler(scoped, res, (err) => fail(err ? errorText(err) : 'next() called'));
      if (returned && typeof returned.then === 'function') {
        returned.then(() => fail('no answer'), (err) => fail(errorText(err)));
      } else {
        fail('no answer');
      }
    } catch (err) {
      fail(errorText(err));
    }
  });
}

module.exports = { payloadOf };
