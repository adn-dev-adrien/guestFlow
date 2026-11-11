/**
 * Test helper — start an Express app (or http server) on a free port of the loopback address only and
 * resolve once it is listening. Binding 127.0.0.1 explicitly keeps another process from owning the same
 * port on the loopback while a wildcard listener holds it, which made `fetch` reach the wrong socket.
 */
function listenLocal(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1');
    server.once('error', reject);
    server.once('listening', () => resolve(server));
  });
}

module.exports = { listenLocal };
