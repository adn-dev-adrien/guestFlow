/**
 * Runs an Express handler in-process and resolves with the JSON body it answers, so a summary can be
 * built from the very list a card reads (specs/shell-and-home-day-first.md rule 7).
 *
 * Resolves `null` — never rejects — when the handler answers an error status, throws, calls `next`,
 * or returns without answering: one broken source must not break the page that gathers them (rule 4).
 * `query` overrides the request's query string for this call; everything else (session, user) is
 * read through to the caller's request.
 */
function payloadOf(handler, req, { query } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value === undefined ? null : value);
    };
    let statusCode = 200;
    const res = {
      get statusCode() { return statusCode; },
      status(code) { statusCode = code; return res; },
      json(body) { done(statusCode < 400 ? body : null); return res; },
      send(body) { done(statusCode < 400 ? body : null); return res; },
      end() { done(null); return res; },
      set() { return res; },
      setHeader() { return res; },
      type() { return res; },
    };
    const scoped = Object.create(req || {});
    if (query) {
      Object.defineProperty(scoped, 'query', { value: { ...((req && req.query) || {}), ...query }, enumerable: true });
    }
    try {
      const returned = handler(scoped, res, () => done(null));
      if (returned && typeof returned.then === 'function') {
        returned.then(() => done(null), () => done(null));
      } else {
        done(null);
      }
    } catch {
      done(null);
    }
  });
}

module.exports = { payloadOf };
