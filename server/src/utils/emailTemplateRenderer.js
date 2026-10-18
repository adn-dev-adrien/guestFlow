/**
 * Email template renderer — pure (specs/email-automation.md §3 rule 3 + rule 4).
 *
 * Two passes against the input text:
 *
 *   1. **Conditional blocks** — single level (no nesting). Syntax:
 *        {{#if conditionName}} ... {{/if}}
 *        {{#if conditionName}} ... {{else}} ... {{/if}}
 *      The condition name is looked up in `context.flags` (a plain object whose values are
 *      treated as JS-truthy / falsy). Malformed blocks (unbalanced, unknown shape) are
 *      passed through verbatim with a one-time warning so the operator sees the literal
 *      `{{#if ...}}` in the preview and notices.
 *
 *   2. **Variables** — `{{tokenName}}` is replaced by `context.vars[tokenName]`. Unknown /
 *      empty tokens render as the empty string — never leak `{{...}}` to the recipient.
 *
 * The renderer applies both passes to the subject AND the body so the operator can use
 * `{{propertyName}}` in either.
 *
 * Returns `{ subject, body, missingVariables }`. `missingVariables` is the set of tokens
 * the template referenced but the context didn't carry — surfaced in the preview UI as a
 * warning chip.
 */

// Single-level conditional regex — captures: cond name, inner body (may contain {{else}}).
// Non-greedy match so multiple blocks in the same template are evaluated independently.
const COND_BLOCK_RE = /\{\{#if\s+([a-zA-Z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;

function renderConditionals(text, flags) {
  return String(text || '').replace(COND_BLOCK_RE, (_match, condName, inner) => {
    const isTruthy = Boolean(flags && flags[condName]);
    // Inside the block, look for an {{else}} divider — at most one, anywhere.
    const elseIdx = inner.indexOf('{{else}}');
    if (elseIdx < 0) {
      return isTruthy ? inner : '';
    }
    const yesBranch = inner.slice(0, elseIdx);
    const noBranch  = inner.slice(elseIdx + '{{else}}'.length);
    return isTruthy ? yesBranch : noBranch;
  });
}

// specs/email-automation.md rule 19 — an empty name token right before punctuation takes its leading
// spaces with it: « Bonjour {{clientFirstName}}, » reads « Bonjour, », never « Bonjour , ».
const NAME_TOKENS = new Set(['clientFirstName', 'clientLastName', 'clientFullName']);
const LEADING_VARIABLE_RE = /([ \t]*)\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function renderVariables(text, vars, missing) {
  return String(text || '').replace(LEADING_VARIABLE_RE, (match, lead, tokenName, offset, whole) => {
    let value = '';
    if (vars && Object.prototype.hasOwnProperty.call(vars, tokenName)) {
      const v = vars[tokenName];
      value = v == null ? '' : String(v);
    } else if (missing) {
      missing.add(tokenName);
    }
    const next = whole.charAt(offset + match.length);
    if (value === '' && NAME_TOKENS.has(tokenName) && /[,.!?;:]/.test(next)) return '';
    return lead + value;
  });
}

/**
 * @param {{ subject: string, body: string }} template
 * @param {{ vars: object, flags?: object }} context
 * @returns {{ subject: string, body: string, missingVariables: string[] }}
 */
function renderTemplate(template, context) {
  const t = template || {};
  const ctx = context || {};
  const vars = ctx.vars || {};
  const flags = ctx.flags || {};

  // Order matters: evaluate conditionals first so a {{varName}} inside a non-emitted
  // branch never lands in `missingVariables`.
  const subjectAfterCond = renderConditionals(t.subject, flags);
  const bodyAfterCond    = renderConditionals(t.body,    flags);

  const missing = new Set();
  const subject = renderVariables(subjectAfterCond, vars, missing);
  const body    = renderVariables(bodyAfterCond,    vars, missing);

  return {
    subject,
    body,
    missingVariables: Array.from(missing).sort(),
  };
}

/**
 * The first name a text uses that it may not (specs/plugins-phase-p-productisation.md rule 4,
 * specs/guest-email-texts-made-simple.md rule 11), or null. `{{#if x}}` accepts a flag or a token;
 * `{{x}}` a token only. Any other `{{…}}` — a name with a space or an accent — is unknown too: the
 * renderer would leave it in the email as literal braces.
 */
function unknownToken(text, { tokens = [], flags = [] } = {}) {
  const asFlag = new Set([...flags, ...tokens]);
  const asToken = new Set(tokens);
  const re = /\{\{([^{}]*)\}\}/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    const inner = m[1].trim();
    if (inner === 'else' || inner === '/if') continue;
    const cond = /^#if\s+(.*)$/.exec(inner);
    const name = cond ? cond[1].trim() : inner;
    const wellFormed = /^[A-Za-z0-9_]+$/.test(name);
    if (!wellFormed || (cond ? !asFlag.has(name) : !asToken.has(name))) return name;
  }
  return null;
}

/**
 * What makes a text unreadable to the renderer, or null (specs/guest-email-texts-made-simple.md
 * rule 27). The renderer passes a broken piece through as literal text, so the guest would read it:
 *
 *   'brace'    a `{{` or `}}` without its other half, or a label bracket `⟦` / `⟧` left from the page
 *   'unclosed' a `{{#if …}}` without its `{{/if}}`
 *   'orphan'   a `{{/if}}` without its `{{#if …}}`
 *   'else'     a `{{else}}` outside a condition
 *   'nested'   a condition inside a condition (the renderer has one level)
 */
function structureError(text) {
  const source = String(text || '');
  if (/[⟦⟧]/.test(source)) return 'brace';
  if (/\{\{|\}\}/.test(source.replace(/\{\{[^{}]*\}\}/g, ''))) return 'brace';
  let depth = 0;
  const re = /\{\{([^{}]*)\}\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const inner = m[1].trim();
    if (/^#if\b/.test(inner)) {
      if (depth > 0) return 'nested';
      depth += 1;
    } else if (inner === '/if') {
      if (depth === 0) return 'orphan';
      depth -= 1;
    } else if (inner === 'else' && depth === 0) {
      return 'else';
    }
  }
  return depth > 0 ? 'unclosed' : null;
}

const STRUCTURE_MESSAGES = Object.freeze({
  brace: 'Variable incomplète : la remettre depuis les boutons.',
  unclosed: 'Condition sans fin : ajouter « fin si ».',
  orphan: '« fin si » sans condition : le retirer.',
  else: '« sinon » hors d’une condition : le retirer.',
  nested: 'Condition dans une condition : une seule à la fois.',
});

module.exports = {
  renderTemplate,
  unknownToken,
  structureError,
  STRUCTURE_MESSAGES,
  // Exposed for tests + future renderer reuse.
  __test: { renderConditionals, renderVariables },
};
