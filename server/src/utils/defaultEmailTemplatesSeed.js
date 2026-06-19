/**
 * Boot-time seed for the default email templates registry
 * (specs/email-automation.md §3 rule 6 + §5).
 *
 * For each entry in `DEFAULT_TEMPLATES`, INSERT into `email_templates` iff no row with
 * that `stableKey` already exists. Operator edits to a previously-seeded row are NEVER
 * overwritten — the seed only inserts when missing. A row deleted by the operator gets
 * re-seeded on the next boot (which the spec calls out as intentional).
 *
 * Returns `{ insertedKeys: [...], skippedKeys: [...] }` so the boot log can summarise the
 * outcome in one line and the unit tests can assert behaviour without inspecting the DB.
 */

const { DEFAULT_TEMPLATES } = require('./defaultEmailTemplatesRegistry');

function ensureDefaultEmailTemplates(database, { logger = console } = {}) {
  try {
    const cols = database.prepare('PRAGMA table_info(email_templates)').all().map((c) => c.name);
    if (cols.length === 0 || !cols.includes('stableKey')) {
      // Schema not migrated yet — silent return. The next boot, after the CREATE TABLE
      // up in database.js runs, will seed normally.
      return { insertedKeys: [], skippedKeys: [], action: 'skipped-schema' };
    }

    const find = database.prepare('SELECT id FROM email_templates WHERE stableKey = ?');
    // Bilingual columns (specs/email-language-fr-en.md) are optional in minimal/legacy schemas — only
    // insert subjectEn/bodyEn when the columns exist.
    const hasEnCols = cols.includes('subjectEn') && cols.includes('bodyEn');
    const insert = hasEnCols
      ? database.prepare(`
        INSERT INTO email_templates
          (stableKey, name, subject, body, subjectEn, bodyEn, dayOffset, sendMode, enabled)
        VALUES
          (@stableKey, @name, @subject, @body, @subjectEn, @bodyEn, @dayOffset, @sendMode, @enabled)
      `)
      : database.prepare(`
        INSERT INTO email_templates
          (stableKey, name, subject, body, dayOffset, sendMode, enabled)
        VALUES
          (@stableKey, @name, @subject, @body, @dayOffset, @sendMode, @enabled)
      `);

    const insertedKeys = [];
    const skippedKeys = [];

    const tx = database.transaction(() => {
      for (const def of DEFAULT_TEMPLATES) {
        if (find.get(def.stableKey)) {
          skippedKeys.push(def.stableKey);
          continue;
        }
        const row = {
          stableKey: def.stableKey,
          name:      def.name,
          subject:   def.subject,
          body:      def.body,
          dayOffset: Number(def.dayOffset),
          sendMode:  def.sendMode,
          enabled:   def.enabled ? 1 : 0,
        };
        if (hasEnCols) {
          row.subjectEn = def.subjectEn || null;
          row.bodyEn    = def.bodyEn || null;
        }
        insert.run(row);
        insertedKeys.push(def.stableKey);
      }
    });
    tx();

    if (insertedKeys.length > 0) {
      logger.log(`[seed:email-templates] inserted ${insertedKeys.length} default template(s): ${insertedKeys.join(', ')}`);
    }

    return { insertedKeys, skippedKeys, action: 'ok' };
  } catch (error) {
    // Surface only when something actually breaks — silent in normal boots.
    console.error(`[seed:email-templates] failed: ${error.message}`);
    return { insertedKeys: [], skippedKeys: [], action: 'error', error: error.message };
  }
}

module.exports = {
  ensureDefaultEmailTemplates,
};
