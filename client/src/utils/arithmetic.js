/**
 * Safe arithmetic evaluator for money input fields (specs/reservation-price-arithmetic.md).
 *
 * Supports `+ - * /`, parentheses, and decimal numbers (French comma `,` accepted as the decimal
 * separator). NO `eval` / `Function` — it tokenizes, converts to RPN (shunting-yard) and evaluates,
 * so arbitrary code can never run from a user-typed field.
 *
 * `evaluateArithmetic(input)` returns the numeric result, or `null` when the expression is empty,
 * malformed, or not finite (e.g. division by zero). Callers decide how to treat `null` (typically:
 * keep the previous value).
 *
 * Before parsing, the input goes through `normalizeMoneyInput`: an amount copied off a platform
 * statement (« 1 197,00 € ») is read as the number it obviously is, not rejected (rules 8-9).
 */

function tokenize(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ') { i += 1; continue; }
    if ('+-*/()'.includes(ch)) { tokens.push(ch); i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < s.length && /[0-9.]/.test(s[i])) { num += s[i]; i += 1; }
      if ((num.match(/\./g) || []).length > 1) return null;      // "1.2.3"
      if (!/^(?:\d+\.?\d*|\.\d+)$/.test(num)) return null;        // lone ".", etc.
      tokens.push(num);
      continue;
    }
    return null; // unsupported character
  }
  return tokens;
}

const PREC = { 'u-': 4, '*': 3, '/': 3, '+': 2, '-': 2 };
const RIGHT_ASSOC = { 'u-': true };

function toRPN(tokens) {
  const out = [];
  const ops = [];
  let prev = null; // 'num' | 'op' | '(' | ')' | null
  for (const t of tokens) {
    if (/^[0-9.]/.test(t)) {
      out.push(parseFloat(t));
      prev = 'num';
    } else if (t === '(') {
      ops.push(t);
      prev = '(';
    } else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop());
      if (!ops.length) return null; // mismatched parenthesis
      ops.pop();
      prev = ')';
    } else {
      let op = t;
      const unaryContext = prev === null || prev === 'op' || prev === '(';
      if (op === '+' && unaryContext) { continue; } // unary plus → no-op
      if (op === '-' && unaryContext) op = 'u-';
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top === '(') break;
        if (PREC[top] > PREC[op] || (PREC[top] === PREC[op] && !RIGHT_ASSOC[op])) out.push(ops.pop());
        else break;
      }
      ops.push(op);
      prev = 'op';
    }
  }
  while (ops.length) {
    const op = ops.pop();
    if (op === '(') return null; // mismatched parenthesis
    out.push(op);
  }
  return out;
}

function evalRPN(rpn) {
  const st = [];
  for (const tok of rpn) {
    if (typeof tok === 'number') { st.push(tok); continue; }
    if (tok === 'u-') {
      if (!st.length) return null;
      st.push(-st.pop());
      continue;
    }
    if (st.length < 2) return null;
    const b = st.pop();
    const a = st.pop();
    let r;
    if (tok === '+') r = a + b;
    else if (tok === '-') r = a - b;
    else if (tok === '*') r = a * b;
    else if (tok === '/') { if (b === 0) return null; r = a / b; }
    else return null;
    st.push(r);
  }
  return st.length === 1 ? st[0] : null;
}

// A currency symbol is decoration, never part of the arithmetic: the operator copies « 460,48 € »
// off the platform's statement and the field has to read the amount (rule 8).
const CURRENCY = /[\u20ac$\u00a3]|\bEUR\b/gi;

/**
 * Turns a human/statement-formatted amount into something the tokenizer understands: drops the
 * currency symbol, flattens every kind of Unicode space (NBSP, narrow NBSP, thin space — what a
 * copy-paste actually carries) and removes thousands separators. The decimal mark is left alone;
 * `evaluateArithmetic` still maps `,` to `.` afterwards.
 *
 * @param {string|number|null|undefined} input
 * @returns {string} the normalized expression (never null — an unreadable input stays unreadable
 *                   and is rejected further down the pipe)
 */
export function normalizeMoneyInput(input) {
  let s = String(input ?? '').replace(CURRENCY, ' ').replace(/\s+/g, ' ');

  // A dot groups thousands only when it cannot be the decimal mark: either a comma takes that role
  // after it (« 1.197,00 »), or there are several dots in an expression with nothing else in it
  // (« 1.234.567 »). Anywhere else `1.234` stays a decimal — `1.234+5.678` must not become 6912.
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const dotCount = (s.match(/\./g) || []).length;
  const dotGroupsThousands = (lastDot !== -1 && lastComma > lastDot)
    || (dotCount > 1 && !/[+\-*/()]/.test(s));
  if (dotGroupsThousands) s = s.replace(/(\d)\.(?=\d{3}(?!\d))/g, '$1');

  // A space between a digit and a group of exactly three digits is a thousands separator, not a
  // missing operator: « 1 197 » is 1197. Spaces around an operator (« 100 + 20 ») are untouched.
  return s.replace(/(\d) (?=\d{3}(?!\d))/g, '$1').trim();
}

export function evaluateArithmetic(input) {
  if (input == null) return null;
  const s = normalizeMoneyInput(input).replace(/,/g, '.');
  if (s === '') return null;
  const tokens = tokenize(s);
  if (!tokens || tokens.length === 0) return null;
  const rpn = toRPN(tokens);
  if (!rpn) return null;
  const result = evalRPN(rpn);
  if (result == null || !Number.isFinite(result)) return null;
  return result;
}

export default evaluateArithmetic;
