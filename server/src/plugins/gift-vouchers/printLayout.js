/**
 * The imposition of printed cards on A4 sheets (specs/gift-vouchers/gift-voucher-week-weekend-and-print.md rules 22-27): where each front, each back and each fold goes, in millimetres on
 * the sheet. Pure: no PDF, no database — the PDF builder draws from it and the print dialog previews it, so the two can never differ.
 *
 *   plan({ mode, perSheet, count, flip }) → { ok: true, layout } | { ok: false, field, message }
 *
 * `mode` is `recto-verso` (a sheet of fronts, then its sheet of backs, printed two-sided) or `side-by-side` (each card its front and its back next to each other, folded in the middle).
 * `flip` names the gesture that turns a two-sided sheet over, `left-right` (like a page of a book) or `top-bottom` (like a calendar): the back of a card lands where its front
 * lands once the sheet is turned — its column mirrored for the first, its row for the second. The cards are A6 (105 × 148 mm), reduced where the table of rule 26 says so.
 */

const CARD = Object.freeze({ width: 105, height: 148 });
const A4 = Object.freeze({ short: 210, long: 297 });
const MAX_COUNT = 200;

// Rule 26 — per mode and per sheet: the sheet's orientation, the grid of cards (or pairs) and their scale.
const TABLE = Object.freeze({
  'recto-verso': Object.freeze({
    1: { orientation: 'portrait', cols: 1, rows: 1, scale: 1 },
    2: { orientation: 'landscape', cols: 2, rows: 1, scale: 1 },
    4: { orientation: 'portrait', cols: 2, rows: 2, scale: 0.94 },
    8: { orientation: 'landscape', cols: 4, rows: 2, scale: 0.66 },
  }),
  'side-by-side': Object.freeze({
    1: { orientation: 'landscape', cols: 1, rows: 1, scale: 1 },
    2: { orientation: 'portrait', cols: 1, rows: 2, scale: 0.94 },
    4: { orientation: 'landscape', cols: 2, rows: 2, scale: 0.66 },
  }),
});
const MODES = Object.freeze(Object.keys(TABLE));
const FLIPS = Object.freeze(['left-right', 'top-bottom']);

const round = (n) => Math.round(n * 100) / 100;
const refuse = (field, message) => ({ ok: false, field, message });

function check({ mode, perSheet, count, flip }) {
  if (!MODES.includes(mode)) return refuse('mode', 'Mode : « recto-verso » ou « côte à côte, à plier » est attendu.');
  const offered = Object.keys(TABLE[mode]).map(Number);
  if (!offered.includes(perSheet)) return refuse('perSheet', `Cartes par feuille : ${offered.join(', ')} pour ce mode.`);
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return refuse('count', `Nombre de cartes : un nombre entier de 1 à ${MAX_COUNT}.`);
  if (mode === 'recto-verso' && !FLIPS.includes(flip)) return refuse('flip', 'Retournement : « de gauche à droite » ou « de haut en bas » est attendu.');
  return null;
}

/** The sheet and the cells of one page; `cards` are the numbers (1-based) of the cards it holds, in reading order. */
function geometry(mode, perSheet) {
  const row = TABLE[mode][perSheet];
  const width = row.orientation === 'portrait' ? A4.short : A4.long;
  const height = row.orientation === 'portrait' ? A4.long : A4.short;
  const cell = { width: round(CARD.width * row.scale * (mode === 'side-by-side' ? 2 : 1)), height: round(CARD.height * row.scale) };
  const gridWidth = cell.width * row.cols;
  const gridHeight = cell.height * row.rows;
  const left = (width - gridWidth) / 2;
  const top = (height - gridHeight) / 2;
  return {
    row, width, height, cell, left, top,
  };
}

/** `{ x, y }` of the cell in column `col` and row `row`. */
const originOf = (g, col, rowIndex) => ({ x: round(g.left + col * g.cell.width), y: round(g.top + rowIndex * g.cell.height) });

function rectoVerso(g, cards, flip) {
  const { cols, rows } = g.row;
  const fronts = cards.map((card, i) => ({
    card, face: 'front', ...originOf(g, i % cols, Math.floor(i / cols)), widthMm: round(CARD.width * g.row.scale), heightMm: round(CARD.height * g.row.scale),
  }));
  const backs = cards.map((card, i) => {
    const col = i % cols;
    const rowIndex = Math.floor(i / cols);
    const at = flip === 'left-right' ? originOf(g, cols - 1 - col, rowIndex) : originOf(g, col, rows - 1 - rowIndex);
    return {
      card, face: 'back', ...at, widthMm: round(CARD.width * g.row.scale), heightMm: round(CARD.height * g.row.scale),
    };
  });
  return [fronts, backs];
}

function sideBySide(g, cards) {
  const { cols } = g.row;
  const half = round(CARD.width * g.row.scale);
  const heightMm = round(CARD.height * g.row.scale);
  const cells = [];
  const folds = [];
  cards.forEach((card, i) => {
    const at = originOf(g, i % cols, Math.floor(i / cols));
    cells.push({
      card, face: 'front', x: at.x, y: at.y, widthMm: half, heightMm,
    });
    cells.push({
      card, face: 'back', x: round(at.x + half), y: at.y, widthMm: half, heightMm,
    });
    folds.push({
      x1: round(at.x + half), y1: at.y, x2: round(at.x + half), y2: round(at.y + heightMm),
    });
  });
  return { cells, folds };
}

/**
 * → `{ ok: true, layout }`: `layout = { mode, perSheet, count, flip, scale, sheetCount, pageCount, pages: [{ number, sheet: { orientation, widthMm, heightMm }, cells: [{ card, face, xMm, yMm, widthMm, heightMm }], folds: [...], marks }] }`
 * or `{ ok: false, field, message }` with the sentence the dialog shows under the field.
 */
function plan(input) {
  const asked = {
    mode: input.mode, perSheet: Number(input.perSheet), count: Number(input.count), flip: input.mode === 'recto-verso' ? input.flip : null,
  };
  const problem = check(asked);
  if (problem) return problem;
  const g = geometry(asked.mode, asked.perSheet);
  const sheet = { orientation: g.row.orientation, widthMm: g.width, heightMm: g.height };
  const pages = [];
  for (let first = 1; first <= asked.count; first += asked.perSheet) {
    const cards = Array.from({ length: Math.min(asked.perSheet, asked.count - first + 1) }, (_, i) => first + i);
    if (asked.mode === 'recto-verso') {
      rectoVerso(g, cards, asked.flip).forEach((cells) => pages.push({
        number: pages.length + 1, sheet, cells: cells.map(({ x, y, ...rest }) => ({ ...rest, xMm: x, yMm: y })), folds: [], marks: false,
      }));
    } else {
      const { cells, folds } = sideBySide(g, cards);
      pages.push({
        number: pages.length + 1, sheet, cells: cells.map(({ x, y, ...rest }) => ({ ...rest, xMm: x, yMm: y })), folds, marks: true,
      });
    }
  }
  return {
    ok: true,
    layout: {
      mode: asked.mode, perSheet: asked.perSheet, count: asked.count, flip: asked.flip, scale: g.row.scale, sheetCount: Math.ceil(asked.count / asked.perSheet), pageCount: pages.length, pages,
    },
  };
}

module.exports = {
  plan, check, CARD, A4, MAX_COUNT, MODES, FLIPS, TABLE,
};
