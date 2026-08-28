#!/usr/bin/env node
/**
 * Builds a self-contained tariff STUDY page for one recipe: fonts inlined as data URIs, no network
 * at render time. The companion of `platform-tariff-rollout/build-verification-page.mjs` — that one
 * reports what the CHANNELS were charging, proof by screenshot; this one reports what the RECIPE
 * says and how it was arrived at, proof by arithmetic.
 *
 *   node build-study-page.mjs <inputs.json> <recipe.json> <out.html>
 *
 * Same golden rule: `inputs.json` declares OBSERVED FACTS ONLY — the grid as it stands in the
 * database, the stays on the books, the platform commissions, the prose. Every derived figure —
 * the new prices, the calendar, the channel grid, the iso-price comparison, the control cases — is
 * recomputed here from the recipe file, and a self-check that fails is printed in red with exit
 * code 2. Never write a computed figure into inputs.json: the page has to be able to contradict
 * whoever produced it.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..'); // <repo>/.claude/skills/<skill>/ → <repo>
const require = createRequire(pathToFileURL(join(REPO, 'server', 'src', 'index.js')));
const { validateRecipe } = require(join(REPO, 'server/src/utils/tariffRecipe.js'));
const { buildYearPlan, materializeClosures } = require(join(REPO, 'server/src/utils/seasonPlan.js'));
const { grossFromNet } = require(join(REPO, 'server/src/utils/pricing.js'));

const [inputsPath, recipePath, outPath] = process.argv.slice(2);
if (!inputsPath || !recipePath || !outPath) {
  console.error('usage: build-study-page.mjs <inputs.json> <recipe.json> <out.html>');
  process.exit(1);
}
const IN = JSON.parse(readFileSync(resolve(inputsPath), 'utf8'));
const loaded = validateRecipe(JSON.parse(readFileSync(resolve(recipePath), 'utf8')));
if (!loaded.valid) { console.error('recette invalide :', loaded.error); process.exit(1); }
const R = loaded.recipe;

// ── helpers ──────────────────────────────────────────────────────────────────
const b64 = (p) => readFileSync(p).toString('base64');
const FONTS = join(REPO, 'client', 'node_modules', '@fontsource');
const face = (rel) => { const p = join(FONTS, rel); return existsSync(p) ? `data:font/woff2;base64,${b64(p)}` : null; };
const serif600 = face('source-serif-4/files/source-serif-4-latin-600-normal.woff2');
const sans400 = face('inter/files/inter-latin-400-normal.woff2');
const sans600 = face('inter/files/inter-latin-600-normal.woff2');
if (!serif600 || !sans400) console.warn('! polices @fontsource absentes — repli sur les polices système');

const r2 = (x) => Math.round(x * 100) / 100;
const eur = (n) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const eur0 = (n) => n.toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' €';
const pct = (n) => (Number.isInteger(r2(n)) ? String(r2(n)) : r2(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + ' %';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const jour = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const jourCourt = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const nuitLbl = (n) => `${n} nuit${n > 1 ? 's' : ''}`;

const checks = [];
const check = (label, ok, detail = '') => { checks.push({ label, ok, detail }); return ok; };

// ── the recipe, resolved ─────────────────────────────────────────────────────
const seasons = [...R.seasons].sort((a, b) => a.rank - b.rank);
/** Longest run of consecutive nights a season actually covers — a 2-night season has no 7-night total. */
const plusLongueSuite = {};
const byKey = Object.fromEntries(seasons.map((s) => [s.key, s]));
const marginal = (s, night) => {
  // A `fixed` season opts out of the curve: every night at the full rate, no length discount.
  if ((s.pricingMode || 'fixed') !== 'progressive') return Number(s.pricePerNight);
  if (night === 1) return Number(s.pricePerNight);
  const t = s.progressiveTiers.find((x) => Number(x.nightNumber) === night);
  return Number(t ? t.extraNightPrice : s.progressiveTiers[s.progressiveTiers.length - 1].extraNightPrice);
};
const cumul = (s, upTo) => { const out = [Number(s.pricePerNight)]; for (let n = 2; n <= upTo; n += 1) out.push(r2(out[out.length - 1] + marginal(s, n))); return out; };

const MOTEUR = IN.fraisMoteurPct ?? 5;
const UPLIFT = Number(R.welcomePack?.cost || 0);
for (const s of seasons) {
  if ((s.pricingMode || 'fixed') === 'progressive') {
    check(`${s.label} — la semaine vaut quatre nuits`, cumul(s, 7)[6] === r2(s.pricePerNight * 4), `${eur(cumul(s, 7)[6])} contre ${eur(r2(s.pricePerNight * 4))}`);
    check(`${s.label} — la nuit d'après une semaine vaut un septième de semaine`, r2(cumul(s, 8)[7] - cumul(s, 8)[6]) === r2((s.pricePerNight * 4) / 7), `${eur(r2(cumul(s, 8)[7] - cumul(s, 8)[6]))}`);
  } else {
    // A season billed flat must stay flat: n nights = n × the rate, with no discount creeping in.
    check(`${s.label} — facturée à plat, sans remise de durée`, cumul(s, 5).every((t, i) => t === r2(s.pricePerNight * (i + 1))), `5 nuits = ${eur(cumul(s, 5)[4])}`);
  }
  check(`${s.label} — le net plancher redonne le prix direct`, grossFromNet(s.netTargetPerNight, MOTEUR, { fixedCost: UPLIFT }) === Number(s.pricePerNight), `plafond((${eur(s.netTargetPerNight)} + ${eur0(UPLIFT)}) ÷ ${String(1 - MOTEUR / 100).replace('.', ',')}) = ${eur0(grossFromNet(s.netTargetPerNight, MOTEUR, { fixedCost: UPLIFT }))}`);
  check(`${s.label} — le direct ne dépasse pas le canal le moins cher`, Number(s.pricePerNight) <= grossFromNet(s.netTargetPerNight, 10), `${eur0(s.pricePerNight)} contre ${eur0(grossFromNet(s.netTargetPerNight, 10))} chez Gîtes de France`);
}

// ── calendars ────────────────────────────────────────────────────────────────
const ANNEE = IN.anneeReference ?? 2026;
const ANNEES = IN.anneesDerivees ?? [ANNEE, ANNEE + 1, ANNEE + 2];
const plans = {};
const joursNouveaux = {};
const minNouveaux = {};
for (const y of ANNEES) {
  plans[y] = buildYearPlan(R, y, materializeClosures(R, y - 1, y));
  let couverts = 0;
  for (const s of seasons) for (const rg of plans[y][s.key] || []) {
    for (let t = Date.parse(rg.startDate + 'T00:00:00Z'); t <= Date.parse(rg.endDate + 'T00:00:00Z'); t += DAY) {
      joursNouveaux[iso(t)] = s.key; if (rg.minNights) minNouveaux[iso(t)] = rg.minNights; couverts += 1;
    }
  }
  const attendus = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
  check(`${y} — l'année entière est couverte, sans trou ni recouvrement`, couverts === attendus, `${couverts} jours sur ${attendus}`);
}

for (const s of seasons) {
  let max = 0;
  for (const y of ANNEES) for (const rg of plans[y][s.key] || []) {
    max = Math.max(max, Math.round((Date.parse(rg.endDate) - Date.parse(rg.startDate)) / DAY) + 1);
  }
  plusLongueSuite[s.key] = max;
}

// ── the old grid, reverse-engineered ─────────────────────────────────────────
const OLD = IN.ancienneGrille.map((o) => {
  const cum = [o.base];
  for (let n = 2; n <= 14; n += 1) {
    const t = o.tiers.find((x) => x.n === n);
    cum.push(r2(cum[cum.length - 1] + Number(t ? t.p : o.tiers[o.tiers.length - 1].p)));
  }
  const semaine = cum[6];
  const quatreNuits = r2(o.base * 4);
  const queue = o.tiers.length ? Number(o.tiers[o.tiers.length - 1].p) : null;
  return { ...o, cum, semaine, quatreNuits, concorde: Math.abs(semaine - quatreNuits) < 0.011, queue, semaineImplicite: queue === null ? null : r2(queue * 7) };
});
const joursAnciens = {};
for (const o of IN.ancienneGrille) for (const rg of o.ranges) {
  for (let t = Date.parse(rg.startDate + 'T00:00:00Z'); t <= Date.parse(rg.endDate + 'T00:00:00Z'); t += DAY) joursAnciens[iso(t)] = o.label;
}
const labelToKey = Object.fromEntries(seasons.map((s) => [s.label.toLowerCase(), s.key]));

// A day that changed season is not automatically a CORRECTION: some changes are deliberate
// additions (a holiday raise, a new carved-out period). Deriving the calendar a second time WITHOUT
// them separates the two — what the rules fix, and what the owner asked for — instead of parading
// the whole lot as drift.
const voulues = new Set(IN.periodesVoulues || []);
const socle = JSON.parse(JSON.stringify(loaded.recipe));
socle.calendar.modifiers = [];
socle.calendar.events = [];
socle.calendar.periods = socle.calendar.periods.filter((p) => !voulues.has(p.id));
const joursSocle = {};
for (const y of ANNEES) {
  const plan = buildYearPlan(socle, y, materializeClosures(socle, y - 1, y));
  for (const s of socle.seasons) for (const rg of plan[s.key] || []) {
    for (let t = Date.parse(rg.startDate + 'T00:00:00Z'); t <= Date.parse(rg.endDate + 'T00:00:00Z'); t += DAY) joursSocle[iso(t)] = s.key;
  }
}
const joursAnnee = Object.keys(joursAnciens).filter((d) => d.startsWith(String(ANNEE))).sort();
const derives = joursAnnee.filter((d) => labelToKey[joursAnciens[d].toLowerCase()] !== joursSocle[d]);
const ajouts = joursAnnee.filter((d) => joursSocle[d] !== joursNouveaux[d]);

// ── pricing a stay under either grid ─────────────────────────────────────────
const prixNouveau = (debut, nuits) => {
  let total = 0; const lignes = []; let complet = true;
  for (let i = 0; i < nuits; i += 1) {
    const d = iso(Date.parse(debut + 'T00:00:00Z') + i * DAY);
    const s = byKey[joursNouveaux[d]];
    // A date outside the derived horizon has NO price. Counting it as zero would quietly understate
    // the total and print a comparison that looks precise and is wrong.
    if (!s) { complet = false; lignes.push({ d, saison: null, prix: 0 }); continue; }
    const p = marginal(s, i + 1);
    total = r2(total + p); lignes.push({ d, saison: s, prix: p });
  }
  return { total, lignes, complet };
};
const prixAncien = (debut, nuits) => {
  let total = 0;
  for (let i = 0; i < nuits; i += 1) {
    const d = iso(Date.parse(debut + 'T00:00:00Z') + i * DAY);
    const o = OLD.find((x) => x.label === joursAnciens[d]);
    if (!o) return null;
    const p = i === 0 ? o.base : Number((o.tiers.find((x) => x.n === i + 1) || o.tiers[o.tiers.length - 1]).p);
    total = r2(total + p);
  }
  return total;
};
const minimumSur = (debut, nuits) => {
  let m = 1;
  for (let i = 0; i < nuits; i += 1) {
    const d = iso(Date.parse(debut + 'T00:00:00Z') + i * DAY);
    const s = byKey[joursNouveaux[d]];
    m = Math.max(m, minNouveaux[d] || (s ? Number(s.minNights || 1) : 1));
  }
  return m;
};

const sejours = IN.sejours.map((sj) => {
  const avant = prixAncien(sj.du, sj.nuits);
  const apres = prixNouveau(sj.du, sj.nuits).total;
  return { ...sj, avant, apres, ecart: avant === null ? null : r2(apres - avant) };
}).filter((sj) => sj.avant !== null);
const totalAvant = r2(sejours.reduce((a, b) => a + b.avant, 0));
const totalApres = r2(sejours.reduce((a, b) => a + b.apres, 0));
const bouges = sejours.filter((sj) => sj.ecart !== 0);

// ── channel grid ─────────────────────────────────────────────────────────────
const estPropre = (nom) => /^(direct|lodgify)$/i.test(nom);
const canaux = [];
const vus = new Set();
for (const c of [...IN.canaux].sort((a, b) => b.commissionPct - a.commissionPct)) {
  const cle = estPropre(c.nom) ? 'propre' : c.nom.toLowerCase();
  if (vus.has(cle)) continue; vus.add(cle);
  const propre = estPropre(c.nom);
  // The direct row carries the recipe's per-stay direct-side amount — the grid applies it to that
  // row alone — so the page shows what the engine actually bills, not a bare gross-up.
  canaux.push({ nom: propre ? 'Direct · moteur Lodgify' : c.nom, commissionPct: c.commissionPct, propre,
    prix: seasons.map((s) => grossFromNet(s.netTargetPerNight, c.commissionPct, propre ? { fixedCost: UPLIFT } : {})) });
}
for (const c of canaux.filter((x) => x.propre)) {
  check('La ligne « direct » de la grille redonne exactement ce que le moteur facture', c.prix.every((p, i) => p === Number(seasons[i].pricePerNight)), c.prix.map(eur0).join(' · '));
}

// ── the public-holiday blocks the modifier produced ──────────────────────────
const pontsParAnnee = ANNEES.map((y) => {
  const blocs = [];
  for (const s of seasons) for (const rg of plans[y][s.key] || []) if (rg.minNights) blocs.push({ ...rg, saison: s });
  return { annee: y, blocs: blocs.sort((a, b) => a.startDate.localeCompare(b.startDate)) };
});

// ── control cases ────────────────────────────────────────────────────────────
const cas = (IN.cas || []).map((c) => {
  const q = prixNouveau(c.du, c.nuits);
  return { ...c, ...q, min: minimumSur(c.du, c.nuits) };
});

const gdfTotalBrut = r2(IN.gdf.reduce((a, b) => a + b.brut, 0));
const gdfTotalCom = r2(IN.gdf.reduce((a, b) => a + b.com, 0));
const gdfTaux = gdfTotalBrut ? r2((100 * gdfTotalCom) / gdfTotalBrut) : 0;
const echecs = checks.filter((c) => !c.ok);

// ── markup ───────────────────────────────────────────────────────────────────
const ff = (name, url, weight) => (url ? `@font-face { font-family: '${name}'; src: url('${url}') format('woff2'); font-weight: ${weight}; font-display: swap; }` : '');
const chip = (s) => `<span class="chip" style="color:${esc(s.color)}">${esc(s.label)}</span>`;
const row = (lib, calc, montant, cls = '') => `
        <div class="row ${cls}">
          <span class="row-label">${lib}</span>
          <span class="row-calc">${calc}</span>
          <span class="row-amount">${montant}</span>
        </div>`;

const carteCas = (c) => {
  const groupes = [];
  c.lignes.forEach((l, i) => {
    const g = groupes[groupes.length - 1];
    // Consecutive nights at the same price in the same season read as one line; the night NUMBERS
    // come from the position in the stay, which is also what picks the discount tier.
    if (g && g.saison === l.saison && g.prix === l.prix) { g.n += 1; g.fin = l.d; g.dernier = i + 1; }
    else groupes.push({ saison: l.saison, prix: l.prix, n: 1, debut: l.d, fin: l.d, premier: i + 1, dernier: i + 1 });
  });
  return `
    <article class="case" id="${esc(c.id)}">
      <div class="case-head">
        ${[...new Set(c.lignes.map((l) => l.saison))].filter(Boolean).map(chip).join(' ')}
        <h3>${esc(c.titre)}</h3>
        <p class="dates">${jour(c.du)} → ${jour(iso(Date.parse(c.du + 'T00:00:00Z') + c.nuits * DAY))} · ${nuitLbl(c.nuits)}</p>
      </div>
      <div class="case-body case-body-solo">
        <div class="ledger">
          ${groupes.map((g) => row(
            g.premier === g.dernier ? `Nuit ${g.premier}` : `Nuits ${g.premier} à ${g.dernier}`,
            `${esc(g.saison ? g.saison.label.toLowerCase() : '—')} · ${jourCourt(g.debut)}${g.n > 1 ? ` → ${jourCourt(g.fin)} · ${g.n} × ${eur(g.prix)}` : ''}`,
            eur(r2(g.prix * g.n)),
          )).join('')}
          ${row('Minimum de séjour', c.min > 1 ? `${c.min} nuits sur ces dates` : 'aucun', c.min > 1 ? `${c.min} n` : '—', 'row-muted')}
          <div class="row row-total">
            <span class="row-label">Total hébergement</span>
            <span class="row-calc">hors taxe de séjour et hors services</span>
            <span class="row-amount">${eur(c.total)}</span>
          </div>
          ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
        </div>
      </div>
    </article>`;
};

const ETAPES = [
  ['Le prix de la nuit', `Celui de la saison du jour. Le Gîte se loue <strong>en entier</strong> — de deux à ${IN.propriete.maxGuests} personnes, le prix ne bouge pas.`],
  ['La semaine vaut quatre nuits', 'Les deux premières nuits au prix plein, puis la 3ᵉ à la 7ᵉ descendent régulièrement jusqu’à ce qu’une semaine coûte <strong>quatre fois la nuit</strong>.'],
  ['Au-delà d’une semaine', 'Chaque nuit supplémentaire vaut <strong>un septième de semaine</strong>. C’est la seule marche de la courbe : la 8ᵉ nuit coûte plus que la 7ᵉ, sans que le total baisse jamais.'],
  ['Ce qui s’ajoute', `La taxe de séjour (${eur(IN.propriete.touristTaxPerDayPerPerson)} par personne et par nuit), et les services restés hors du tarif : ${IN.services.filter((s) => !s.inclus).map((s) => `${s.nom.toLowerCase()} ${eur0(s.prix)}${s.unite === 'per_person' ? ' par personne' : ''}`).join(', ')}. Le ${IN.services.filter((s) => s.inclus).map((s) => s.nom.toLowerCase()).join(' et le ')}, lui, est compris dans le tarif.`],
];

// The <title> names the page in a browser tab and in the Artifact gallery, where it sits beside
// every other report: a short name, not the headline. `titre` stays the h1.
const html = `<title>${esc(IN.titrePage || IN.titre)}</title>
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
    :root:not([data-theme="light"]) {
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

  body { margin:0; background:var(--paper); color:var(--ink); font-family:var(--sans);
         font-size:16px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:62rem; margin:0 auto; padding:clamp(1.5rem,4vw,3.5rem) clamp(1rem,4vw,2rem) 5rem; }
  h1,h2,h3 { font-family:var(--serif); font-weight:600; text-wrap:balance; margin:0; }
  h1 { font-size:clamp(1.85rem,4.5vw,2.6rem); line-height:1.2; letter-spacing:-.01em; }
  h2 { font-size:1.3rem; } h3 { font-size:1.12rem; }
  p { margin:0; }
  a { color:var(--sapin); }
  a:focus-visible { outline:2px solid var(--miel); outline-offset:3px; border-radius:3px; }
  strong { font-weight:600; }
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
  .step strong { color:var(--ink); }

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
  tr.is-direct td { background:var(--ok-bg); }
  tr.is-direct td:first-child { font-weight:600; }
  tr.is-flagged td { background:var(--warn-bg); }
  tr.is-sum td { border-top:2px solid var(--ink); font-weight:600; }
  td.up { color:var(--brique); } td.same { color:var(--ink-soft); }
  .provisoire { color:var(--warn); font-style:italic; }

  .cases { display:grid; gap:1.5rem; }
  .case { background:var(--card); border:1px solid var(--rule); border-radius:14px; box-shadow:var(--shadow); overflow:hidden; }
  .case-flagged { border-color:var(--warn); border-width:2px; }
  .case-head { display:flex; flex-wrap:wrap; align-items:baseline; gap:.55rem .8rem; padding:1.1rem 1.35rem; border-bottom:1px solid var(--rule); }
  .case-head .dates { color:var(--ink-soft); font-size:.88rem; margin-left:auto; font-variant-numeric:tabular-nums; }
  .chip { font-size:.72rem; font-weight:600; text-transform:uppercase; letter-spacing:.07em;
          padding:.25rem .6rem; border-radius:999px; border:1px solid currentColor; white-space:nowrap; }
  .case-body { padding:1.35rem; }
  .ledger { display:flex; flex-direction:column; }
  .row { display:grid; grid-template-columns:1fr auto; gap:.15rem .9rem; padding:.6rem 0;
         border-bottom:1px solid var(--rule); align-items:baseline; }
  .row-label { font-weight:600; font-size:.93rem; }
  .row-calc { grid-column:1; font-size:.82rem; color:var(--ink-soft); }
  .row-amount { grid-column:2; grid-row:1 / span 2; font-variant-numeric:tabular-nums; font-size:1rem; align-self:center; white-space:nowrap; }
  .row-muted .row-amount, .row-muted .row-label { color:var(--ink-soft); }
  .row-bad .row-amount, .row-bad .row-label { color:var(--warn); }
  .row-total { border-bottom:0; border-top:2px solid var(--ink); margin-top:.35rem; padding-top:.7rem; }
  .row-total .row-label { font-family:var(--serif); font-size:1.1rem; }
  .row-total .row-amount { font-size:1.35rem; font-weight:600; }
  .row-total .row-calc { color:var(--ink-soft); }
  .note { margin-top:.9rem; font-size:.88rem; color:var(--ink-soft); }

  .flags { display:grid; gap:.9rem; }
  .flag { display:grid; grid-template-columns:auto 1fr; gap:.9rem; background:var(--warn-bg);
          border:1px solid color-mix(in srgb, var(--warn) 32%, transparent); border-radius:12px; padding:1rem 1.2rem; }
  .flag-mark { font-weight:600; color:var(--warn); font-size:1.1rem; line-height:1.4; }
  .flag h3 { font-size:1rem; margin-bottom:.2rem; color:var(--warn); }
  .flag p { font-size:.92rem; }
  .flag p + p { margin-top:.5rem; }

  .rules { display:grid; gap:.5rem; }
  .rule { display:grid; grid-template-columns:auto 1fr auto; gap:.9rem; align-items:baseline;
          background:var(--card); border:1px solid var(--rule); border-radius:10px; padding:.75rem 1rem; box-shadow:var(--shadow); }
  .rule-n { font-variant-numeric:tabular-nums; font-weight:600; color:var(--ink-soft); font-size:.85rem; }
  .rule-txt { font-size:.95rem; }

  .years { display:grid; gap:1rem; }
  .year { background:var(--card); border:1px solid var(--rule); border-radius:12px; padding:1rem 1.2rem; box-shadow:var(--shadow); }
  .year h3 { font-size:1rem; margin-bottom:.6rem; }
  .band { display:grid; grid-template-columns:auto 1fr; gap:.5rem .9rem; align-items:baseline; padding:.3rem 0; font-size:.88rem; }
  .band .dates { font-variant-numeric:tabular-nums; color:var(--ink-soft); }

  .checks { display:grid; gap:.35rem; }
  .chk { display:grid; grid-template-columns:1.4rem 1fr auto; gap:.7rem; align-items:baseline;
         padding:.5rem .8rem; border:1px solid var(--rule); border-radius:9px; background:var(--card); font-size:.88rem; }
  .chk-mark { font-weight:600; color:var(--ok); }
  .chk.is-bad { border-color:var(--warn); background:var(--warn-bg); }
  .chk.is-bad .chk-mark { color:var(--warn); }
  .chk-detail { color:var(--ink-soft); font-size:.8rem; font-variant-numeric:tabular-nums; white-space:nowrap; }

  footer { margin-top:3.5rem; padding-top:1.25rem; border-top:1px solid var(--rule); color:var(--ink-soft); font-size:.84rem; }
  footer p + p { margin-top:.4rem; }

  @media (max-width:760px) {
    .case-head .dates { margin-left:0; width:100%; }
    .rule { grid-template-columns:auto 1fr; }
    .rule > :last-child { grid-column:2; }
    .chk { grid-template-columns:1.4rem 1fr; }
    .chk-detail { grid-column:2; white-space:normal; }
  }
  @media (prefers-reduced-motion:reduce) { * { animation:none !important; transition:none !important; } }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">${esc(IN.sousTitre)}</p>
    <h1>${esc(IN.titre)}</h1>
    <p class="lede">${esc(IN.intro)}</p>
    <p class="verdict${echecs.length ? ' is-bad' : ''}">${echecs.length
      ? `${echecs.length} contrôle${echecs.length > 1 ? 's' : ''} arithmétique${echecs.length > 1 ? 's' : ''} en échec sur ${checks.length}`
      : `Les ${checks.length} contrôles arithmétiques passent`}</p>
  </header>

  <section>
    <div class="sec-head">
      <h2>Comment se construit un prix</h2>
      <p>Quatre étapes, toujours dans cet ordre. C’est la grille à garder en tête pour lire tout ce qui suit.</p>
    </div>
    <div class="steps">
      ${ETAPES.map(([t, d]) => `<div class="step"><div><h3>${t}</h3><p>${d}</p></div></div>`).join('\n      ')}
    </div>
    <div class="bareme">
      ${R.lengthOfStayDiscounts.map((t) => `<div class="tier"><b>−${String(r2(t.discountPct)).replace('.', ',')} %</b><span>${nuitLbl(t.nights)}</span></div>`).join('\n      ')}
    </div>
    <p class="note">Remise cumulée sur le séjour entier — une seule s’applique, celle de la durée réservée. Au-delà de ${nuitLbl(R.lengthOfStayDiscounts[R.lengthOfStayDiscounts.length - 1].nights)}, le dernier palier se prolonge.</p>
  </section>

  <section>
    <div class="sec-head">
      <h2>Les saisons, et ce que coûte un séjour</h2>
      <p>Le prix affiché sur le canal propre, le net qui reste après les ${String(MOTEUR).replace('.', ',')} % du moteur, et le total pour les durées les plus vendues. Le prix ne dépend jamais du nombre de personnes.</p>
    </div>
    <div class="scroll">
      <table>
        <thead><tr><th>Saison</th><th>La nuit</th><th>Net</th><th>2 n</th><th>3 n</th><th>5 n</th><th>7 n</th><th>14 n</th></tr></thead>
        <tbody>
          ${seasons.map((s) => { const c = cumul(s, 14); const prov = IN.saisonsProvisoires?.includes(s.key);
            // A season only a couple of nights long can never total a week: show a dash rather than
            // a price nobody can ever be charged.
            const cell = (n, cls = '') => (plusLongueSuite[s.key] >= n ? `<td class="${cls}">${eur0(c[n - 1])}</td>` : '<td class="same">—</td>');
            return `<tr${prov ? ' class="is-flagged"' : ''}><td>${chip(s)}</td><td class="total">${eur0(s.pricePerNight)}${prov ? ' <span class="provisoire">prov.</span>' : ''}</td><td>${eur(s.netTargetPerNight)}</td>${cell(2)}${cell(3)}${cell(5)}${cell(7, 'total')}${cell(14)}</tr>`; }).join('\n          ')}
        </tbody>
      </table>
    </div>
    ${IN.saisonsProvisoires?.length ? `<p class="note"><span class="provisoire">prov.</span> — tarif provisoire, en attente d’arbitrage. À ne publier sur aucun canal en l’état.</p>` : ''}
  </section>

  ${(IN.preuves || []).length ? `<section>
    <div class="sec-head">
      <h2>${esc(IN.preuvesTitre || 'Ce que la réalité a payé')}</h2>
      <p>${esc(IN.preuvesIntro || '')}</p>
    </div>
    <div class="scroll">
      <table>
        <thead><tr><th>Séjour</th><th>Nuits</th><th>Brut</th><th>Par nuit</th><th>Ce que la recette facture</th><th>Source</th></tr></thead>
        <tbody>
          ${IN.preuves.map((pr) => {
            const parNuit = r2(pr.brut / pr.nuits);
            const q = pr.du ? prixNouveau(pr.du, pr.nuits) : null;
            const rec = q && q.complet ? q.total : null;
            return `<tr><td>${esc(pr.quoi)}</td><td>${pr.nuits}</td><td>${eur(pr.brut)}</td><td class="total">${eur(parNuit)}</td><td class="${rec === null ? 'same' : (rec > pr.brut ? 'up total' : 'total')}">${rec === null ? '—' : `${eur(rec)}${rec !== pr.brut ? ` <span style="font-size:.8em">(${rec > pr.brut ? '+' : ''}${pct((100 * (rec - pr.brut)) / pr.brut)})</span>` : ''}`}</td><td style="text-align:left;font-size:.85em;color:var(--ink-soft)">${esc(pr.source)}</td></tr>`;
          }).join('\n          ')}
        </tbody>
      </table>
    </div>
    ${IN.preuvesNote ? `<p class="note">${esc(IN.preuvesNote)}</p>` : ''}
  </section>` : ''}

  <section>
    <div class="sec-head">
      <h2>Ce que l’ancienne grille disait vraiment</h2>
      <p>Les paliers nuit par nuit enregistrés dans GuestFlow pour chacune des ${IN.ancienneGrille.length} saisons ne sont pas une courbe dessinée à la main : ils se ramènent tous à la même règle. Sauf un.</p>
    </div>
    <div class="scroll">
      <table>
        <thead><tr><th>Saison (ancienne)</th><th>La nuit</th><th>Semaine facturée</th><th>4 × la nuit</th><th>Nuit au-delà</th><th></th></tr></thead>
        <tbody>
          ${OLD.map((o) => `<tr class="${o.concorde ? '' : 'is-flagged'}"><td>${esc(o.label)}</td><td>${eur(o.base)}</td><td class="total">${eur(o.semaine)}</td><td>${eur(o.quatreNuits)}</td><td>${o.queue === null ? '—' : eur(o.queue)}</td><td>${o.concorde ? '<span style="color:var(--ok);font-weight:600">concorde</span>' : `<span style="color:var(--warn);font-weight:600">écart de ${eur(r2(o.quatreNuits - o.semaine))}</span>`}</td></tr>`).join('\n          ')}
        </tbody>
      </table>
    </div>
    ${OLD.filter((o) => !o.concorde).map((o) => `
    <article class="case case-flagged" style="margin-top:1.25rem">
      <div class="case-head"><span class="chip" style="color:var(--warn)">saison incohérente</span><h3>${esc(o.label)}</h3><p class="dates">${o.ranges.map((rg) => `${jourCourt(rg.startDate)} → ${jourCourt(rg.endDate)}`).join(' · ')}</p></div>
      <div class="case-body">
        <div class="ledger">
          ${[1, 2, 3, 4, 5, 6, 7].map((n) => { const p = n === 1 ? o.base : Number((o.tiers.find((x) => x.n === n) || {}).p ?? 0);
            const suspect = n > 2 && p < o.base * 0.1;
            return row(`Nuit ${n}`, suspect ? 'prix sans explication commerciale' : (n <= 2 ? 'prix plein' : 'nuit dégressive'), eur(p), suspect ? 'row-bad' : ''); }).join('')}
          ${row('Semaine facturée', 'somme des sept nuits ci-dessus', eur(o.semaine))}
          ${row('Semaine implicite', `sa propre nuit au-delà (${eur(o.queue)}) × 7`, eur(o.semaineImplicite), 'row-muted')}
          <div class="row row-total">
            <span class="row-label">Écart avec sa propre semaine implicite</span>
            <span class="row-calc">la saison se contredit elle-même</span>
            <span class="row-amount">${eur(r2(o.semaineImplicite - o.semaine))}</span>
          </div>
          <p class="note">${esc(IN.noteSaisonCassee || '')}</p>
        </div>
      </div>
    </article>`).join('')}
  </section>

  <section>
    <div class="sec-head">
      <h2>Le calendrier, en règles plutôt qu’en dates</h2>
      <p>Toutes les bornes de ${ANNEE} sauf une tombent un vendredi soir : le Gîte se découpe en semaines qui changent le samedi. Dit en règles, l’année entière se redéduit chaque année sans que personne ne repeigne un calendrier.</p>
    </div>
    <div class="rules">
      <div class="rule"><span class="rule-n">base</span><span class="rule-txt">Toute l’année</span>${chip(byKey[R.calendar.baseSeason])}</div>
      ${R.calendar.periods.map((p, i) => `<div class="rule"><span class="rule-n">${i + 1}</span><span class="rule-txt">${esc(IN.reglesCalendrier?.[p.id] || p.id)}</span>${chip(byKey[p.season])}</div>`).join('\n      ')}
      ${R.calendar.modifiers.map((m) => `<div class="rule"><span class="rule-n">+</span><span class="rule-txt">${esc(IN.reglesCalendrier?.ponts || 'Les ponts fériés montent d’un cran')}</span><span class="chip" style="color:var(--miel)">plafonné à ${esc(byKey[m.capSeason]?.label || 'la saison la plus haute')}</span></div>`).join('')}
    </div>
    <div class="years" style="margin-top:1.25rem">
      ${ANNEES.map((y) => `<div class="year"><h3>${y}</h3>
        ${seasons.filter((s) => (plans[y][s.key] || []).length).map((s) => `<div class="band">${chip(s)}<span class="dates">${(plans[y][s.key]).map((rg) => `${jourCourt(rg.startDate)}${rg.startDate === rg.endDate ? '' : ' → ' + jourCourt(rg.endDate)}${rg.minNights ? ` <span style="color:var(--miel)">min ${rg.minNights} n</span>` : ''}`).join(' · ')}</span></div>`).join('\n        ')}
      </div>`).join('\n      ')}
    </div>
    <div class="flags" style="margin-top:1.25rem">
      ${derives.length ? `<div class="flag"><span class="flag-mark">!</span><div>
        <h3>${derives.length} jour${derives.length > 1 ? 's' : ''} que les règles corrigent en ${ANNEE}</h3>
        <p>${derives.map((d) => `<strong>${jour(d)}</strong> : ${esc(joursAnciens[d])} → ${esc(byKey[joursSocle[d]].label)}`).join('<br>')}</p>
        <p>${esc(IN.noteDerive || '')}</p>
      </div></div>` : ''}
      ${ajouts.length ? `<div class="flag" style="background:var(--card);border-color:var(--rule)"><span class="flag-mark" style="color:var(--sapin)">+</span><div>
        <h3 style="color:var(--sapin)">${ajouts.length} nuit${ajouts.length > 1 ? 's' : ''} que la recette change délibérément en ${ANNEE}</h3>
        <p>${(() => { const g = []; for (const d of ajouts) { const l = g[g.length - 1];
            if (l && Date.parse(d) - Date.parse(l.fin) === DAY && joursSocle[d] === joursSocle[l.debut] && joursNouveaux[d] === joursNouveaux[l.debut]) l.fin = d;
            else g.push({ debut: d, fin: d }); }
          return g.map((x) => `<strong>${jour(x.debut)}${x.debut === x.fin ? '' : ' → ' + jour(x.fin)}</strong> : ${esc(byKey[joursSocle[x.debut]].label)} → ${esc(byKey[joursNouveaux[x.debut]].label)}`).join('<br>'); })()}</p>
        <p>${esc(IN.noteAjouts || '')}</p>
      </div></div>` : ''}
    </div>
  </section>

  ${pontsParAnnee.some((p) => p.blocs.length) ? `<section>
    <div class="sec-head">
      <h2>Les ponts fériés</h2>
      <p>${esc(IN.notePonts || '')}</p>
    </div>
    <div class="years">
      ${pontsParAnnee.filter((p) => p.blocs.length).map((p) => `<div class="year"><h3>${p.annee}</h3>
        ${p.blocs.map((b) => `<div class="band">${chip(b.saison)}<span class="dates">${jourCourt(b.startDate)}${b.startDate === b.endDate ? '' : ' → ' + jourCourt(b.endDate)} · minimum ${b.minNights} nuits</span></div>`).join('\n        ')}
      </div>`).join('\n      ')}
    </div>
  </section>` : ''}

  <section>
    <div class="sec-head">
      <h2>Les mêmes prix sur les autres plateformes</h2>
      <p>${esc(IN.pivotIntro || `Chaque canal est regrossi depuis le net plancher, jamais depuis un prix affiché — un prix contient déjà une marge, un net n'en contient pas.${UPLIFT ? ` La ligne directe porte en plus ${eur0(UPLIFT)} par nuit, que la grille n'applique qu'à elle.` : ''}`)}</p>
    </div>
    <div class="scroll">
      <table>
        <thead><tr><th>Canal</th><th>Commission</th>${seasons.map((s) => `<th>${esc(s.label)}</th>`).join('')}</tr></thead>
        <tbody>
          ${canaux.map((c) => `<tr class="${c.propre ? 'is-direct' : ''}${IN.canauxDouteux?.includes(c.nom) ? ' is-flagged' : ''}"><td>${esc(c.nom)}</td><td>${pct(c.commissionPct)}</td>${c.prix.map((p, i) => `<td${IN.saisonsProvisoires?.includes(seasons[i].key) ? ' class="provisoire"' : ''}>${eur0(p)}</td>`).join('')}</tr>`).join('\n          ')}
        </tbody>
      </table>
    </div>
    ${IN.noteCanaux ? `<p class="note">${esc(IN.noteCanaux)}</p>` : ''}
  </section>

  <section>
    <div class="sec-head">
      <h2>Contrôle : les ${sejours.length} séjours ${ANNEE} repassés dans la nouvelle grille</h2>
      <p>Chaque séjour déjà au planning, retarifé par la recette et comparé à ce que la grille actuelle facture. Un écart doit avoir une cause nommable — sinon la recette n’est pas fidèle.</p>
    </div>
    <div class="scroll">
      <table>
        <thead><tr><th>Séjour</th><th>Nuits</th><th>Pers.</th><th>Canal</th><th>Grille actuelle</th><th>Nouvelle grille</th><th>Écart</th></tr></thead>
        <tbody>
          ${sejours.map((sj) => `<tr><td>${jourCourt(sj.du)} → ${jourCourt(sj.au)}</td><td>${sj.nuits}</td><td>${sj.pax || '—'}</td><td>${esc(sj.canal)}</td><td>${eur(sj.avant)}</td><td>${eur(sj.apres)}</td><td class="${sj.ecart ? 'up total' : 'same'}">${sj.ecart ? '+' + eur(sj.ecart) : '—'}</td></tr>`).join('\n          ')}
          <tr class="is-sum"><td>Total</td><td></td><td></td><td></td><td>${eur(totalAvant)}</td><td>${eur(totalApres)}</td><td class="up">+${eur(r2(totalApres - totalAvant))}</td></tr>
        </tbody>
      </table>
    </div>
    <p class="note">${sejours.length - bouges.length} séjours sur ${sejours.length} au centime près. ${esc(IN.noteIso || '')}</p>
  </section>

  ${cas.length ? `<section>
    <div class="sec-head">
      <h2>Le détail, cas par cas</h2>
      <p>Le calcul se lit ligne à ligne. Ces mêmes totaux sont vérifiés par la suite de tests du serveur, qui les fait passer par le vrai moteur de devis — deux chemins indépendants pour un seul chiffre.</p>
    </div>
    <div class="cases">${cas.map(carteCas).join('\n')}</div>
  </section>` : ''}

  ${(IN.reserves || []).length ? `<section>
    <div class="sec-head"><h2>${IN.reserves.length > 1 ? 'Réserves à lever' : 'Réserve à lever'}</h2>
    <p>Rien ne part sur un canal avant que celles-ci soient tranchées.</p></div>
    <div class="flags">
      ${IN.reserves.map((rv) => `<div class="flag"><span class="flag-mark">!</span><div><h3>${esc(rv.titre)}</h3><p>${esc(rv.texte)}</p>${rv.id === 'gdf' ? `
        <div class="scroll" style="margin-top:.8rem"><table style="min-width:24rem">
          <thead><tr><th>Séjour</th><th>Brut</th><th>Commission</th><th>Taux</th></tr></thead>
          <tbody>${IN.gdf.map((g) => `<tr><td>${jourCourt(g.date)}</td><td>${eur(g.brut)}</td><td>${eur(g.com)}</td><td>${pct((100 * g.com) / g.brut)}</td></tr>`).join('')}
          <tr class="is-sum"><td>Ensemble</td><td>${eur(gdfTotalBrut)}</td><td>${eur(gdfTotalCom)}</td><td>${pct(gdfTaux)}</td></tr></tbody>
        </table></div>` : ''}</div></div>`).join('\n      ')}
    </div>
  </section>` : ''}

  <section>
    <div class="sec-head">
      <h2>Ce que cette page a vérifié</h2>
      <p>Chaque ligne est recalculée à l’ouverture du générateur, depuis le fichier de recette lui-même. Une seule qui tombe, et la page le dit en haut.</p>
    </div>
    <div class="checks">
      ${checks.map((c) => `<div class="chk${c.ok ? '' : ' is-bad'}"><span class="chk-mark">${c.ok ? '✓' : '✕'}</span><span>${esc(c.label)}</span><span class="chk-detail">${esc(c.detail)}</span></div>`).join('\n      ')}
    </div>
    ${IN.nonVerifie?.length ? `<div class="flags" style="margin-top:1.25rem"><div class="flag"><span class="flag-mark">?</span><div>
      <h3>Ce qui n’a pas été vérifié</h3>${IN.nonVerifie.map((t) => `<p>${esc(t)}</p>`).join('')}</div></div></div>` : ''}
  </section>

  <footer>${(IN.pied || []).map((t) => `<p>${esc(t)}</p>`).join('')}</footer>
</div>`;

writeFileSync(resolve(outPath), html);
console.log('écrit    :', resolve(outPath));
console.log('taille   :', (html.length / 1024).toFixed(0), 'Ko');
console.log('contrôles:', `${checks.length - echecs.length}/${checks.length} OK`);
for (const c of echecs) console.error('  ÉCHEC :', c.label, c.detail);
console.log('séjours  :', `${sejours.length - bouges.length}/${sejours.length} inchangés, ${bouges.length} déplacés`);
if (echecs.length) process.exitCode = 2;
