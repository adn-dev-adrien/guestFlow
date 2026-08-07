// Le middleware d'erreur global ajouté avec express 5 (specs/express-5-upgrade.md §3 rule 4).
//
// Pourquoi ce test : express 5 transmet le rejet d'une promesse d'un handler asynchrone au
// middleware d'erreur, là où express 4 le laissait s'échapper en `unhandledRejection` — la requête
// restait alors suspendue, sans réponse. Sans ce middleware, un tel rejet tomberait désormais sur le
// gestionnaire HTML par défaut d'express, sur une API qui ne parle que JSON.
//
// On reconstruit ici la même terminaison qu'`index.js` plutôt que de démarrer le vrai serveur (qui
// ouvre la base, les tâches planifiées et un port) : c'est le CONTRAT qui est testé.

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

// Copie fidèle du handler monté en fin de `src/index.js`.
function mountErrorHandler(app, logs) {
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logs.push(`${req.method} ${req.originalUrl}`);
    if (res.headersSent) return;
    res.status(err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500)
      .json({ error: 'Erreur interne du serveur' });
  });
}

// Démarre l'app sur un port éphémère, joue une requête, rend la réponse, ferme.
function call(app, path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method });
        const text = await res.text();
        server.close(() => resolve({
          status: res.status,
          type: res.headers.get('content-type') || '',
          body: text,
        }));
      } catch (e) { server.close(() => reject(e)); }
    });
  });
}

test('un handler async qui rejette produit un 500 JSON (et non une page HTML ni une requête suspendue)', async () => {
  const app = express();
  const logs = [];
  app.get('/api/boom', async () => { throw new Error('secret: /Users/adrien/db.sqlite'); });
  mountErrorHandler(app, logs);

  const res = await call(app, '/api/boom');
  assert.equal(res.status, 500);
  assert.match(res.type, /application\/json/);
  assert.deepEqual(JSON.parse(res.body), { error: 'Erreur interne du serveur' });
  assert.equal(logs.length, 1, 'l\'erreur est journalisée côté serveur');
});

test('le détail de l\'erreur ne fuit JAMAIS au client', async () => {
  const app = express();
  app.get('/api/leak', async () => { throw new Error('SELECT * FROM users WHERE token = "abc123"'); });
  mountErrorHandler(app, []);

  const res = await call(app, '/api/leak');
  assert.doesNotMatch(res.body, /SELECT|token|abc123/, 'ni SQL, ni jeton, ni chemin dans la réponse');
});

test('une erreur portant un `status` valide le conserve (404, 409…)', async () => {
  const app = express();
  app.get('/api/notfound', async () => { const e = new Error('nope'); e.status = 404; throw e; });
  mountErrorHandler(app, []);

  const res = await call(app, '/api/notfound');
  assert.equal(res.status, 404);
});

test('un `status` aberrant retombe sur 500 plutôt que de casser res.status()', async () => {
  // express 5 valide l'argument de `res.status()` : un code hors norme lèverait DANS le handler
  // d'erreur, ce qui laisserait la requête sans réponse. D'où le garde-fou sur la borne.
  const app = express();
  app.get('/api/weird', async () => { const e = new Error('x'); e.status = 99; throw e; });
  mountErrorHandler(app, []);

  const res = await call(app, '/api/weird');
  assert.equal(res.status, 500);
});

test('une réponse déjà envoyée n\'est pas réécrite (pas de « headers already sent »)', async () => {
  const app = express();
  app.get('/api/half', async (req, res) => {
    res.status(200).json({ ok: true });
    throw new Error('après coup');
  });
  mountErrorHandler(app, []);

  const res = await call(app, '/api/half');
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});
