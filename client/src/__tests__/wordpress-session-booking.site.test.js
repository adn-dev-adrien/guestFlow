// specs/site/site-outside-resource-booking.md rules 18-20 — the pieces of the connector around the tunnel: the alias block draws the same tunnel, the permanent link `/utiliser` leads to the page that holds
// either block, the purchase page links to it (and only when a page holds it), and the voucher card stands straight.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';
import { setup, resetPage } from './wordpressSessionFixtures';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../integrations/wordpress/guestflow-booking');
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');

afterEach(resetPage);

test('rule 18 — « Utiliser un bon cadeau » stays registered and draws the same tunnel: same mount point, the session block’s own script', () => {
  const alias = read('blocks/gift-voucher-use/render.php');
  expect(alias).toContain('data-gf-session-booking');
  expect(read('blocks/gift-voucher-use/block.json')).toContain('"name": "guestflow/gift-voucher-use"');
  expect(fs.existsSync(path.join(PLUGIN, 'blocks/gift-voucher-use/view.js'))).toBe(false);
  const blocks = read('includes/class-gf-blocks.php');
  expect(blocks).toMatch(/VIEW_OF = \['gift-voucher-use' => 'session-booking'\]/);
  expect(read('blocks/session-booking/render.php')).toContain('data-gf-session-booking');
  expect(read('includes/class-gf-shortcodes.php')).toContain("add_shortcode('guestflow_session_booking'");
  expect(read('includes/class-gf-shortcodes.php')).toContain("add_shortcode('guestflow_gift_voucher_use'");
});

test('rule 18 — the alias block’s container runs the tunnel: a page holding it still works', async () => {
  document.body.innerHTML = '<div data-gf-session-booking class="gf-block gf-session-block"></div>';
  setup();
  expect(await screen.findByText('Réserver une séance')).toBeTruthy();
});

test('rule 18 — `/<base>/utiliser` leads to the page holding either block, whatever the vouchers do; a page holding both blocks initialises once', async () => {
  const redirects = read('includes/class-gf-redirects.php');
  expect(redirects).toContain('private function use_target()');
  expect(redirects).not.toMatch(/use_target\(\)[\s\S]*gift-vouchers\/offer/);
  const settings = read('includes/class-gf-settings.php');
  expect(settings).toMatch(/'gift_voucher_use' => \['<!-- wp:guestflow\/session-booking', '\[guestflow_session_booking\]', '<!-- wp:guestflow\/gift-voucher-use'\]/);
  document.body.innerHTML = '<div data-gf-session-booking></div>';
  const { calls } = setup();
  await screen.findByText('Réserver une séance');
  const container = document.querySelector('[data-gf-session-booking]');
  expect(container.getAttribute('data-gf-ready')).toBe('1');
  const before = calls.length;
  // A second script run over the same container (the alias handle enqueued next to the block's own) draws nothing twice.
  new Function(read('blocks/session-booking/view.js'))(); // eslint-disable-line no-new-func
  expect(document.querySelectorAll('.gf-sb')).toHaveLength(1);
  expect(calls.length).toBe(before);
});

test('rule 19 — the purchase page links to the session page below the form, and only when a page holds the block', async () => {
  const GV = ['assets/voucher-code.js', 'assets/voucher-parts.js', 'assets/voucher-card.js'];
  const campaign = {
    available: true,
    campaigns: [{
      slug: 'montant', kind: 'lodging', title: 'Un séjour', name: 'Séjour', amount: { minCents: 5000, maxCents: 50000 }, ideas: [], validityMonths: 12, hasFront: false,
    }],
  };
  const routes = () => ({ status: 200, body: { data: campaign } });
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  loadBlock('blocks/gift-voucher/view.js', { routes, assets: GV, config: { sessionPageUrl: 'https://site.example/reserver-une-seance/' } });
  const link = await screen.findByText('Réserver votre séance');
  expect(link.getAttribute('href')).toBe('https://site.example/reserver-une-seance/');
  expect(screen.getByText('Vous avez reçu un bon cadeau ?')).toBeTruthy();
  expect(link.closest('.gf-gv-uselink').compareDocumentPosition(document.querySelector('.gf-gv-pay')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  resetPage();
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  loadBlock('blocks/gift-voucher/view.js', { routes, assets: GV, config: { sessionPageUrl: '' } });
  await screen.findByText('Payer', { exact: false });
  expect(screen.queryByText('Réserver votre séance')).toBeNull();
});

test('rule 20 — the voucher card stands straight: no rotation in the rule or the keyframes, the entrance keeps its fade and rise, and none under reduced motion (the turn of specs/gift-vouchers/gift-voucher-campaigns.md rule 66 is the only rotation)', () => {
  const css = read('assets/style.css');
  const rule = css.split('\n').find((line) => line.startsWith('.gf-card {'));
  expect(rule).toBeTruthy();
  expect(rule).not.toMatch(/rotate/);
  expect(rule).toContain('animation: gf-gv-front-in');
  const keyframes = css.split('\n').find((line) => line.startsWith('@keyframes gf-gv-front-in'));
  expect(keyframes).not.toMatch(/rotate/);
  expect(keyframes).toMatch(/opacity: 0; transform: translateY\(10px\)/);
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.gf-card \{ animation: none; \}/);
});

test('rule 2 — the tunnel’s layout: two columns with a sticky recap from 900 px of block width, one column and, on a phone, a sticky bar below', () => {
  const css = read('assets/style.css');
  expect(css).toMatch(/\.gf-booking-block, \.gf-session-block \{ container: gf-host \/ inline-size; \}/);
  expect(css).toMatch(/@container gf-host \(min-width: 900px\) \{\s*\.gf-sb \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 340px;/);
  expect(css).toMatch(/\.gf-sb > \.gf-summary \{[^}]*position: sticky;/);
  expect(css).toMatch(/@media \(pointer: coarse\), \(max-width: 600px\) \{\s*@container gf-host \(max-width: 899\.98px\) \{\s*\.gf-sb > \.gf-bar \{[^}]*position: sticky; bottom: 0;/);
});
