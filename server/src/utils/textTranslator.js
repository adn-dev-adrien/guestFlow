/**
 * Token-safe translation of the guest email texts, French → English
 * (specs/guest-email-texts-made-simple.md rules 19–20).
 *
 * The key is the platform's (`GUESTFLOW_TRANSLATE_API_KEY`, set by the operator), never the owner's:
 * without it `isAvailable()` is false and nothing is offered. The call is the Anthropic Messages API
 * through plain `fetch` — no SDK dependency for one request.
 *
 * Every `{{…}}` is swapped for a numbered marker before sending and swapped back after; a text whose
 * markers do not all come back exactly once fails the whole run. All or nothing: the caller writes
 * only when every text came back whole.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-5-5';
const BATCH = 40;

const SYSTEM = [
  'You translate short French texts of a holiday rental\'s guest emails into natural British English.',
  'Keep the warm, plain tone; address the guest as "you".',
  'Markers like [[0]] stand for variables: copy each one exactly once, unchanged, where it belongs in the sentence.',
  'Keep line breaks and list dashes. Return one translation per input, in the same order.',
].join(' ');

class TranslationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TranslationError';
    this.code = 'TRANSLATION_FAILED';
  }
}

function apiKey() {
  return String(process.env.GUESTFLOW_TRANSLATE_API_KEY || '').trim();
}

function isAvailable() {
  return apiKey() !== '';
}

/** `{{…}}` → `[[n]]`, with what each marker stood for. */
function protect(text) {
  const tokens = [];
  const masked = String(text).replace(/\{\{[^{}]*\}\}/g, (match) => {
    tokens.push(match);
    return `[[${tokens.length - 1}]]`;
  });
  return { masked, tokens };
}

/** The markers back to their tokens, or null when one is missing, repeated or invented. */
function restore(translated, tokens) {
  const found = String(translated).match(/\[\[\d+\]\]/g) || [];
  const expected = tokens.map((_, i) => `[[${i}]]`);
  if (found.length !== expected.length || expected.some((m) => !found.includes(m))) return null;
  return String(translated).replace(/\[\[(\d+)\]\]/g, (_, i) => tokens[Number(i)]);
}

async function translateBatch(texts, fetchImpl) {
  const res = await fetchImpl(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { translations: { type: 'array', items: { type: 'string' } } },
            required: ['translations'],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: 'user', content: JSON.stringify(texts) }],
    }),
  });
  if (!res.ok) throw new TranslationError(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.stop_reason === 'refusal' || body.stop_reason === 'max_tokens') throw new TranslationError(String(body.stop_reason));
  const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new TranslationError('Réponse illisible'); }
  const out = parsed && Array.isArray(parsed.translations) ? parsed.translations : null;
  if (!out || out.length !== texts.length || out.some((t) => typeof t !== 'string')) throw new TranslationError('Réponse incomplète');
  return out;
}

/**
 * @param {string[]} frTexts
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 * @returns {Promise<string[]>} the English texts, same order
 * @throws {TranslationError} on any failure — nothing partial is ever returned
 */
async function translate(frTexts, { fetchImpl = globalThis.fetch } = {}) {
  if (!isAvailable()) throw new TranslationError('Service non configuré');
  const prepared = frTexts.map(protect);
  const result = [];
  for (let i = 0; i < prepared.length; i += BATCH) {
    const slice = prepared.slice(i, i + BATCH);
    let translated;
    try {
      translated = await translateBatch(slice.map((p) => p.masked), fetchImpl);
    } catch (err) {
      throw err instanceof TranslationError ? err : new TranslationError(err && err.message);
    }
    translated.forEach((t, j) => {
      const restored = restore(t, slice[j].tokens);
      if (restored == null) throw new TranslationError('Variable perdue');
      result.push(restored);
    });
  }
  return result;
}

module.exports = { translate, isAvailable, protect, restore, TranslationError, MODEL };
