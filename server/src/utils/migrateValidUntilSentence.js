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
 *   withoutValidUntilSentence(body)                 → the body without the sentence, in either form (as shipped before rule 36)
 *   withValidUntilSentence(body, lang)              → the sentence inserted after the link, or null
 *
 * v2 (rule 59, audit R9 database N1): the sentence moves into a block of its own,
 * `{{#if hasPaymentLinkValidUntil}}\n<sentence>{{/if}}`, so a rollback to a release that knows neither the token
 * nor the flag drops the line instead of mailing « Ce lien est valable jusqu'au . ». It rewrites a side only when
 * its text is, to the character, a default as v1 left it (the defaults of rule 36, or an older default with v1's
 * sentence inserted — `MIGRATED_V1`, every version of the registry up to rule 59); any other text carrying the
 * sentence is the operator's, left alone and named in the boot log. Runs after v1, so an install that never ran
 * v1 gets both in one boot. Idempotent via `migrations`, and a side already in the block form is skipped.
 *
 *   runValidUntilBlockMigration(db, { logger })     → { ran, updated, kept: ['<stableKey> (fr|en)'] }
 *   rollbackSafeValidUntil(body, lang)              → the v1 form turned into the block form, or null
 */

const crypto = require('crypto');
const { VALID_UNTIL_SENTENCE, VALID_UNTIL_FLAG, VALID_UNTIL_BLOCK } = require('./defaultEmailTemplatesRegistry');

const MIGRATION_NAME = 'payment_link_valid_until_sentence_v1';
const MIGRATION_NAME_V2 = 'payment_link_valid_until_sentence_v2';
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

// The sides as v1 left them: each pre-rule-36 default above with its sentence inserted, and the rule-36 defaults.
const MIGRATED_V1 = Object.freeze({
  deposit_request: {
    fr: ['b2281fd326ea1b66fed1664455f6fe9bcb4bd72b4db0e50ffcf6c286a5dad90c', '204cce873b0badd89c3a5c806a7e94367f6c4fa6ff12434c0a21831428799ef1'],
    en: ['3e572f47792064862edb1ac3a508b938f2a0727dbe7d7bd05bf3c412d5022af4', '34ec79a3ef74e5545b1c0bd928860ec627821bb1915277391828ea58991ba452'],
  },
  balance_request: {
    fr: ['d7537ddc874cfc8e197468c19efcb441b801700d9261dc90541979e347beeacc', '53dd918f1679d66b26125d82ae6b8ac79c5f5985a3abab8109db846b7c8fd7a7'],
    en: ['4729e7051d626be3cfb5e4e2681cd21a6acf45f457bb91b207bfc74b512202c2', '162c7dc3bb80e4949217977533d7f52ffdb101a4d339f93c454bf238489047ac'],
  },
  full_request: {
    fr: ['d910eaec60c3eddac355e8e2b76739bae2cc8b95ae3ddf902bf4cecc8bab2e91', '2e5587461dbcb44c3aea0f6fdb29cb61bfe58256d2f1db9398836c5f91d79f10'],
    en: ['d8170de824694267465cc02c89dc624067dcc38148cb2ff52d990a3d35eac9a8', '41691b5fbad11aa5a20d8a33eb61c691877cff4bf092a74fc1113e779b03b38b'],
  },
  installment_request: {
    fr: ['5b24daa232d8d581d2b1914e074b715665a3bf7f0b5e4bb76ebd2420858e733f'],
    en: ['ea726745cd7bdb3628174748f422e4a32d4f503633065a4f51217174329359c9'],
  },
  deposit_reminder: {
    fr: ['bfe99200112925ac95696142841fff49c14e6927f956fae55422526ceb5dfd8c', '9d93753868f59e431654665b4a58577421915a46784088356f5bad90ce7c5b8c', 'b0fb7e3df283461748afee5a026dab760be31cc878e502670f69a12dc0211422', '1a7a9098b9f159ba8cda47127968ce4d66a7ccbfaa6bddaa43cd0341e185abea'],
    en: ['f48de69a22f7c2f423888efc971c19d5da7939f63a91eabd275717a77187e218', 'e5a094a217f0b68be8917f61d054d5bc55f21a76a44527ec12e8da8d3f08081c', 'c988f925097e3feff40b9cda0d613c7c2ce8597ad45a773f5f9c573ec9846b99', '2df31ddcdde294865c248f6ad440d37e907d76d8eda09a518fe434f5b3a017ed'],
  },
});
/* eslint-enable max-len */

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function withoutValidUntilSentence(body) {
  return ['fr', 'en'].reduce((text, lang) => text
    .split(VALID_UNTIL_BLOCK[lang]).join('')
    .split(`${LINK}\n${VALID_UNTIL_SENTENCE[lang]}`).join(LINK), String(body || ''));
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

function rollbackSafeValidUntil(body, lang) {
  const text = String(body || '');
  const v1 = `${LINK}\n${VALID_UNTIL_SENTENCE[lang]}`;
  const at = text.indexOf(v1);
  if (at < 0 || text.indexOf(v1, at + 1) >= 0 || text.includes(VALID_UNTIL_FLAG)) return null;
  const bare = text.slice(0, at) + LINK + text.slice(at + v1.length);
  const before = bare.slice(0, at);
  const insideLinkBlock = before.lastIndexOf('{{#if hasPaymentLink}}') > before.lastIndexOf('{{/if}}');
  const end = insideLinkBlock ? bare.indexOf('{{/if}}', at) + '{{/if}}'.length : at + LINK.length;
  if (insideLinkBlock && end < '{{/if}}'.length) return null;
  return bare.slice(0, end) + VALID_UNTIL_BLOCK[lang] + bare.slice(end);
}

function runValidUntilBlockMigration(db, { logger = console } = {}) {
  if (db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION_NAME_V2)) return { ran: false, updated: 0, kept: [] };
  const outcome = db.transaction(() => {
    let updated = 0;
    const kept = [];
    for (const [stableKey, migrated] of Object.entries(MIGRATED_V1)) {
      const row = db.prepare('SELECT id, body, bodyEn FROM email_templates WHERE stableKey = ?').get(stableKey);
      if (!row) continue;
      for (const [column, lang] of [['body', 'fr'], ['bodyEn', 'en']]) {
        const stored = row[column];
        if (!stored || !stored.includes('{{paymentLinkValidUntil}}') || stored.includes(VALID_UNTIL_FLAG)) continue;
        const safe = migrated[lang].includes(sha256(stored)) ? rollbackSafeValidUntil(stored, lang) : null;
        if (!safe) {
          kept.push(`${stableKey} (${lang})`);
          continue;
        }
        db.prepare(`UPDATE email_templates SET ${column} = ?, updatedAt = datetime('now') WHERE id = ?`).run(safe, row.id);
        updated += 1;
      }
    }
    db.prepare('INSERT INTO migrations (name) VALUES (?)').run(MIGRATION_NAME_V2);
    return { ran: true, updated, kept };
  })();
  logger.log(`[migration:link-valid-until-v2] ${outcome.updated} template field(s) now state the link's end in a rollback-safe block`
    + `${outcome.kept.length ? `; edited, left as they are: ${outcome.kept.join(', ')}` : ''}`);
  return outcome;
}

module.exports = {
  runValidUntilSentenceMigration, runValidUntilBlockMigration, withoutValidUntilSentence, withValidUntilSentence, rollbackSafeValidUntil,
  MIGRATION_NAME, MIGRATION_NAME_V2, SHIPPED, MIGRATED_V1,
};
