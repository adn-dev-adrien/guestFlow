/**
 * One-shot (specs/payment-schedule-and-cancellation.md rule 61): the stored `cancellation_notice` sentence written by
 * the seed names « l'acompte » kept, while the sum the cancellation keeps may be échéances of a plan or a commission
 * withheld. Only that exact seeded sentence is rewritten to « la somme », in French and in English; a body the
 * operator reworded is left as it is. Returns the number of fields updated.
 */

const SENTENCES = {
  body: [
    "l'acompte de {{retainedDepositAmount}} déjà versé reste acquis à titre d'indemnité",
    "la somme de {{retainedDepositAmount}} déjà versée reste acquise à titre d'indemnité",
  ],
  bodyEn: [
    'the deposit of {{retainedDepositAmount}} already paid is retained as compensation',
    'the amount of {{retainedDepositAmount}} already paid is retained as compensation',
  ],
};

function runCancellationNoticeKeptSumMigration(db) {
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

module.exports = { runCancellationNoticeKeptSumMigration };
