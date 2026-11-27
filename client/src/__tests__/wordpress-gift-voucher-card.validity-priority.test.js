// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rule 20 — the website's back keeps « Valable jusqu'au » when the room runs out (the contents give way first, then the
// message), inside the same safe frame as the other lines, and keeps the subtitle's gap when no names are typed, as the PDF does.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../../integrations/wordpress/guestflow-booking/assets');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'voucher-card.js'), 'utf8');
const rule = (selector) => {
  const found = new RegExp(`^${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'm').exec(css);
  expect(found, selector).toBeTruthy();
  return found[1];
};

test('the validity is the one line that never shrinks; the contents shrink before the message', () => {
  expect(rule('.gf-v-valid')).toMatch(/flex: none/);
  expect(rule('.gf-v-message')).toMatch(/flex: 0 1 auto/);
  expect(rule('.gf-v-includes')).toMatch(/flex: 0 3 auto/);
  expect(rule('.gf-v-safe')).toMatch(/overflow: hidden/);
});

test('the validity sits inside the safe frame, after the contents and the message', () => {
  const order = [...js.matchAll(/safe\.appendChild\((\w+)\)/g)].map((m) => m[1]);
  expect(order.indexOf('valid')).toBeGreaterThan(order.indexOf('message'));
  expect(order.indexOf('message')).toBeGreaterThan(order.indexOf('includes'));
});

test('an empty subtitle is not hidden: its gap stays', () => {
  expect(js).not.toMatch(/subtitle\.hidden/);
  expect(rule('.gf-v-subtitle')).toMatch(/margin-bottom/);
});
