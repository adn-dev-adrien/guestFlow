#!/usr/bin/env node
// Imports the Domaine Solio welcome booklet (livret.mjs) into a GuestFlow's booklet studio, through the studio's own
// admin API (specs/guest-app.md §4.3): the same writes the studio makes, with the same validations.
//
//   node specs/guest-app-livret/import.mjs --base https://guestflow.example.com --email admin@example.com [--dry-run]
//
// The password (and the second-factor code when the account asks for one) are typed at the prompt, or read from
// GUESTFLOW_PASSWORD; the password is never echoed (prompt.mjs). Node 20 or later, nothing to install.
//
// What it does, per lodging (La Granja, L'Estiva, found by name; --granja / --estiva give their ids instead):
//   1. refuses to run when a lodging's booklet holds a page the operator has already edited (never overwrites work);
//   2. uploads the three photos (fire-lighting steps, evacuation plans);
//   3. deletes the neutral starter pages, creates the booklet's pages (shared pages once, placed in both lodgings),
//      their blocks (lodging-only blocks restricted with « Pour ce logement seulement »), sets the page order;
//   4. publishes both lodgings.
// First of all, the J-7 and J-2 e-mails get their « Mon séjour » paragraph (French and English), unless the link is
// already there; this step runs even when the booklet was imported before. It writes `body` and `bodyEn` only: the
// subject, `enabled` and `sendMode` of a template are never touched (every template stays manual unless the operator
// chose otherwise).
// --dry-run checks the login, the lodgings and the booklets, and prints the plan without writing anything.

import { readFile } from 'node:fs/promises';
import { argv, env, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LODGINGS, MEDIA, PAGES } from './livret.mjs';
import { ask, askSecret } from './prompt.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(argv.slice(2).reduce((out, arg, i, all) => {
  if (arg.startsWith('--')) out.push([arg.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
  return out;
}, []));
const BASE = String(args.base || '').replace(/\/+$/, '');
const DRY = Boolean(args['dry-run']);
// Imported by a suite (it only reads the e-mail paragraphs), the script stays quiet; run as a command it needs its arguments.
const RUN_AS_COMMAND = argv[1] === fileURLToPath(import.meta.url);
if (RUN_AS_COMMAND && (!BASE || !args.email)) {
  console.error('Usage : node specs/guest-app-livret/import.mjs --base https://… --email admin@… [--dry-run] [--granja ID] [--estiva ID]');
  exit(2);
}

let cookie = '';
async function call(method, route, body, { form = false } = {}) {
  const headers = { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) };
  let payload;
  if (form) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${BASE}${route}`, { method, headers, body: payload, redirect: 'manual' });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status} ${(json && (json.message || json.error)) || text.slice(0, 200)}`);
  return json;
}

async function login() {
  const password = env.GUESTFLOW_PASSWORD || await askSecret('Mot de passe : ');
  const first = await call('POST', '/api/auth/login', { email: args.email, password });
  if (first && first.step === 'second-factor') {
    const code = await ask(`${first.message || 'Code de vérification'} : `);
    await call('POST', '/api/auth/2fa/verify', { code });
  }
  console.log('✓ Connecté.');
}

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function lodgingIds() {
  const { lodgings } = await call('GET', '/api/guest-app/studio/lodgings');
  const ids = {};
  for (const [key, name] of Object.entries(LODGINGS)) {
    if (args[key]) { ids[key] = Number(args[key]); continue; }
    const found = lodgings.filter((l) => norm(l.name) === norm(name));
    if (found.length !== 1) throw new Error(`Logement « ${name} » introuvable dans GuestFlow (${lodgings.map((l) => l.name).join(', ')}) : passez --${key} ID.`);
    ids[key] = found[0].propertyId;
  }
  return ids;
}

/** The bath sold in a lodging's shop, for the « Réserver un créneau » button; null when there is none. */
async function bathItem(propertyId) {
  const items = await call('GET', `/api/guest-app/items?propertyId=${propertyId}`);
  const list = Array.isArray(items) ? items : (items.items || []);
  const bath = list.find((i) => i.kind === 'resource' && i.sold && /bain/i.test(i.title));
  return bath ? { kind: 'item', itemKind: 'resource', itemId: bath.id } : null;
}

// The reminder e-mails' « Mon séjour » paragraph, placed before the « question » line (J-7, specs/guest-app.md rule 70 as amended
// 2026-11-10: no app name, nothing about paying, two short sentences) or the « call us » line / the sign-off (J-2, 2026-11-09).
// J-7: two flat blocks (the renderer's conditionals do not nest) — `hasStayAppBath` (orders can be taken and the stay holds the
// bath or an offered session) and `hasStayAppShopOnly` (orders without the bath), both computed by the server: the sentence never
// promises what the link does not give. J-2: under `hasStayApp`.
const EMAILS = [
  {
    key: 'arrival_reminder_7d',
    label: 'J-7',
    paragraph: {
      body: '{{#if hasStayAppBath}}Vous pouvez déjà commander ce que vous aimeriez trouver à votre arrivée, et programmer votre séance de bain nordique : {{stayAppUrl}}\n\n{{/if}}{{#if hasStayAppShopOnly}}Vous pouvez déjà commander ce que vous aimeriez trouver à votre arrivée : {{stayAppUrl}}\n\n{{/if}}',
      bodyEn: '{{#if hasStayAppBath}}You can already order anything you would like to find on arrival, and book your nordic bath session: {{stayAppUrl}}\n\n{{/if}}{{#if hasStayAppShopOnly}}You can already order anything you would like to find on arrival: {{stayAppUrl}}\n\n{{/if}}',
    },
    // At the anchor itself, never at its line start: in the J-7 that line opens with the `{{/if}}` of the previous block.
    anchors: { body: ['Une question'], bodyEn: ['Any question'] },
    atAnchor: true,
  },
  {
    key: 'arrival_reminder_1d',
    label: 'J-2',
    paragraph: {
      body: '{{#if hasStayApp}}Tout votre séjour tient dans « Mon séjour » : le portail, le livret, la boutique et le bain. Gardez ce lien sous la main : {{stayAppUrl}}\n\n{{/if}}',
      bodyEn: '{{#if hasStayApp}}Your whole stay fits in “Mon séjour”: the gate, the booklet, the shop and the bath. Keep this link handy: {{stayAppUrl}}\n\n{{/if}}',
    },
    anchors: { body: ['{{#if hasCompanyPhone}}Un imprévu', 'Bonne route'], bodyEn: ['{{#if hasCompanyPhone}}Something unexpected', 'Safe travels'] },
    atAnchor: false,
  },
];

/** → the template's new { body, bodyEn }, null when the link is already there; throws when no anchor is found. */
function withStayAppParagraph(template, email) {
  if (`${template.body || ''}${template.bodyEn || ''}`.includes('{{stayAppUrl}}')) return null;
  const out = {};
  for (const field of ['body', 'bodyEn']) {
    const text = template[field];
    if (!text) continue;
    const anchor = email.anchors[field].find((a) => text.includes(a));
    if (!anchor) throw new Error(`E-mail ${email.label} (${field === 'body' ? 'français' : 'anglais'}) : je ne trouve ni « ${email.anchors[field].join(' » ni « ')} ». Ajoutez le paragraphe à la main dans Paramètres › E-mails.`);
    const at = email.atAnchor ? text.indexOf(anchor) : text.lastIndexOf('\n', text.indexOf(anchor)) + 1;
    out[field] = `${text.slice(0, at)}${email.paragraph[field]}${text.slice(at)}`;
  }
  return out;
}

async function stayAppEmails() {
  const rows = await call('GET', '/api/email-templates');
  for (const email of EMAILS) {
    const row = (Array.isArray(rows) ? rows : []).find((r) => r.stableKey === email.key);
    if (!row) { console.warn(`⚠ E-mail ${email.label} introuvable : paragraphe « Mon séjour » non ajouté.`); continue; }
    const template = await call('GET', `/api/email-templates/${row.id}`);
    const next = withStayAppParagraph(template, email);
    if (!next) { console.log(`✓ E-mail ${email.label} : le lien « Mon séjour » y est déjà.`); continue; }
    if (DRY) { console.log(`E-mail ${email.label} : le paragraphe « Mon séjour » sera ajouté.`); continue; }
    // `body` and `bodyEn` only: subject, enabled and sendMode stay as the operator set them.
    await call('PUT', `/api/email-templates/${row.id}`, next);
    console.log(`✓ E-mail ${email.label} : paragraphe « Mon séjour » ajouté (français et anglais).`);
  }
}

export { withStayAppParagraph, EMAILS };

async function main() {
  await login();
  await stayAppEmails();
  const ids = await lodgingIds();
  console.log(`✓ Logements : ${Object.entries(LODGINGS).map(([k, n]) => `${n} #${ids[k]}`).join(', ')}.`);

  const booklets = {};
  for (const key of Object.keys(LODGINGS)) {
    booklets[key] = await call('GET', `/api/guest-app/studio/lodgings/${ids[key]}/booklet`);
    const edited = booklets[key].pages.filter((pg) => !pg.placeholder);
    if (edited.length) {
      throw new Error(`Le livret de ${LODGINGS[key]} contient déjà ${edited.length} page(s) modifiée(s) (${edited.map((pg) => pg.slug).join(', ')}). Rien n’a été écrit : supprimez-les dans le Studio, puis relancez.`);
    }
  }
  const bath = await bathItem(ids.granja);
  if (!bath) console.warn('⚠ Pas de bain nordique vendu dans la Boutique : le bouton « Réserver un créneau » est omis.');

  const plan = PAGES.map((pg) => `${pg.title.fr}${pg.only ? ` (${LODGINGS[pg.only]} seulement)` : ''} : ${pg.blocks.length} blocs`);
  console.log(`Plan : ${PAGES.length} pages\n  ${plan.join('\n  ')}`);
  if (DRY) { console.log('--dry-run : rien n’a été écrit.'); return; }

  const media = {};
  for (const [key, m] of Object.entries(MEDIA)) {
    const form = new FormData();
    form.append('file', new Blob([await readFile(path.join(HERE, m.file))], { type: 'image/jpeg' }), path.basename(m.file));
    form.append('altFr', m.alt.fr);
    form.append('altEn', m.alt.en);
    media[key] = (await call('POST', '/api/guest-app/studio/media', form, { form: true })).id;
  }
  console.log(`✓ ${Object.keys(media).length} photos envoyées.`);

  for (const key of Object.keys(LODGINGS)) {
    for (const pg of booklets[key].pages) await call('DELETE', `/api/guest-app/studio/pages/${pg.id}`);
  }

  const order = { granja: [], estiva: [] };
  for (const pg of PAGES) {
    const home = pg.only || 'granja';
    const page = await call('POST', `/api/guest-app/studio/lodgings/${ids[home]}/pages`, { slug: pg.slug, title: pg.title, icon: pg.icon });
    if (!pg.only) await call('POST', `/api/guest-app/studio/pages/${page.id}/placements`, { propertyId: ids.estiva });
    for (const b of pg.blocks) {
      let data = b.data;
      if (b.type === 'image') data = { mediaId: media[b.media] };
      if (b.type === 'button' && b.data.target.lookup === 'bath') {
        if (!bath) continue;
        data = { ...b.data, target: bath };
      }
      await call('POST', `/api/guest-app/studio/pages/${page.id}/blocks`, {
        type: b.type, data, onlyForPropertyIds: b.only ? [ids[b.only]] : null,
      });
    }
    (pg.only ? [pg.only] : Object.keys(LODGINGS)).forEach((k) => order[k].push(page.id));
    console.log(`✓ ${pg.title.fr}`);
  }

  for (const key of Object.keys(LODGINGS)) {
    await call('PUT', `/api/guest-app/studio/lodgings/${ids[key]}/booklet`, {
      pages: order[key].map((pageId, sortOrder) => ({ pageId, sortOrder, published: true })),
    });
    await call('POST', `/api/guest-app/studio/lodgings/${ids[key]}/publish`);
    console.log(`✓ Livret de ${LODGINGS[key]} publié : ${order[key].length} pages.`);
  }
}

if (RUN_AS_COMMAND) main().catch((err) => { console.error(`✗ ${err.message}`); exit(1); });
