#!/usr/bin/env node
/**
 * Builds a self-contained tariff-verification page: fonts and screenshots inlined as data URIs,
 * no network at render time. Publish the result with the Artifact tool.
 *
 *   node build-verification-page.mjs <cases.json> <shots-dir> <out.html>
 *
 * cases.json declares INPUTS ONLY — every other figure is derived here from the tariff rules, and
 * a case whose derived total disagrees with the observed one is flagged in the page. Never write a
 * computed figure into cases.json by hand: the page has to be able to contradict you.
 *
 * {
 *   "titre": "Vérification des tarifs 2026",
 *   "sousTitre": "Aventura Lodge · Domaine Solio",
 *   "intro": "…",
 *   "quoteUrlBase": "https://checkout.lodgify.com/fr/<slug>/<rentalId>/reservation?currency=EUR&",
 *   "supplementParVoyageur": 16,
 *   "occupantsInclus": 2,
 *   "tauxTaxeSejour": 5.51,      // % of the VAT-excluded amount
 *   "tauxTva": 10,
 *   "saisons":  { "basse": { "nom": "Basse saison", "prix": 179 }, … },
 *   "bareme":   [[2, 24], [3, 33], …],            // [nuits, remise %]
 *   "canaux":   [["Airbnb", 193, 233, 267], …],   // [nom, basse, moyenne, haute]
 *   "reserves": [{ "titre": "…", "texte": "…" }],
 *   "tableaux": [{ "titre","chapo","entetes":[…],"lignes":[[…]],"note" }],
 *   "comparatif": { "titre","chapo","note","canaux":[{nom,prix{saison:€},commissionPct,fraisFixes,taxePPPN,tolerance}],
 *                   "cas":[{id,libelle,dates,note,composition:[[saison,n]],cellules:{<canal>:{remise|remisePct,total}}}] },
 *   "saisonsFixes": ["christmas","new-year"],   // jamais remisées : le plancher ne les dégresse pas
 *   "taxeSejourParPersonneParNuit": 1.2,   // forfait ; sinon tauxTaxeSejour en %
 *   "fraisFixes": 80,                       // ménage & co, ajoutés au total
 *   "cas": [{ "id","saison","extras","nuits","remisePct","dates","img","affiche","note","url",
 *            "composition": [["high",1],["christmas",2]] }]  // séjour à cheval sur des saisons
 * }
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..'); // <repo>/.claude/skills/<skill>/ → <repo>
const FONTS = join(REPO, 'client', 'node_modules', '@fontsource');

const [casesPath, shotsDir, outPath] = process.argv.slice(2);
if (!casesPath || !shotsDir || !outPath) {
  console.error('usage: build-verification-page.mjs <cases.json> <shots-dir> <out.html>');
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(resolve(casesPath), 'utf8'));
const b64 = (p) => readFileSync(p).toString('base64');

/** Self-hosted faces; fall back to a system stack rather than ever reaching for a CDN (CSP blocks it). */
const face = (rel) => {
  const p = join(FONTS, rel);
  return existsSync(p) ? `data:font/woff2;base64,${b64(p)}` : null;
};
const serif600 = face('source-serif-4/files/source-serif-4-latin-600-normal.woff2');
const sans400 = face('inter/files/inter-latin-400-normal.woff2');
const sans600 = face('inter/files/inter-latin-600-normal.woff2');
if (!serif600 || !sans400) console.warn('! polices @fontsource absentes — repli sur les polices système');

/** A case may have no screenshot yet: degrade to a placeholder rather than failing the whole page. */
const shot = (name) => {
  if (!name) return null;
  const f = join(resolve(shotsDir), name);
  return existsSync(f) ? `data:image/png;base64,${b64(f)}` : null;
};
const eur = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r2 = (x) => Math.round(x * 100) / 100;

const SUP = cfg.supplementParVoyageur ?? 0;
const INCL = cfg.occupantsInclus ?? 2;
const TAXE = cfg.tauxTaxeSejour ?? 0;
const TVA = cfg.tauxTva ?? 0;

const TAXE_PPPN = cfg.taxeSejourParPersonneParNuit ?? 0;
const FRAIS = cfg.fraisFixes ?? 0;

const derive = (c) => {
  // `composition` lets one stay span several seasons — a Christmas stay is Haute + Noël + Noël.
  // Without it a case is a single season repeated `nuits` times, which is the common shape.
  const compo = c.composition && c.composition.length
    ? c.composition
    : [[c.saison, c.nuits]];
  const nuitsTotal = compo.reduce((a, [, n]) => a + n, 0);
  if (nuitsTotal !== c.nuits) {
    throw new Error(`cas ${c.id} : la composition fait ${nuitsTotal} nuits, le cas en déclare ${c.nuits}`);
  }
  const prixSaison = cfg.saisons[compo[0][0]].prix;
  const prixNuit = prixSaison + SUP * (c.extras || 0);
  const brut = r2(compo.reduce(
    (a, [cle, n]) => a + (cfg.saisons[cle].prix + SUP * (c.extras || 0)) * n, 0));
  const remise = r2((brut * (c.remisePct || 0)) / 100);
  const net = r2(brut - remise);
  const ht = r2(net / (1 + TVA / 100));
  // Tourist tax: either a percentage of the VAT-excluded amount, or a flat per-person per-night
  // amount. Never both — a channel does it one way or the other.
  const taxe = TAXE_PPPN
    ? r2(TAXE_PPPN * (INCL + (c.extras || 0)) * c.nuits)
    : r2((ht * TAXE) / 100);
  const total = r2(net + taxe + FRAIS);
  return { prixSaison, prixNuit, brut, remise, net, ht, taxe, frais: FRAIS, total,
    compo, ok: Math.abs(total - c.affiche) < 0.011 };
};

const cases = cfg.cas.map((c) => ({ ...c, ...derive(c) }));
const ecarts = cases.filter((c) => !c.ok);

const row = (lib, calc, montant, cls = '') => `
        <div class="row ${cls}">
          <span class="row-label">${lib}</span>
          <span class="row-calc">${calc}</span>
          <span class="row-amount">${montant}</span>
        </div>`;

const carte = (c) => {
  const occ = INCL + (c.extras || 0);
  const s = cfg.saisons[(c.composition && c.composition.length ? c.composition[0][0] : c.saison)];
  const nuitLbl = `${c.nuits} nuit${c.nuits > 1 ? 's' : ''}`;
  return `
    <article class="case${c.ok ? '' : ' case-flagged'}" id="${esc(c.id)}">
      <div class="case-head">
        <span class="chip chip-${esc(c.saison)}"${s.couleur ? ` style="color:${esc(s.couleur)}"` : ''}>${esc(s.nom)}</span>
        <h3>${nuitLbl}, ${occ} personne${occ > 1 ? 's' : ''}</h3>
        <p class="dates">${esc(c.dates)}</p>
      </div>
      <div class="case-body">
        ${shot(c.img) ? `<figure class="shot">
          <img src="${shot(c.img)}" alt="Devis : ${esc(s.nom)}, ${nuitLbl}, ${occ} personnes, total ${eur(c.affiche)}" loading="lazy" />
          <figcaption>Devis relevé sur le site client</figcaption>
        </figure>` : ''}
        <div class="ledger">
          ${row('Prix par nuit', c.extras
            ? `${c.prixSaison} € + ${c.extras} voyageur${c.extras > 1 ? 's' : ''} en plus × ${SUP} €`
            : `${esc(s.nom.toLowerCase())}, pas de supplément`, eur(c.prixNuit))}
          ${row('Brut', `${c.prixNuit} € × ${nuitLbl}`, eur(c.brut))}
          ${c.remisePct
            ? row(`Remise ${nuitLbl}`, `−${c.remisePct} % de ${eur(c.brut)}`, '−' + eur(c.remise), 'row-discount')
            : row('Remise', 'aucune — séjour trop court', '—', 'row-muted')}
          ${c.remisePct ? row('Sous-total', 'après remise', eur(c.net)) : ''}
          ${TAXE ? row('Taxe de séjour', `${String(TAXE).replace('.', ',')} % de ${eur(c.ht)} hors TVA`, eur(c.taxe)) : ''}
          <div class="row row-total">
            <span class="row-label">Total</span>
            <span class="row-calc ${c.ok ? '' : 'is-bad'}">${c.ok ? 'conforme au devis' : `ÉCART — devis à ${eur(c.affiche)}`}</span>
            <span class="row-amount">${eur(c.total)}</span>
          </div>
          ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
          ${c.url && cfg.quoteUrlBase ? `<a class="relink" href="${esc(cfg.quoteUrlBase + c.url)}" target="_blank" rel="noopener">Refaire ce devis&nbsp;↗</a>` : ''}
        </div>
      </div>
    </article>`;
};

const ETAPES = [
  ['Prix par nuit', `Le prix de la saison, plus <strong>${SUP} € par voyageur au-delà de ${INCL}</strong>. Le supplément est fondu dans le prix par nuit — il n’apparaît jamais en ligne séparée.`],
  ['Brut', 'Prix par nuit multiplié par le nombre de nuits.'],
  ['Remise de durée', 'Appliquée sur le brut entier, supplément voyageur compris. <strong>Une seule remise s’applique</strong>, la plus avantageuse.'],
  ['Taxe de séjour', `${String(TAXE).replace('.', ',')} % du montant <strong>hors TVA</strong>, c’est-à-dire du montant après remise divisé par ${String(1 + TVA / 100).replace('.', ',')}. C’est la seule ligne qui s’ajoute.`],
];

const ff = (name, url, weight) =>
  url ? `@font-face { font-family: '${name}'; src: url('${url}') format('woff2'); font-weight: ${weight}; font-display: swap; }` : '';

const html = `<title>${esc(cfg.titre)}</title>
<style>
  ${ff('Source Serif 4', serif600, 600)}
  ${ff('InterVf', sans400, 400)}
  ${ff('InterVf', sans600, 600)}

  :root {
    --paper:#F8F5EF; --card:#FFFFFF; --ink:#27251F; --ink-soft:#6E6A5E;
    --sapin:#2F5D46; --miel:#C99038; --ok:#3E7D54; --ok-bg:#E6EFE7;
    --warn:#8F6A1D; --warn-bg:#F6EDD7; --brique:#A8433A; --rule:rgba(60,54,36,.12);
    --shadow:0 1px 2px rgba(39,37,31,.05), 0 8px 24px -12px rgba(39,37,31,.16);
    --serif:'Source Serif 4', Iowan Old Style, Georgia, serif;
    --sans:'InterVf', ui-sans-serif, -apple-system, Segoe UI, sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --paper:#1A1813; --card:#221F19; --ink:#EDE7DA; --ink-soft:#9C9584;
      --sapin:#77AC90; --miel:#DDAE5E; --ok:#7FB894; --ok-bg:rgba(62,125,84,.18);
      --warn:#D3A954; --warn-bg:rgba(143,106,29,.22); --brique:#D08479; --rule:rgba(237,231,218,.13);
      --shadow:0 1px 2px rgba(0,0,0,.3), 0 8px 24px -12px rgba(0,0,0,.5);
    }
  }
  :root[data-theme="dark"] {
    --paper:#1A1813; --card:#221F19; --ink:#EDE7DA; --ink-soft:#9C9584;
    --sapin:#77AC90; --miel:#DDAE5E; --ok:#7FB894; --ok-bg:rgba(62,125,84,.18);
    --warn:#D3A954; --warn-bg:rgba(143,106,29,.22); --brique:#D08479; --rule:rgba(237,231,218,.13);
    --shadow:0 1px 2px rgba(0,0,0,.3), 0 8px 24px -12px rgba(0,0,0,.5);
  }
  :root[data-theme="light"] {
    --paper:#F8F5EF; --card:#FFFFFF; --ink:#27251F; --ink-soft:#6E6A5E;
    --sapin:#2F5D46; --miel:#C99038; --ok:#3E7D54; --ok-bg:#E6EFE7;
    --warn:#8F6A1D; --warn-bg:#F6EDD7; --brique:#A8433A; --rule:rgba(60,54,36,.12);
    --shadow:0 1px 2px rgba(39,37,31,.05), 0 8px 24px -12px rgba(39,37,31,.16);
  }

  body { margin:0; background:var(--paper); color:var(--ink); font-family:var(--sans);
         font-size:16px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:62rem; margin:0 auto; padding:clamp(1.5rem,4vw,3.5rem) clamp(1rem,4vw,2rem) 5rem; }
  h1,h2,h3 { font-family:var(--serif); font-weight:600; text-wrap:balance; margin:0; }
  h1 { font-size:clamp(1.85rem,4.5vw,2.6rem); line-height:1.2; letter-spacing:-.01em; }
  h2 { font-size:1.3rem; } h3 { font-size:1.12rem; }
  p { margin:0; }
  a { color:var(--sapin); }
  a:focus-visible { outline:2px solid var(--miel); outline-offset:3px; border-radius:3px; }
  .eyebrow { font-size:.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.1em; color:var(--sapin); }

  .masthead { display:flex; flex-direction:column; gap:.75rem; padding-bottom:1.75rem; border-bottom:2px solid var(--rule); }
  .lede { max-width:60ch; color:var(--ink-soft); font-size:1.05rem; }
  .verdict { display:inline-flex; align-items:center; gap:.55rem; align-self:flex-start;
             padding:.45rem .85rem; border-radius:999px; font-size:.85rem; font-weight:600;
             background:var(--ok-bg); color:var(--ok); border:1px solid color-mix(in srgb, var(--ok) 30%, transparent); }
  .verdict::before { content:""; width:.5rem; height:.5rem; border-radius:50%; background:currentColor; }
  .verdict.is-bad { background:var(--warn-bg); color:var(--warn); border-color:color-mix(in srgb, var(--warn) 32%, transparent); }

  section { margin-top:3.25rem; }
  .sec-head { display:flex; flex-direction:column; gap:.3rem; margin-bottom:1.25rem; }
  .sec-head p { color:var(--ink-soft); max-width:62ch; }

  .steps { display:grid; gap:.6rem; counter-reset:step; }
  .step { display:grid; grid-template-columns:2rem 1fr; gap:.9rem; align-items:baseline;
          background:var(--card); border:1px solid var(--rule); border-radius:12px;
          padding:1rem 1.15rem; box-shadow:var(--shadow); }
  .step::before { counter-increment:step; content:counter(step); font-variant-numeric:tabular-nums;
                  font-weight:600; font-size:.95rem; color:var(--paper); background:var(--sapin);
                  width:1.65rem; height:1.65rem; border-radius:50%; display:grid; place-items:center; }
  .step h3 { font-size:1rem; margin-bottom:.15rem; }
  .step p { color:var(--ink-soft); font-size:.93rem; }
  .step strong { color:var(--ink); font-weight:600; }

  .bareme { display:flex; flex-wrap:wrap; gap:.5rem; margin-top:1rem; }
  .tier { display:flex; flex-direction:column; align-items:center; gap:.1rem; background:var(--card);
          border:1px solid var(--rule); border-radius:10px; padding:.6rem .85rem; min-width:5.2rem; box-shadow:var(--shadow); }
  .tier b { font-size:1.15rem; font-weight:600; color:var(--ok); font-variant-numeric:tabular-nums; }
  .tier span { font-size:.75rem; color:var(--ink-soft); font-variant-numeric:tabular-nums; }

  .scroll { overflow-x:auto; border:1px solid var(--rule); border-radius:12px; background:var(--card); box-shadow:var(--shadow); }
  table { border-collapse:collapse; width:100%; min-width:34rem; font-size:.92rem; }
  th,td { text-align:right; padding:.7rem .9rem; border-bottom:1px solid var(--rule); font-variant-numeric:tabular-nums; }
  th:first-child, td:first-child { text-align:left; font-variant-numeric:normal; }
  thead th { font-size:.72rem; text-transform:uppercase; letter-spacing:.08em; color:var(--ink-soft); font-weight:600; }
  tbody tr:last-child td { border-bottom:0; }
  td.total { font-weight:600; }
  td.sous-plancher { background:var(--warn-bg); color:var(--warn); font-weight:700; }
  tr.is-bad td { background:var(--warn-bg); }
  tr.is-bad td:first-child { font-weight:600; color:var(--warn); }
  tr.is-bad td strong { color:var(--warn); }
  td .row-calc { font-size:.82em; opacity:.7; }
  tr.is-direct td { background:var(--ok-bg); }
  tr.is-direct td:first-child { font-weight:600; }

  .cases { display:grid; gap:1.5rem; }
  .case { background:var(--card); border:1px solid var(--rule); border-radius:14px; box-shadow:var(--shadow); overflow:hidden; }
  .case-flagged { border-color:var(--warn); border-width:2px; }
  .case-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:.55rem .8rem; padding:1.1rem 1.35rem; border-bottom:1px solid var(--rule); }
  .case-head .dates { color:var(--ink-soft); font-size:.88rem; margin-left:auto; font-variant-numeric:tabular-nums; }
  .chip { font-size:.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.07em;
          padding:.25rem .6rem; border-radius:999px; border:1px solid currentColor; }
  .chip-basse { color:var(--sapin); } .chip-moyenne { color:var(--miel); } .chip-haute { color:var(--brique); }

  .case-body { display:grid; grid-template-columns:minmax(15rem,20rem) 1fr; gap:1.5rem; padding:1.35rem; align-items:start; }
  .shot { margin:0; display:flex; flex-direction:column; gap:.5rem; }
  .shot img { width:100%; height:auto; display:block; border:1px solid var(--rule); border-radius:10px; background:#fff; }
  .shot figcaption { font-size:.75rem; color:var(--ink-soft); text-align:center; }

  .ledger { display:flex; flex-direction:column; }
  .row { display:grid; grid-template-columns:1fr auto; gap:.15rem .9rem; padding:.6rem 0;
         border-bottom:1px solid var(--rule); align-items:baseline; }
  .row-label { font-weight:600; font-size:.93rem; }
  .row-calc { grid-column:1; font-size:.82rem; color:var(--ink-soft); }
  .row-amount { grid-column:2; grid-row:1 / span 2; font-variant-numeric:tabular-nums; font-size:1rem; align-self:center; white-space:nowrap; }
  .row-discount .row-label, .row-discount .row-amount { color:var(--ok); }
  .row-muted .row-amount { color:var(--ink-soft); }
  .row-total { border-bottom:0; border-top:2px solid var(--ink); margin-top:.35rem; padding-top:.7rem; }
  .row-total .row-label { font-family:var(--serif); font-size:1.1rem; }
  .row-total .row-amount { font-size:1.35rem; font-weight:600; }
  .row-total .row-calc { color:var(--ok); font-weight:600; }
  .row-total .row-calc.is-bad { color:var(--warn); }

  .note { margin-top:.9rem; font-size:.88rem; color:var(--ink-soft); }
  .relink { margin-top:.7rem; font-size:.82rem; font-weight:600; text-decoration:none; display:inline-block; }
  .relink:hover { text-decoration:underline; }

  .flags { display:grid; gap:.9rem; }
  .flag { display:grid; grid-template-columns:auto 1fr; gap:.9rem; background:var(--warn-bg);
          border:1px solid color-mix(in srgb, var(--warn) 32%, transparent); border-radius:12px; padding:1rem 1.2rem; }
  .flag-mark { font-weight:600; color:var(--warn); font-size:1.1rem; line-height:1.4; }
  .flag h3 { font-size:1rem; margin-bottom:.2rem; color:var(--warn); }
  .flag p { font-size:.92rem; }

  .howto { background:var(--card); border:1px dashed var(--rule); border-radius:12px; padding:1.1rem 1.3rem; margin-top:1rem; }
  .howto code { display:block; overflow-x:auto; white-space:pre; font-size:.78rem; background:var(--paper);
                border:1px solid var(--rule); border-radius:8px; padding:.7rem .85rem; margin-top:.6rem;
                font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }

  footer { margin-top:3.5rem; padding-top:1.25rem; border-top:1px solid var(--rule); color:var(--ink-soft); font-size:.84rem; }

  @media (max-width:760px) {
    .case-body { grid-template-columns:1fr; }
    .case-head .dates { margin-left:0; width:100%; }
    .shot img { max-width:22rem; margin:0 auto; }
  }
  @media (prefers-reduced-motion:reduce) { * { animation:none !important; transition:none !important; } }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">${esc(cfg.sousTitre || '')}</p>
    <h1>${esc(cfg.titre)}</h1>
    <p class="lede">${esc(cfg.intro || '')}</p>
    <p class="verdict${ecarts.length ? ' is-bad' : ''}">${ecarts.length
      ? `${ecarts.length} devis sur ${cases.length} ne correspond${ecarts.length > 1 ? 'ent' : ''} pas au calcul`
      : `Les ${cases.length} devis correspondent au centime près`}</p>
  </header>

  <section>
    <div class="sec-head">
      <h2>Comment se construit un prix</h2>
      <p>Quatre étapes, toujours dans cet ordre. C’est la grille à garder en tête pour lire les cas qui suivent.</p>
    </div>
    <div class="steps">
      ${ETAPES.map(([t, d]) => `<div class="step"><div><h3>${t}</h3><p>${d}</p></div></div>`).join('\n      ')}
    </div>
    <div class="bareme">
      ${(cfg.bareme || []).map(([n, p]) => `<div class="tier"><b>−${p} %</b><span>${n} nuit${n > 1 ? 's' : ''}</span></div>`).join('\n      ')}
    </div>
    <p class="note">Prix des saisons : ${Object.values(cfg.saisons).map((s) => `${s.nom.toLowerCase()} ${s.prix} €`).join(' · ')}.</p>
  </section>

  <section>
    <div class="sec-head">
      <h2>Les devis en un coup d’œil</h2>
      <p>Colonne « calculé » : le total reconstitué à partir des règles. Colonne « affiché » : ce que montre réellement le devis.</p>
    </div>
    <div class="scroll">
      <table>
        <thead><tr><th>Cas</th><th>Nuits</th><th>Pers.</th><th>Prix / nuit</th><th>Remise</th><th>Calculé</th><th>Affiché</th></tr></thead>
        <tbody>
          ${cases.map((c) => `<tr><td><a href="#${esc(c.id)}">${esc(cfg.saisons[c.saison].nom)}</a></td><td>${c.nuits}</td><td>${INCL + (c.extras || 0)}</td><td>${c.prixNuit} €</td><td>${c.remisePct ? '−' + c.remisePct + ' %' : '—'}</td><td class="total">${eur(c.total)}</td><td class="total">${eur(c.affiche)}</td></tr>`).join('\n          ')}
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <div class="sec-head">
      <h2>Le détail, cas par cas</h2>
      <p>La capture à gauche est la preuve ; le calcul à droite se lit ligne à ligne.</p>
    </div>
    <div class="cases">${cases.map(carte).join('\n')}</div>
  </section>

  ${(cfg.reserves || []).length ? `<section>
    <div class="sec-head"><h2>${cfg.reserves.length > 1 ? 'Réserves à lever' : 'Réserve à lever'}</h2></div>
    <div class="flags">
      ${cfg.reserves.map((r) => `<div class="flag"><span class="flag-mark">!</span><div><h3>${esc(r.titre)}</h3><p>${esc(r.texte)}</p></div></div>`).join('\n      ')}
    </div>
  </section>` : ''}

  ${(() => {
    const C = cfg.comparatif;
    if (!C) return '';
    // Per channel, per case: rebuild the quote from the channel's OWN grid and compare it to the
    // total observed on the guest page. `remise` (euros) or `remisePct` is an INPUT, read off the
    // page; everything else is derived here so a wrong cell shows up red.
    const tier = (n) => {
      let best = 0;
      for (const [nn, pct] of (cfg.bareme || [])) if (n >= nn) best = pct;
      return best;
    };
    const cells = [];
    const body = C.cas.map((c) => {
      const nuits = c.composition.reduce((a, [, n]) => a + n, 0);
      const plancher = r2(c.composition.reduce((a, [cle, n]) => {
        const s = cfg.saisons[cle];
        const fixe = (cfg.saisonsFixes || []).includes(cle);
        return a + (s.net || 0) * n * (fixe ? 1 : 1 - tier(nuits) / 100);
      }, 0));
      const cols = C.canaux.map((ch) => {
        const cell = c.cellules[ch.nom];
        if (!cell) return { ch, vide: true };
        const brut = r2(c.composition.reduce((a, [cle, n]) => a + ch.prix[cle] * n, 0));
        const remise = cell.remise != null ? r2(cell.remise) : r2(brut * (cell.remisePct || 0) / 100);
        const heberg = r2(brut - remise);
        const taxe = r2((ch.taxePPPN || 0) * (cfg.occupantsInclus ?? 2) * nuits);
        const attendu = r2(heberg + taxe + (ch.fraisFixes || 0));
        const ecart = r2(attendu - cell.total);
        const ok = Math.abs(ecart) <= (ch.tolerance ?? 0.011);
        const net = ch.commissionPct == null ? null : r2(heberg * (1 - ch.commissionPct / 100));
        const marge = net == null ? null : r2(net - plancher);
        cells.push({ ok, sousPlancher: marge != null && marge < 0, canal: ch.nom, cas: c.libelle });
        return { ch, cell, brut, remise, heberg, taxe, attendu, ecart, ok, net, marge, pct: brut ? r2(remise / brut * 100) : 0 };
      });
      return { c, nuits, plancher, cols };
    });
    const kos = cells.filter((x) => !x.ok).length;
    const sous = cells.filter((x) => x.sousPlancher);
    return `<section>
    <div class="sec-head">
      <h2>${esc(C.titre)}</h2>
      ${C.chapo ? `<p>${esc(C.chapo)}</p>` : ''}
    </div>
    <p class="note">${cells.length} devis relevés sur les pages clientes, ${kos === 0
      ? 'et les ' + cells.length + ' se reconstruisent depuis la grille du canal.'
      : '<strong>dont ' + kos + ' que le calcul ne reproduit pas</strong> — signalés en rouge.'}
      Le plancher est ce que Gîtes de France paie réellement, remisé sur les nuits progressives et jamais sur les nuits de fête.</p>
    ${sous.length ? `<p class="verdict is-bad">${sous.length === 1 ? 'Un devis vend' : sous.length + ' devis vendent'} sous le plancher : ${
      sous.map((x) => esc(x.canal) + ' sur « ' + esc(x.cas) + ' »').join(', ')}.</p>`
      : `<p class="verdict">Aucun devis ne passe sous le plancher.</p>`}
    ${body.map((b) => `
    <div class="sec-head" style="margin-top:2rem">
      <h3>${esc(b.c.libelle)} — <span style="font-weight:400">${esc(b.c.dates)}</span></h3>
      ${b.c.note ? `<p>${esc(b.c.note)}</p>` : ''}
    </div>
    <div class="scroll">
      <table>
        <thead><tr><th>Canal</th><th>Brut</th><th>Remise</th><th>Taxe</th><th>Frais</th><th>Total attendu</th><th>Total relevé</th><th>Net après commission</th><th>Plancher ${eur(b.plancher)}</th></tr></thead>
        <tbody>
          ${b.cols.filter((x) => !x.vide).map((x) => `<tr class="${x.ok ? '' : 'is-bad'}${/direct/i.test(x.ch.nom) ? ' is-direct' : ''}">
            <td>${esc(x.ch.nom)}</td>
            <td class="total">${eur(x.brut)}</td>
            <td class="total">${x.remise ? '−' + eur(x.remise) + ' <span class="row-calc">(' + String(x.pct).replace('.', ',') + ' %)</span>' : '—'}</td>
            <td class="total">${x.taxe ? eur(x.taxe) : '—'}</td>
            <td class="total">${x.ch.fraisFixes ? eur(x.ch.fraisFixes) : '—'}</td>
            <td class="total">${eur(x.attendu)}</td>
            <td class="total">${eur(x.cell.total)}${x.ok ? '' : ' <strong>ÉCART ' + eur(Math.abs(x.ecart)) + '</strong>'}</td>
            <td class="total">${x.net == null ? '—' : eur(x.net)}</td>
            <td class="total${x.marge != null && x.marge < 0 ? ' sous-plancher' : ''}">${x.marge == null ? '—' : (x.marge >= 0 ? '+' : '−') + eur(Math.abs(x.marge))}</td>
          </tr>`).join('\n          ')}
        </tbody>
      </table>
    </div>`).join('\n')}
    ${C.note ? `<p class="note">${esc(C.note)}</p>` : ''}
  </section>`;
  })()}

  ${(cfg.tableaux || []).map((t) => `<section>
    <div class="sec-head">
      <h2>${esc(t.titre)}</h2>
      ${t.chapo ? `<p>${esc(t.chapo)}</p>` : ''}
    </div>
    <div class="scroll">
      <table>
        <thead><tr>${t.entetes.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>
          ${t.lignes.map((l) => `<tr>${l.map((v, i) => `<td${i && /^[-−+]?[\d\s  ]+([,.]\d+)?\s*€?$/.test(String(v)) ? ' class="total"' : ''}>${esc(String(v))}</td>`).join('')}</tr>`).join('\n          ')}
        </tbody>
      </table>
    </div>
    ${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}
  </section>`).join('\n')}

  ${(cfg.canaux || []).length ? `<section>
    <div class="sec-head">
      <h2>Les mêmes prix sur les autres plateformes</h2>
      <p>${esc(cfg.canauxNote || 'Les devis ci-dessus sont les prix directs. La remise de durée est identique partout.')}</p>
    </div>
    <div class="scroll">
      <table>
        <thead><tr><th>Canal</th>${Object.values(cfg.saisons).map((s) => `<th>${esc(s.nom)}</th>`).join('')}</tr></thead>
        <tbody>
          ${cfg.canaux.map(([nom, ...prix]) => `<tr class="${/direct/i.test(nom) ? 'is-direct' : ''}"><td>${esc(nom)}</td>${prix.map((p) => `<td>${p} €</td>`).join('')}</tr>`).join('\n          ')}
        </tbody>
      </table>
    </div>
  </section>` : ''}

  ${cfg.quoteUrlBase ? `<section>
    <div class="sec-head"><h2>Refaire ces devis toi-même</h2></div>
    <div class="howto">
      <p>Colle cette adresse dans ton navigateur en changeant les dates et le nombre d’adultes. Ouvrir un devis ne crée aucune réservation.</p>
      <code>${esc(cfg.quoteUrlBase)}arrival=AAAA-MM-JJ&amp;departure=AAAA-MM-JJ&amp;adults=N</code>
    </div>
  </section>` : ''}

  <footer>${esc(cfg.pied || '')}</footer>
</div>`;

writeFileSync(resolve(outPath), html);
console.log('écrit  :', resolve(outPath));
console.log('taille :', (html.length / 1024).toFixed(0), 'Ko');
console.log('cas    :', cases.map((c) => `${c.id}=${c.ok ? 'OK' : 'ECART'}`).join(' '));
if (ecarts.length) process.exitCode = 2;
