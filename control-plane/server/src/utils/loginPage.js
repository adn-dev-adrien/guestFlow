/**
 * The HTML of `app.<domain>` (specs/control-plane-plans-and-access.md rules 24, 25, 27). Rendered by
 * the server with no script, so it works on any phone and needs no client bundle. Every value is
 * escaped. There is no password field on this page, ever: passwords stay on each space.
 */

const esc = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MESSAGES = {
  none: 'Aucun espace GuestFlow n’est associé à cette adresse. Vérifiez l’orthographe ou contactez la personne qui vous a invité.',
  invalid: 'Adresse email invalide.',
  tooMany: 'Trop de recherches depuis votre connexion. Réessayez dans une minute.',
};

const STYLE = `
:root{--paper:#F5F0E6;--card:#FFFDF8;--ink:#1F241D;--muted:#5F665A;--line:#DDD5C4;--sapin:#2E3B2A;--field:#FFFFFF;--fieldline:#C9C0AC;--note:#B87B2A;
--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media (prefers-color-scheme: dark){:root{--paper:#161C16;--card:#1F261E;--ink:#EDE8DC;--muted:#A8AE9F;--line:#39433A;--sapin:#C9D8BC;--field:#141A14;--fieldline:#4A544A;--note:#E0A956}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 var(--sans)}
main{max-width:420px;margin:0 auto;padding:48px 16px}
h1{font:600 30px/1.2 var(--serif);color:var(--sapin);text-align:center;margin:0 0 4px}
.sub{text-align:center;color:var(--muted);margin:0 0 20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px}
label{display:block;font-size:13px;font-weight:600;color:var(--muted);margin-bottom:6px}
input{width:100%;font:inherit;padding:10px 12px;min-height:48px;border:1px solid var(--fieldline);border-radius:8px;background:var(--field);color:var(--ink)}
button{width:100%;font:inherit;font-weight:600;min-height:48px;border-radius:8px;cursor:pointer;margin-top:12px}
.primary{background:var(--sapin);color:var(--paper);border:1px solid var(--sapin)}
.secondary{background:transparent;color:var(--ink);border:1px solid var(--fieldline)}
.space{display:block;text-align:left;background:var(--field);color:var(--ink);border:1px solid var(--fieldline);padding:10px 14px;min-height:56px}
.space strong{display:block}
.space span{color:var(--muted);font-size:14px;font-weight:400}
.note{border-left:4px solid var(--note);padding:8px 12px;margin:0 0 16px;background:var(--paper);border-radius:6px}
form{margin:0}
`;

function page(body, sub = 'Connexion à votre espace') {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Connexion — GuestFlow</title>
<link rel="icon" href="data:,">
<style>${STYLE}</style>
</head>
<body><main>
<h1>GuestFlow</h1>
<p class="sub">${esc(sub)}</p>
<div class="card">${body}</div>
</main></body>
</html>`;
}

function formPage({ message, email } = {}) {
  return page(`${message ? `<p class="note" role="alert">${esc(message)}</p>` : ''}
<form method="post" action="/lookup">
<label for="email">Adresse email</label>
<input id="email" name="email" type="email" autocomplete="email" inputmode="email" required autofocus value="${esc(email || '')}">
<button class="primary" type="submit">Continuer</button>
</form>`);
}

function listPage({ spaces, email }) {
  const buttons = spaces.map((s) => `<form method="post" action="/go">
<input type="hidden" name="slug" value="${esc(s.slug)}"><input type="hidden" name="email" value="${esc(email)}">
<button class="space" type="submit"><strong>${esc(s.name)}</strong><span>${esc(s.address)}</span></button>
</form>`).join('\n');
  return page(`${buttons}
<form method="post" action="/forget"><button class="secondary" type="submit">Utiliser une autre adresse</button></form>`,
  `Cette adresse a accès à ${spaces.length} espaces`);
}

function rememberedPage({ space }) {
  return page(`<form method="post" action="/go">
<input type="hidden" name="slug" value="${esc(space.slug)}">
<button class="primary" type="submit">Continuer vers ${esc(space.name)}</button>
</form>
<form method="post" action="/forget"><button class="secondary" type="submit">Utiliser une autre adresse</button></form>`);
}

module.exports = { MESSAGES, formPage, listPage, rememberedPage, esc };
