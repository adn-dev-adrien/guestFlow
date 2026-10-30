/**
 * Test helpers for the control-plane HTTP tests — start an Express app on a free port of the loopback
 * address only, talk to it with a bounded request, and shut it down without waiting on keep-alive sockets.
 * Binding 127.0.0.1 explicitly keeps another process from owning the same port on the loopback while a
 * wildcard listener holds it, which made `fetch` reach the wrong socket and hang for minutes.
 */
const REQUEST_TIMEOUT_MS = 10_000;

function listenLocal(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
}

function fetchLocal(url, options = {}) {
  return fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...options });
}

module.exports = { listenLocal, closeServer, fetchLocal, REQUEST_TIMEOUT_MS };
