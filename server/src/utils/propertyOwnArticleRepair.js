/**
 * One-shot repair (2026-10-27 spec review): a property whose name starts with its own article
 * (« La Bergerie », « Le Fournil », « Les Pins », « L'Oustal ») takes that article, confirmed
 * (specs/guest-email-texts-made-simple.md rule 30). Before the review, a property created from the
 * property page was stored « au » unconfirmed, so its guest e-mails read « votre séjour au La Bergerie ».
 *
 *   repairPropertyOwnArticles(db) → number of properties corrected
 */

const propertyArticle = require('./propertyArticle');

function repairPropertyOwnArticles(db) {
  const rows = db.prepare('SELECT id, name, nameArticle, nameArticleConfirmed FROM properties').all();
  const update = db.prepare('UPDATE properties SET nameArticle = ?, nameArticleConfirmed = 1 WHERE id = ?');
  let repaired = 0;
  for (const row of rows) {
    const own = propertyArticle.derive(row.name);
    if (!own.certain) continue;
    if (row.nameArticle === own.article && Number(row.nameArticleConfirmed) === 1) continue;
    update.run(own.article, row.id);
    repaired += 1;
  }
  return repaired;
}

module.exports = { repairPropertyOwnArticles };
