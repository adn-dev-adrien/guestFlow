// Annual revenue goals, one per exercise (specs/finance-dashboard-redesign.md §3.8 rules 26-29).
// Stored as a JSON object `{ "<exercise key>": amount }` in `app_settings.revenueGoals`; an exercise
// without a goal is simply absent. Pure helpers: parsing the operator's input, validating a
// submitted set, merging it into what is stored, and reading it back.

const MAX_GOAL = 10000000;

const MESSAGES = {
  notPositive: "L'objectif doit être supérieur à 0 €. Laissez vide pour ne pas en fixer.",
  notANumber: 'Un montant en euros, sans lettres (ex. 85 000).',
  tooManyDecimals: 'Deux décimales au plus.',
  tooHigh: 'Montant trop élevé : 10 000 000 € au plus.',
  badExercise: 'Exercice inconnu.',
};

// Rule 27 — empty means « no goal »; spaces (« 85 000 ») and a decimal comma are accepted.
function parseGoalAmount(value) {
  if (value == null) return { ok: true, value: null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { ok: false, error: MESSAGES.notANumber };
    return checkRange(value, String(value));
  }
  const text = String(value).replace(/[\s  ]/g, '').replace(',', '.');
  if (text === '') return { ok: true, value: null };
  if (/^-/.test(text)) return { ok: false, error: MESSAGES.notPositive };
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, error: MESSAGES.notANumber };
  return checkRange(Number(text), text);
}

function checkRange(n, text) {
  if (n <= 0) return { ok: false, error: MESSAGES.notPositive };
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  if (decimals > 2) return { ok: false, error: MESSAGES.tooManyDecimals };
  if (n > MAX_GOAL) return { ok: false, error: MESSAGES.tooHigh };
  return { ok: true, value: n };
}

const isExerciseKey = (key) => /^\d{4}$/.test(String(key)) && Number(key) >= 2000;

// A submitted `{ key: value }` set → `{ goals: { key: number|null }, errors: { key: message } }`.
function validateRevenueGoals(input) {
  const goals = {};
  const errors = {};
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { goals, errors: { _: MESSAGES.notANumber } };
  }
  for (const [key, value] of Object.entries(input)) {
    if (!isExerciseKey(key)) { errors[key] = MESSAGES.badExercise; continue; }
    const parsed = parseGoalAmount(value);
    if (parsed.ok) goals[key] = parsed.value; else errors[key] = parsed.error;
  }
  return { goals, errors };
}

function readRevenueGoals(stored) {
  if (!stored) return {};
  let parsed;
  try { parsed = JSON.parse(stored); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    const n = Number(value);
    if (isExerciseKey(key) && Number.isFinite(n) && n > 0) out[key] = n;
  }
  return out;
}

// Exercises not submitted keep their stored goal; a submitted null removes it.
function mergeRevenueGoals(stored, goals) {
  const merged = { ...readRevenueGoals(stored) };
  for (const [key, value] of Object.entries(goals)) {
    if (value == null) delete merged[key]; else merged[key] = value;
  }
  return Object.keys(merged).length ? JSON.stringify(merged) : null;
}

module.exports = { MAX_GOAL, MESSAGES, parseGoalAmount, validateRevenueGoals, readRevenueGoals, mergeRevenueGoals };
