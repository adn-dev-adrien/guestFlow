/**
 * One-shot (specs/payment-link-lifecycle.md rule 36): the stored payment templates nobody edited gain the
 * sentence stating the link's end of validity, on the line right after the link.
 *
 * « Nobody edited » is judged per side (French `body`, English `bodyEn`): the stored text is, to the
 * character, one of the defaults GuestFlow shipped for that template before this version. The defaults
 * changed over time without rewriting stored rows, so an install keeps whichever version it was seeded
 * with; each is recognised by its SHA-256 below (every version of `defaultEmailTemplatesRegistry.js` up to
 * this change). Only the sentence is inserted — the rest of an older default stays as it is. Any other
 * text is the operator's: left alone and named in the boot log; the token is in the catalogue.
 * Idempotent via `migrations`.
 *
 *   runValidUntilSentenceMigration(db, { logger }) → { ran, updated, kept: ['<stableKey> (fr|en)'] }
 *   withoutValidUntilSentence(body)                 → the body without the sentence (as shipped before rule 36)
 *   withValidUntilSentence(body, lang)              → the sentence inserted after the link, or null
 */

const crypto = require('crypto');
const { VALID_UNTIL_SENTENCE } = require('./defaultEmailTemplatesRegistry');

const MIGRATION_NAME = 'payment_link_valid_until_sentence_v1';
const LINK = '{{paymentLink}}';

/* eslint-disable max-len */
const SHIPPED = Object.freeze({
  deposit_request: {
    fr: ['e3a0c47f657cb97478c16745de23decc26af5356fa652049fd4732a01141f028', 'a12e0971ef50dac1475aa96223387eda9235a996b262127048c2ec00abf23175'],
    en: ['7a6037a403ed05028fa1e99f9ffbe050ffa46351028d05f788ba255d490b624f', '0866127641d100a3ba557eb9db5794a6d1fe886940dd64c9c0e8a9abd1c9281a'],
  },
  balance_request: {
    fr: ['bfb698cee4884d2f403f2f0211ce46bd172dc622a0e4b00ace723aa1c7a5847d', 'f160514bfb3c5c210720a6844936264da3f39dc2aa6547a862b1971130333b44'],
    en: ['2e15987a7d32102910c8b1805d996cb086d5c94850f83e14711c18962c7ed530', '43875edaeb12a26ea7aca40ded12770467532809f518b4bca57ba44c6223c426'],
  },
  full_request: {
    fr: ['8b6ed7f73f4b9502d6595e0875d3f1049419ac68f120509e686fb924705cd7af', '02555b7f60c9fc87b2399f300323d393910aa119354036ddb8ef9a6c78240fc2'],
    en: ['2a49e88226c81c3ae4840c6f11fd8f6d2dbad31aea9dd0d91be0ace38dda8dfc', '84f3059205b8e4adbbf9079e726a491efdfb33d94eff3dc463cef32a670de594'],
  },
  installment_request: {
    fr: ['00b9e8700a283f2a7cdd363a915b4e0fde6e6260d50fec6e39b9a181ad11af67'],
    en: ['039013a7cccea85a2705f4b061dccfc756f2114e43000d558ebf08c45470d4e3'],
  },
  deposit_reminder: {
    fr: ['f7b3ee7de41291be06ad891c882f99cd56fa145459aca7c831a904ec69958e21', 'af16b8f1fbe748539d925a17366670834fd60386b2bcaab7fda77475413dfa2c', '6c6ca650b93b98f3664dc384622984f9af744617acdc8c28ab3d7ebee6512fdd', '4cd3b1aab44e4e93b6591c42087e0dbf272fbafd88187e6d0ff908aba1df8dd9'],
    en: ['7159aeabc500b72bcc7800a56ff831cd01086b79541758800392a7f7e0b12dd6', '80750ea51a8515392f63e696a56cf859445995281ebeeae75034d1aaf69b8949', 'f1e88810b8c2a6162450f325632c69088fecb5c70f452d60565c114b5033454f', '0c21c4667ff9380d06c56aed9b3550894fdeffb2d4b028a046f44a481cd98f53'],
  },
});
/* eslint-enable max-len */

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function withoutValidUntilSentence(body) {
  return [VALID_UNTIL_SENTENCE.fr, VALID_UNTIL_SENTENCE.en]
    .reduce((text, sentence) => text.split(`${LINK}\n${sentence}`).join(LINK), String(body || ''));
}

function withValidUntilSentence(body, lang) {
  const text = String(body || '');
  if (!text.includes(LINK) || text.includes('{{paymentLinkValidUntil}}')) return null;
  return text.replace(LINK, `${LINK}\n${VALID_UNTIL_SENTENCE[lang]}`);
}

function runValidUntilSentenceMigration(db, { logger = console } = {}) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION_NAME)) return { ran: false, updated: 0, kept: [] };
  const outcome = db.transaction(() => {
    let updated = 0;
    const kept = [];
    for (const [stableKey, shipped] of Object.entries(SHIPPED)) {
      const row = db.prepare('SELECT id, body, bodyEn FROM email_templates WHERE stableKey = ?').get(stableKey);
      if (!row) continue;
      for (const [column, lang] of [['body', 'fr'], ['bodyEn', 'en']]) {
        const stored = row[column];
        if (!stored || stored.includes('{{paymentLinkValidUntil}}')) continue;
        if (!shipped[lang].includes(sha256(stored))) {
          kept.push(`${stableKey} (${lang})`);
          continue;
        }
        db.prepare(`UPDATE email_templates SET ${column} = ?, updatedAt = datetime('now') WHERE id = ?`).run(withValidUntilSentence(stored, lang), row.id);
        updated += 1;
      }
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION_NAME);
    return { ran: true, updated, kept };
  })();
  logger.log(`[migration:link-valid-until] ${outcome.updated} template field(s) now state the link's end of validity`
    + `${outcome.kept.length ? `; edited, left as they are: ${outcome.kept.join(', ')}` : ''}`);
  return outcome;
}

module.exports = { runValidUntilSentenceMigration, withoutValidUntilSentence, withValidUntilSentence, MIGRATION_NAME, SHIPPED };
