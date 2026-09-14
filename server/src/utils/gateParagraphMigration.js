// One-shot: put the gate paragraph into the arrival reminders an existing instance already has
// (specs/guest-gate-access.md §3.6 rule 23).
//
// The default registry only shapes a FRESH install. On an instance that has been running for
// months, the templates live in the database with the operator's own wording, and nothing would
// ever add the paragraph — the feature would ship with the code and stay invisible in the emails,
// which is the worst of both worlds.
//
// So this migration inserts it, and it is written to be as timid as a migration touching someone
// else's prose should be:
//
//   - it only ever touches the two ARRIVAL reminders, by stableKey;
//   - it skips any body that already mentions `hasGateAccess` — so a second run, or a body the
//     operator wrote themselves, is left alone;
//   - it never rewrites a single existing character: the block is INSERTED;
//   - where it inserts is the one place that reads naturally in every wording we have seen: at the
//     blank line that precedes the sign-off (found by walking back from `{{senderName}}`). If there
//     is no sign-off token, or no blank line before it, it appends at the end rather than guessing —
//     a paragraph in an odd place is visible and takes ten seconds to move; a mangled template is
//     not.
//
// It runs once, guarded by the `migrations` table, and logs exactly what it did.

const ARRIVAL_KEYS = ['arrival_reminder_7d', 'arrival_reminder_1d'];

const BLOCK_FR = [
  '{{#if hasGateAccess}}Ouvrir le portail depuis votre téléphone : {{gateAccessUrl}}',
  'Ce lien vous est propre. Vous pouvez aussi ouvrir {{gateAccessBaseUrl}} et saisir le code {{gateAccessCode}}.',
  "Il fonctionne de votre heure d'arrivée jusqu'à une heure après votre départ, et vous pouvez le partager avec les personnes qui vous accompagnent.",
  '',
  '{{/if}}',
];

const BLOCK_EN = [
  '{{#if hasGateAccess}}Opening the gate from your phone: {{gateAccessUrl}}',
  'This link is yours alone. You can also open {{gateAccessBaseUrl}} and enter the code {{gateAccessCode}}.',
  'It works from your arrival time until one hour after your departure, and you may share it with the people travelling with you.',
  '',
  '{{/if}}',
];

/**
 * Returns the body with the block inserted, or null when it must be left alone.
 * Pure — the whole point is that the placement rule is unit-testable without a database.
 */
function withGateParagraph(body, block) {
  const text = typeof body === 'string' ? body : '';
  if (!text.trim()) return null;                    // an empty body is not ours to fill
  if (text.includes('hasGateAccess')) return null;  // already there, by seed or by hand

  const lines = text.split('\n');
  const signature = lines.findIndex((line) => line.includes('{{senderName}}'));

  let at = lines.length;                            // no sign-off found → append
  if (signature !== -1) {
    // Walk back to the blank line that separates the body from the sign-off.
    let cursor = signature - 1;
    while (cursor >= 0 && lines[cursor].trim() !== '') cursor -= 1;
    // AFTER the blank line, not on it: the paragraph must not run straight on from the previous
    // sentence, and the block's own trailing blank then separates it from the salutation.
    at = cursor >= 0 ? cursor + 1 : signature;      // no blank line → straight above the signature
  }

  const merged = lines.slice(0, at).concat(block, lines.slice(at));
  return merged.join('\n');
}

/** Applies it to the two arrival reminders. Returns what changed, for the log. */
function runGateParagraphMigration(db) {
  const touched = [];
  const rows = db
    .prepare(`SELECT id, stableKey, body, bodyEn FROM email_templates WHERE stableKey IN (${ARRIVAL_KEYS.map(() => '?').join(', ')})`)
    .all(...ARRIVAL_KEYS);

  for (const row of rows) {
    const body = withGateParagraph(row.body, BLOCK_FR);
    const bodyEn = withGateParagraph(row.bodyEn, BLOCK_EN);
    if (!body && !bodyEn) continue;

    db.prepare('UPDATE email_templates SET body = COALESCE(?, body), bodyEn = COALESCE(?, bodyEn) WHERE id = ?')
      .run(body, bodyEn, row.id);
    touched.push({ stableKey: row.stableKey, fr: !!body, en: !!bodyEn });
  }
  return touched;
}

module.exports = { runGateParagraphMigration, ARRIVAL_KEYS, BLOCK_FR, BLOCK_EN, __test: { withGateParagraph } };
