// specs/gift-vouchers/gift-voucher-campaigns.md rule 66 — on a narrow block the card is as wide as the form (up to 420 px), and its root
// class is `gf-vcard`, never the bare `gf-card` a site theme may frame.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { screen } from '@testing-library/react';
import { loadBlock } from './wordpressBookingFixtures';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../integrations/wordpress/guestflow-booking');
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
const ASSETS = ['assets/voucher-code.js', 'assets/voucher-parts.js', 'assets/voucher-card.js'];

afterEach(() => { document.body.innerHTML = ''; delete window.GFBooking; window.location.hash = ''; });

test('rule 66 — the narrow card column takes the form width, capped at 420 px, and the wide layout still overrides it', () => {
  const css = read('assets/style.css');
  expect(css).toContain('.gf-card-col { min-width: 0; width: min(100%, 420px); justify-self: center; }');
  expect(css).toMatch(/@container gf-gv \(min-width: 600px\) \{[^@]*\.gf-gv-lead\.has-card > \.gf-card-col \{ width: 100%;/);
  expect(css).toContain('@container gf-gv (min-width: 900px) { .gf-gv-lead.has-card { grid-template-columns: 400px minmax(0, 1fr); } }');
});

test('rule 66 — no stylesheet rule and no script uses the bare gf-card class', () => {
  expect(read('assets/style.css')).not.toMatch(/\.gf-card([^-\w]|$)/);
  for (const file of ['assets/voucher-card.js', 'blocks/gift-voucher/view.js']) {
    expect(read(file)).not.toMatch(/['"\s.]gf-card(['"\s]|$)/);
  }
});

test('rule 66 — the card root rendered by voucher-card.js carries gf-vcard', async () => {
  document.body.innerHTML = '<div data-gf-gift-voucher></div>';
  const offer = {
    available: true,
    brand: 'Domaine Solio',
    termsVersionId: 4,
    validityMonths: 18,
    ideas: [],
    back: {
      layout: { trimMm: { width: 105, height: 148 }, pt: {}, lines: {}, lineHeight: {} },
      texts: { title: 'BON CADEAU' },
      design: {
        layout: { trimMm: { width: 105, height: 148 }, pt: {}, lines: {}, lineHeight: {} },
        voucherLayout: { trimMm: { width: 105, height: 148 }, pt: {}, lines: {}, lineHeight: {} },
        texts: { title: 'BON CADEAU', recipient: 'Pour {name}', sender: 'de la part de {name}', codePlaceholder: 'XXXX', validUntil: '{date}', bullet: '•' },
      },
      companyName: 'Domaine Solio',
    },
    campaigns: [{
      slug: 'sejour', kind: 'lodging', title: 'Bon cadeau', validityMonths: 18, minAmountCents: 2000, maxAmountCents: 200000, ideas: [], termsVersionId: 4,
      back: { lineTemplate: '{amount}', validUntil: '' },
    }],
  };
  loadBlock('blocks/gift-voucher/view.js', {
    routes: (method, p) => (p === '/gift-vouchers/offer'
      ? { status: 200, body: { data: offer } }
      : { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }),
    assets: ASSETS,
  });
  await screen.findByLabelText('Prénom');
  expect(document.querySelectorAll('.gf-vcard')).toHaveLength(1);
  expect(document.querySelector('.gf-card')).toBeNull();
});
