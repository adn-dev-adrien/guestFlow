/**
 * CGV persistence (specs/terms-acceptance-record.md §5): the single draft, the published versions and
 * the acceptances. Versions and acceptances are insert-only — there is no update or delete statement
 * for them here, on purpose: they are what a guest accepted.
 */

const db = require('../database');

function createTermsModel(database) {
  // Statements are prepared on first use, not at load: modules requiring this one (the controllers)
  // must stay loadable against the minimal schemas the unit tests build.
  const lazy = (make) => { let st = null; return () => { st = st || make(); return st; }; };
  const getDraftStmt = lazy(() => database.prepare('SELECT markdownFr, markdownEn, updatedAt FROM terms_draft WHERE id = 1'));
  const saveDraftStmt = lazy(() => database.prepare(`
    INSERT INTO terms_draft (id, markdownFr, markdownEn, updatedAt) VALUES (1, @fr, @en, @now)
    ON CONFLICT(id) DO UPDATE SET markdownFr = @fr, markdownEn = @en, updatedAt = @now
  `));
  const currentStmt = lazy(() => database.prepare('SELECT * FROM terms_versions ORDER BY version DESC LIMIT 1'));
  const byVersionStmt = lazy(() => database.prepare('SELECT * FROM terms_versions WHERE version = ?'));
  const byIdStmt = lazy(() => database.prepare('SELECT * FROM terms_versions WHERE id = ?'));
  const maxVersionStmt = lazy(() => database.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM terms_versions'));
  const insertVersionStmt = lazy(() => database.prepare(`
    INSERT INTO terms_versions
      (version, markdownFr, markdownEn, htmlFr, htmlEn, variablesJson, contentHash, publishedAt, publishedBy)
    VALUES
      (@version, @markdownFr, @markdownEn, @htmlFr, @htmlEn, @variablesJson, @contentHash, @publishedAt, @publishedBy)
  `));
  const listStmt = lazy(() => database.prepare(`
    SELECT v.id, v.version, v.publishedAt, v.contentHash,
           (SELECT COUNT(*) FROM terms_acceptances a WHERE a.termsVersionId = v.id) AS acceptanceCount
      FROM terms_versions v
     ORDER BY v.version DESC
  `));
  const insertAcceptanceStmt = lazy(() => database.prepare(`
    INSERT INTO terms_acceptances (reservationId, termsVersionId, acceptedAt, ip, userAgent, pluginVersion)
    VALUES (@reservationId, @termsVersionId, @acceptedAt, @ip, @userAgent, @pluginVersion)
  `));
  const insertHistoryStmt = lazy(() => database.prepare(
    "INSERT INTO reservation_history (reservationId, eventType, changedFields) VALUES (?, 'terms_accepted', ?)",
  ));
  const acceptanceByReservationStmt = lazy(() => database.prepare(`
    SELECT a.*, v.version, v.publishedAt, v.contentHash
      FROM terms_acceptances a
      JOIN terms_versions v ON v.id = a.termsVersionId
     WHERE a.reservationId = ?
     ORDER BY a.id DESC
     LIMIT 1
  `));

  const publishTx = lazy(() => database.transaction(({ markdownFr, markdownEn, htmlFr, htmlEn, variables, contentHash, publishedAt, publishedBy }) => {
    const version = maxVersionStmt().get().v + 1;
    insertVersionStmt().run({
      version,
      markdownFr,
      markdownEn,
      htmlFr,
      htmlEn,
      variablesJson: JSON.stringify(variables || {}),
      contentHash,
      publishedAt,
      publishedBy: publishedBy || null,
    });
    return byVersionStmt().get(version);
  }));

  return {
    getDraft() {
      return getDraftStmt().get() || { markdownFr: '', markdownEn: '', updatedAt: null };
    },
    saveDraft({ fr, en }, now = new Date().toISOString()) {
      saveDraftStmt().run({ fr: String(fr || ''), en: String(en || ''), now });
      return this.getDraft();
    },
    getCurrent() {
      return currentStmt().get() || null;
    },
    getByVersion(version) {
      return byVersionStmt().get(Number(version)) || null;
    },
    getById(id) {
      return byIdStmt().get(Number(id)) || null;
    },
    /** Next number allocated inside the transaction, so two publications can never share one. */
    publishVersion(input) {
      return publishTx()(input);
    },
    listVersionsWithCounts() {
      return listStmt().all();
    },
    /**
     * Records the acceptance AND its « Historique » entry (rule 20). Runs inside the booking
     * transaction of publicBookingRequestController, so both land with the devis or not at all.
     */
    insertAcceptance(row) {
      insertHistoryStmt().run(row.reservationId, JSON.stringify([{
        field: 'termsVersion', label: 'Conditions générales', from: null, to: `Version ${row.version} acceptée`,
      }]));
      insertAcceptanceStmt().run({
        reservationId: row.reservationId,
        termsVersionId: row.termsVersionId,
        acceptedAt: row.acceptedAt,
        ip: row.ip || null,
        userAgent: row.userAgent || null,
        pluginVersion: row.pluginVersion || null,
      });
    },
    findAcceptanceByReservation(reservationId) {
      return acceptanceByReservationStmt().get(reservationId) || null;
    },
  };
}

const defaultModel = createTermsModel(db);
defaultModel.create = createTermsModel;

module.exports = defaultModel;
