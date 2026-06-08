/**
 * Default email templates registry (specs/email-automation.md §3 rule 6).
 *
 * This is the **single source of truth** for every default template GuestFlow ships out
 * of the box. Each entry is a self-contained object — adding a new default email is
 * therefore one file change: append an object below, write a one-line test case
 * asserting it seeds, and you're done. No DB migration, no controller change.
 *
 * Contract for each entry:
 *   - `stableKey` — unique-across-the-registry string, snake_case. The seed uses it as
 *     the lookup key, so it MUST stay stable across boots (renaming it would re-insert
 *     a duplicate). Naming convention: `<purpose>_<offset>` (e.g. `arrival_reminder_7d`).
 *   - `name`      — operator-facing label.
 *   - `subject`   — plain text, supports `{{tokens}}`.
 *   - `body`      — plain text, supports `{{tokens}}` + single-level `{{#if}}…{{/if}}`.
 *   - `dayOffset` — integer; -7 = 7 days before startDate, +1 = day after, 0 = day J.
 *   - `sendMode`  — `'auto'` | `'manual'`. Default templates ship with `'manual'` so the
 *     operator reviews them before the first send.
 *   - `enabled`   — boolean. Ship enabled by default.
 *
 * Supported tokens + conditional flags live in `utils/emailContextBuilder.js`.
 */

const ARRIVAL_REMINDER_7D_BODY = [
  'Bonjour {{clientFirstName}},',
  '',
  'Votre séjour à {{propertyName}} approche, nous nous réjouissons de vous accueillir.',
  '',
  'Rappel des informations de votre séjour :',
  '- Logement : {{propertyName}}',
  '- Arrivée  : le {{startDate}} à partir de {{checkInTime}}',
  '- Départ   : le {{endDate}} avant {{checkOutTime}}',
  '{{#if hasOptions}}- Options choisies : {{optionsList}}',
  '{{/if}}',
  'Afin de préparer au mieux votre arrivée, pourriez-vous nous indiquer votre heure d\'arrivée estimée ?',
  '',
  '{{#if hasBedLinenOption}}Vous avez souscrit à l\'option linge de lit. La configuration prévue pour le logement est : {{bedConfig}}.',
  'Si cette configuration ne vous convient pas, n\'hésitez pas à nous le faire savoir avant votre arrivée afin que nous puissions ajuster la mise en place.',
  '',
  '{{/if}}',
  '{{#if cautionNotBanked}}Pour rappel, la caution de {{cautionAmount}} n\'a pas été prélevée par virement bancaire. Merci de prévoir un chèque de caution du même montant à remettre le jour de votre arrivée.',
  '',
  '{{/if}}',
  'Nous restons à votre disposition pour toute question ; n\'hésitez pas à nous joindre par retour de cet email ou au {{companyPhone}}.',
  '',
  'À très bientôt,',
  '{{companyName}}',
].join('\n');

const DEFAULT_TEMPLATES = Object.freeze([
  Object.freeze({
    stableKey: 'arrival_reminder_7d',
    name:      'Rappel arrivée — J-7',
    subject:   'Préparation de votre séjour à {{propertyName}}',
    body:      ARRIVAL_REMINDER_7D_BODY,
    dayOffset: -7,
    sendMode:  'manual',
    enabled:   true,
  }),
  // ───────────────────────────────────────────────────────────────────────────────
  // Add new default templates below. One object per template; follow the contract
  // documented at the top of this file. Re-uses any of the variables / flags listed in
  // `utils/emailContextBuilder.js`. Add a matching test case in
  // `tests/default-email-templates-seed.unit.test.js` so the seed coverage stays exhaustive.
  // ───────────────────────────────────────────────────────────────────────────────
]);

module.exports = {
  DEFAULT_TEMPLATES,
  // Exposed verbatim for tests that need the same body string the seed inserts.
  ARRIVAL_REMINDER_7D_BODY,
};
