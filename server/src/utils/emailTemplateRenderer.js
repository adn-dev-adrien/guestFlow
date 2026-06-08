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
const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

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

function renderVariables(text, vars, missing) {
  return String(text || '').replace(VARIABLE_RE, (_match, tokenName) => {
    if (vars && Object.prototype.hasOwnProperty.call(vars, tokenName)) {
      const v = vars[tokenName];
      return v == null ? '' : String(v);
    }
    if (missing) missing.add(tokenName);
    return '';
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

module.exports = {
  renderTemplate,
  // Exposed for tests + future renderer reuse.
  __test: { renderConditionals, renderVariables },
};
