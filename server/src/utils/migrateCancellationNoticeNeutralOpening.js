/**
 * One-shot (specs/payment-schedule-and-cancellation.md rule 63, audit R45-DB-L2): the seeded `cancellation_notice`
 * opened with non-payment as the reason for every cancellation. Only that exact seeded sentence is rewritten to the
 * neutral opening, in French and in English; a body the operator reworded, the send mode and the enabled flag are left
 * as they are. Returns the number of fields updated.
 */

const SENTENCES = {
  body: [
    'Faute de règlement du solde, nous avons le regret de vous informer que votre séjour {{propertyWithArticle}} est annulé.',
    'Nous avons le regret de vous informer que votre séjour {{propertyWithArticle}} est annulé.',
  ],
  bodyEn: [
    'As the balance was not paid, we are sorry to inform you that your stay at {{propertyWithArticle}} has been cancelled.',
    'We are sorry to inform you that your stay at {{propertyWithArticle}} has been cancelled.',
  ],
};

function runCancellationNoticeNeutralOpeningMigration(db) {
  const row = db.prepare("SELECT id, body, bodyEn FROM email_templates WHERE stableKey = 'cancellation_notice'").get();
  if (!row) return 0;
  let updated = 0;
  for (const [column, [before, after]] of Object.entries(SENTENCES)) {
    const text = String(row[column] || '');
    if (!text.includes(before)) continue;
    db.prepare(`UPDATE email_templates SET ${column} = ?, updatedAt = datetime('now') WHERE id = ?`).run(text.split(before).join(after), row.id);
    updated += 1;
  }
  return updated;
}

module.exports = { runCancellationNoticeNeutralOpeningMigration };
