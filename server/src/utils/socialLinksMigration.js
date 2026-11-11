/**
 * One-shot (specs/settings-input-guards.md rule 41): the single Instagram URL becomes the first entry
 * of the social-links list. The URL is copied verbatim, even when it would fail the host check, so no
 * e-mail changes; `instagramUrl` stays written for a rollback (rule 42).
 */

const MIGRATION = 'social_links_from_instagram_v1';

function migrateSocialLinks(db) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION)) return { action: 'already-ran' };
  const cols = db.prepare('PRAGMA table_info(app_settings)').all().map((c) => c.name);
  if (!cols.includes('socialLinks') || !cols.includes('instagramUrl')) return { action: 'skipped-schema' };
  return db.transaction(() => {
    const row = db.prepare('SELECT socialLinks, instagramUrl FROM app_settings WHERE id = 1').get() || {};
    const url = String(row.instagramUrl || '').trim();
    const empty = !row.socialLinks || row.socialLinks === '[]';
    let action = 'kept';
    if (empty && url) {
      db.prepare('UPDATE app_settings SET socialLinks = ? WHERE id = 1').run(JSON.stringify([{ network: 'instagram', url }]));
      action = 'copied';
    } else if (empty) {
      db.prepare("UPDATE app_settings SET socialLinks = '[]' WHERE id = 1").run();
      action = 'empty';
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION);
    return { action };
  })();
}

module.exports = { migrateSocialLinks, MIGRATION };
