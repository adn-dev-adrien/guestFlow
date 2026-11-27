// specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 22-27 — the imposition of cards on A4 sheets (every row of the table of rule 26, both flips, the page count of a partial last
// sheet, the refusals), and the two ways it is served: the layout as JSON for the dialog's preview and the PDF drawn from that very layout, for the merchant card and for a voucher.
process.env.DB_PATH = ':memory:';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const { plan } = require('../printLayout');

const ok = (input) => {
  const planned = plan(input);
  assert.equal(planned.ok, true, JSON.stringify(planned));
  return planned.layout;
};
const rect = (cell) => ({
  left: cell.xMm, top: cell.yMm, right: cell.xMm + cell.widthMm, bottom: cell.yMm + cell.heightMm,
});

// Rule 26 — [mode, per sheet, orientation, scale, cards per row, rows]
const TABLE = [
  ['recto-verso', 1, 'portrait', 1, 1, 1],
  ['recto-verso', 2, 'landscape', 1, 2, 1],
  ['recto-verso', 4, 'portrait', 0.94, 2, 2],
  ['recto-verso', 8, 'landscape', 0.66, 4, 2],
  ['side-by-side', 1, 'landscape', 1, 1, 1],
  ['side-by-side', 2, 'portrait', 0.94, 1, 2],
  ['side-by-side', 4, 'landscape', 0.66, 2, 2],
];

TABLE.forEach(([mode, perSheet, orientation, scale, cols, rows]) => {
  ['left-right', 'top-bottom'].forEach((flip) => {
    test(`rule 26 — ${mode}, ${perSheet} per sheet, ${flip}: ${orientation} A4 at ${scale * 100} %, ${cols} × ${rows}, every cell inside the sheet and none overlapping`, () => {
      const layout = ok({ mode, perSheet, count: perSheet, flip });
      const [first] = layout.pages;
      assert.deepEqual([first.sheet.orientation, layout.scale], [orientation, scale]);
      assert.deepEqual([first.sheet.widthMm, first.sheet.heightMm], orientation === 'portrait' ? [210, 297] : [297, 210]);
      const cells = layout.pages.flatMap((page) => page.cells.map((cell) => ({ page, cell })));
      cells.forEach(({ page, cell }) => {
        const r = rect(cell);
        assert.ok(r.left >= -0.01 && r.top >= -0.01 && r.right <= page.sheet.widthMm + 0.01 && r.bottom <= page.sheet.heightMm + 0.01, `card ${cell.card} ${cell.face} is on the sheet`);
        assert.equal(cell.widthMm, Math.round(105 * scale * 100) / 100);
      });
      layout.pages.forEach((page) => {
        page.cells.forEach((a, i) => page.cells.slice(i + 1).forEach((b) => {
          const ra = rect(a);
          const rb = rect(b);
          const overlap = ra.left < rb.right - 0.02 && rb.left < ra.right - 0.02 && ra.top < rb.bottom - 0.02 && rb.top < ra.bottom - 0.02;
          assert.equal(overlap, false, `cards ${a.card}/${a.face} and ${b.card}/${b.face} do not overlap`);
        }));
      });
      assert.equal(layout.pages[0].cells.filter((c) => c.face === 'front').length, mode === 'recto-verso' ? perSheet : perSheet);
    });
  });
});

test('rule 24 — recto-verso: odd pages are fronts, even pages backs; the back of a card lands where its front does once the sheet is turned (columns mirrored, or rows)', () => {
  const lr = ok({ mode: 'recto-verso', perSheet: 8, count: 8, flip: 'left-right' });
  const tb = ok({ mode: 'recto-verso', perSheet: 8, count: 8, flip: 'top-bottom' });
  [lr, tb].forEach((layout) => {
    assert.deepEqual(layout.pages.map((p) => [...new Set(p.cells.map((c) => c.face))]), [['front'], ['back']]);
  });
  const at = (layout, page, card) => layout.pages[page].cells.find((c) => c.card === card);
  // Card 1 is the top-left front; turned left to right its back is the top-right, turned top to bottom the bottom-left.
  assert.deepEqual([at(lr, 0, 1).xMm, at(lr, 0, 1).yMm], [9.9, 7.32]);
  assert.deepEqual([at(lr, 1, 1).xMm, at(lr, 1, 1).yMm], [217.8, 7.32]);
  assert.deepEqual([at(tb, 1, 1).xMm, at(tb, 1, 1).yMm], [9.9, 105]);
  // The back of card 4 (top-right front) is the top-left, left to right.
  assert.deepEqual([at(lr, 1, 4).xMm, at(lr, 1, 4).yMm], [9.9, 7.32]);
});

test('rule 24 — the last sheet holds what remains: 9 cards at 8 per sheet are 4 pages, fronts 1-8, backs 1-8, front 9, back 9', () => {
  const layout = ok({ mode: 'recto-verso', perSheet: 8, count: 9, flip: 'left-right' });
  assert.deepEqual([layout.sheetCount, layout.pageCount], [2, 4]);
  assert.deepEqual(layout.pages.map((p) => [p.number, p.cells[0].face, p.cells.map((c) => c.card)]), [
    [1, 'front', [1, 2, 3, 4, 5, 6, 7, 8]], [2, 'back', [1, 2, 3, 4, 5, 6, 7, 8]], [3, 'front', [9]], [4, 'back', [9]],
  ]);
  assert.equal(layout.pages[3].cells[0].xMm, 217.8, 'the back of the 9th card is mirrored in the full grid, its front being in the first column');
});

test('rule 25 — side by side: each card is its front and its back next to each other with a dotted fold line between them, crop marks around the pair, one page per sheet', () => {
  const layout = ok({ mode: 'side-by-side', perSheet: 2, count: 3 });
  assert.deepEqual([layout.sheetCount, layout.pageCount], [2, 2]);
  const [first, second] = layout.pages;
  assert.equal(first.marks, true);
  assert.deepEqual(first.cells.map((c) => [c.card, c.face]), [[1, 'front'], [1, 'back'], [2, 'front'], [2, 'back']]);
  assert.equal(first.folds.length, 2);
  const [front, back] = first.cells;
  assert.equal(front.xMm + front.widthMm, back.xMm, 'the fold is where the two halves meet');
  assert.deepEqual([first.folds[0].x1, first.folds[0].x2], [back.xMm, back.xMm]);
  assert.equal(second.cells.length, 2);
});

test('rule 23, 27 — the refusals name their field with the sentence the dialog shows', () => {
  const refused = (input) => {
    const planned = plan(input);
    assert.equal(planned.ok, false);
    return [planned.field, planned.message];
  };
  assert.deepEqual(refused({ mode: 'poster', perSheet: 1, count: 1 }), ['mode', 'Mode : « recto-verso » ou « côte à côte, à plier » est attendu.']);
  assert.deepEqual(refused({ mode: 'recto-verso', perSheet: 3, count: 1, flip: 'left-right' }), ['perSheet', 'Cartes par feuille : 1, 2, 4, 8 pour ce mode.']);
  assert.deepEqual(refused({ mode: 'side-by-side', perSheet: 8, count: 1 }), ['perSheet', 'Cartes par feuille : 1, 2, 4 pour ce mode.']);
  [0, 201, 1.5, 'x'].forEach((count) => assert.equal(refused({ mode: 'recto-verso', perSheet: 1, count, flip: 'left-right' })[0], 'count', String(count)));
  assert.deepEqual(refused({ mode: 'recto-verso', perSheet: 1, count: 1, flip: 'diagonal' }), ['flip', 'Retournement : « de gauche à droite » ou « de haut en bas » est attendu.']);
  assert.equal(plan({ mode: 'side-by-side', perSheet: 1, count: 200 }).ok, true, 'the flip is not asked of a folded sheet');
});

// ── served ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const { requirePlugins } = require('../../sdk/testing');

if (requirePlugins(['hourly-resources'])) {
  const fx = require('./campaignFixtures');
  const campaignRules = require('../campaignRules');
  const images = require('../visualImages');
  const { picture } = require('./visualFixtures');
  const { filesDir } = require('./visualFilesFixture');

  const ids = fx.seedCatalogue();
  const { api } = fx.openShop();
  const checked = campaignRules.validateCampaign(fx.bathCampaign(ids, { slug: 'impression' }), fx.rulesContext(api));
  const campaign = api.campaigns.find(api.campaigns.insert(checked.value));
  const pageCount = (buffer) => (buffer.toString('latin1').match(/\/Type \/Page(?!s)/g) || []).length;
  const voucher = (() => {
    const issued = api.offerService.issueDirect({
      request: { slug: 'impression', period: 'week' },
      parties: { recipientFirstName: 'Marie', recipientLastName: 'Durand', senderName: 'Paul', message: '', email: '', language: 'fr' },
      outcome: 'paid',
      paymentMethod: 'cash',
      actor: 'user:7',
    });
    return issued.voucherId;
  })();

  test('rules 22, 27 — the layout is served as JSON, the merchant card prints as a PDF of that many pages and locks the slug; a refusal is a 400 with the field under which the dialog shows it', async () => {
    const bytes = await picture(1300, 1832, { format: 'png', background: '#aa5500' });
    const visualId = api.visuals.insert({ name: 'Carte', use: 'merchant', file: { path: images.store(bytes, filesDir(), 'png'), width: 1300, height: 1832 } });
    api.campaigns.update(campaign.id, { ...api.campaigns.find(campaign.id), merchantVisualId: visualId });
    const server = await fx.serve(api);
    try {
      const base = `${server.base}/api/gift-vouchers/campaigns/${campaign.id}`;
      const query = '?mode=recto-verso&perSheet=8&count=9&flip=left-right';
      const layout = await (await fetch(`${base}/print-layout${query}`)).json();
      assert.deepEqual([layout.sheetCount, layout.pageCount], [2, 4]);
      assert.equal(api.campaigns.find(campaign.id).slugLockedAt, null, 'a preview prints nothing');
      const res = await fetch(`${base}/print.pdf${query}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'application/pdf');
      assert.equal(pageCount(Buffer.from(await res.arrayBuffer())), 4, 'one PDF page per page of the layout');
      assert.ok(api.campaigns.find(campaign.id).slugLockedAt, 'the link is printed');
      const side = await fetch(`${base}/print.pdf?mode=side-by-side&perSheet=2&count=3`);
      assert.equal(pageCount(Buffer.from(await side.arrayBuffer())), 2);
      const bad = await fetch(`${base}/print.pdf?mode=recto-verso&perSheet=8&count=0&flip=left-right`);
      assert.equal(bad.status, 400);
      assert.deepEqual(await bad.json(), { error: 'Nombre de cartes : un nombre entier de 1 à 200.', code: 'PRINT_INVALID', field: 'count' });
      assert.equal((await fetch(`${base}/print-layout?mode=recto-verso&perSheet=3&count=1&flip=left-right`)).status, 400);
    } finally {
      await server.close();
    }
  });

  test('rules 22, 27 — a voucher prints the same way, its own front and back', async () => {
    const server = await fx.serve(api);
    try {
      const base = `${server.base}/api/gift-vouchers/${voucher}`;
      const layout = await (await fetch(`${base}/print-layout?mode=side-by-side&perSheet=4&count=5`)).json();
      assert.equal(layout.pageCount, 2);
      const res = await fetch(`${base}/print.pdf?mode=recto-verso&perSheet=2&count=3&flip=top-bottom`);
      assert.equal(res.status, 200);
      assert.equal(pageCount(Buffer.from(await res.arrayBuffer())), 4);
      assert.equal((await fetch(`${base}/print.pdf?mode=recto-verso&perSheet=2&count=3&flip=sideways`)).status, 400);
    } finally {
      await server.close();
    }
  });
}
