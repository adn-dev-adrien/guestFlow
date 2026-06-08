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

export function evaluateArithmetic(input) {
  if (input == null) return null;
  const s = String(input).replace(/,/g, '.').trim();
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
