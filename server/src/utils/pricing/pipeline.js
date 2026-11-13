/**
 * PIPELINE — freely chainable steps over one quote context (specs/pricing-components.md §3 rule 52).
 *
 * Contract: a step is a plain object `{ id, requires: [keys], provides: [keys], apply(ctx) → ctx }`. `apply` returns a
 * new context and never mutates the one it receives (the context is frozen between steps). `buildPipeline(steps,
 * { initial })` checks, when it is built (module load), that:
 *   - every `requires` key is in `initial` or provided by an earlier step, else it throws
 *     `PIPELINE_MISSING_INPUT <step>.<key>`;
 *   - no key is provided twice, else `PIPELINE_DUPLICATE_PROVIDE <step>.<key>`;
 *   - no step id is used twice, else `PIPELINE_DUPLICATE_STEP <id>`.
 * It returns `run(initialContext) → context`. A step may return the reserved key `halt` (a finished result, such as the
 * refusal of a stay with no night): the run stops there and the context holding `halt` is returned. A step that does
 * not return a key it declared fails the run with `PIPELINE_MISSING_OUTPUT <step>.<key>`.
 *
 * Pure: no DB, no clock, no settings.
 */
const HALT = 'halt';

function pipelineError(code, detail) {
  const error = new Error(`${code} ${detail}`);
  error.code = code;
  return error;
}

function buildPipeline(steps, { initial = [] } = {}) {
  const known = new Set(initial);
  const ids = new Set();
  for (const step of steps) {
    if (!step || typeof step.id !== 'string' || typeof step.apply !== 'function') throw pipelineError('PIPELINE_INVALID_STEP', String(step && step.id));
    if (ids.has(step.id)) throw pipelineError('PIPELINE_DUPLICATE_STEP', step.id);
    ids.add(step.id);
    for (const key of step.requires || []) {
      if (!known.has(key)) throw pipelineError('PIPELINE_MISSING_INPUT', `${step.id}.${key}`);
    }
    for (const key of step.provides || []) {
      if (key === HALT) continue;
      if (known.has(key)) throw pipelineError('PIPELINE_DUPLICATE_PROVIDE', `${step.id}.${key}`);
      known.add(key);
    }
  }

  function run(initialContext) {
    let ctx = Object.freeze({ ...initialContext });
    for (const step of steps) {
      const next = step.apply(ctx);
      if (!next || typeof next !== 'object') throw pipelineError('PIPELINE_INVALID_RESULT', step.id);
      if (next[HALT] !== undefined) return Object.freeze({ ...next });
      for (const key of step.provides || []) {
        if (key !== HALT && !(key in next)) throw pipelineError('PIPELINE_MISSING_OUTPUT', `${step.id}.${key}`);
      }
      ctx = Object.freeze({ ...next });
    }
    return ctx;
  }
  run.steps = Object.freeze(steps.map((step) => step.id));
  return run;
}

module.exports = { buildPipeline, HALT };
